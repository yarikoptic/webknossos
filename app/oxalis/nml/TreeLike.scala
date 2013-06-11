package oxalis.nml

import braingames.image.Color
import braingames.xml.{SynchronousXMLWrites, XMLWrites, Xml}
import play.api.libs.json.Writes
import play.api.libs.json.Json

trait TreeLike {
  def treeId: Int
  def color: Color
  def nodes: Set[Node]
  def edges: Set[Edge]
  def timestamp: Long

  def name: String
  def changeTreeId(id: Int): TreeLike
  def changeName(name: String): TreeLike
  
  def applyNodeMapping(f: Int => Int): TreeLike
}

object TreeLike{
    implicit object TreeLikeXMLWrites extends SynchronousXMLWrites[TreeLike] {
    import Node.NodeXMLWrites
    import Edge.EdgeXMLWrites

    def synchronousWrites(t: TreeLike) =
      <thing id={ t.treeId.toString } color.r={ t.color.r.toString } color.g={ t.color.g.toString } color.b={ t.color.b.toString } color.a={ t.color.a.toString } name={t.name}>
        <nodes>
          { t.nodes.map(n => Xml.toXML(n)) }
        </nodes>
        <edges>
          { t.edges.map(e => Xml.toXML(e)) }
        </edges>
      </thing>
  }

  implicit object DBTreeFormat extends Writes[TreeLike] {
    import Node.NodeFormat
    import Edge.EdgeFormat

    val ID = "id"
    val NODES = "nodes"
    val EDGES = "edges"
    val COLOR = "color"
    val NAME = "name"
    val TIMESTAMP = "timestamp"

    def writes(t: TreeLike) = Json.obj(
      ID -> t.treeId,
      NODES -> t.nodes,
      EDGES -> t.edges,
      NAME -> t.name,
      COLOR -> t.color,
      TIMESTAMP -> t.timestamp)
  }
}