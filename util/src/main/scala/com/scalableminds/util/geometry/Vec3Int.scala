package com.scalableminds.util.geometry

import play.api.libs.json.Json._
import play.api.libs.json._

case class Vec3Int(x: Int, y: Int, z: Int) {
  def scale(s: Int): Vec3Int =
    Vec3Int(x * s, y * s, z * s)

  def scale(s: Float): Vec3Int =
    Vec3Int((x * s).toInt, (y * s).toInt, (z * s).toInt)

  def <=(other: Vec3Int): Boolean =
    x <= other.x && y <= other.y && z <= other.z

  def isIsotropic: Boolean =
    x == y && y == z

  override def toString: String = "(%d, %d, %d)".format(x, y, z)

  def toList = List(x, y, z)

  def move(dx: Int, dy: Int, dz: Int) =
    Vec3Int(x + dx, y + dy, z + dz)

  def move(other: Vec3Int): Vec3Int =
    move(other.x, other.y, other.z)

  def negate = Vec3Int(-x, -y, -z)

  def to(bottomRight: Vec3Int) =
    range(bottomRight, _ to _)

  def until(bottomRight: Vec3Int) =
    range(bottomRight, _ until _)

  def maxDim: Int = Math.max(Math.max(x, y), z)

  private def range(other: Vec3Int, func: (Int, Int) => Range) =
    for {
      x <- func(x, other.x)
      y <- func(y, other.y)
      z <- func(z, other.z)
    } yield Vec3Int(x, y, z)
}

object Vec3Int {
  val formRx = "\\s*([0-9]+),\\s*([0-9]+),\\s*([0-9]+)\\s*".r
  def toForm(p: Vec3Int) = Some("%d, %d, %d".format(p.x, p.y, p.z))

  def apply(t: (Int, Int, Int)): Vec3Int =
    Vec3Int(t._1, t._2, t._3)

  def fromForm(s: String) =
    s match {
      case formRx(x, y, z) =>
        Vec3Int(Integer.parseInt(x), Integer.parseInt(y), Integer.parseInt(z))
      case _ =>
        null
    }

  def fromArray[T <% Int](array: Array[T]) =
    if (array.size >= 3)
      Some(Vec3Int(array(0), array(1), array(2)))
    else
      None

  def fromList(l: List[Int]) =
    fromArray(l.toArray)

  implicit object Vec3IntReads extends Reads[Vec3Int] {
    def reads(json: JsValue) = json match {
      case JsArray(ts) if ts.size == 3 =>
        val c = ts.map(fromJson[Int](_)).flatMap(_.asOpt)
        if (c.size != 3)
          JsError(Seq(JsPath() -> Seq(JsonValidationError("validate.error.array.invalidContent"))))
        else
          JsSuccess(Vec3Int(c(0), c(1), c(2)))
      case _ =>
        JsError(Seq(JsPath() -> Seq(JsonValidationError("validate.error.expected.vec3IntArray"))))
    }
  }

  implicit object Vec3IntWrites extends Writes[Vec3Int] {
    def writes(v: Vec3Int) = {
      val l = List(v.x, v.y, v.z)
      JsArray(l.map(toJson(_)))
    }
  }
}