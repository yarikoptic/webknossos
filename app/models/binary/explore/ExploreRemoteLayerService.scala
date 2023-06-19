package models.binary.explore

import com.scalableminds.util.geometry.{Vec3Double, Vec3Int}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.dataformats.n5.{N5DataLayer, N5SegmentationLayer}
import com.scalableminds.webknossos.datastore.dataformats.precomputed.{
  PrecomputedDataLayer,
  PrecomputedSegmentationLayer
}
import com.scalableminds.webknossos.datastore.dataformats.zarr3.{Zarr3DataLayer, Zarr3SegmentationLayer}
import com.scalableminds.webknossos.datastore.dataformats.zarr._
import com.scalableminds.webknossos.datastore.datareaders.n5.N5Header
import com.scalableminds.webknossos.datastore.datareaders.precomputed.PrecomputedHeader
import com.scalableminds.webknossos.datastore.datareaders.zarr._
import com.scalableminds.webknossos.datastore.datareaders.zarr3.Zarr3ArrayHeader
import com.scalableminds.webknossos.datastore.datavault.VaultPath
import com.scalableminds.webknossos.datastore.models.datasource._
import com.scalableminds.webknossos.datastore.storage.{DataVaultService, RemoteSourceDescriptor}
import com.typesafe.scalalogging.LazyLogging
import models.binary.credential.CredentialService
import models.user.User
import net.liftweb.common.{Empty, Failure, Full}
import net.liftweb.util.Helpers.tryo
import oxalis.security.WkEnv
import play.api.libs.json.{Json, OFormat}

import java.net.URI
import javax.inject.Inject
import scala.collection.mutable.ListBuffer
import scala.concurrent.ExecutionContext
import scala.util.Try

case class ExploreRemoteDatasetParameters(remoteUri: String,
                                          credentialIdentifier: Option[String],
                                          credentialSecret: Option[String])

object ExploreRemoteDatasetParameters {
  implicit val jsonFormat: OFormat[ExploreRemoteDatasetParameters] = Json.format[ExploreRemoteDatasetParameters]
}

class ExploreRemoteLayerService @Inject()(credentialService: CredentialService, dataVaultService: DataVaultService)
    extends FoxImplicits
    with LazyLogging {

  def exploreRemoteDatasource(
      urisWithCredentials: List[ExploreRemoteDatasetParameters],
      requestIdentity: WkEnv#I,
      reportMutable: ListBuffer[String])(implicit ec: ExecutionContext): Fox[GenericDataSource[DataLayer]] =
    for {
      exploredLayersNested <- Fox.serialCombined(urisWithCredentials)(
        parameters =>
          exploreRemoteLayersForUri(parameters.remoteUri,
                                    parameters.credentialIdentifier,
                                    parameters.credentialSecret,
                                    reportMutable,
                                    requestIdentity))
      layersWithVoxelSizes = exploredLayersNested.flatten
      _ <- bool2Fox(layersWithVoxelSizes.nonEmpty) ?~> "Detected zero layers"
      rescaledLayersAndVoxelSize <- rescaleLayersByCommonVoxelSize(layersWithVoxelSizes) ?~> "Could not extract common voxel size from layers"
      rescaledLayers = rescaledLayersAndVoxelSize._1
      voxelSize = rescaledLayersAndVoxelSize._2
      renamedLayers = makeLayerNamesUnique(rescaledLayers)
      dataSource = GenericDataSource[DataLayer](
        DataSourceId("", ""), // Frontend will prompt user for a good name
        renamedLayers,
        voxelSize
      )
    } yield dataSource

  private def makeLayerNamesUnique(layers: List[DataLayer]): List[DataLayer] = {
    val namesSetMutable = scala.collection.mutable.Set[String]()
    layers.map { layer: DataLayer =>
      var nameCandidate = layer.name
      var index = 1
      while (namesSetMutable.contains(nameCandidate)) {
        index += 1
        nameCandidate = f"${layer.name}_$index"
      }
      namesSetMutable.add(nameCandidate)
      if (nameCandidate == layer.name) {
        layer
      } else
        layer match {
          case l: ZarrDataLayer         => l.copy(name = nameCandidate)
          case l: ZarrSegmentationLayer => l.copy(name = nameCandidate)
          case l: N5DataLayer           => l.copy(name = nameCandidate)
          case l: N5SegmentationLayer   => l.copy(name = nameCandidate)
          case _                        => throw new Exception("Encountered unsupported layer format during explore remote")
        }
    }
  }

  private def magFromVoxelSize(minVoxelSize: Vec3Double, voxelSize: Vec3Double)(
      implicit ec: ExecutionContext): Fox[Vec3Int] = {
    def isPowerOfTwo(x: Int): Boolean =
      x != 0 && (x & (x - 1)) == 0

    val mag = (voxelSize / minVoxelSize).round.toVec3Int
    for {
      _ <- bool2Fox(isPowerOfTwo(mag.x) && isPowerOfTwo(mag.x) && isPowerOfTwo(mag.x)) ?~> s"invalid mag: $mag. Must all be powers of two"
    } yield mag
  }

  private def checkForDuplicateMags(magGroup: List[Vec3Int])(implicit ec: ExecutionContext): Fox[Unit] =
    for {
      _ <- bool2Fox(magGroup.length == 1) ?~> s"detected mags are not unique, found $magGroup"
    } yield ()

  private def rescaleLayersByCommonVoxelSize(layersWithVoxelSizes: List[(DataLayer, Vec3Double)])(
      implicit ec: ExecutionContext): Fox[(List[DataLayer], Vec3Double)] = {
    val allVoxelSizes = layersWithVoxelSizes
      .flatMap(layerWithVoxelSize => {
        val layer = layerWithVoxelSize._1
        val voxelSize = layerWithVoxelSize._2

        layer.resolutions.map(resolution => voxelSize * resolution.toVec3Double)
      })
      .toSet
    val minVoxelSizeOpt = Try(allVoxelSizes.minBy(_.toTuple)).toOption

    for {
      minVoxelSize <- option2Fox(minVoxelSizeOpt)
      allMags <- Fox.combined(allVoxelSizes.map(magFromVoxelSize(minVoxelSize, _)).toList) ?~> s"voxel sizes for layers are not uniform, got ${layersWithVoxelSizes
        .map(_._2)}"
      groupedMags = allMags.groupBy(_.maxDim)
      _ <- Fox.combined(groupedMags.values.map(checkForDuplicateMags).toList)
      rescaledLayers = layersWithVoxelSizes.map(layerWithVoxelSize => {
        val layer = layerWithVoxelSize._1
        val layerVoxelSize = layerWithVoxelSize._2
        val magFactors = (layerVoxelSize / minVoxelSize).toVec3Int
        layer match {
          case l: ZarrDataLayer =>
            l.copy(mags = l.mags.map(mag => mag.copy(mag = mag.mag * magFactors)),
                   boundingBox = l.boundingBox * magFactors)
          case l: ZarrSegmentationLayer =>
            l.copy(mags = l.mags.map(mag => mag.copy(mag = mag.mag * magFactors)),
                   boundingBox = l.boundingBox * magFactors)
          case l: N5DataLayer =>
            l.copy(mags = l.mags.map(mag => mag.copy(mag = mag.mag * magFactors)),
                   boundingBox = l.boundingBox * magFactors)
          case l: N5SegmentationLayer =>
            l.copy(mags = l.mags.map(mag => mag.copy(mag = mag.mag * magFactors)),
                   boundingBox = l.boundingBox * magFactors)
          case l: PrecomputedDataLayer =>
            l.copy(mags = l.mags.map(mag => mag.copy(mag = mag.mag * magFactors)),
                   boundingBox = l.boundingBox * magFactors)
          case l: PrecomputedSegmentationLayer =>
            l.copy(mags = l.mags.map(mag => mag.copy(mag = mag.mag * magFactors)),
                   boundingBox = l.boundingBox * magFactors)
          case l: Zarr3DataLayer =>
            l.copy(mags = l.mags.map(mag => mag.copy(mag = mag.mag * magFactors)),
                   boundingBox = l.boundingBox * magFactors)
          case l: Zarr3SegmentationLayer =>
            l.copy(mags = l.mags.map(mag => mag.copy(mag = mag.mag * magFactors)),
                   boundingBox = l.boundingBox * magFactors)
          case _ => throw new Exception("Encountered unsupported layer format during explore remote")
        }
      })
    } yield (rescaledLayers, minVoxelSize)
  }

  private def exploreRemoteLayersForUri(
      layerUri: String,
      credentialIdentifier: Option[String],
      credentialSecret: Option[String],
      reportMutable: ListBuffer[String],
      requestingUser: User)(implicit ec: ExecutionContext): Fox[List[(DataLayer, Vec3Double)]] =
    for {
      uri <- tryo(new URI(normalizeUri(layerUri))) ?~> s"Received invalid URI: $layerUri"
      credentialOpt = credentialService.createCredentialOpt(uri,
                                                            credentialIdentifier,
                                                            credentialSecret,
                                                            requestingUser._id,
                                                            requestingUser._organization)
      remoteSource = RemoteSourceDescriptor(uri, credentialOpt)
      credentialId <- Fox.runOptional(credentialOpt)(c => credentialService.insertOne(c)) ?~> "dataVault.credential.insert.failed"
      remotePath <- dataVaultService.getVaultPath(remoteSource) ?~> "dataVault.setup.failed"
      layersWithVoxelSizes <- exploreRemoteLayersForRemotePath(
        remotePath,
        credentialId.map(_.toString),
        reportMutable,
        List(
          new ZarrArrayExplorer,
          new NgffExplorer,
          new WebknossosZarrExplorer,
          new N5ArrayExplorer,
          new N5MultiscalesExplorer,
          new PrecomputedExplorer,
          new Zarr3ArrayExplorer
        )
      )
    } yield layersWithVoxelSizes

  private def normalizeUri(uri: String): String =
    if (uri.endsWith(N5Header.FILENAME_ATTRIBUTES_JSON)) uri.dropRight(N5Header.FILENAME_ATTRIBUTES_JSON.length)
    else if (uri.endsWith(ZarrHeader.FILENAME_DOT_ZARRAY)) uri.dropRight(ZarrHeader.FILENAME_DOT_ZARRAY.length)
    else if (uri.endsWith(NgffMetadata.FILENAME_DOT_ZATTRS)) uri.dropRight(NgffMetadata.FILENAME_DOT_ZATTRS.length)
    else if (uri.endsWith(NgffGroupHeader.FILENAME_DOT_ZGROUP))
      uri.dropRight(NgffGroupHeader.FILENAME_DOT_ZGROUP.length)
    else if (uri.endsWith(PrecomputedHeader.FILENAME_INFO)) uri.dropRight(PrecomputedHeader.FILENAME_INFO.length)
    else if (uri.endsWith(Zarr3ArrayHeader.ZARR_JSON)) uri.dropRight(Zarr3ArrayHeader.ZARR_JSON.length)
    else uri

  private def exploreRemoteLayersForRemotePath(
      remotePath: VaultPath,
      credentialId: Option[String],
      reportMutable: ListBuffer[String],
      explorers: List[RemoteLayerExplorer])(implicit ec: ExecutionContext): Fox[List[(DataLayer, Vec3Double)]] =
    explorers match {
      case Nil => Fox.empty
      case currentExplorer :: remainingExplorers =>
        reportMutable += s"\nTrying to explore $remotePath as ${currentExplorer.name}..."
        currentExplorer.explore(remotePath, credentialId).futureBox.flatMap {
          case Full(layersWithVoxelSizes) =>
            reportMutable += s"Found ${layersWithVoxelSizes.length} ${currentExplorer.name} layers at $remotePath."
            Fox.successful(layersWithVoxelSizes)
          case f: Failure =>
            reportMutable += s"Error when reading $remotePath as ${currentExplorer.name}: ${Fox.failureChainAsString(f)}"
            exploreRemoteLayersForRemotePath(remotePath, credentialId, reportMutable, remainingExplorers)
          case Empty =>
            reportMutable += s"Error when reading $remotePath as ${currentExplorer.name}: Empty"
            exploreRemoteLayersForRemotePath(remotePath, credentialId, reportMutable, remainingExplorers)
        }
    }

}
