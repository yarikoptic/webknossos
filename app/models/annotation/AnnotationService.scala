package models.annotation

import akka.actor.ActorSystem
import akka.stream.Materializer
import com.scalableminds.util.accesscontext.{AuthorizedAccessContext, DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.geometry.{BoundingBox, Vec3Double, Vec3Int}
import com.scalableminds.util.io.{NamedStream, ZipIO}
import com.scalableminds.util.mvc.Formatter
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{BoxImplicits, Fox, FoxImplicits, TextUtils}
import com.scalableminds.webknossos.datastore.SkeletonTracing._
import com.scalableminds.webknossos.datastore.VolumeTracing.{VolumeTracing, VolumeTracingOpt, VolumeTracings}
import com.scalableminds.webknossos.datastore.geometry.{
  AdditionalCoordinateProto,
  ColorProto,
  NamedBoundingBoxProto,
  Vec3DoubleProto,
  Vec3IntProto
}
import com.scalableminds.webknossos.datastore.helpers.{NodeDefaults, ProtoGeometryImplicits, SkeletonTracingDefaults}
import com.scalableminds.webknossos.datastore.models.annotation.{
  AnnotationLayer,
  AnnotationLayerType,
  AnnotationSource,
  FetchedAnnotationLayer
}
import com.scalableminds.webknossos.datastore.models.datasource.{
  AdditionalAxis,
  ElementClass,
  DataSourceLike => DataSource,
  SegmentationLayerLike => SegmentationLayer
}
import com.scalableminds.webknossos.tracingstore.tracings._
import com.scalableminds.webknossos.tracingstore.tracings.volume.VolumeDataZipFormat.VolumeDataZipFormat
import com.scalableminds.webknossos.tracingstore.tracings.volume.{
  ResolutionRestrictions,
  VolumeDataZipFormat,
  VolumeTracingDefaults,
  VolumeTracingDownsampling
}
import com.typesafe.scalalogging.LazyLogging
import controllers.AnnotationLayerParameters
import models.annotation.AnnotationState._
import models.annotation.AnnotationType.AnnotationType
import models.annotation.handler.SavedTracingInformationHandler
import models.annotation.nml.NmlWriter
import models.dataset._
import models.organization.OrganizationDAO
import models.project.ProjectDAO
import models.task.{Task, TaskDAO, TaskService, TaskTypeDAO}
import models.team.{TeamDAO, TeamService}
import models.user.{User, UserDAO, UserService}
import net.liftweb.common.{Box, Full}
import play.api.i18n.{Messages, MessagesProvider}
import play.api.libs.Files.{TemporaryFile, TemporaryFileCreator}
import play.api.libs.json.{JsNull, JsObject, JsValue, Json}
import utils.{ObjectId, WkConf}

import java.io.{BufferedOutputStream, File, FileOutputStream}
import javax.inject.Inject
import scala.concurrent.{ExecutionContext, Future}

case class DownloadAnnotation(skeletonTracingIdOpt: Option[String],
                              volumeTracingIdOpt: Option[String],
                              skeletonTracingOpt: Option[SkeletonTracing],
                              volumeTracingOpt: Option[VolumeTracing],
                              volumeDataOpt: Option[Array[Byte]],
                              name: String,
                              scaleOpt: Option[Vec3Double],
                              annotation: Annotation,
                              user: User,
                              taskOpt: Option[Task],
                              organizationName: String,
                              datasetName: String)

// Used to pass duplicate properties when creating a new tracing to avoid masking them.
// Uses the proto-generated geometry classes, hence the full qualifiers.
case class RedundantTracingProperties(
    editPosition: Vec3IntProto,
    editRotation: Vec3DoubleProto,
    zoomLevel: Double,
    userBoundingBoxes: Seq[NamedBoundingBoxProto],
    editPositionAdditionalCoordinates: Seq[AdditionalCoordinateProto],
)

class AnnotationService @Inject()(
    annotationInformationProvider: AnnotationInformationProvider,
    savedTracingInformationHandler: SavedTracingInformationHandler,
    annotationDAO: AnnotationDAO,
    annotationLayersDAO: AnnotationLayerDAO,
    userDAO: UserDAO,
    taskTypeDAO: TaskTypeDAO,
    taskService: TaskService,
    datasetService: DatasetService,
    datasetDAO: DatasetDAO,
    dataStoreService: DataStoreService,
    tracingStoreService: TracingStoreService,
    tracingStoreDAO: TracingStoreDAO,
    taskDAO: TaskDAO,
    teamDAO: TeamDAO,
    userService: UserService,
    teamService: TeamService,
    dataStoreDAO: DataStoreDAO,
    projectDAO: ProjectDAO,
    organizationDAO: OrganizationDAO,
    annotationRestrictionDefults: AnnotationRestrictionDefaults,
    nmlWriter: NmlWriter,
    temporaryFileCreator: TemporaryFileCreator,
    conf: WkConf,
)(implicit ec: ExecutionContext, val materializer: Materializer)
    extends BoxImplicits
    with FoxImplicits
    with ProtoGeometryImplicits
    with LazyLogging {
  implicit val actorSystem: ActorSystem = ActorSystem()

  val DefaultAnnotationListLimit = 1000

  private def selectSuitableTeam(user: User, dataSet: Dataset): Fox[ObjectId] =
    (for {
      userTeamIds <- userService.teamIdsFor(user._id)
      datasetAllowedTeamIds <- teamService.allowedTeamIdsForDataset(dataSet, cumulative = true) ?~> "allowedTeams.notFound"
    } yield {
      val selectedTeamOpt = datasetAllowedTeamIds.intersect(userTeamIds).headOption
      selectedTeamOpt match {
        case Some(selectedTeam) => Fox.successful(selectedTeam)
        case None =>
          for {
            isTeamManagerOrAdminOfOrg <- userService.isTeamManagerOrAdminOfOrg(user, user._organization)
            _ <- bool2Fox(isTeamManagerOrAdminOfOrg || dataSet.isPublic || user.isDatasetManager)
            organizationTeamId <- organizationDAO.findOrganizationTeamId(user._organization)
          } yield organizationTeamId
      }
    }).flatten

  private def createVolumeTracing(
      dataSource: DataSource,
      datasetOrganizationName: String,
      fallbackLayer: Option[SegmentationLayer],
      boundingBox: Option[BoundingBox] = None,
      startPosition: Option[Vec3Int] = None,
      startRotation: Option[Vec3Double] = None,
      resolutionRestrictions: ResolutionRestrictions,
      mappingName: Option[String]
  ): Fox[VolumeTracing] = {
    val resolutions = VolumeTracingDownsampling.magsForVolumeTracing(dataSource, fallbackLayer)
    val resolutionsRestricted = resolutionRestrictions.filterAllowed(resolutions)
    val additionalCoordinates =
      fallbackLayer.map(_.additionalAxes).getOrElse(dataSource.additionalAxesUnion)
    for {
      _ <- bool2Fox(resolutionsRestricted.nonEmpty) ?~> "annotation.volume.resolutionRestrictionsTooTight"
    } yield
      VolumeTracing(
        None,
        boundingBoxToProto(boundingBox.getOrElse(dataSource.boundingBox)),
        System.currentTimeMillis(),
        dataSource.id.name,
        vec3IntToProto(startPosition.getOrElse(dataSource.center)),
        vec3DoubleToProto(startRotation.getOrElse(vec3DoubleFromProto(VolumeTracingDefaults.editRotation))),
        elementClassToProto(
          fallbackLayer.map(layer => layer.elementClass).getOrElse(VolumeTracingDefaults.elementClass)),
        fallbackLayer.map(_.name),
        combineLargestSegmentIdsByPrecedence(fromNml = None, fromFallbackLayer = fallbackLayer.map(_.largestSegmentId)),
        0,
        VolumeTracingDefaults.zoomLevel,
        organizationName = Some(datasetOrganizationName),
        mappingName = mappingName,
        resolutions = resolutionsRestricted.map(vec3IntToProto),
        hasSegmentIndex = Some(fallbackLayer.isEmpty),
        additionalAxes = AdditionalAxis.toProto(additionalCoordinates)
      )
  }

  def combineLargestSegmentIdsByPrecedence(fromNml: Option[Long],
                                           fromFallbackLayer: Option[Option[Long]]): Option[Long] =
    if (fromNml.nonEmpty)
      // This was called for an NML upload. The NML had an explicit largestSegmentId. Use that.
      fromNml
    else if (fromFallbackLayer.nonEmpty)
      // There is a fallback layer. Use its largestSegmentId, even if it is None.
      // Some tracing functionality will be disabled until a segment id is set by the user.
      fromFallbackLayer.flatten
    else {
      // There is no fallback layer. Start at default segment id for fresh volume layers
      VolumeTracingDefaults.largestSegmentId
    }

  def addAnnotationLayer(
      annotation: Annotation,
      organizationName: String,
      annotationLayerParameters: AnnotationLayerParameters)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      dataSet <- datasetDAO.findOne(annotation._dataSet) ?~> "dataset.notFoundForAnnotation"
      dataSource <- datasetService.dataSourceFor(dataSet).flatMap(_.toUsable) ?~> "dataSource.notFound"
      newAnnotationLayers <- createTracingsForExplorational(dataSet,
                                                            dataSource,
                                                            List(annotationLayerParameters),
                                                            organizationName,
                                                            annotation.annotationLayers)
      _ <- annotationLayersDAO.insertForAnnotation(annotation._id, newAnnotationLayers)
    } yield ()

  def deleteAnnotationLayer(annotation: Annotation, layerName: String): Fox[Unit] =
    for {
      _ <- annotationLayersDAO.deleteOne(annotation._id, layerName)
    } yield ()

  private def createTracingsForExplorational(dataSet: Dataset,
                                             dataSource: DataSource,
                                             allAnnotationLayerParameters: List[AnnotationLayerParameters],
                                             datasetOrganizationId: String,
                                             existingAnnotationLayers: List[AnnotationLayer] = List())(
      implicit ctx: DBAccessContext): Fox[List[AnnotationLayer]] = {

    def getAutoFallbackLayerName: Option[String] =
      dataSource.dataLayers.find {
        case _: SegmentationLayer => true
        case _                    => false
      }.map(_.name)

    def getFallbackLayer(fallbackLayerName: String): Fox[SegmentationLayer] =
      for {
        fallbackLayer <- dataSource.dataLayers
          .filter(dl => dl.name == fallbackLayerName)
          .flatMap {
            case layer: SegmentationLayer => Some(layer)
            case _                        => None
          }
          .headOption
          .toFox
        _ <- bool2Fox(ElementClass.largestSegmentIdIsInRange(
          fallbackLayer.largestSegmentId,
          fallbackLayer.elementClass)) ?~> "annotation.volume.largestSegmentIdExceedsRange"
      } yield fallbackLayer

    def createAndSaveAnnotationLayer(
        annotationLayerParameters: AnnotationLayerParameters,
        oldPrecedenceLayerProperties: Option[RedundantTracingProperties]): Fox[AnnotationLayer] =
      for {
        client <- tracingStoreService.clientFor(dataSet)
        tracingIdAndName <- annotationLayerParameters.typ match {
          case AnnotationLayerType.Skeleton =>
            val skeleton = SkeletonTracingDefaults.createInstance.copy(
              dataSetName = dataSet.name,
              editPosition = dataSource.center,
              organizationName = Some(datasetOrganizationId),
              additionalAxes = AdditionalAxis.toProto(dataSource.additionalAxesUnion)
            )
            val skeletonAdapted = oldPrecedenceLayerProperties.map { p =>
              skeleton.copy(
                editPosition = p.editPosition,
                editRotation = p.editRotation,
                zoomLevel = p.zoomLevel,
                userBoundingBoxes = p.userBoundingBoxes,
                editPositionAdditionalCoordinates = p.editPositionAdditionalCoordinates
              )
            }.getOrElse(skeleton)
            for {
              tracingId <- client.saveSkeletonTracing(skeletonAdapted)
              name = annotationLayerParameters.name.getOrElse(
                AnnotationLayer.defaultNameForType(annotationLayerParameters.typ))
            } yield (tracingId, name)
          case AnnotationLayerType.Volume =>
            val autoFallbackLayerName =
              if (annotationLayerParameters.autoFallbackLayer) getAutoFallbackLayerName else None
            val fallbackLayerName = annotationLayerParameters.fallbackLayerName.orElse(autoFallbackLayerName)
            for {
              fallbackLayer <- Fox.runOptional(fallbackLayerName)(getFallbackLayer)
              volumeTracing <- createVolumeTracing(
                dataSource,
                datasetOrganizationId,
                fallbackLayer,
                resolutionRestrictions =
                  annotationLayerParameters.resolutionRestrictions.getOrElse(ResolutionRestrictions.empty),
                mappingName = annotationLayerParameters.mappingName
              )
              volumeTracingAdapted = oldPrecedenceLayerProperties.map { p =>
                volumeTracing.copy(
                  editPosition = p.editPosition,
                  editRotation = p.editRotation,
                  zoomLevel = p.zoomLevel,
                  userBoundingBoxes = p.userBoundingBoxes,
                  editPositionAdditionalCoordinates = p.editPositionAdditionalCoordinates
                )
              }.getOrElse(volumeTracing)
              volumeTracingId <- client.saveVolumeTracing(volumeTracingAdapted)
              name = annotationLayerParameters.name
                .orElse(autoFallbackLayerName)
                .getOrElse(AnnotationLayer.defaultNameForType(annotationLayerParameters.typ))
            } yield (volumeTracingId, name)
          case _ =>
            Fox.failure(s"Unknown AnnotationLayerType: ${annotationLayerParameters.typ}")
        }
      } yield AnnotationLayer(tracingIdAndName._1, annotationLayerParameters.typ, tracingIdAndName._2)

    def fetchOldPrecedenceLayer: Fox[Option[FetchedAnnotationLayer]] =
      if (existingAnnotationLayers.isEmpty) Fox.successful(None)
      else
        for {
          oldPrecedenceLayer <- selectLayerWithPrecedence(existingAnnotationLayers)
          tracingStoreClient <- tracingStoreService.clientFor(dataSet)
          oldPrecedenceLayerFetched <- if (oldPrecedenceLayer.typ == AnnotationLayerType.Skeleton)
            tracingStoreClient.getSkeletonTracing(oldPrecedenceLayer, None)
          else
            tracingStoreClient.getVolumeTracing(oldPrecedenceLayer,
                                                None,
                                                skipVolumeData = true,
                                                volumeDataZipFormat = VolumeDataZipFormat.wkw,
                                                dataSet.scale)
        } yield Some(oldPrecedenceLayerFetched)

    def extractPrecedenceProperties(oldPrecedenceLayer: FetchedAnnotationLayer): RedundantTracingProperties =
      oldPrecedenceLayer.tracing match {
        case Left(s) =>
          RedundantTracingProperties(
            s.editPosition,
            s.editRotation,
            s.zoomLevel,
            s.userBoundingBoxes ++ s.userBoundingBox.map(
              com.scalableminds.webknossos.datastore.geometry.NamedBoundingBoxProto(0, None, None, None, _)),
            s.editPositionAdditionalCoordinates
          )
        case Right(v) =>
          RedundantTracingProperties(
            v.editPosition,
            v.editRotation,
            v.zoomLevel,
            v.userBoundingBoxes ++ v.userBoundingBox.map(
              com.scalableminds.webknossos.datastore.geometry.NamedBoundingBoxProto(0, None, None, None, _)),
            v.editPositionAdditionalCoordinates
          )
      }

    for {
      /*
        Note that the tracings have redundant properties, with a precedence logic selecting a layer
        from which the values are used. Adding a layer may change this precedence, so the redundant
        values need to be copied to the new layer from the layer that had precedence before. Otherwise, those
        properties would be masked and lost.
        Unfortunately, their history is still lost since the new layer gets only the latest snapshot.
        We do this for *every* new layer, since we only later get its ID which determines the actual precedence.
        All of this is skipped if existingAnnotationLayers is empty.
       */
      oldPrecedenceLayer <- fetchOldPrecedenceLayer
      precedenceProperties = oldPrecedenceLayer.map(extractPrecedenceProperties)
      newAnnotationLayers <- Fox.serialCombined(allAnnotationLayerParameters)(p =>
        createAndSaveAnnotationLayer(p, precedenceProperties))
    } yield newAnnotationLayers
  }

  /*
   If there is more than one tracing, select the one that has precedence for the parameters (they should be identical anyway)
   This needs to match the code in NmlWriter’s selectLayerWithPrecedence, though the types are different
   */
  private def selectLayerWithPrecedence(annotationLayers: List[AnnotationLayer]): Fox[AnnotationLayer] = {
    val skeletonLayers = annotationLayers.filter(_.typ == AnnotationLayerType.Skeleton)
    val volumeLayers = annotationLayers.filter(_.typ == AnnotationLayerType.Volume)
    if (skeletonLayers.nonEmpty) {
      Fox.successful(skeletonLayers.minBy(_.tracingId))
    } else if (volumeLayers.nonEmpty) {
      Fox.successful(volumeLayers.minBy(_.tracingId))
    } else Fox.failure("Trying to select precedence layer from empty layer list.")
  }

  def createExplorationalFor(user: User,
                             _dataSet: ObjectId,
                             annotationLayerParameters: List[AnnotationLayerParameters])(
      implicit ctx: DBAccessContext,
      m: MessagesProvider): Fox[Annotation] =
    for {
      dataSet <- datasetDAO.findOne(_dataSet) ?~> "dataset.noAccessById"
      dataSource <- datasetService.dataSourceFor(dataSet)
      datasetOrganization <- organizationDAO.findOne(dataSet._organization)
      usableDataSource <- dataSource.toUsable ?~> Messages("dataset.notImported", dataSource.id.name)
      annotationLayers <- createTracingsForExplorational(dataSet,
                                                         usableDataSource,
                                                         annotationLayerParameters,
                                                         datasetOrganization._id)
      teamId <- selectSuitableTeam(user, dataSet) ?~> "annotation.create.forbidden"
      annotation = Annotation(ObjectId.generate, _dataSet, None, teamId, user._id, annotationLayers)
      _ <- annotationDAO.insertOne(annotation)
    } yield {
      annotation
    }

  def makeAnnotationHybrid(annotation: Annotation, organizationName: String, fallbackLayerName: Option[String])(
      implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      newAnnotationLayerType <- annotation.tracingType match {
        case TracingType.skeleton => Fox.successful(AnnotationLayerType.Volume)
        case TracingType.volume   => Fox.successful(AnnotationLayerType.Skeleton)
        case _                    => Fox.failure("annotation.makeHybrid.alreadyHybrid")
      }
      usedFallbackLayerName = if (newAnnotationLayerType == AnnotationLayerType.Volume) fallbackLayerName else None
      newAnnotationLayerParameters = AnnotationLayerParameters(
        newAnnotationLayerType,
        usedFallbackLayerName,
        autoFallbackLayer = false,
        None,
        Some(ResolutionRestrictions.empty),
        Some(AnnotationLayer.defaultNameForType(newAnnotationLayerType)),
        None
      )
      _ <- addAnnotationLayer(annotation, organizationName, newAnnotationLayerParameters) ?~> "makeHybrid.createTracings.failed"
    } yield ()

  def downsampleAnnotation(annotation: Annotation, volumeAnnotationLayer: AnnotationLayer)(
      implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      dataSet <- datasetDAO.findOne(annotation._dataSet) ?~> "dataset.notFoundForAnnotation"
      _ <- bool2Fox(volumeAnnotationLayer.typ == AnnotationLayerType.Volume) ?~> "annotation.downsample.volumeOnly"
      rpcClient <- tracingStoreService.clientFor(dataSet)
      newVolumeTracingId <- rpcClient.duplicateVolumeTracing(volumeAnnotationLayer.tracingId, downsample = true)
      _ = logger.info(
        s"Replacing volume tracing ${volumeAnnotationLayer.tracingId} by downsampled copy $newVolumeTracingId for annotation ${annotation._id}.")
      _ <- annotationLayersDAO.replaceTracingId(annotation._id, volumeAnnotationLayer.tracingId, newVolumeTracingId)
    } yield ()

  def addSegmentIndex(annotation: Annotation, volumeAnnotationLayer: AnnotationLayer)(
      implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      dataSet <- datasetDAO.findOne(annotation._dataSet) ?~> "dataSet.notFoundForAnnotation"
      _ <- bool2Fox(volumeAnnotationLayer.typ == AnnotationLayerType.Volume) ?~> "annotation.downsample.volumeOnly"
      rpcClient <- tracingStoreService.clientFor(dataSet)
      // duplicate in tracingstore will add segment index if possible
      newVolumeTracingId <- rpcClient.duplicateVolumeTracing(volumeAnnotationLayer.tracingId)
      _ = logger.info(
        s"Replacing volume tracing ${volumeAnnotationLayer.tracingId} by copy with added segment index $newVolumeTracingId for annotation ${annotation._id}.")
      _ <- annotationLayersDAO.replaceTracingId(annotation._id, volumeAnnotationLayer.tracingId, newVolumeTracingId)
    } yield ()

  // WARNING: needs to be repeatable, might be called multiple times for an annotation
  def finish(annotation: Annotation, user: User, restrictions: AnnotationRestrictions)(
      implicit ctx: DBAccessContext): Fox[String] = {
    def executeFinish: Fox[String] =
      for {
        _ <- annotationDAO.updateModified(annotation._id, Instant.now)
        _ <- annotationDAO.updateState(annotation._id, AnnotationState.Finished)
      } yield {
        if (annotation._task.isEmpty)
          "annotation.finished"
        else
          "task.finished"
      }

    (for {
      allowed <- restrictions.allowFinishSoft(user)
    } yield {
      if (allowed) {
        if (annotation.state == Active) {
          logger.info(
            s"Finishing annotation ${annotation._id.toString}, new state will be ${AnnotationState.Finished.toString}, access context: ${ctx.toStringAnonymous}")
          executeFinish
        } else if (annotation.state == Finished) {
          logger.info(
            s"Silently not finishing annotation ${annotation._id.toString} for it is aready finished. Access context: ${ctx.toStringAnonymous}")
          Fox.successful("annotation.finished")
        } else {
          logger.info(
            s"Not finishing annotation ${annotation._id.toString} for its state is ${annotation.state.toString}. Access context: ${ctx.toStringAnonymous}")
          Fox.failure("annotation.notActive")
        }
      } else {
        logger.info(
          s"Not finishing annotation ${annotation._id.toString} due to missing permissions. Access context: ${ctx.toStringAnonymous}")
        Fox.failure("annotation.notPossible")
      }
    }).flatten
  }

  private def baseForTask(taskId: ObjectId)(implicit ctx: DBAccessContext): Fox[Annotation] =
    (for {
      list <- annotationDAO.findAllByTaskIdAndType(taskId, AnnotationType.TracingBase)
    } yield list.headOption.toFox).flatten

  def annotationsFor(taskId: ObjectId)(implicit ctx: DBAccessContext): Fox[List[Annotation]] =
    annotationDAO.findAllByTaskIdAndType(taskId, AnnotationType.Task)

  private def tracingsFromBase(annotationBase: Annotation, dataSet: Dataset)(
      implicit ctx: DBAccessContext,
      m: MessagesProvider): Fox[(Option[String], Option[String])] =
    for {
      _ <- bool2Fox(dataSet.isUsable) ?~> Messages("dataset.notImported", dataSet.name)
      tracingStoreClient <- tracingStoreService.clientFor(dataSet)
      baseSkeletonIdOpt <- annotationBase.skeletonTracingId
      baseVolumeIdOpt <- annotationBase.volumeTracingId
      newSkeletonId: Option[String] <- Fox.runOptional(baseSkeletonIdOpt)(skeletonId =>
        tracingStoreClient.duplicateSkeletonTracing(skeletonId))
      newVolumeId: Option[String] <- Fox.runOptional(baseVolumeIdOpt)(volumeId =>
        tracingStoreClient.duplicateVolumeTracing(volumeId))
    } yield (newSkeletonId, newVolumeId)

  def createAnnotationFor(user: User, taskId: ObjectId, initializingAnnotationId: ObjectId)(
      implicit m: MessagesProvider,
      ctx: DBAccessContext): Fox[Annotation] = {
    def useAsTemplateAndInsert(annotation: Annotation) =
      for {
        dataSetName <- datasetDAO.getNameById(annotation._dataSet)(GlobalAccessContext) ?~> "dataset.notFoundForAnnotation"
        dataSet <- datasetDAO.findOne(annotation._dataSet) ?~> Messages("dataset.noAccess", dataSetName)
        (newSkeletonId, newVolumeId) <- tracingsFromBase(annotation, dataSet) ?~> s"Failed to use annotation base as template for task $taskId with annotation base ${annotation._id}"
        annotationLayers <- AnnotationLayer.layersFromIds(newSkeletonId, newVolumeId)
        newAnnotation = annotation.copy(
          _id = initializingAnnotationId,
          _user = user._id,
          annotationLayers = annotationLayers,
          state = Active,
          typ = AnnotationType.Task,
          created = Instant.now,
          modified = Instant.now
        )
        _ <- annotationDAO.updateInitialized(newAnnotation)
      } yield newAnnotation

    for {
      annotationBase <- baseForTask(taskId) ?~> "Failed to retrieve annotation base."
      result <- useAsTemplateAndInsert(annotationBase).toFox
    } yield result
  }

  def createSkeletonTracingBase(dataSetName: String,
                                boundingBox: Option[BoundingBox],
                                startPosition: Vec3Int,
                                startRotation: Vec3Double): SkeletonTracing = {
    val initialNode = NodeDefaults.createInstance.withId(1).withPosition(startPosition).withRotation(startRotation)
    val initialTree = Tree(
      1,
      Seq(initialNode),
      Seq.empty,
      Some(ColorProto(1, 0, 0, 1)),
      Seq(BranchPoint(initialNode.id, System.currentTimeMillis())),
      Seq.empty,
      "",
      System.currentTimeMillis()
    )
    SkeletonTracingDefaults.createInstance.copy(
      dataSetName = dataSetName,
      boundingBox = boundingBox.flatMap { box =>
        if (box.isEmpty) None else Some(box)
      },
      editPosition = startPosition,
      editRotation = startRotation,
      activeNodeId = Some(1),
      trees = Seq(initialTree)
    )
  }

  def createVolumeTracingBase(dataSetName: String,
                              organizationId: String,
                              boundingBox: Option[BoundingBox],
                              startPosition: Vec3Int,
                              startRotation: Vec3Double,
                              volumeShowFallbackLayer: Boolean,
                              resolutionRestrictions: ResolutionRestrictions)(implicit ctx: DBAccessContext,
                                                                              m: MessagesProvider): Fox[VolumeTracing] =
    for {
      organization <- organizationDAO.findOne(organizationId)
      dataSet <- datasetDAO.findOneByNameAndOrganization(dataSetName, organizationId) ?~> Messages("dataset.notFound",
                                                                                                   dataSetName)
      dataSource <- datasetService.dataSourceFor(dataSet).flatMap(_.toUsable)

      fallbackLayer = if (volumeShowFallbackLayer) {
        dataSource.dataLayers.flatMap {
          case layer: SegmentationLayer => Some(layer)
          case _                        => None
        }.headOption
      } else None
      _ <- bool2Fox(fallbackLayer.forall(_.largestSegmentId.exists(_ >= 0L))) ?~> "annotation.volume.invalidLargestSegmentId"

      volumeTracing <- createVolumeTracing(
        dataSource,
        organization._id,
        fallbackLayer = fallbackLayer,
        boundingBox = boundingBox.flatMap { box =>
          if (box.isEmpty) None else Some(box)
        },
        startPosition = Some(startPosition),
        startRotation = Some(startRotation),
        resolutionRestrictions = resolutionRestrictions,
        mappingName = None
      )
    } yield volumeTracing

  def abortInitializedAnnotationOnFailure(initializingAnnotationId: ObjectId,
                                          insertedAnnotationBox: Box[Annotation]): Fox[Unit] =
    insertedAnnotationBox match {
      case Full(_) => Fox.successful(())
      case _       => annotationDAO.abortInitializingAnnotation(initializingAnnotationId)
    }

  def createAnnotationBase(
      taskFox: Fox[Task],
      userId: ObjectId,
      skeletonTracingIdBox: Box[Option[String]],
      volumeTracingIdBox: Box[Option[String]],
      dataSetId: ObjectId,
      description: Option[String]
  )(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      task <- taskFox
      skeletonIdOpt <- skeletonTracingIdBox.toFox
      volumeIdOpt <- volumeTracingIdBox.toFox
      _ <- bool2Fox(skeletonIdOpt.isDefined || volumeIdOpt.isDefined) ?~> "annotation.needsAtleastOne"
      project <- projectDAO.findOne(task._project)
      annotationLayers <- AnnotationLayer.layersFromIds(skeletonIdOpt, volumeIdOpt)
      annotationBase = Annotation(ObjectId.generate,
                                  dataSetId,
                                  Some(task._id),
                                  project._team,
                                  userId,
                                  annotationLayers,
                                  description.getOrElse(""),
                                  typ = AnnotationType.TracingBase)
      _ <- annotationDAO.insertOne(annotationBase)
    } yield ()

  def createFrom(user: User,
                 dataSet: Dataset,
                 annotationLayers: List[AnnotationLayer],
                 annotationType: AnnotationType,
                 name: Option[String],
                 description: String): Fox[Annotation] =
    for {
      teamId <- selectSuitableTeam(user, dataSet)
      annotation = Annotation(ObjectId.generate,
                              dataSet._id,
                              None,
                              teamId,
                              user._id,
                              annotationLayers,
                              description,
                              name = name.getOrElse(""),
                              typ = annotationType)
      _ <- annotationDAO.insertOne(annotation)
    } yield annotation

  // Does not use access query (because they dont support prefixes). Use only after separate access check!
  def sharedAnnotationsFor(userTeams: List[ObjectId]): Fox[List[Annotation]] =
    annotationDAO.findAllSharedForTeams(userTeams)

  def updateTeamsForSharedAnnotation(annotationId: ObjectId, teams: List[ObjectId])(
      implicit ctx: DBAccessContext): Fox[Unit] =
    annotationDAO.updateTeamsForSharedAnnotation(annotationId, teams)

  def zipAnnotations(annotations: List[Annotation],
                     zipFileName: String,
                     skipVolumeData: Boolean,
                     volumeDataZipFormat: VolumeDataZipFormat)(implicit
                                                               ctx: DBAccessContext): Fox[TemporaryFile] =
    for {
      downloadAnnotations <- getTracingsScalesAndNamesFor(annotations, skipVolumeData, volumeDataZipFormat)
      nmlsAndVolumes <- Fox.serialCombined(downloadAnnotations.flatten) {
        case DownloadAnnotation(skeletonTracingIdOpt,
                                volumeTracingIdOpt,
                                skeletonTracingOpt,
                                volumeTracingOpt,
                                volumeDataOpt,
                                name,
                                scaleOpt,
                                annotation,
                                user,
                                taskOpt,
                                organizationName,
                                datasetName) =>
          for {
            fetchedAnnotationLayersForAnnotation <- FetchedAnnotationLayer.layersFromTracings(skeletonTracingIdOpt,
                                                                                              volumeTracingIdOpt,
                                                                                              skeletonTracingOpt,
                                                                                              volumeTracingOpt)
            nml = nmlWriter.toNmlStream(
              name,
              fetchedAnnotationLayersForAnnotation,
              Some(annotation),
              scaleOpt,
              Some(name + "_data.zip"),
              organizationName,
              conf.Http.uri,
              datasetName,
              Some(user),
              taskOpt,
              skipVolumeData,
              volumeDataZipFormat
            )
          } yield (nml, volumeDataOpt)
      }
      zip <- createZip(nmlsAndVolumes, zipFileName)
    } yield zip

  private def getTracingsScalesAndNamesFor(
      annotations: List[Annotation],
      skipVolumeData: Boolean,
      volumeDataZipFormat: VolumeDataZipFormat)(implicit ctx: DBAccessContext): Fox[List[List[DownloadAnnotation]]] = {

    def getSingleDownloadAnnotation(annotation: Annotation, scaleOpt: Option[Vec3Double]) =
      for {
        user <- userService.findOneCached(annotation._user) ?~> "user.notFound"
        taskOpt <- Fox.runOptional(annotation._task)(taskDAO.findOne) ?~> "task.notFound"
        name <- savedTracingInformationHandler.nameForAnnotation(annotation)
        dataset <- datasetDAO.findOne(annotation._dataSet)
        organizationName <- organizationDAO.findOrganizationNameForAnnotation(annotation._id)
        skeletonTracingIdOpt <- annotation.skeletonTracingId
        volumeTracingIdOpt <- annotation.volumeTracingId
      } yield
        DownloadAnnotation(skeletonTracingIdOpt,
                           volumeTracingIdOpt,
                           None,
                           None,
                           None,
                           name,
                           scaleOpt,
                           annotation,
                           user,
                           taskOpt,
                           organizationName,
                           dataset.name)

    def getSkeletonTracings(dataSetId: ObjectId, tracingIds: List[Option[String]]): Fox[List[Option[SkeletonTracing]]] =
      for {
        dataSet <- datasetDAO.findOne(dataSetId)
        tracingStoreClient <- tracingStoreService.clientFor(dataSet)
        tracingContainers: List[SkeletonTracings] <- Fox.serialCombined(tracingIds.grouped(1000).toList)(
          tracingStoreClient.getSkeletonTracings)
        tracingOpts: List[SkeletonTracingOpt] = tracingContainers.flatMap(_.tracings)
      } yield tracingOpts.map(_.tracing)

    def getVolumeTracings(dataSetId: ObjectId, tracingIds: List[Option[String]]): Fox[List[Option[VolumeTracing]]] =
      for {
        dataSet <- datasetDAO.findOne(dataSetId)
        tracingStoreClient <- tracingStoreService.clientFor(dataSet)
        tracingContainers: List[VolumeTracings] <- Fox.serialCombined(tracingIds.grouped(1000).toList)(
          tracingStoreClient.getVolumeTracings)
        tracingOpts: List[VolumeTracingOpt] = tracingContainers.flatMap(_.tracings)
      } yield tracingOpts.map(_.tracing)

    def getVolumeDataObjects(datasetId: ObjectId,
                             tracingIds: List[Option[String]],
                             volumeDataZipFormat: VolumeDataZipFormat): Fox[List[Option[Array[Byte]]]] =
      for {
        dataset <- datasetDAO.findOne(datasetId)
        tracingStoreClient <- tracingStoreService.clientFor(dataset)
        tracingDataObjects: List[Option[Array[Byte]]] <- Fox.serialCombined(tracingIds) {
          case None                      => Fox.successful(None)
          case Some(_) if skipVolumeData => Fox.successful(None)
          case Some(tracingId) =>
            tracingStoreClient
              .getVolumeData(tracingId,
                             version = None,
                             volumeDataZipFormat = volumeDataZipFormat,
                             voxelSize = dataset.scale)
              .map(Some(_))
        }
      } yield tracingDataObjects

    def getDatasetScale(dataSetId: ObjectId) =
      for {
        dataSet <- datasetDAO.findOne(dataSetId)
      } yield dataSet.scale

    val annotationsGrouped: Map[ObjectId, List[Annotation]] = annotations.groupBy(_._dataSet)
    val tracingsGrouped = annotationsGrouped.map {
      case (dataSetId, annotations) =>
        for {
          scale <- getDatasetScale(dataSetId)
          skeletonTracingIdOpts <- Fox.serialCombined(annotations)(a => a.skeletonTracingId)
          volumeTracingIdOpts <- Fox.serialCombined(annotations)(a => a.volumeTracingId)
          skeletonTracings <- getSkeletonTracings(dataSetId, skeletonTracingIdOpts)
          volumeTracings <- getVolumeTracings(dataSetId, volumeTracingIdOpts)
          volumeDataObjects <- getVolumeDataObjects(dataSetId, volumeTracingIdOpts, volumeDataZipFormat)
          incompleteDownloadAnnotations <- Fox.serialCombined(annotations)(getSingleDownloadAnnotation(_, scale))
        } yield
          incompleteDownloadAnnotations
            .zip(skeletonTracings)
            .map {
              case (downloadAnnotation, skeletonTracingOpt) =>
                downloadAnnotation.copy(skeletonTracingOpt = skeletonTracingOpt)
            }
            .zip(volumeTracings)
            .map {
              case (downloadAnnotation, volumeTracingOpt) =>
                downloadAnnotation.copy(volumeTracingOpt = volumeTracingOpt)
            }
            .zip(volumeDataObjects)
            .map {
              case (downloadAnnotation, volumeDataOpt) =>
                downloadAnnotation.copy(volumeDataOpt = volumeDataOpt)
            }
    }

    Fox.combined(tracingsGrouped.toList)
  }

  private def createZip(nmls: List[(NamedStream, Option[Array[Byte]])], zipFileName: String): Fox[TemporaryFile] = {
    val zipped = temporaryFileCreator.create(TextUtils.normalize(zipFileName), ".zip")
    val zipper = ZipIO.startZip(new BufferedOutputStream(new FileOutputStream(new File(zipped.path.toString))))

    def addToZip(nmls: List[(NamedStream, Option[Array[Byte]])]): Fox[Boolean] =
      nmls match {
        case (nml, volumeDataOpt) :: tail =>
          if (volumeDataOpt.isDefined) {
            val subZip = temporaryFileCreator.create(TextUtils.normalize(nml.name), ".zip")
            val subZipper =
              ZipIO.startZip(new BufferedOutputStream(new FileOutputStream(new File(subZip.path.toString))))
            volumeDataOpt.foreach(volumeData => subZipper.addFileFromBytes(nml.name + "_data.zip", volumeData))
            for {
              _ <- subZipper.addFileFromNamedStream(nml, suffix = ".nml")
              _ = subZipper.close()
              _ = zipper.addFileFromTemporaryFile(nml.name + ".zip", subZip)
              res <- addToZip(tail)
            } yield res
          } else {
            zipper.addFileFromNamedStream(nml, suffix = ".nml").flatMap(_ => addToZip(tail))
          }
        case _ =>
          Future.successful(true)
      }

    addToZip(nmls).map { _ =>
      zipper.close()
      zipped
    }
  }

  def transferAnnotationToUser(typ: String, id: String, userId: ObjectId, issuingUser: User)(
      implicit ctx: DBAccessContext): Fox[Annotation] =
    for {
      annotation <- annotationInformationProvider.provideAnnotation(typ, id, issuingUser) ?~> "annotation.notFound"
      newUser <- userDAO.findOne(userId) ?~> "user.notFound"
      _ <- datasetDAO.findOne(annotation._dataSet)(AuthorizedAccessContext(newUser)) ?~> "annotation.transferee.noDatasetAccess"
      _ <- annotationDAO.updateUser(annotation._id, newUser._id)
      updated <- annotationInformationProvider.provideAnnotation(typ, id, issuingUser)
    } yield updated

  def resetToBase(annotation: Annotation)(implicit ctx: DBAccessContext, m: MessagesProvider): Fox[Unit] =
    annotation.typ match {
      case AnnotationType.Explorational =>
        Fox.failure("annotation.revert.tasksOnly")
      case AnnotationType.Task =>
        for {
          task <- taskFor(annotation)
          oldSkeletonTracingIdOpt <- annotation.skeletonTracingId // This also asserts that the annotation does not have multiple volume/skeleton layers
          oldVolumeTracingIdOpt <- annotation.volumeTracingId
          _ = logger.warn(
            s"Resetting annotation ${annotation._id} to base, discarding skeleton tracing $oldSkeletonTracingIdOpt and/or volume tracing $oldVolumeTracingIdOpt")
          annotationBase <- baseForTask(task._id)
          dataSet <- datasetDAO.findOne(annotationBase._dataSet)(GlobalAccessContext) ?~> "dataset.notFoundForAnnotation"
          (newSkeletonIdOpt, newVolumeIdOpt) <- tracingsFromBase(annotationBase, dataSet)
          _ <- Fox.bool2Fox(newSkeletonIdOpt.isDefined || newVolumeIdOpt.isDefined) ?~> "annotation.needsEitherSkeletonOrVolume"
          _ <- Fox.runOptional(newSkeletonIdOpt)(newSkeletonId =>
            oldSkeletonTracingIdOpt.toFox.map { oldSkeletonId =>
              annotationLayersDAO.replaceTracingId(annotation._id, oldSkeletonId, newSkeletonId)
          })
          _ <- Fox.runOptional(newVolumeIdOpt)(newVolumeId =>
            oldVolumeTracingIdOpt.toFox.map { oldVolumeId =>
              annotationLayersDAO.replaceTracingId(annotation._id, oldVolumeId, newVolumeId)
          })
        } yield ()
    }

  private def settingsFor(annotation: Annotation)(implicit ctx: DBAccessContext) =
    if (annotation.typ == AnnotationType.Task || annotation.typ == AnnotationType.TracingBase)
      for {
        taskId <- annotation._task.toFox
        task: Task <- taskDAO.findOne(taskId) ?~> "task.notFound"
        taskType <- taskTypeDAO.findOne(task._taskType) ?~> "taskType.notFound"
      } yield {
        taskType.settings
      } else
      Fox.successful(AnnotationSettings.defaultFor(annotation.tracingType))

  def taskFor(annotation: Annotation)(implicit ctx: DBAccessContext): Fox[Task] =
    annotation._task.toFox.flatMap(taskId => taskDAO.findOne(taskId))

  def publicWrites(annotation: Annotation,
                   requestingUser: Option[User] = None,
                   restrictionsOpt: Option[AnnotationRestrictions] = None): Fox[JsObject] = {
    implicit val ctx: DBAccessContext = GlobalAccessContext
    for {
      dataSet <- datasetDAO.findOne(annotation._dataSet) ?~> "dataset.notFoundForAnnotation"
      organization <- organizationDAO.findOne(dataSet._organization) ?~> "organization.notFound"
      task = annotation._task.toFox.flatMap(taskId => taskDAO.findOne(taskId))
      taskJson <- task.flatMap(t => taskService.publicWrites(t)).getOrElse(JsNull)
      userJson <- userJsonForAnnotation(annotation._user)
      settings <- settingsFor(annotation)
      restrictionsJs <- AnnotationRestrictions.writeAsJson(
        restrictionsOpt.getOrElse(annotationRestrictionDefults.defaultsFor(annotation)),
        requestingUser)
      dataStore <- dataStoreDAO.findOneByName(dataSet._dataStore.trim) ?~> "datastore.notFound"
      dataStoreJs <- dataStoreService.publicWrites(dataStore)
      teams <- teamDAO.findSharedTeamsForAnnotation(annotation._id)
      teamsJson <- Fox.serialCombined(teams)(teamService.publicWrites(_))
      tracingStore <- tracingStoreDAO.findFirst
      tracingStoreJs <- tracingStoreService.publicWrites(tracingStore)
      contributors <- userDAO.findContributorsForAnnotation(annotation._id)
      contributorsJs <- Fox.serialCombined(contributors)(c => userJsonForAnnotation(c._id, Some(c)))
    } yield {
      Json.obj(
        "modified" -> annotation.modified,
        "state" -> annotation.state,
        "id" -> annotation.id,
        "name" -> annotation.name,
        "description" -> annotation.description,
        "viewConfiguration" -> annotation.viewConfiguration,
        "typ" -> annotation.typ,
        "task" -> taskJson,
        "stats" -> annotation.statistics,
        "restrictions" -> restrictionsJs,
        "formattedHash" -> Formatter.formatHash(annotation._id.toString),
        "annotationLayers" -> Json.toJson(annotation.annotationLayers),
        "dataSetName" -> dataSet.name,
        "organization" -> organization.name,
        "dataStore" -> dataStoreJs,
        "tracingStore" -> tracingStoreJs,
        "visibility" -> annotation.visibility,
        "settings" -> settings,
        "tracingTime" -> annotation.tracingTime,
        "teams" -> teamsJson,
        "tags" -> (annotation.tags ++ Set(dataSet.name, annotation.tracingType.toString)),
        "user" -> userJson,
        "owner" -> userJson,
        "contributors" -> contributorsJs,
        "othersMayEdit" -> annotation.othersMayEdit
      )
    }
  }

  def writesWithDataset(annotation: Annotation): Fox[JsObject] = {
    implicit val ctx: DBAccessContext = GlobalAccessContext
    for {
      dataSet <- datasetDAO.findOne(annotation._dataSet) ?~> "dataset.notFoundForAnnotation"
      tracingStore <- tracingStoreDAO.findFirst
      tracingStoreJs <- tracingStoreService.publicWrites(tracingStore)
      dataSetJs <- datasetService.publicWrites(dataSet, None, None, None)
    } yield
      Json.obj(
        "id" -> annotation._id.id,
        "name" -> annotation.name,
        "description" -> annotation.description,
        "typ" -> annotation.typ,
        "tracingStore" -> tracingStoreJs,
        "dataSet" -> dataSetJs
      )
  }

  def writesAsAnnotationSource(annotation: Annotation, accessViaPrivateLink: Boolean): Fox[JsValue] = {
    implicit val ctx: DBAccessContext = GlobalAccessContext
    for {
      dataSet <- datasetDAO.findOne(annotation._dataSet) ?~> "dataset.notFoundForAnnotation"
      organization <- organizationDAO.findOne(dataSet._organization) ?~> "organization.notFound"
      dataStore <- dataStoreDAO.findOneByName(dataSet._dataStore.trim) ?~> "datastore.notFound"
      tracingStore <- tracingStoreDAO.findFirst
      annotationSource = AnnotationSource(
        id = annotation.id,
        annotationLayers = annotation.annotationLayers,
        dataSetName = dataSet.name,
        organizationName = organization.name,
        dataStoreUrl = dataStore.publicUrl,
        tracingStoreUrl = tracingStore.publicUrl,
        accessViaPrivateLink = accessViaPrivateLink,
      )
    } yield Json.toJson(annotationSource)
  }

  private def userJsonForAnnotation(userId: ObjectId, userOpt: Option[User] = None): Fox[Option[JsObject]] =
    if (userId == ObjectId.dummyId) {
      Fox.successful(None)
    } else {
      for {
        user <- Fox.fillOption(userOpt)(userService.findOneCached(userId)(GlobalAccessContext)) ?~> "user.notFound"
        userJson <- userService.compactWrites(user)
      } yield Some(userJson)
    }

  //for Explorative Annotations list
  def compactWrites(annotation: Annotation): Fox[JsObject] = {
    implicit val ctx: DBAccessContext = GlobalAccessContext
    for {
      dataSet <- datasetDAO.findOne(annotation._dataSet) ?~> "dataset.notFoundForAnnotation"
      organization <- organizationDAO.findOne(dataSet._organization) ?~> "organization.notFound"
      teams <- teamDAO.findSharedTeamsForAnnotation(annotation._id) ?~> s"fetching sharedTeams for annotation ${annotation._id} failed"
      teamsJson <- Fox.serialCombined(teams)(teamService.publicWrites(_, Some(organization))) ?~> s"serializing sharedTeams for annotation ${annotation._id} failed"
      user <- userDAO.findOne(annotation._user) ?~> s"fetching owner info for annotation ${annotation._id} failed"
      userJson = Json.obj(
        "id" -> user._id.toString,
        "firstName" -> user.firstName,
        "lastName" -> user.lastName
      )
    } yield {
      Json.obj(
        "modified" -> annotation.modified,
        "state" -> annotation.state,
        "id" -> annotation._id.toString,
        "name" -> annotation.name,
        "description" -> annotation.description,
        "typ" -> annotation.typ,
        "stats" -> annotation.statistics,
        "formattedHash" -> Formatter.formatHash(annotation._id.toString),
        "annotationLayers" -> annotation.annotationLayers,
        "dataSetName" -> dataSet.name,
        "organization" -> organization.name,
        "visibility" -> annotation.visibility,
        "tracingTime" -> annotation.tracingTime,
        "teams" -> teamsJson,
        "tags" -> (annotation.tags ++ Set(dataSet.name, annotation.tracingType.toString)),
        "owner" -> userJson,
        "othersMayEdit" -> annotation.othersMayEdit
      )
    }
  }
}
