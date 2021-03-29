package com.scalableminds.webknossos.datastore.dataformats

import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.dataformats.wkw.WKWCube
import com.scalableminds.webknossos.datastore.models.BucketPosition
import com.scalableminds.webknossos.datastore.models.requests.DataReadInstruction
import com.scalableminds.webknossos.datastore.storage.DataCubeCache
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Box, Empty}

import scala.concurrent.ExecutionContext

trait BucketProvider extends FoxImplicits with LazyLogging {

  var requestCount: List[Int] = List()

  // To be defined in subclass.
  def loadFromUnderlying(readInstruction: DataReadInstruction): Box[WKWCube] = Empty

  def load(readInstruction: DataReadInstruction, cache: DataCubeCache)(
      implicit ec: ExecutionContext): Fox[Array[Byte]] = {
    val t = System.currentTimeMillis
    var result = cache.withCache(readInstruction)(loadFromUnderlyingWithTimeout)(_.cutOutBucket(readInstruction.bucket))
    val duration = System.currentTimeMillis - t
      logger.info(
        s"Loading file took $duration ms\n"
          + s"  dataSource: ${readInstruction.dataSource.id.name}\n"
          + s"  dataLayer: ${readInstruction.dataLayer.name}\n"
          + s"  cube: ${readInstruction.cube}"
      )
    result
  }

  private def loadFromUnderlyingWithTimeout(readInstruction: DataReadInstruction): Box[WKWCube] = {
    loadFromUnderlying(readInstruction)
  }

  def bucketStream(version: Option[Long] = None): Iterator[(BucketPosition, Array[Byte])] =
    Iterator.empty
}
