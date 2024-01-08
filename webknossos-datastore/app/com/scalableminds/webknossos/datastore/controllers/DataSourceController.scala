package com.scalableminds.webknossos.datastore.controllers

import com.google.inject.Inject
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.ListOfLong.ListOfLong
import com.scalableminds.webknossos.datastore.helpers.SegmentStatisticsParameters
import com.scalableminds.webknossos.datastore.models.datasource.inbox.{
  InboxDataSource,
  InboxDataSourceLike,
  UnusableInboxDataSource
}
import com.scalableminds.webknossos.datastore.models.datasource.{DataSource, DataSourceId}
import com.scalableminds.webknossos.datastore.services._
import play.api.data.Form
import play.api.data.Forms.{longNumber, nonEmptyText, number, tuple}
import play.api.i18n.Messages
import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent, MultipartFormData, PlayBodyParsers}

import java.io.File
import com.scalableminds.webknossos.datastore.storage.AgglomerateFileKey
import play.api.libs.Files

import scala.concurrent.ExecutionContext
import scala.concurrent.duration._

class DataSourceController @Inject()(
    dataSourceRepository: DataSourceRepository,
    dataSourceService: DataSourceService,
    remoteWebKnossosClient: DSRemoteWebKnossosClient,
    accessTokenService: DataStoreAccessTokenService,
    binaryDataServiceHolder: BinaryDataServiceHolder,
    connectomeFileService: ConnectomeFileService,
    segmentIndexFileService: SegmentIndexFileService,
    storageUsageService: DSUsedStorageService,
    datasetErrorLoggingService: DatasetErrorLoggingService,
    uploadService: UploadService
)(implicit bodyParsers: PlayBodyParsers, ec: ExecutionContext)
    extends Controller
    with FoxImplicits {

  override def allowRemoteOrigin: Boolean = true

  def read(token: Option[String],
           organizationName: String,
           dataSetName: String,
           returnFormatLike: Boolean): Action[AnyContent] =
    Action.async { implicit request =>
      {
        accessTokenService.validateAccessForSyncBlock(
          UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
          urlOrHeaderToken(token, request)) {
          val dsOption: Option[InboxDataSource] =
            dataSourceRepository.find(DataSourceId(dataSetName, organizationName))
          dsOption match {
            case Some(ds) =>
              val dslike: InboxDataSourceLike = ds
              if (returnFormatLike) Ok(Json.toJson(dslike))
              else Ok(Json.toJson(ds))
            case _ => Ok
          }
        }
      }
    }

  def triggerInboxCheckBlocking(token: Option[String]): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccess(UserAccessRequest.administrateDataSources, urlOrHeaderToken(token, request)) {
      for {
        _ <- dataSourceService.checkInbox(verbose = true)
      } yield Ok
    }
  }

  def reserveUpload(token: Option[String]): Action[ReserveUploadInformation] =
    Action.async(validateJson[ReserveUploadInformation]) { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.administrateDataSources(request.body.organization),
                                        urlOrHeaderToken(token, request)) {
        for {
          isKnownUpload <- uploadService.isKnownUpload(request.body.uploadId)
          _ <- if (!isKnownUpload) {
            (remoteWebKnossosClient.reserveDataSourceUpload(request.body, urlOrHeaderToken(token, request)) ?~> "dataset.upload.validation.failed")
              .flatMap(_ => uploadService.reserveUpload(request.body))
          } else Fox.successful(())
        } yield Ok
      }
    }

  /* Upload a byte chunk for a new dataset
  Expects:
    - As file attachment: A raw byte chunk of the dataset
    - As form parameter:
    - name (string): dataset name
    - owningOrganization (string): owning organization name
    - resumableChunkNumber (int): chunk index
    - resumableChunkSize (int): chunk size in bytes
    - resumableTotalChunks (string): total chunk count of the upload
    - totalFileCount (string): total file count of the upload
    - resumableIdentifier (string): identifier of the resumable upload and file ("{uploadId}/{filepath}")
    - As GET parameter:
    - token (string): datastore token identifying the uploading user
   */
  def uploadChunk(token: Option[String]): Action[MultipartFormData[Files.TemporaryFile]] =
    Action.async(parse.multipartFormData) { implicit request =>
      val uploadForm = Form(
        tuple(
          "resumableChunkNumber" -> number,
          "resumableChunkSize" -> number,
          "resumableTotalChunks" -> longNumber,
          "resumableIdentifier" -> nonEmptyText
        )).fill((-1, -1, -1, ""))

      uploadForm
        .bindFromRequest(request.body.dataParts)
        .fold(
          hasErrors = formWithErrors => Fox.successful(JsonBadRequest(formWithErrors.errors.head.message)),
          success = {
            case (chunkNumber, chunkSize, totalChunkCount, uploadFileId) =>
              for {
                dataSourceId <- uploadService.getDataSourceIdByUploadId(
                  uploadService.extractDatasetUploadId(uploadFileId)) ?~> "dataset.upload.validation.failed"
                result <- accessTokenService.validateAccess(UserAccessRequest.writeDataSource(dataSourceId),
                                                            urlOrHeaderToken(token, request)) {
                  for {
                    isKnownUpload <- uploadService.isKnownUploadByFileId(uploadFileId)
                    _ <- bool2Fox(isKnownUpload) ?~> "dataset.upload.validation.failed"
                    chunkFile <- request.body.file("file") ?~> "zip.file.notFound"
                    _ <- uploadService.handleUploadChunk(uploadFileId,
                                                         chunkSize,
                                                         totalChunkCount,
                                                         chunkNumber,
                                                         new File(chunkFile.ref.path.toString))
                  } yield Ok
                }
              } yield result
          }
        )
    }

  def finishUpload(token: Option[String]): Action[UploadInformation] = Action.async(validateJson[UploadInformation]) {
    implicit request =>
      log() {
        for {
          dataSourceId <- uploadService
            .getDataSourceIdByUploadId(request.body.uploadId) ?~> "dataset.upload.validation.failed"
          result <- accessTokenService.validateAccess(UserAccessRequest.writeDataSource(dataSourceId),
                                                      urlOrHeaderToken(token, request)) {
            for {
              (dataSourceId, datasetSizeBytes) <- uploadService.finishUpload(request.body)
              _ <- remoteWebKnossosClient.reportUpload(
                dataSourceId,
                datasetSizeBytes,
                request.body.needsConversion.getOrElse(false),
                viaAddRoute = false,
                userToken = urlOrHeaderToken(token, request)) ?~> "reportUpload.failed"
            } yield Ok
          }
        } yield result
      }
  }

  def cancelUpload(token: Option[String]): Action[CancelUploadInformation] =
    Action.async(validateJson[CancelUploadInformation]) { implicit request =>
      val dataSourceIdFox = uploadService.isKnownUpload(request.body.uploadId).flatMap {
        case false => Fox.failure("dataset.upload.validation.failed")
        case true  => uploadService.getDataSourceIdByUploadId(request.body.uploadId)
      }
      dataSourceIdFox.flatMap { dataSourceId =>
        accessTokenService.validateAccess(UserAccessRequest.deleteDataSource(dataSourceId),
                                          urlOrHeaderToken(token, request)) {
          for {
            _ <- remoteWebKnossosClient.deleteDataSource(dataSourceId) ?~> "dataset.delete.webknossos.failed"
            _ <- uploadService.cancelUpload(request.body) ?~> "Could not cancel the upload."
          } yield Ok
        }
      }
    }

  def suggestDatasourceJson(token: Option[String], organizationName: String, dataSetName: String): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccessForSyncBlock(
        UserAccessRequest.writeDataSource(DataSourceId(dataSetName, organizationName)),
        urlOrHeaderToken(token, request)) {
        for {
          previousDataSource <- dataSourceRepository.find(DataSourceId(dataSetName, organizationName)) ?~ Messages(
            "dataSource.notFound") ~> NOT_FOUND
          (dataSource, messages) <- dataSourceService.exploreDataSource(previousDataSource.id,
                                                                        previousDataSource.toUsable)
          previousDataSourceJson = previousDataSource match {
            case usableDataSource: DataSource => Json.toJson(usableDataSource)
            case unusableDataSource: UnusableInboxDataSource =>
              unusableDataSource.existingDataSourceProperties match {
                case Some(existingConfig) => existingConfig
                case None                 => Json.toJson(unusableDataSource)
              }
          }
        } yield {
          Ok(
            Json.obj(
              "dataSource" -> dataSource,
              "previousDataSource" -> previousDataSourceJson,
              "messages" -> messages.map(m => Json.obj(m._1 -> m._2))
            ))
        }
      }
    }

  def listMappings(
      token: Option[String],
      organizationName: String,
      dataSetName: String,
      dataLayerName: String
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccessForSyncBlock(
      UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
      urlOrHeaderToken(token, request)) {
      addNoCacheHeaderFallback(
        Ok(Json.toJson(dataSourceService.exploreMappings(organizationName, dataSetName, dataLayerName))))
    }
  }

  def listAgglomerates(
      token: Option[String],
      organizationName: String,
      dataSetName: String,
      dataLayerName: String
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
                                      urlOrHeaderToken(token, request)) {
      for {
        agglomerateService <- binaryDataServiceHolder.binaryDataService.agglomerateServiceOpt.toFox
        agglomerateList = agglomerateService.exploreAgglomerates(organizationName, dataSetName, dataLayerName)
      } yield Ok(Json.toJson(agglomerateList))
    }
  }

  def generateAgglomerateSkeleton(
      token: Option[String],
      organizationName: String,
      dataSetName: String,
      dataLayerName: String,
      mappingName: String,
      agglomerateId: Long
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
                                      urlOrHeaderToken(token, request)) {
      for {
        agglomerateService <- binaryDataServiceHolder.binaryDataService.agglomerateServiceOpt.toFox
        skeleton <- agglomerateService.generateSkeleton(organizationName,
                                                        dataSetName,
                                                        dataLayerName,
                                                        mappingName,
                                                        agglomerateId) ?~> "agglomerateSkeleton.failed"
      } yield Ok(skeleton.toByteArray).as(protobufMimeType)
    }
  }

  def agglomerateGraph(
      token: Option[String],
      organizationName: String,
      dataSetName: String,
      dataLayerName: String,
      mappingName: String,
      agglomerateId: Long
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
                                      urlOrHeaderToken(token, request)) {
      for {
        agglomerateService <- binaryDataServiceHolder.binaryDataService.agglomerateServiceOpt.toFox
        agglomerateGraph <- agglomerateService.generateAgglomerateGraph(
          AgglomerateFileKey(organizationName, dataSetName, dataLayerName, mappingName),
          agglomerateId) ?~> "agglomerateGraph.failed"
      } yield Ok(agglomerateGraph.toByteArray).as(protobufMimeType)
    }
  }

  def largestAgglomerateId(
      token: Option[String],
      organizationName: String,
      dataSetName: String,
      dataLayerName: String,
      mappingName: String
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
                                      urlOrHeaderToken(token, request)) {
      for {
        agglomerateService <- binaryDataServiceHolder.binaryDataService.agglomerateServiceOpt.toFox
        largestAgglomerateId: Long <- agglomerateService
          .largestAgglomerateId(
            AgglomerateFileKey(
              organizationName,
              dataSetName,
              dataLayerName,
              mappingName
            )
          )
          .toFox
      } yield Ok(Json.toJson(largestAgglomerateId))
    }
  }

  def agglomerateIdsForSegmentIds(
      token: Option[String],
      organizationName: String,
      dataSetName: String,
      dataLayerName: String,
      mappingName: String
  ): Action[ListOfLong] = Action.async(validateProto[ListOfLong]) { implicit request =>
    accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
                                      urlOrHeaderToken(token, request)) {
      for {
        agglomerateService <- binaryDataServiceHolder.binaryDataService.agglomerateServiceOpt.toFox
        agglomerateIds: Seq[Long] <- agglomerateService
          .agglomerateIdsForSegmentIds(
            AgglomerateFileKey(
              organizationName,
              dataSetName,
              dataLayerName,
              mappingName
            ),
            request.body.items
          )
          .toFox
      } yield Ok(ListOfLong(agglomerateIds).toByteArray)
    }
  }

  def update(token: Option[String], organizationName: String, dataSetName: String): Action[DataSource] =
    Action.async(validateJson[DataSource]) { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.writeDataSource(DataSourceId(dataSetName, organizationName)),
                                        urlOrHeaderToken(token, request)) {
        for {
          _ <- Fox.successful(())
          dataSource <- dataSourceRepository.find(DataSourceId(dataSetName, organizationName)).toFox ?~> Messages(
            "dataSource.notFound") ~> NOT_FOUND
          _ <- dataSourceService.updateDataSource(request.body.copy(id = dataSource.id), expectExisting = true)
        } yield Ok
      }
    }

  def add(token: Option[String],
          organizationName: String,
          dataSetName: String,
          folderId: Option[String]): Action[DataSource] =
    Action.async(validateJson[DataSource]) { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.administrateDataSources, urlOrHeaderToken(token, request)) {
        for {
          _ <- bool2Fox(dataSourceRepository.find(DataSourceId(dataSetName, organizationName)).isEmpty) ?~> Messages(
            "dataSource.alreadyPresent")
          _ <- remoteWebKnossosClient.reserveDataSourceUpload(
            ReserveUploadInformation(
              uploadId = "",
              name = dataSetName,
              organization = organizationName,
              totalFileCount = 1,
              layersToLink = None,
              initialTeams = List.empty,
              folderId = folderId,
            ),
            urlOrHeaderToken(token, request)
          ) ?~> "dataSet.upload.validation.failed"
          _ <- dataSourceService.updateDataSource(request.body.copy(id = DataSourceId(dataSetName, organizationName)),
                                                  expectExisting = false)
          _ <- remoteWebKnossosClient.reportUpload(
            DataSourceId(dataSetName, organizationName),
            0L,
            needsConversion = false,
            viaAddRoute = true,
            userToken = urlOrHeaderToken(token, request)) ?~> "reportUpload.failed"
        } yield Ok
      }
    }

  def createOrganizationDirectory(token: Option[String], organizationName: String): Action[AnyContent] = Action.async {
    implicit request =>
      accessTokenService
        .validateAccessForSyncBlock(UserAccessRequest.administrateDataSources(organizationName), token) {
          val newOrganizationDirectory = new File(f"${dataSourceService.dataBaseDir}/$organizationName")
          newOrganizationDirectory.mkdirs()
          if (newOrganizationDirectory.isDirectory) {
            logger.info(s"Created organization directory at $newOrganizationDirectory")
            Ok
          } else
            BadRequest
        }
  }

  def measureUsedStorage(token: Option[String],
                         organizationName: String,
                         datasetName: Option[String] = None): Action[AnyContent] =
    Action.async { implicit request =>
      log() {
        accessTokenService.validateAccess(UserAccessRequest.administrateDataSources(organizationName),
                                          urlOrHeaderToken(token, request)) {
          for {
            before <- Fox.successful(System.currentTimeMillis())
            usedStorageInBytes: List[DirectoryStorageReport] <- storageUsageService.measureStorage(organizationName,
                                                                                                   datasetName)
            after = System.currentTimeMillis()
            _ = if (after - before > (10 seconds).toMillis) {
              val datasetLabel = datasetName.map(n => s" dataset $n of").getOrElse("")
              logger.info(s"Measuring storage for$datasetLabel orga $organizationName took ${after - before} ms.")
            }
          } yield Ok(Json.toJson(usedStorageInBytes))
        }
      }
    }

  def reload(token: Option[String],
             organizationName: String,
             dataSetName: String,
             layerName: Option[String] = None): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.administrateDataSources(organizationName),
                                        urlOrHeaderToken(token, request)) {
        val (closedAgglomerateFileHandleCount, closedDataCubeHandleCount, removedChunksCount) =
          binaryDataServiceHolder.binaryDataService.clearCache(organizationName, dataSetName, layerName)
        val reloadedDataSource = dataSourceService.dataSourceFromFolder(
          dataSourceService.dataBaseDir.resolve(organizationName).resolve(dataSetName),
          organizationName)
        datasetErrorLoggingService.clearForDataset(organizationName, dataSetName)
        for {
          clearedVaultCacheEntries <- dataSourceService.invalidateVaultCache(reloadedDataSource, layerName)
          _ = logger.info(
            s"Reloading ${layerName.map(l => s"layer '$l' of ").getOrElse("")}dataset $organizationName/$dataSetName: closed $closedDataCubeHandleCount data shard / array handles, $closedAgglomerateFileHandleCount agglomerate file handles, removed $clearedVaultCacheEntries vault cache entries and $removedChunksCount image chunk cache entries.")
          _ <- dataSourceRepository.updateDataSource(reloadedDataSource)
        } yield Ok(Json.toJson(reloadedDataSource))
      }
    }

  def deleteOnDisk(token: Option[String], organizationName: String, dataSetName: String): Action[AnyContent] =
    Action.async { implicit request =>
      val dataSourceId = DataSourceId(dataSetName, organizationName)
      accessTokenService.validateAccess(UserAccessRequest.deleteDataSource(dataSourceId),
                                        urlOrHeaderToken(token, request)) {
        for {
          _ <- binaryDataServiceHolder.binaryDataService.deleteOnDisk(
            organizationName,
            dataSetName,
            reason = Some("the user wants to delete the dataset")) ?~> "dataset.delete.failed"
          _ <- dataSourceRepository.cleanUpDataSource(dataSourceId) // also frees the name in the wk-side database
        } yield Ok
      }
    }

  def listConnectomeFiles(token: Option[String],
                          organizationName: String,
                          dataSetName: String,
                          dataLayerName: String): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
                                        urlOrHeaderToken(token, request)) {
        val connectomeFileNames =
          connectomeFileService.exploreConnectomeFiles(organizationName, dataSetName, dataLayerName)
        for {
          mappingNames <- Fox.serialCombined(connectomeFileNames.toList) { connectomeFileName =>
            val path =
              connectomeFileService.connectomeFilePath(organizationName, dataSetName, dataLayerName, connectomeFileName)
            connectomeFileService.mappingNameForConnectomeFile(path)
          }
          connectomesWithMappings = connectomeFileNames
            .zip(mappingNames)
            .map(tuple => ConnectomeFileNameWithMappingName(tuple._1, tuple._2))
        } yield Ok(Json.toJson(connectomesWithMappings))
      }
    }

  def getSynapsesForAgglomerates(token: Option[String],
                                 organizationName: String,
                                 dataSetName: String,
                                 dataLayerName: String): Action[ByAgglomerateIdsRequest] =
    Action.async(validateJson[ByAgglomerateIdsRequest]) { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
                                        urlOrHeaderToken(token, request)) {
        for {
          meshFilePath <- Fox.successful(
            connectomeFileService
              .connectomeFilePath(organizationName, dataSetName, dataLayerName, request.body.connectomeFile))
          synapses <- connectomeFileService.synapsesForAgglomerates(meshFilePath, request.body.agglomerateIds)
        } yield Ok(Json.toJson(synapses))
      }
    }

  def getSynapticPartnerForSynapses(token: Option[String],
                                    organizationName: String,
                                    dataSetName: String,
                                    dataLayerName: String,
                                    direction: String): Action[BySynapseIdsRequest] =
    Action.async(validateJson[BySynapseIdsRequest]) { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
                                        urlOrHeaderToken(token, request)) {
        for {
          meshFilePath <- Fox.successful(
            connectomeFileService
              .connectomeFilePath(organizationName, dataSetName, dataLayerName, request.body.connectomeFile))
          agglomerateIds <- connectomeFileService.synapticPartnerForSynapses(meshFilePath,
                                                                             request.body.synapseIds,
                                                                             direction)
        } yield Ok(Json.toJson(agglomerateIds))
      }
    }

  def getSynapsePositions(token: Option[String],
                          organizationName: String,
                          dataSetName: String,
                          dataLayerName: String): Action[BySynapseIdsRequest] =
    Action.async(validateJson[BySynapseIdsRequest]) { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
                                        urlOrHeaderToken(token, request)) {
        for {
          meshFilePath <- Fox.successful(
            connectomeFileService
              .connectomeFilePath(organizationName, dataSetName, dataLayerName, request.body.connectomeFile))
          synapsePositions <- connectomeFileService.positionsForSynapses(meshFilePath, request.body.synapseIds)
        } yield Ok(Json.toJson(synapsePositions))
      }
    }

  def getSynapseTypes(token: Option[String],
                      organizationName: String,
                      dataSetName: String,
                      dataLayerName: String): Action[BySynapseIdsRequest] =
    Action.async(validateJson[BySynapseIdsRequest]) { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
                                        urlOrHeaderToken(token, request)) {
        for {
          meshFilePath <- Fox.successful(
            connectomeFileService
              .connectomeFilePath(organizationName, dataSetName, dataLayerName, request.body.connectomeFile))
          synapseTypes <- connectomeFileService.typesForSynapses(meshFilePath, request.body.synapseIds)
        } yield Ok(Json.toJson(synapseTypes))
      }
    }

  def checkSegmentIndexFile(token: Option[String],
                            organizationName: String,
                            dataSetName: String,
                            dataLayerName: String): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
                                        urlOrHeaderToken(token, request)) {
        val segmentIndexFileOpt =
          segmentIndexFileService.getSegmentIndexFile(organizationName, dataSetName, dataLayerName).toOption
        for {
          _ <- Fox.successful(())
          segmentIndexPaths = Seq() ++ segmentIndexFileOpt
          segmentIndexFiles = segmentIndexPaths.map(_.toString)
        } yield Ok(Json.toJson(segmentIndexFiles))
      }
    }

  def getSegmentIndex(token: Option[String],
                      organizationName: String,
                      dataSetName: String,
                      dataLayerName: String,
                      segmentId: String,
                      mag: String,
                      cubeSize: String): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
                                        urlOrHeaderToken(token, request)) {
        for {
          topLefts <- segmentIndexFileService.readSegmentIndex(organizationName,
                                                               dataSetName,
                                                               dataLayerName,
                                                               segmentId.toLong)
          // TODO: Use mag and cubeSize
        } yield Ok(Json.toJson(topLefts))
      }
    }

  def getSegmentVolume(token: Option[String], organizationName: String, dataSetName: String, dataLayerName: String) =
    Action.async(validateJson[SegmentStatisticsParameters]) { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
                                        urlOrHeaderToken(token, request)) {
        for {
          _ <- Fox.successful(())
          _ <- Fox.box2Fox(segmentIndexFileService.getSegmentIndexFile(organizationName, dataSetName, dataLayerName)) ?~> "segmentIndexFile.notFound" //TODO: Dont use head, get all volumes
          volume <- segmentIndexFileService.getSegmentVolume(organizationName,
                                                             dataSetName,
                                                             dataLayerName,
                                                             request.body.segmentIds.head,
                                                             request.body.mag)
        } yield Ok(volume.toString)
      }
    }

  def getSegmentBoundingBox(token: Option[String],
                            organizationName: String,
                            dataSetName: String,
                            dataLayerName: String) =
    Action.async(validateJson[SegmentStatisticsParameters]) { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readDataSources(DataSourceId(dataSetName, organizationName)),
                                        urlOrHeaderToken(token, request)) {
        for {
          _ <- Fox.successful(())
        } yield Ok("Not implemented yet")
      }
    }

}
