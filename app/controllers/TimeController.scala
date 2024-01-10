package controllers

import java.text.SimpleDateFormat
import java.util.Calendar
import play.silhouette.api.Silhouette
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Fox, FoxImplicits}

import javax.inject.Inject
import models.user._
import models.user.time.{Interval, TimeSpan, TimeSpanDAO, TimeSpanService}
import net.liftweb.common.Box
import play.api.i18n.Messages
import play.api.libs.json.{JsObject, JsValue, Json}
import play.api.mvc.{Action, AnyContent}
import security.WkEnv
import utils.ObjectId

import scala.concurrent.ExecutionContext

class TimeController @Inject()(userService: UserService,
                               userDAO: UserDAO,
                               timeSpanDAO: TimeSpanDAO,
                               timeSpanService: TimeSpanService,
                               sil: Silhouette[WkEnv])(implicit ec: ExecutionContext)
    extends Controller
    with FoxImplicits {

  // Called by webknossos-libs client. Sums monthly. Includes exploratives
  def userLoggedTime(userId: String): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        userIdValidated <- ObjectId.fromString(userId) ?~> "user.id.invalid"
        user <- userDAO.findOne(userIdValidated) ?~> "user.notFound" ~> NOT_FOUND
        _ <- Fox.assertTrue(userService.isEditableBy(user, request.identity)) ?~> "notAllowed" ~> FORBIDDEN
        timeSpansBox: Box[List[TimeSpan]] <- timeSpanDAO.findAllByUser(user._id).futureBox
        loggedTimeAsMap = timeSpanService.sumTimespansPerInterval(TimeSpan.groupByMonth, timeSpansBox)
      } yield {
        JsonOk(
          Json.obj("loggedTime" ->
            loggedTimeAsMap.map {
              case (paymentInterval, duration) =>
                Json.obj("paymentInterval" -> paymentInterval, "durationInSeconds" -> duration.toSeconds)
            }))
      }
    }

  // Legacy, called by braintracing
  def timeSpansOfAllUsers(year: Int, month: Int, startDay: Option[Int], endDay: Option[Int]): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        users <- userDAO.findAll
        filteredUsers <- Fox.filter(users)(user => userService.isTeamManagerOrAdminOf(request.identity, user))
        js <- getTimeSpansOfUsersForMonthJs(filteredUsers, year, month, startDay, endDay)
      } yield Ok(js)
    }

  // Legacy, called by braintracing
  def timeSpansOfUsers(userString: String, year: Int, month: Int, startDay: Option[Int], endDay: Option[Int],
  ): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        users <- Fox.combined(
          userString
            .split(",")
            .toList
            .map(email => userService.findOneByEmailAndOrganization(email, request.identity._organization))) ?~> "user.email.invalid"
        _ <- Fox.combined(users.map(user => Fox.assertTrue(userService.isTeamManagerOrAdminOf(request.identity, user)))) ?~> "user.notAuthorised" ~> FORBIDDEN
        js <- getTimeSpansOfUsersForMonthJs(users, year, month, startDay, endDay)
      } yield Ok(js)
    }

  def timeSpansOfUser(userId: String,
                      startDate: Long,
                      endDate: Long,
                      onlyCountTasks: Option[Boolean],
                      projectIds: Option[String]): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        userIdValidated <- ObjectId.fromString(userId)
        projectIdsValidated <- parseProjectIdsOpt(projectIds)
        user <- userService.findOneCached(userIdValidated) ?~> "user.notFound" ~> NOT_FOUND
        isTeamManagerOrAdmin <- userService.isTeamManagerOrAdminOf(request.identity, user)
        _ <- bool2Fox(isTeamManagerOrAdmin || user._id == request.identity._id) ?~> "user.notAuthorised" ~> FORBIDDEN
        js <- getUserTimeSpansJs(user,
                                 Instant(startDate),
                                 Instant(endDate),
                                 onlyCountTasks.getOrElse(true),
                                 projectIdsValidated)
      } yield Ok(js)
    }

  private def getTimeSpansOfUsersForMonthJs(users: List[User],
                                            year: Int,
                                            month: Int,
                                            startDay: Option[Int],
                                            endDay: Option[Int]): Fox[JsValue] = {
    lazy val startDate = Calendar.getInstance()
    lazy val endDate = Calendar.getInstance()

    val input = new SimpleDateFormat("yy")
    val output = new SimpleDateFormat("yyyy")
    val date = input.parse(year.toString)
    val fullYear = output.format(date).toInt

    //set them here to first day of selected month so getActualMaximum below will use the correct month entry
    startDate.set(fullYear, month - 1, 1, 0, 0, 0)
    endDate.set(fullYear, month - 1, 1, 0, 0, 0)

    val sDay = startDay.getOrElse(startDate.getActualMinimum(Calendar.DAY_OF_MONTH))
    val eDay = endDay.getOrElse(endDate.getActualMaximum(Calendar.DAY_OF_MONTH))

    startDate.set(fullYear, month - 1, sDay, 0, 0, 0)
    startDate.set(Calendar.MILLISECOND, 0)
    endDate.set(fullYear, month - 1, eDay, 23, 59, 59)
    endDate.set(Calendar.MILLISECOND, 999)

    for {
      userTimeSpansJsList: Seq[JsObject] <- Fox.serialCombined(users)(
        user =>
          getUserTimeSpansJs(user,
                             Instant.fromCalendar(startDate),
                             Instant.fromCalendar(endDate),
                             onlyCountTasks = true,
                             projectIdsOpt = None))
    } yield Json.toJson(userTimeSpansJsList)
  }

  private def getUserTimeSpansJs(user: User,
                                 start: Instant,
                                 end: Instant,
                                 onlyCountTasks: Boolean,
                                 projectIdsOpt: Option[List[ObjectId]]): Fox[JsObject] =
    for {
      userJs <- userService.compactWrites(user)
      timeSpansJs <- timeSpanDAO.findAllByUserWithTask(user._id, start, end, onlyCountTasks, projectIdsOpt)
    } yield Json.obj("user" -> userJs, "timelogs" -> timeSpansJs)

  // Used for graph on statistics page. Always includes explorative annotations
  def timeGroupedByInterval(interval: String, start: Option[Long], end: Option[Long]): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      intervalGroupingFunctions.get(interval) match {
        case Some(intervalGroupingFunction) =>
          for {
            organizationId <- Fox.successful(request.identity._organization)
            _ <- Fox.assertTrue(userService.isTeamManagerOrAdminOfOrg(request.identity, organizationId)) ?~> "notAllowed" ~> FORBIDDEN
            timeSpansBox: Box[List[TimeSpan]] <- timeSpanDAO
              .findAllByOrganization(start.map(Instant(_)), end.map(Instant(_)), organizationId)
              .futureBox
            timesGrouped = timeSpanService.sumTimespansPerInterval(intervalGroupingFunction, timeSpansBox)
          } yield {
            Ok(
              Json.obj(
                "timeGroupedByInterval" -> timesGrouped.map {
                  case (interval, duration) =>
                    Json.obj(
                      "start" -> interval.start.toString,
                      "end" -> interval.end.toString,
                      "tracingTime" -> duration.toMillis
                    )
                },
              )
            )
          }
        case _ =>
          Fox.successful(BadRequest(Messages("statistics.interval.invalid")))
      }
    }

  private val intervalGroupingFunctions: Map[String, TimeSpan => Interval] = Map(
    "month" -> TimeSpan.groupByMonth,
    "week" -> TimeSpan.groupByWeek,
    "day" -> TimeSpan.groupByDay
  )

  def timeSummedUserList(start: Long,
                         end: Long,
                         onlyCountTasks: Boolean,
                         teamId: String,
                         projectIds: Option[String]): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        _ <- Fox.assertTrue(userService.isTeamManagerOrAdminOfOrg(request.identity, request.identity._organization)) ?~> "notAllowed" ~> FORBIDDEN
        teamIdValidated <- ObjectId.fromString(teamId)
        projectIdsValidated <- parseProjectIdsOpt(projectIds)
        users <- userDAO.findAllByTeams(List(teamIdValidated))
        notUnlistedUsers = users.filter(!_.isUnlisted)
        usersWithTimesJs <- timeSpanDAO.timeSummedSearch(Instant(start),
                                                         Instant(end),
                                                         notUnlistedUsers.map(_._id),
                                                         onlyCountTasks,
                                                         projectIdsValidated)
      } yield Ok(Json.toJson(usersWithTimesJs))
    }

  private def parseProjectIdsOpt(projectIdsStr: Option[String]): Fox[Option[List[ObjectId]]] =
    Fox.runOptional(projectIdsStr) { pidsStr: String =>
      Fox.serialCombined(pidsStr.split(",").toList)(pid => ObjectId.fromString(pid))
    }
}
