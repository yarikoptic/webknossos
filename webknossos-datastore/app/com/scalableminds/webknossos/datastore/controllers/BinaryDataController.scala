package com.scalableminds.webknossos.datastore.controllers

import brave.play.{TraceData, ZipkinTraceServiceLike}
import brave.play.implicits.ZipkinTraceImplicits
import com.google.inject.Inject
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.helpers.MissingBucketHeaders
import com.scalableminds.webknossos.datastore.models.DataRequestCollection._
import com.scalableminds.webknossos.datastore.models.datasource._
import com.scalableminds.webknossos.datastore.models.requests.{DataServiceDataRequest, DataServiceMappingRequest}
import com.scalableminds.webknossos.datastore.models._
import com.scalableminds.webknossos.datastore.services._
import com.scalableminds.webknossos.datastore.slacknotification.DSSlackNotificationService
import io.swagger.annotations._
import net.liftweb.util.Helpers.tryo
import play.api.i18n.Messages
import play.api.libs.json.Json
import play.api.mvc.{AnyContent, _}

import scala.concurrent.duration.DurationInt
import java.nio.{ByteBuffer, ByteOrder}
import scala.concurrent.ExecutionContext

@Api(tags = Array("datastore"))
class BinaryDataController @Inject()(
    dataSourceRepository: DataSourceRepository,
    config: DataStoreConfig,
    accessTokenService: DataStoreAccessTokenService,
    binaryDataServiceHolder: BinaryDataServiceHolder,
    mappingService: MappingService,
    slackNotificationService: DSSlackNotificationService,
    isosurfaceServiceHolder: IsosurfaceServiceHolder,
    findDataService: FindDataService,
    val tracer: ZipkinTraceServiceLike,
)(implicit ec: ExecutionContext, bodyParsers: PlayBodyParsers)
    extends Controller
    with MissingBucketHeaders
    with ZipkinTraceImplicits {

  override def allowRemoteOrigin: Boolean = true

  val binaryDataService: BinaryDataService = binaryDataServiceHolder.binaryDataService
  isosurfaceServiceHolder.dataStoreIsosurfaceConfig =
    (binaryDataService, mappingService, config.Datastore.Isosurface.timeout, config.Datastore.Isosurface.actorPoolSize)
  val isosurfaceService: IsosurfaceService = isosurfaceServiceHolder.dataStoreIsosurfaceService

  @ApiOperation(hidden = true, value = "")
  def requestViaWebKnossos(
      token: Option[String],
      organizationName: String,
      dataSetName: String,
      dataLayerName: String
  ): Action[List[WebKnossosDataRequest]] = Action.async(validateJson[List[WebKnossosDataRequest]]) { implicit request =>
    tracer.traceFuture("requestViaWebknossos") { _ =>
      accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
                                        urlOrHeaderToken(token, request)) {
        logTime(slackNotificationService.noticeSlowRequest) {
          val t = Instant.now
          for {
            (dataSource, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationName,
                                                                                      dataSetName,
                                                                                      dataLayerName) ~> NOT_FOUND
            (data, indices) <- requestData(dataSource, dataLayer, request.body)
            duration = Instant.since(t)
            _ = if (duration > (10 seconds))
              logger.info(
                s"Complete data request took $duration ms.\n"
                  + s"  dataSource: $organizationName/$dataSetName\n"
                  + s"  dataLayer: $dataLayerName\n"
                  + s"  requestCount: ${request.body.size}"
                  + s"  requestHead: ${request.body.headOption}")
          } yield Ok(data).withHeaders(createMissingBucketsHeaders(indices): _*)
        }
      }
    }
  }

  /**
    * Handles requests for raw binary data via HTTP GET.
    */
  @ApiOperation(value = "Get raw binary data from a bounding box in a dataset layer", nickname = "datasetDownload")
  @ApiResponses(
    Array(
      new ApiResponse(code = 200, message = "Raw bytes from the dataset"),
      new ApiResponse(code = 400, message = "Operation could not be performed. See JSON body for more information.")
    ))
  def requestRawCuboid(
      @ApiParam(value = "Datastore token identifying the requesting user") token: Option[String],
      @ApiParam(value = "Name of the dataset’s organization", required = true) organizationName: String,
      @ApiParam(value = "Dataset name", required = true) dataSetName: String,
      @ApiParam(value = "Layer name of the dataset", required = true) dataLayerName: String,
      @ApiParam(value = "Mag1 x coordinate of the top-left corner of the bounding box", required = true) x: Int,
      @ApiParam(value = "Mag1 y coordinate of the top-left corner of the bounding box", required = true) y: Int,
      @ApiParam(value = "Mag1 z coordinate of the top-left corner of the bounding box", required = true) z: Int,
      @ApiParam(value = "Target-mag width of the bounding box", required = true) width: Int,
      @ApiParam(value = "Target-mag height of the bounding box", required = true) height: Int,
      @ApiParam(value = "Target-mag depth of the bounding box", required = true) depth: Int,
      @ApiParam(value = "Mag in three-component format (e.g. 1-1-1 or 16-16-8)", required = true) mag: String,
      @ApiParam(value = "If true, use lossy compression by sending only half-bytes of the data") halfByte: Boolean,
      @ApiParam(value = "If set, apply set mapping name") mappingName: Option[String]
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
                                      urlOrHeaderToken(token, request)) {
      Fox.failure("not implemented")
    }
  }

  @ApiOperation(hidden = true, value = "")
  def requestRawCuboidPost(
      token: Option[String],
      organizationName: String,
      dataSetName: String,
      dataLayerName: String
  ): Action[RawCuboidRequest] = Action.async(validateJson[RawCuboidRequest]) { implicit request =>
    Fox.failure("not implemented")
  }

  /**
    * Handles a request for raw binary data via a HTTP GET. Used by knossos.
    */
  @ApiOperation(hidden = true, value = "")
  def requestViaKnossos(token: Option[String],
                        organizationName: String,
                        dataSetName: String,
                        dataLayerName: String,
                        resolution: Int,
                        x: Int,
                        y: Int,
                        z: Int,
                        cubeSize: Int): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
                                      urlOrHeaderToken(token, request)) {
      Fox.failure("not implemented")
    }
  }

  @ApiOperation(hidden = true, value = "")
  def thumbnailJpeg(token: Option[String],
                    organizationName: String,
                    dataSetName: String,
                    dataLayerName: String,
                    x: Int,
                    y: Int,
                    z: Int,
                    width: Int,
                    height: Int,
                    mag: String,
                    mappingName: Option[String],
                    intensityMin: Option[Double],
                    intensityMax: Option[Double],
                    color: Option[String],
                    invertColor: Option[Boolean]): Action[RawBuffer] = Action.async(parse.raw) { implicit request =>
    Fox.failure("not implemented")
  }

  @ApiOperation(hidden = true, value = "")
  def mappingJson(
      token: Option[String],
      organizationName: String,
      dataSetName: String,
      dataLayerName: String,
      mappingName: String
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
                                      urlOrHeaderToken(token, request)) {
      for {
        (dataSource, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationName,
                                                                                  dataSetName,
                                                                                  dataLayerName) ~> NOT_FOUND
        segmentationLayer <- tryo(dataLayer.asInstanceOf[SegmentationLayer]).toFox ?~> Messages("dataLayer.notFound")
        mappingRequest = DataServiceMappingRequest(dataSource, segmentationLayer, mappingName)
        result <- mappingService.handleMappingRequest(mappingRequest)
      } yield Ok(result)
    }
  }

  /**
    * Handles isosurface requests.
    */
  @ApiOperation(hidden = true, value = "")
  def requestIsosurface(token: Option[String],
                        organizationName: String,
                        dataSetName: String,
                        dataLayerName: String): Action[WebKnossosIsosurfaceRequest] =
    Action.async(validateJson[WebKnossosIsosurfaceRequest]) { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
                                        urlOrHeaderToken(token, request)) {
        for {
          (dataSource, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationName,
                                                                                    dataSetName,
                                                                                    dataLayerName) ~> NOT_FOUND
          segmentationLayer <- tryo(dataLayer.asInstanceOf[SegmentationLayer]).toFox ?~> "dataLayer.mustBeSegmentation"
          isosurfaceRequest = IsosurfaceRequest(
            Some(dataSource),
            segmentationLayer,
            request.body.cuboid(dataLayer),
            request.body.segmentId,
            request.body.subsamplingStrides,
            request.body.scale,
            request.body.mapping,
            request.body.mappingType,
            request.body.findNeighbors
          )
          // The client expects the isosurface as a flat float-array. Three consecutive floats form a 3D point, three
          // consecutive 3D points (i.e., nine floats) form a triangle.
          // There are no shared vertices between triangles.
          (vertices, neighbors) <- isosurfaceService.requestIsosurfaceViaActor(isosurfaceRequest)
        } yield {
          // We need four bytes for each float
          val responseBuffer = ByteBuffer.allocate(vertices.length * 4).order(ByteOrder.LITTLE_ENDIAN)
          responseBuffer.asFloatBuffer().put(vertices)
          Ok(responseBuffer.array()).withHeaders(getNeighborIndices(neighbors): _*)
        }
      }
    }

  private def getNeighborIndices(neighbors: List[Int]) =
    List("NEIGHBORS" -> formatNeighborList(neighbors), "Access-Control-Expose-Headers" -> "NEIGHBORS")

  private def formatNeighborList(neighbors: List[Int]): String =
    "[" + neighbors.mkString(", ") + "]"

  @ApiOperation(hidden = true, value = "")
  def colorStatistics(token: Option[String],
                      organizationName: String,
                      dataSetName: String,
                      dataLayerName: String): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
                                        urlOrHeaderToken(token, request)) {
        for {
          (dataSource, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationName,
                                                                                    dataSetName,
                                                                                    dataLayerName) ~> NOT_FOUND
          meanAndStdDev <- findDataService.meanAndStdDev(dataSource, dataLayer)
        } yield
          Ok(
            Json.obj("mean" -> meanAndStdDev._1, "stdDev" -> meanAndStdDev._2)
          )
      }
    }

  @ApiOperation(hidden = true, value = "")
  def findData(token: Option[String],
               organizationName: String,
               dataSetName: String,
               dataLayerName: String): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
                                        urlOrHeaderToken(token, request)) {
        for {
          (dataSource, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationName,
                                                                                    dataSetName,
                                                                                    dataLayerName) ~> NOT_FOUND
          positionAndResolutionOpt <- findDataService.findPositionWithData(dataSource, dataLayer)
        } yield
          Ok(
            Json.obj("position" -> positionAndResolutionOpt.map(_._1),
                     "resolution" -> positionAndResolutionOpt.map(_._2)))
      }
    }

  @ApiOperation(hidden = true, value = "")
  def histogram(token: Option[String],
                organizationName: String,
                dataSetName: String,
                dataLayerName: String): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
                                        urlOrHeaderToken(token, request)) {
        for {
          (dataSource, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationName,
                                                                                    dataSetName,
                                                                                    dataLayerName) ?~> Messages(
            "dataSource.notFound") ~> NOT_FOUND ?~> Messages("histogram.layerMissing", dataLayerName)
          listOfHistograms <- findDataService.createHistogram(dataSource, dataLayer) ?~> Messages("histogram.failed",
                                                                                                  dataLayerName)
        } yield Ok(Json.toJson(listOfHistograms))
      }
    }

  private def requestData(
      dataSource: DataSource,
      dataLayer: DataLayer,
      dataRequests: DataRequestCollection
  )(implicit parentData: TraceData): Fox[(Array[Byte], List[Int])] = {
    val requests =
      dataRequests.map(r => DataServiceDataRequest(dataSource, dataLayer, None, r.cuboid(dataLayer), r.settings))
    binaryDataService.handleDataRequests(requests)
  }

}
