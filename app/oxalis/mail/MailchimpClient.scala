package oxalis.mail

import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.security.SCrypt
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.typesafe.scalalogging.LazyLogging
import javax.inject.Inject
import models.user.{MultiUser, MultiUserDAO, User}
import oxalis.mail.MailchimpTag.MailchimpTag
import play.api.libs.json.Json
import play.api.libs.ws.WSResponse
import utils.WkConf

class MailchimpClient @Inject()(wkConf: WkConf, rpc: RPC, multiUserDAO: MultiUserDAO) extends LazyLogging {

  private lazy val conf = wkConf.Mail.Mailchimp

  def registerUser(user: User, multiUser: MultiUser, tag: MailchimpTag): Unit = {
    if (conf.host.isEmpty) return
    val emailMd5 = SCrypt.md5(multiUser.email)
    logger.info(s"Registering user ${user._id} for Mailchimp, tag=${MailchimpTag.format(tag)}")
    for {
      _ <- registerUser(user.firstName, user.lastName, multiUser.email, emailMd5)
      _ <- tagUser(emailMd5, tag)
    } yield ()
    ()
  }

  private def registerUser(firstName: String, lastName: String, email: String, emailMd5: String): Fox[WSResponse] = {
    val uri = s"${conf.host}/lists/${conf.listId}/members/$emailMd5"
    val userBody = Json.obj(
      "email_address" -> email,
      "status" -> "subscribed",
      "merge_fields" -> Json.obj(
        "FNAME" -> firstName,
        "LNAME" -> lastName,
      )
    )
    rpc(uri).silent.withBasicAuth(conf.user, conf.password).put(userBody)
  }

  def tagUser(user: User, tag: MailchimpTag): Unit = {
    if (conf.host.isEmpty) return
    for {
      multiUser <- multiUserDAO.findOne(user._multiUser)(GlobalAccessContext)
      emailMd5 = SCrypt.md5(multiUser.email)
      _ <- tagUser(emailMd5, tag)
    } yield ()
    ()
  }

  private def tagUser(emailMd5: String, tag: MailchimpTag): Fox[WSResponse] = {
    val uri = s"${conf.host}/lists/${conf.listId}/members/$emailMd5/tags"
    val tagBody = Json.obj(
      "tags" -> List(Json.obj("name" -> MailchimpTag.format(tag), "status" -> "active"))
    )
    rpc(uri).silent.withBasicAuth(conf.user, conf.password).post(tagBody)
  }

}
