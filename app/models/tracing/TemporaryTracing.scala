package models.tracing

import oxalis.nml.TreeLike
import oxalis.nml.BranchPoint
import braingames.geometry.Scale
import braingames.geometry.Point3D
import oxalis.nml.Comment
import oxalis.nml.NML
import models.user.User

case class TemporaryTracing(
    id: String,
    dataSetName: String,
    trees: List[TreeLike],
    branchPoints: List[BranchPoint],
    timestamp: Long,
    activeNodeId: Int,
    scale: Scale,
    editPosition: Point3D,
    comments: List[Comment] = Nil,
    tracingSettings: TracingSettings = TracingSettings.default.copy(isEditable = false),
    tracingType: TracingType.Value = TracingType.CompoundProject,
    accessFkt: User => Boolean =( _ => false),
    state: TracingState = TracingState.Finished,
    version: Int = 0) extends TracingLike {

  type Self = TemporaryTracing

  def task = None
  
  def makeReadOnly = 
    this.copy(tracingSettings = tracingSettings.copy(isEditable = false))
    
   def allowAllModes = 
    this.copy(tracingSettings = tracingSettings.copy(allowedModes = TracingSettings.ALL_MODES))  
  
  def insertTree[TemporaryTracing](tree: TreeLike) = {
    this.copy(trees = tree :: trees).asInstanceOf[TemporaryTracing]
  }

  def insertBranchPoint[TemporaryTracing](bp: BranchPoint) =
    this.copy(branchPoints = bp :: this.branchPoints).asInstanceOf[TemporaryTracing]

  def insertComment[TemporaryTracing](c: Comment) =
    this.copy(comments = c :: this.comments).asInstanceOf[TemporaryTracing]
  
  def accessPermission(user: User) = accessFkt(user)
}

object TemporaryTracing {
  def createFrom(nml: NML, id: String) = {
    TemporaryTracing(
      id,
      nml.dataSetName,
      nml.trees,
      nml.branchPoints,
      System.currentTimeMillis(),
      nml.activeNodeId,
      nml.scale,
      nml.editPosition,
      nml.comments)
  }
  
  def createFrom(tracing: TracingLike, id: String) = {
    TemporaryTracing(
      id,
      tracing.dataSetName,
      tracing.trees,
      tracing.branchPoints,
      System.currentTimeMillis(),
      tracing.activeNodeId,
      tracing.scale,
      tracing.editPosition,
      tracing.comments)
  }
}