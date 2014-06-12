package models.tracing.volume

import braingames.geometry.{Point3D, BoundingBox}
import models.annotation.{AnnotationLike, AnnotationContentService, AnnotationContent, AnnotationSettings}
import models.basics.SecuredBaseDAO
import models.binary.UserDataLayerDAO
import models.binary.DataSet
import java.io.InputStream
import play.api.libs.json.{Json, JsValue}
import braingames.reactivemongo.{DBAccessContext, GlobalAccessContext}
import braingames.util.{FoxImplicits, Fox}
import reactivemongo.bson.BSONObjectID
import play.modules.reactivemongo.json.BSONFormats._
import play.api.libs.concurrent.Execution.Implicits._
import controllers.DataStoreHandler
import braingames.binary.models.{DataLayer, UserDataLayer, DataSource}

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 02.06.13
 * Time: 11:23
 */
case class VolumeTracing(
  dataSetName: String,
  userDataLayerName: String,
  activeCellId: Option[Int] = None,
  timestamp: Long = System.currentTimeMillis(),
  editPosition: Point3D = Point3D(0,0,0),
  zoomLevel: Double,
  boundingBox: Option[BoundingBox] = None,
  settings: AnnotationSettings = AnnotationSettings.volumeDefault,
  _id: BSONObjectID = BSONObjectID.generate)
  extends AnnotationContent {

  def id = _id.stringify

  type Self = VolumeTracing

  def service = VolumeTracingService

  def updateFromJson(jsUpdates: Seq[JsValue])(implicit ctx: DBAccessContext): Fox[VolumeTracing] = {
    val updates = jsUpdates.flatMap { json =>
      TracingUpdater.createUpdateFromJson(json)
    }
    if (jsUpdates.size == updates.size) {
      for {
        updatedTracing <- updates.foldLeft(Fox.successful(this)) {
          case (f, updater) => f.flatMap(tracing => updater.update(tracing))
        }
        _ <- VolumeTracingDAO.update(updatedTracing._id, updatedTracing.copy(timestamp = System.currentTimeMillis))(GlobalAccessContext)
      } yield updatedTracing
    } else {
      Fox.empty
    }
  }

  def copyDeepAndInsert = ???

  def mergeWith(source: AnnotationContent) = ???

  def contentType: String = VolumeTracing.contentType

  def toDownloadStream: Fox[InputStream] = ???

  def downloadFileExtension: String = ???

  override def contentData = {
    UserDataLayerDAO.findOneByName(userDataLayerName)(GlobalAccessContext).map{ userDataLayer =>
      Json.obj(
        "activeCell" -> activeCellId,
        "customLayers" -> List(AnnotationContent.dataLayerWrites.writes(userDataLayer.dataLayer)),
        "nextCell" -> userDataLayer.dataLayer.nextSegmentationId.getOrElse[Long](1),
        "zoomLevel" -> zoomLevel
      )
    }
  }
}

object VolumeTracingService extends AnnotationContentService with FoxImplicits{
  type AType = VolumeTracing

  def dao = VolumeTracingDAO

  def updateSettings(settings: AnnotationSettings, tracingId: String)(implicit ctx: DBAccessContext): Fox[Boolean] = ???

  def findOneById(id: String)(implicit ctx: DBAccessContext) =
    VolumeTracingDAO.findOneById(id)

  def createFrom(baseDataSet: DataSet)(implicit ctx: DBAccessContext) = {
    for {
      baseSource <- baseDataSet.dataSource.toFox
      dataLayer <- DataStoreHandler.createUserDataLayer(baseDataSet.dataStoreInfo, baseSource)
      volumeTracing = VolumeTracing(baseDataSet.name, dataLayer.dataLayer.name, editPosition = baseDataSet.defaultStart, zoomLevel = VolumeTracing.defaultZoomLevel)
      _ <- UserDataLayerDAO.insert(dataLayer)
      _ <- VolumeTracingDAO.insert(volumeTracing)
    } yield {
      volumeTracing
    }
  }

  def clearTracingData(id: String)(implicit ctx: DBAccessContext): Fox[VolumeTracingService.AType] = ???
}

object VolumeTracing{
  implicit val volumeTracingFormat = Json.format[VolumeTracing]

  val contentType = "volumeTracing"

  val defaultZoomLevel = 0.0
}

object VolumeTracingDAO extends SecuredBaseDAO[VolumeTracing] {
  val collectionName = "volumes"

  val formatter = VolumeTracing.volumeTracingFormat
}
