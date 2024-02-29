package com.scalableminds.webknossos.datastore.dataformats.precomputed

import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.dataformats.{BucketProvider, DatasetArrayHandle, MagLocator}
import com.scalableminds.webknossos.datastore.datareaders.precomputed.PrecomputedArray
import com.scalableminds.webknossos.datastore.datavault.VaultPath
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceId
import com.scalableminds.webknossos.datastore.models.requests.DataReadInstruction
import com.scalableminds.webknossos.datastore.storage.RemoteSourceDescriptorService
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.Empty

import scala.concurrent.ExecutionContext
import ucar.ma2.{Array => MultiArray}

class PrecomputedBucketProvider(layer: PrecomputedLayer,
                                dataSourceId: DataSourceId,
                                val remoteSourceDescriptorServiceOpt: Option[RemoteSourceDescriptorService],
                                sharedChunkContentsCache: Option[AlfuCache[String, MultiArray]])
    extends BucketProvider
    with LazyLogging {

  override def openDatasetArrayHandle(readInstruction: DataReadInstruction)(
      implicit ec: ExecutionContext): Fox[DatasetArrayHandle] = {
    val magLocatorOpt: Option[MagLocator] =
      layer.mags.find(_.mag == readInstruction.bucket.mag)

    magLocatorOpt match {
      case None => Fox.empty
      case Some(magLocator) =>
        remoteSourceDescriptorServiceOpt match {
          case Some(remoteSourceDescriptorService: RemoteSourceDescriptorService) =>
            for {
              magPath: VaultPath <- remoteSourceDescriptorService.vaultPathFor(readInstruction.baseDir,
                                                                               readInstruction.dataSource.id,
                                                                               readInstruction.dataLayer.name,
                                                                               magLocator)
              chunkContentsCache <- sharedChunkContentsCache.toFox
              cubeHandle <- PrecomputedArray
                .open(magPath,
                      dataSourceId,
                      layer.name,
                      magLocator.axisOrder,
                      magLocator.channelIndex,
                      layer.additionalAxes,
                      chunkContentsCache)
                .map(new DatasetArrayHandle(_))
            } yield cubeHandle
          case None => Empty
        }
    }
  }

}
