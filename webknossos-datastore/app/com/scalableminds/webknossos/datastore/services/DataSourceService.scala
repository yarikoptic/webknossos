package com.scalableminds.webknossos.datastore.services

import java.io.{File, FileWriter}
import java.nio.file.{Files, Path, Paths}

import akka.actor.ActorSystem
import com.google.inject.Inject
import com.google.inject.name.Named
import com.scalableminds.util.io.PathUtils
import com.scalableminds.util.tools.{Fox, FoxImplicits, JsonHelper}
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.dataformats.MappingProvider
import com.scalableminds.webknossos.datastore.dataformats.wkw.WKWDataFormat
import com.scalableminds.webknossos.datastore.helpers.IntervalScheduler
import com.scalableminds.webknossos.datastore.models.datasource._
import com.scalableminds.webknossos.datastore.models.datasource.inbox.{InboxDataSource, UnusableDataSource}
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common._
import org.joda.time.DateTime
import org.joda.time.format.ISODateTimeFormat
import play.api.inject.ApplicationLifecycle
import play.api.libs.json.Json

import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.duration._
import scala.io.Source

class DataSourceService @Inject()(
    config: DataStoreConfig,
    dataSourceRepository: DataSourceRepository,
    val lifecycle: ApplicationLifecycle,
    @Named("webknossos-datastore") val system: ActorSystem
) extends IntervalScheduler
    with LazyLogging
    with FoxImplicits {

  override protected lazy val enabled: Boolean = config.Datastore.WatchFileSystem.enabled
  protected lazy val tickerInterval: FiniteDuration = config.Datastore.WatchFileSystem.interval

  val dataBaseDir: Path = Paths.get(config.Datastore.baseFolder)

  private val propertiesFileName = Paths.get("datasource-properties.json")
  private val logFileName = Paths.get("datasource-properties-backups.log")

  var inboxCheckVerboseCounter = 0

  def tick(): Unit = {
    checkInbox(verbose = inboxCheckVerboseCounter == 0)
    inboxCheckVerboseCounter += 1
    if (inboxCheckVerboseCounter >= 10) inboxCheckVerboseCounter = 0
  }

  def checkInbox(verbose: Boolean): Fox[Unit] = {
    if (verbose) logger.info(s"Scanning inbox ($dataBaseDir)...")
    for {
      _ <- PathUtils.listDirectories(dataBaseDir) match {
        case Full(organizationDirs) =>
          for {
            _ <- Fox.successful(())
            _ = if (verbose) logEmptyDirs(organizationDirs)
            foundInboxSources = organizationDirs.flatMap(teamAwareInboxSources)
            _ = logFoundDatasources(foundInboxSources, verbose)
            _ <- dataSourceRepository.updateDataSources(foundInboxSources)
          } yield ()
        case e =>
          val errorMsg = s"Failed to scan inbox. Error during list directories on '$dataBaseDir': $e"
          logger.error(errorMsg)
          Fox.failure(errorMsg)
      }
    } yield ()
  }

  private def logFoundDatasources(foundInboxSources: Seq[InboxDataSource], verbose: Boolean): Unit = {
    val shortForm =
      s"Finished scanning inbox ($dataBaseDir): ${foundInboxSources.count(_.isUsable)} active, ${foundInboxSources
        .count(!_.isUsable)} inactive"
    val msg = if (verbose) {
      val byTeam: Map[String, Seq[InboxDataSource]] = foundInboxSources.groupBy(_.id.team)
      shortForm + ". " + byTeam.keys.map { team =>
        val byUsable: Map[Boolean, Seq[InboxDataSource]] = byTeam(team).groupBy(_.isUsable)
        team + ": [" + byUsable.keys.map { usable =>
          val label = if (usable) "active: [" else "inactive: ["
          label + byUsable(usable).map { ds =>
            s"${ds.id.name}"
          }.mkString(" ") + "]"
        }.mkString(", ") + "]"
      }.mkString(", ")
    } else {
      shortForm
    }
    logger.info(msg)
  }

  private def logEmptyDirs(paths: List[Path]): Unit = {

    val emptyDirs = paths.flatMap { path =>
      PathUtils.listDirectories(path) match {
        case Full(Nil) =>
          Some(path)
        case _ => None
      }
    }

    if (emptyDirs.nonEmpty) logger.warn(s"Empty organization dataset dirs: ${emptyDirs.mkString(", ")}")
  }

  def exploreDataSource(id: DataSourceId, previous: Option[DataSource]): Box[(DataSource, List[(String, String)])] = {
    val path = dataBaseDir.resolve(id.team).resolve(id.name)
    val report = DataSourceImportReport[Path](dataBaseDir.relativize(path))
    for {
      dataSource <- WKWDataFormat.exploreDataSource(id, path, previous, report)
    } yield (dataSource, report.messages.toList)
  }

  def exploreMappings(organizationName: String, dataSetName: String, dataLayerName: String): Set[String] =
    MappingProvider
      .exploreMappings(dataBaseDir.resolve(organizationName).resolve(dataSetName).resolve(dataLayerName))
      .getOrElse(Set())

  private def validateDataSource(dataSource: DataSource): Box[Unit] = {
    def Check(expression: Boolean, msg: String): Option[String] = if (!expression) Some(msg) else None

    // Check, that each dimension increases monotonically between different resolutions.
    val resolutionsByX = dataSource.dataLayers.map(_.resolutions.sortBy(_.x))
    val resolutionsByY = dataSource.dataLayers.map(_.resolutions.sortBy(_.y))
    val resolutionsByZ = dataSource.dataLayers.map(_.resolutions.sortBy(_.z))

    val errors = List(
      Check(dataSource.scale.isValid, "DataSource scale is invalid"),
      Check(resolutionsByX == resolutionsByY && resolutionsByX == resolutionsByZ,
            "Scales do not monotonically increase in all dimensions"),
      Check(dataSource.dataLayers.nonEmpty, "DataSource must have at least one dataLayer"),
      Check(dataSource.dataLayers.forall(!_.boundingBox.isEmpty), "DataSource bounding box must not be empty"),
      Check(
        dataSource.dataLayers.forall {
          case layer: SegmentationLayer =>
            layer.largestSegmentId > 0 && layer.largestSegmentId < ElementClass.maxSegmentIdValue(layer.elementClass)
          case _ =>
            true
        },
        "Largest segment ID invalid"
      )
    ).flatten

    if (errors.isEmpty) {
      Full(())
    } else {
      ParamFailure("DataSource is invalid", Json.toJson(errors.map(e => Json.obj("error" -> e))))
    }
  }

  def updateDataSource(dataSource: DataSource): Fox[Unit] =
    for {
      _ <- validateDataSource(dataSource).toFox
      dataSourcePath = dataBaseDir.resolve(dataSource.id.team).resolve(dataSource.id.name)
      propertiesFile = dataSourcePath.resolve(propertiesFileName)
      _ <- backupPreviousProperties(dataSourcePath) ?~> "Could not update datasource-properties.json"
      _ <- JsonHelper.jsonToFile(propertiesFile, dataSource) ?~> "Could not update datasource-properties.json"
      _ <- dataSourceRepository.updateDataSource(dataSource)
    } yield ()

  def backupPreviousProperties(dataSourcePath: Path): Box[Unit] = {
    val propertiesFile = dataSourcePath.resolve(propertiesFileName)
    val previousContentOrEmpty = if (Files.exists(propertiesFile)) {
      val previousContentSource = Source.fromFile(propertiesFile.toString)
      val previousContent = previousContentSource.getLines.mkString("\n")
      previousContentSource.close()
      previousContent
    } else {
      "<empty>"
    }
    val timestamp = ISODateTimeFormat.dateTime.print(new DateTime())
    val outputForLogfile =
      f"Contents of $propertiesFileName were changed by webKnossos at $timestamp. Old content: \n\n$previousContentOrEmpty\n\n"
    val logfilePath = dataSourcePath.resolve(logFileName)
    try {
      val fileWriter = new FileWriter(logfilePath.toString, true)
      try {
        fileWriter.write(outputForLogfile)
        Full(())
      } finally fileWriter.close()
    } catch {
      case e: Exception => Failure(s"Could not back up old contents: ${e.toString}")
    }
  }

  private def teamAwareInboxSources(path: Path): List[InboxDataSource] = {
    val organization = path.getFileName.toString

    PathUtils.listDirectories(path) match {
      case Full(dataSourceDirs) =>
        val dataSources = dataSourceDirs.map(path => dataSourceFromFolder(path, organization))
        dataSources
      case _ =>
        logger.error(s"Failed to list directories for organization $organization at path $path")
        Nil
    }
  }

  def dataSourceFromFolder(path: Path, organization: String): InboxDataSource = {
    val id = DataSourceId(path.getFileName.toString, organization)
    val propertiesFile = path.resolve(propertiesFileName)

    if (new File(propertiesFile.toString).exists()) {
      JsonHelper.validatedJsonFromFile[DataSource](propertiesFile, path) match {
        case Full(dataSource) =>
          if (dataSource.dataLayers.nonEmpty) dataSource.copy(id)
          else
            UnusableDataSource(id, "Error: Zero layer Dataset", Some(dataSource.scale), Some(Json.toJson(dataSource)))
        case e =>
          UnusableDataSource(id,
                             s"Error: Invalid json format in $propertiesFile: $e",
                             existingDataSourceProperties = JsonHelper.jsonFromFile(propertiesFile, path).toOption)
      }
    } else {
      UnusableDataSource(id, "Not imported yet.")
    }
  }

}
