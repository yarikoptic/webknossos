package com.scalableminds.webknossos.datastore.dataformats.precomputed

import com.scalableminds.util.geometry.{BoundingBox, Vec3Int}
import com.scalableminds.webknossos.datastore.dataformats.MagLocator
import com.scalableminds.webknossos.datastore.models.datasource.LayerViewConfiguration.LayerViewConfiguration
import com.scalableminds.webknossos.datastore.models.datasource.{
  Category,
  CoordinateTransformation,
  DataFormat,
  DataLayer,
  ElementClass,
  SegmentationLayer
}
import com.scalableminds.webknossos.datastore.storage.DataVaultService
import play.api.libs.json.{Json, OFormat}

trait PrecomputedLayer extends DataLayer {

  val dataFormat: DataFormat.Value = DataFormat.neuroglancerPrecomputed

  def bucketProvider(dataVaultServiceOpt: Option[DataVaultService]) =
    new PrecomputedBucketProvider(this, dataVaultServiceOpt)

  def resolutions: List[Vec3Int] = mags.map(_.mag)

  def mags: List[MagLocator]

  def lengthOfUnderlyingCubes(resolution: Vec3Int): Int = Int.MaxValue // Prevents the wkw-shard-specific handle caching

  def numChannels: Option[Int] = Some(if (elementClass == ElementClass.uint24) 3 else 1)
}

case class PrecomputedDataLayer(
    name: String,
    boundingBox: BoundingBox,
    category: Category.Value,
    elementClass: ElementClass.Value,
    mags: List[MagLocator],
    defaultViewConfiguration: Option[LayerViewConfiguration] = None,
    adminViewConfiguration: Option[LayerViewConfiguration] = None,
    coordinateTransformations: Option[List[CoordinateTransformation]] = None,
    override val numChannels: Option[Int] = Some(1)
) extends PrecomputedLayer

object PrecomputedDataLayer {
  implicit val jsonFormat: OFormat[PrecomputedDataLayer] = Json.format[PrecomputedDataLayer]
}

case class PrecomputedSegmentationLayer(
    name: String,
    boundingBox: BoundingBox,
    elementClass: ElementClass.Value,
    mags: List[MagLocator],
    largestSegmentId: Option[Long],
    mappings: Option[Set[String]] = None,
    defaultViewConfiguration: Option[LayerViewConfiguration] = None,
    adminViewConfiguration: Option[LayerViewConfiguration] = None,
    coordinateTransformations: Option[List[CoordinateTransformation]] = None,
    override val numChannels: Option[Int] = Some(1)
) extends SegmentationLayer
    with PrecomputedLayer

object PrecomputedSegmentationLayer {
  implicit val jsonFormat: OFormat[PrecomputedSegmentationLayer] = Json.format[PrecomputedSegmentationLayer]
}