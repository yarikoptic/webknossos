package controllers

import javax.inject.Inject
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceId
import com.scalableminds.webknossos.datastore.models.datasource.inbox.{InboxDataSourceLike => InboxDataSource}
import com.scalableminds.webknossos.datastore.services.DataStoreStatus
import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.scalalogging.LazyLogging
import models.annotation.{Annotation, AnnotationDAO}
import models.binary._
import models.user.time.TimeSpanService
import play.api.i18n.{I18nSupport, Messages, MessagesApi}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.{JsError, JsObject, JsSuccess}
import play.api.mvc._
import models.annotation.AnnotationState._
import oxalis.security.WebknossosSilhouette

import scala.concurrent.Future

class WKDataStoreController @Inject()(val messagesApi: MessagesApi)
  extends Controller
    with WKDataStoreActionHelper
    with LazyLogging {

  val bearerTokenService = WebknossosSilhouette.environment.combinedAuthenticatorService.tokenAuthenticatorService

  def validateDataSetUpload(name: String) = DataStoreAction(name).async(parse.json) { implicit request =>
    for {
      uploadInfo <- request.body.validate[DataSourceId].asOpt.toFox ?~> "dataStore.upload.invalid"
      _ <- bool2Fox(DataSetService.isProperDataSetName(uploadInfo.name)) ?~> "dataSet.name.invalid"
      _ <- DataSetService.assertNewDataSetName(uploadInfo.name)(GlobalAccessContext) ?~> "dataSet.name.alreadyTaken"
      _ <- bool2Fox(uploadInfo.team.nonEmpty) ?~> "team.invalid"
    } yield Ok
  }

  def statusUpdate(name: String) = DataStoreAction(name).async(parse.json) { implicit request =>
    request.body.validate[DataStoreStatus] match {
      case JsSuccess(status, _) =>
        logger.debug(s"Status update from data store '$name'. Status: " + status.ok)
        DataStoreDAO.updateUrlByName(name, status.url)(GlobalAccessContext).map(_ => Ok)
      case e: JsError =>
        logger.error("Data store '$name' sent invalid update. Error: " + e)
        Future.successful(JsonBadRequest(JsError.toJson(e)))
    }
  }

  def updateAll(name: String) = DataStoreAction(name).async(parse.json) { implicit request =>
    request.body.validate[List[InboxDataSource]] match {
      case JsSuccess(dataSources, _) =>
        for {
          _ <- DataSetService.deactivateUnreportedDataSources(request.dataStore.name, dataSources)(GlobalAccessContext)
          _ <- DataSetService.updateDataSources(request.dataStore, dataSources)(GlobalAccessContext)
        } yield {
          JsonOk
        }

      case e: JsError =>
        logger.warn("Data store reported invalid json for data sources.")
        Fox.successful(JsonBadRequest(JsError.toJson(e)))
    }
  }

  def updateOne(name: String) = DataStoreAction(name).async(parse.json) { implicit request =>
    request.body.validate[InboxDataSource] match {
      case JsSuccess(dataSource, _) =>
        for {
          _ <- DataSetService.updateDataSources(request.dataStore, List(dataSource))(GlobalAccessContext)
        } yield {
          JsonOk
        }
      case e: JsError =>
        logger.warn("Data store reported invalid json for data source.")
        Fox.successful(JsonBadRequest(JsError.toJson(e)))
    }
  }

  def handleTracingUpdateReport(name: String) = DataStoreAction(name).async(parse.json) { implicit request =>
    for {
      tracingId <- (request.body \ "tracingId").asOpt[String].toFox
      annotation <- AnnotationDAO.findOneByTracingId(tracingId)(GlobalAccessContext)
      _ <- ensureAnnotationNotFinished(annotation)
      timestamps <- (request.body \ "timestamps").asOpt[List[Long]].toFox
      statisticsOpt = (request.body \ "statistics").asOpt[JsObject]
      userTokenOpt = (request.body \ "userToken").asOpt[String]
      _ <- statisticsOpt match {
        case Some(statistics) => AnnotationDAO.updateStatistics(annotation._id, statistics)(GlobalAccessContext)
        case None => Fox.successful(())
      }
      _ <- AnnotationDAO.updateModified(annotation._id, System.currentTimeMillis)(GlobalAccessContext)
      userBox <- bearerTokenService.userForTokenOpt(userTokenOpt)(GlobalAccessContext).futureBox
      _ <- Fox.runOptional(userBox)(user => TimeSpanService.logUserInteraction(timestamps, user, annotation)(GlobalAccessContext))
    } yield {
      Ok
    }
  }

  private def ensureAnnotationNotFinished(annotation: Annotation) = {
    if (annotation.state == Finished) Fox.failure("annotation already finshed")
    else Fox.successful(())
  }
}

trait WKDataStoreActionHelper extends FoxImplicits with Results with I18nSupport {

  import play.api.mvc._

  class RequestWithDataStore[A](val dataStore: DataStore, request: Request[A]) extends WrappedRequest[A](request)

  case class DataStoreAction(name: String) extends ActionBuilder[RequestWithDataStore] {
    def invokeBlock[A](request: Request[A], block: (RequestWithDataStore[A]) => Future[Result]): Future[Result] = {
      request.getQueryString("key")
        .toFox
        .flatMap(key => DataStoreDAO.findOneByKey(key)(GlobalAccessContext)) // Check if key is valid
        //.filter(dataStore => dataStore.name == name) // Check if correct name is provided
        .flatMap(dataStore => block(new RequestWithDataStore(dataStore, request))) // Run underlying action
        .getOrElse(Forbidden(Messages("dataStore.notFound"))) // Default error
    }
  }

}
