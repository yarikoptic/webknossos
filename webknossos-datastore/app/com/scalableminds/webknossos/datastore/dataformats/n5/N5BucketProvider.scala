package com.scalableminds.webknossos.datastore.dataformats.n5

import brave.play.{TraceData, ZipkinTraceServiceLike}
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.dataformats.{BucketProvider, DataCubeHandle, MagLocator}
import com.scalableminds.webknossos.datastore.datareaders.n5.N5Array
import com.scalableminds.webknossos.datastore.datavault.VaultPath
import com.scalableminds.webknossos.datastore.models.BucketPosition
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceId
import com.scalableminds.webknossos.datastore.models.datasource.DataLayer
import com.scalableminds.webknossos.datastore.models.requests.DataReadInstruction
import com.scalableminds.webknossos.datastore.storage.RemoteSourceDescriptorService
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.Empty
import ucar.ma2.{Array => MultiArray}

import scala.concurrent.ExecutionContext

class N5CubeHandle(n5Array: N5Array) extends DataCubeHandle with LazyLogging {

  def cutOutBucket(bucket: BucketPosition, dataLayer: DataLayer)(implicit ec: ExecutionContext,
                                                                 parentData: TraceData): Fox[Array[Byte]] = {
    val shape = Vec3Int.full(bucket.bucketLength)
    val offset = Vec3Int(bucket.topLeft.voxelXInMag, bucket.topLeft.voxelYInMag, bucket.topLeft.voxelZInMag)
    n5Array.readBytesXYZ(shape, offset)
  }

  override protected def onFinalize(): Unit = ()

}

class N5BucketProvider(layer: N5Layer,
                       dataSourceId: DataSourceId,
                       val remoteSourceDescriptorServiceOpt: Option[RemoteSourceDescriptorService],
                       sharedChunkContentsCache: Option[AlfuCache[String, MultiArray]],
                       val tracer: ZipkinTraceServiceLike)
    extends BucketProvider
    with LazyLogging {

  override def loadFromUnderlying(readInstruction: DataReadInstruction)(
      implicit ec: ExecutionContext): Fox[N5CubeHandle] = {
    val n5MagOpt: Option[MagLocator] =
      layer.mags.find(_.mag == readInstruction.bucket.mag)

    n5MagOpt match {
      case None => Fox.empty
      case Some(n5Mag) =>
        remoteSourceDescriptorServiceOpt match {
          case Some(remoteSourceDescriptorService: RemoteSourceDescriptorService) =>
            for {
              magPath: VaultPath <- if (n5Mag.isRemote) {
                remoteSourceDescriptorService.vaultPathFor(n5Mag)
              } else localPathFrom(readInstruction, n5Mag.pathWithFallback)
              chunkContentsCache <- sharedChunkContentsCache.toFox
              cubeHandle <- N5Array
                .open(magPath,
                      dataSourceId,
                      layer.name,
                      n5Mag.axisOrder,
                      n5Mag.channelIndex,
                      chunkContentsCache,
                      tracer)
                .map(new N5CubeHandle(_))
            } yield cubeHandle
          case None => Empty
        }
    }
  }
}
