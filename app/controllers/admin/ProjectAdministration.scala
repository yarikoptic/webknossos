package controllers.admin;

import braingames.mvc.Controller
import oxalis.security.Secured
import models.security.Role
import scala.concurrent.duration._
import views._
import models.task.Project
import play.api.data.Form._
import play.api.data.Form
import play.api.data.Forms._
import models.user.User
import play.api.i18n.Messages
import models.tracing.TracingInfo
import models.tracing.TracingType
import play.api.templates.Html
import models.tracing.UsedTracings
import brainflight.tracing.TracingIdentifier
import brainflight.tracing.RequestTemporaryTracing
import controllers.Application


object ProjectAdministration extends Controller with Secured{

  override val DefaultAccessRole = Role.Admin

  val projectForm = Form(tuple(
    "projectName" -> nonEmptyText(1, 100)
      .verifying("project.nameAlreadyInUse", name => Project.findOneByName(name).isEmpty),
    "owner" -> nonEmptyText(1, 100)
      .verifying("user.notFound", userId => User.findOneById(userId).isDefined)))

  def list = Authenticated { implicit request =>
    Ok(html.admin.project.projectList(
      Project.findAll,
      projectForm.fill("", request.user.id),
      User.findAll.sortBy(_.name)))
  }

  def delete(projectName: String) = Authenticated { implicit request =>
    for {
      project <- Project.findOneByName(projectName) ?~ Messages("project.notFound")
    } yield {
      Project.remove(project)
      JsonOk(Messages("project.removed"))
    }
  }
  
  def trace(projectName: String) = Authenticated { implicit request =>
    for {
      project <- Project.findOneByName(projectName) ?~ Messages("project.notFound")
    } yield {
      val tracingType = TracingType.CompoundProject
      val id = TracingIdentifier(tracingType.toString, projectName)
      val tracingInfo = 
        TracingInfo(
            id.identifier,
            "<unknown>",
            tracingType,
            isEditable = false)
      
      Application.temporaryTracingGenerator ! RequestTemporaryTracing(id)
      
      Ok(html.oxalis.trace(tracingInfo)(Html.empty))
    }
  }

  def create = Authenticated(parser = parse.urlFormEncoded) { implicit request =>
    projectForm.bindFromRequest.fold(
      formWithErrors => BadRequest(html.admin.project.projectList(Project.findAll, formWithErrors, User.findAll)),
      {
        case (name, ownerId) =>
          for {
            owner <- User.findOneById(ownerId) ?~ Messages("user.notFound")
          } yield {
            Project.insertOne(Project(name, owner._id))
            Redirect(routes.ProjectAdministration.list).flashing(
              FlashSuccess(Messages("project.createSuccess")))
          }
      })
  }
}
