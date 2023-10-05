package controllers

import com.mohiva.play.silhouette.api.Silhouette
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.annotation.{AnnotationDAO, AnnotationType}
import models.team.TeamDAO
import models.user.{User, UserDAO, UserService}
import play.api.libs.json.{Json, OFormat}
import play.api.mvc.{Action, AnyContent}
import security.WkEnv
import utils.ObjectId
import utils.sql.{SimpleSQLDAO, SqlClient}

import javax.inject.Inject
import scala.concurrent.ExecutionContext

case class AvailableTaskCountsEntry(id: String,
                                    user: String,
                                    totalAvailableTasks: Int,
                                    availableTasksByProjects: Map[String, Int])
object AvailableTaskCountsEntry {
  implicit val jsonFormat: OFormat[AvailableTaskCountsEntry] = Json.format[AvailableTaskCountsEntry]
}

case class ProjectProgressEntry(projectName: String,
                                paused: Boolean,
                                priority: Long,
                                totalTasks: Int,
                                totalInstances: Int,
                                pendingInstances: Int,
                                finishedInstances: Int,
                                activeInstances: Int,
                                billedMilliseconds: Long)
object ProjectProgressEntry {
  implicit val jsonFormat: OFormat[ProjectProgressEntry] = Json.format[ProjectProgressEntry]
}

class ReportDAO @Inject()(sqlClient: SqlClient, annotationDAO: AnnotationDAO)(implicit ec: ExecutionContext)
    extends SimpleSQLDAO(sqlClient) {

  def projectProgress(teamId: ObjectId): Fox[List[ProjectProgressEntry]] =
    for {
      r <- run(q"""
          with teamMembers as (select _user from webknossos.user_team_roles ut where ut._team = $teamId)

          ,experiences as (select ue.domain, ue.value
          from
            teamMembers u
            JOIN webknossos.user_experiences ue on ue._user = u._user
          )

          ,filteredProjects as (select p._id, p.name, p.paused, p.priority
          from
            webknossos.projects_ p
            JOIN webknossos.tasks_ t ON t._project = p._id
            CROSS JOIN experiences ue
          where p._team = $teamId and
          t.neededExperience_domain = ue.domain and
          t.neededExperience_value <= ue.value and
          not p.isblacklistedfromreport
          group by p._id, p.name, p.paused, p.priority)

          ,projectModifiedTimes as (select p._id, MAX(a.modified) as modified
          from
            filteredProjects p
            JOIN webknossos.tasks_ t ON t._project = p._id
            LEFT JOIN webknossos.annotations_ a ON t._id = a._task
            group by p._id
          )

          ,s1 as (select
               p._id,
               p.name projectName,
               p.paused paused,
               p.priority priority,
               count(t._id) totalTasks,
               sum(t.totalInstances) totalInstances,
               sum(t.pendingInstances) pendingInstances,
               sum(t.tracingTime) tracingTime
          from
            filteredProjects p
            join webknossos.tasks_ t on p._id = t._project
          group by p._id, p.name, p.paused, p.priority)

          ,s2 as (select p._id,
             count(a) activeInstances
           FROM
             filteredProjects p
             join webknossos.tasks_ t on p._id = t._project
             left join (select ${annotationDAO.columns} from webknossos.annotations_ a where a.state = 'Active' and a.typ = 'Task') a on t._id = a._task
           group by p._id
           )


          select s1.projectName, s1.paused, s1.priority, s1.totalTasks, s1.totalInstances, s1.pendingInstances, (s1.totalInstances - s1.pendingInstances - s2.activeInstances) finishedInstances, s2.activeInstances, s1.tracingTime
          from s1
            join s2 on s1._id = s2._id
            join projectModifiedTimes pmt on s1._id = pmt._id
          where (not (s1.paused and s1.totalInstances = s1.pendingInstances)) and ((s1.pendingInstances > 0 and not s1.paused) or s2.activeInstances > 0 or pmt.modified > NOW() - INTERVAL '30 days')
        """.as[(String, Boolean, Long, Int, Int, Int, Int, Int, Long)])
    } yield {
      r.toList.map(row => ProjectProgressEntry(row._1, row._2, row._3, row._4, row._5, row._6, row._7, row._8, row._9))
    }

  def getAvailableTaskCountsByProjectsFor(userId: ObjectId): Fox[Map[String, Int]] =
    for {
      r <- run(q"""
        select p._id, p.name, t.neededExperience_domain, t.neededExperience_value, count(t._id)
        from
        webknossos.tasks_ t
        join
        (select domain, value
          from webknossos.user_experiences
        where _user = $userId)
        as ue on t.neededExperience_domain = ue.domain and t.neededExperience_value <= ue.value
        join webknossos.projects_ p on t._project = p._id
        left join (select _task from webknossos.annotations_ where _user = $userId and typ = ${AnnotationType.Task}) as userAnnotations ON t._id = userAnnotations._task
        where t.pendingInstances > 0
        and userAnnotations._task is null
        and not p.paused
        group by p._id, p.name, t.neededExperience_domain, t.neededExperience_value
      """.as[(String, String, String, Int, Int)])
    } yield {
      val formattedList = r.toList.map(row => (row._2 + "/" + row._3 + ": " + row._4, row._5))
      formattedList.toMap.filter(_ match { case (_: String, availableTasksCount: Int) => availableTasksCount > 0 })
    }

}

class ReportController @Inject()(reportDAO: ReportDAO,
                                 teamDAO: TeamDAO,
                                 userDAO: UserDAO,
                                 userService: UserService,
                                 sil: Silhouette[WkEnv])(implicit ec: ExecutionContext)
    extends Controller
    with FoxImplicits {

  def projectProgressReport(teamId: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      teamIdValidated <- ObjectId.fromString(teamId)
      _ <- teamDAO.findOne(teamIdValidated) ?~> "team.notFound" ~> NOT_FOUND
      entries <- reportDAO.projectProgress(teamIdValidated)
    } yield Ok(Json.toJson(entries))
  }

  def availableTasksReport(teamId: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      teamIdValidated <- ObjectId.fromString(teamId)
      team <- teamDAO.findOne(teamIdValidated) ?~> "team.notFound" ~> NOT_FOUND
      users <- userDAO.findAllByTeams(List(team._id))
      nonUnlistedUsers = users.filter(!_.isUnlisted)
      nonAdminUsers <- Fox.filterNot(nonUnlistedUsers)(u => userService.isTeamManagerOrAdminOf(u, teamIdValidated))
      entries: List[AvailableTaskCountsEntry] <- getAvailableTaskCountsAndProjects(nonAdminUsers)
    } yield Ok(Json.toJson(entries))
  }

  private def getAvailableTaskCountsAndProjects(users: Seq[User]): Fox[List[AvailableTaskCountsEntry]] = {
    val foxes = users.map { user =>
      for {
        pendingTaskCountsByProjects <- reportDAO.getAvailableTaskCountsByProjectsFor(user._id)
      } yield {
        AvailableTaskCountsEntry(user._id.toString,
                                 user.name,
                                 pendingTaskCountsByProjects.values.sum,
                                 pendingTaskCountsByProjects)
      }
    }
    Fox.combined(foxes.toList)
  }

}
