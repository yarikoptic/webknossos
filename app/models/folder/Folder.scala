package models.folder

import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.schema.Tables.{Folders, _}
import models.organization.{Organization, OrganizationDAO}
import models.team.{Team, TeamDAO, TeamService}
import models.user.User
import play.api.libs.json.{JsObject, Json, OFormat}
import slick.jdbc.PostgresProfile.api._
import slick.jdbc.TransactionIsolation.Serializable
import slick.lifted.Rep
import slick.sql.SqlAction
import utils.{ObjectId, SQLClient, SQLDAO}

import javax.inject.Inject
import scala.concurrent.ExecutionContext

case class Folder(_id: ObjectId, name: String)

case class FolderWithParent(_id: ObjectId, name: String, _parent: Option[ObjectId])

case class FolderParameters(name: String)
object FolderParameters {
  implicit val jsonFormat: OFormat[FolderParameters] = Json.format[FolderParameters]
}

class FolderService @Inject()(teamDAO: TeamDAO, teamService: TeamService, organizationDAO: OrganizationDAO)(
    implicit ec: ExecutionContext) {

  def publicWrites(
      folder: Folder,
      requestingUser: Option[User] = None,
      requestingUserOrganization: Option[Organization] = None)(implicit ctx: DBAccessContext): Fox[JsObject] =
    for {
      teams <- allowedTeamsFor(folder._id, requestingUser)
      teamsJs <- Fox.serialCombined(teams)(t => teamService.publicWrites(t, requestingUserOrganization)) ?~> "dataset.list.teamWritesFailed"
    } yield Json.obj("id" -> folder._id, "name" -> folder.name, "teams" -> teamsJs)

  def publicWritesWithParent(folderWithParent: FolderWithParent): JsObject =
    Json.obj("id" -> folderWithParent._id, "name" -> folderWithParent.name, "parent" -> folderWithParent._parent)

  def allowedTeamsFor(folderId: ObjectId, requestingUser: Option[User])(
      implicit ctx: DBAccessContext): Fox[List[Team]] =
    for {
      teams <- teamDAO.findAllForFolder(folderId) ?~> "allowedTeams.notFound"
      // dont leak team names of other organizations
      teamsFiltered = teams.filter(team => requestingUser.map(_._organization).contains(team._organization))
    } yield teamsFiltered
}

class FolderDAO @Inject()(sqlClient: SQLClient)(implicit ec: ExecutionContext)
    extends SQLDAO[Folder, FoldersRow, Folders](sqlClient) {

  val collection = Folders
  def idColumn(x: Folders): Rep[String] = x._Id
  def isDeletedColumn(x: Folders): Rep[Boolean] = x.isdeleted

  def parse(r: FoldersRow): Fox[Folder] =
    Fox.successful(Folder(ObjectId(r._Id), r.name))

  def parseWithParent(t: (String, String, Option[String])): Fox[FolderWithParent] =
    Fox.successful(FolderWithParent(ObjectId(t._1), t._2, t._3.map(ObjectId(_))))

  def insertAsRoot(f: Folder): Fox[Unit] = {
    val insertPathQuery =
      sqlu"INSERT INTO webknossos.folder_paths(_ancestor, _descendant, depth) VALUES(${f._id}, ${f._id}, 0)"
    for {
      _ <- run(DBIO.sequence(List(insertFolderQuery(f), insertPathQuery)).transactionally)
    } yield ()
  }

  def findOne(folderId: ObjectId): Fox[Folder] =
    for {
      rows <- run(sql"SELECT #$columns FROM webknossos.folders WHERE _id = $folderId".as[FoldersRow])
      parsed <- parseFirst(rows, "id")
    } yield parsed

  def updateName(folderId: ObjectId, name: String): Fox[Unit] =
    for {
      _ <- run(sqlu"UPDATE webknossos.folders SET name = $name WHERE _id = $folderId")
    } yield ()

  def findTreeOf(folderId: ObjectId): Fox[List[FolderWithParent]] =
    for {
      rows <- run(sql"""SELECT f._id, f.name, fp._ancestor
              FROM webknossos.folders_ f
              JOIN webknossos.folder_paths fp
              ON f._id = fp._descendant
              WHERE fp.depth = 1 AND f._id IN
              (SELECT _descendant
              FROM webknossos.folder_paths
              WHERE _ancestor = $folderId)
              UNION ALL SELECT _id, name, null from webknossos.folders_
              WHERE _id = $folderId
              """.as[(String, String, Option[String])])
      parsed <- Fox.combined(rows.toList.map(parseWithParent))
    } yield parsed

  def insertAsChild(parentId: ObjectId, f: Folder): Fox[Unit] = {
    val insertPathQuery =
      sqlu"""INSERT INTO webknossos.folder_paths(_ancestor, _descendant, depth)
             SELECT _ancestor, ${f._id}, depth + 1 from webknossos.folder_paths WHERE _descendant = $parentId -- links to ancestors
             UNION ALL SELECT ${f._id}, ${f._id}, 0 -- self link
          """
    for {
      _ <- run(DBIO.sequence(List(insertFolderQuery(f), insertPathQuery)))
    } yield ()
  }

  private def insertFolderQuery(f: Folder): SqlAction[Int, NoStream, Effect] =
    sqlu"insert into webknossos.folders(_id, name) values (${f._id}, ${f.name})"

  def updateOne(f: Folder): Fox[Unit] =
    for {
      _ <- run(sqlu"update webknossos.folders set name = ${f.name} where _id = ${f._id}")
    } yield ()

  def allowedTeamIdsFor(folderId: ObjectId): Fox[List[ObjectId]] =
    for {
      rows <- run(sql"selct _team from folder_allowedTeams where _folder = $folderId".as[ObjectId])
    } yield rows.toList

  def updateAllowedTeamsFor(folderId: ObjectId, allowedTeams: List[ObjectId]): Fox[Unit] = {
    val clearQuery = sqlu"delete from webknossos.folder_allowedTeams where _folder = $folderId"

    val insertQueries = allowedTeams.map(teamId => sqlu"""insert into webknossos.folder_allowedTeams(_folder, _team)
                                                              values($folderId, $teamId)""")

    val composedQuery = DBIO.sequence(List(clearQuery) ++ insertQueries)
    for {
      _ <- run(composedQuery.transactionally.withTransactionIsolation(Serializable),
               retryCount = 50,
               retryIfErrorContains = List(transactionSerializationError))
    } yield ()
  }

}
