### define
app : app
backbone : Backbone
jquery : $
underscore : _
backbone : backbone
libs/request : Request
three.color : ColorConverter
three : THREE
./tracepoint : TracePoint
./tracetree : TraceTree
./skeletontracing_statelogger : SkeletonTracingStateLogger
../../constants : constants
./tracingparser : TracingParser
oxalis/model/right-menu/comments_collection : CommentsCollection
###

class SkeletonTracing

  GOLDEN_RATIO : 0.618033988749895
  TYPE_USUAL   : constants.TYPE_USUAL
  TYPE_BRANCH  : constants.TYPE_BRANCH
  # Max and min radius in base voxels (see scaleInfo.baseVoxel)
  MIN_RADIUS        : 1
  MAX_RADIUS        : 5000

  branchStack : []
  trees : []
  comments : new CommentsCollection()
  activeNode : null
  activeTree : null
  firstEdgeDirection : null
  currentHue : null

  constructor : (tracing, @flycam, @flycam3d, @user, updatePipeline) ->

    _.extend(this, Backbone.Events)

    @doubleBranchPop = false

    @data = tracing.content.contentData

    # initialize deferreds
    @finishedDeferred = new $.Deferred().resolve()


    ############ Load Tree from @data ##############

    @stateLogger = new SkeletonTracingStateLogger(
      @flycam, tracing.version, tracing.id, tracing.typ,
      tracing.restrictions.allowUpdate, updatePipeline, this)

    tracingParser = new TracingParser(@, @data)
    {
      @idCount
      @treeIdCount
      @trees
      @comments
      @activeNode
      @activeTree
    } = tracingParser.parse()

    # ensure a tree is active
    unless @activeTree
      if @trees.length > 0
        @activeTree = @trees[0]
      else
        @createNewTree()

    tracingType = tracing.typ
    if (tracingType == "Task") and @getNodeListOfAllTrees().length == 0
      @addNode(tracing.content.editPosition, @TYPE_USUAL, 0, 0)

    @branchPointsAllowed = tracing.content.settings.branchPointsAllowed
    if not @branchPointsAllowed
      # dirty but this actually is what needs to be done
      @TYPE_BRANCH = @TYPE_USUAL

      #calculate direction of first edge in nm
      if @data.trees[0]?.edges?
        for edge in @data.trees[0].edges
          sourceNode = @findNodeInList(@trees[0].nodes, edge.source).pos
          targetNode = @findNodeInList(@trees[0].nodes, edge.target).pos
          if sourceNode[0] != targetNode[0] or sourceNode[1] != targetNode[1] or sourceNode[2] != targetNode[2]
            @firstEdgeDirection = [targetNode[0] - sourceNode[0],
                                   targetNode[1] - sourceNode[1],
                                   targetNode[2] - sourceNode[2]]
            break

      if @firstEdgeDirection
        @flycam.setSpaceDirection(@firstEdgeDirection)
        @flycam3d.setDirection(@firstEdgeDirection)


    $(window).on(
      "beforeunload"
      =>
        if !@stateLogger.stateSaved() and @stateLogger.allowUpdate
          @stateLogger.pushImpl(false)
          return "You haven't saved your progress, please give us 2 seconds to do so and and then leave this site."
        else
          return
    )


  benchmark : (numberOfTrees = 1, numberOfNodesPerTree = 10000) ->

    console.log "[benchmark] start inserting #{numberOfNodesPerTree} nodes"
    startTime = (new Date()).getTime()
    offset = 0
    size = numberOfNodesPerTree / 10
    for i in [0...numberOfTrees]
      @createNewTree()
      for i in [0...numberOfNodesPerTree]
        pos = [Math.random() * size + offset, Math.random() * size + offset, Math.random() * size + offset]
        point = new TracePoint(@TYPE_USUAL, @idCount++, pos, Math.random() * 200, @activeTree.treeId, null)
        @activeTree.nodes.push(point)
        if @activeNode
          @activeNode.appendNext(point)
          point.appendNext(@activeNode)
          @activeNode = point
        else
          @activeNode = point
          point.type = @TYPE_BRANCH
          if @branchPointsAllowed
            centered = true
            @pushBranch()
        @doubleBranchPop = false
      offset += size
    @trigger("reloadTrees")
    console.log "[benchmark] done. Took me #{((new Date()).getTime() - startTime) / 1000} seconds."


  pushBranch : ->

    if @branchPointsAllowed
      if @activeNode
        @branchStack.push(@activeNode)
        @activeNode.type = @TYPE_BRANCH
        @stateLogger.push()

        @trigger("setBranch", true, @activeNode)
    else
      @trigger("noBranchPoints")


  popBranch : ->

    deferred = new $.Deferred()
    if @branchPointsAllowed
      if @branchStack.length and @doubleBranchPop
        @trigger("doubleBranch", =>
          point = @branchStack.pop()
          @stateLogger.push()
          @setActiveNode(point.id)
          @activeNode.type = @TYPE_USUAL

          @trigger("setBranch", false, @activeNode)
          @doubleBranchPop = true
          deferred.resolve(@activeNode.id))
      else
        point = @branchStack.pop()
        @stateLogger.push()
        if point
          @setActiveNode(point.id)
          @activeNode.type = @TYPE_USUAL

          @trigger("setBranch", false, @activeNode)
          @doubleBranchPop = true
          deferred.resolve(@activeNode.id)
        else
          @trigger("emptyBranchStack")
          deferred.reject()
      deferred
    else
      @trigger("noBranchPoints")
      deferred.reject()


  deleteBranch : (node) ->

    if node.type != @TYPE_BRANCH then return

    i = 0
    while i < @branchStack.length
      if @branchStack[i].id == node.id
        @branchStack.splice(i, 1)
      else
        i++


  isBranchPoint : (id) ->

    return id in (node.id for node in @branchStack)


  addNode : (position, type, viewport, resolution, centered = true) ->

    if @ensureDirection(position)

      radius = 10 * app.scaleInfo.baseVoxel
      if @activeNode then radius = @activeNode.radius

      metaInfo =
        timestamp : (new Date()).getTime()
        viewport : viewport
        resolution : resolution
        bitDepth : if @user.get("fourBit") then 4 else 8
        interpolation : @user.get("interpolation")

      point = new TracePoint(type, @idCount++, position, radius, @activeTree.treeId, metaInfo)
      @activeTree.nodes.push(point)

      if @activeNode

        @activeNode.appendNext(point)
        point.appendNext(@activeNode)
        @activeNode = point

      else

        @activeNode = point
        point.type = @TYPE_BRANCH
        if @branchPointsAllowed
          centered = true
          @pushBranch()

      @doubleBranchPop = false

      @stateLogger.createNode(point, @activeTree.treeId)

      @trigger("newNode", centered)
      @trigger("newActiveNode", @activeNode.id)
    else
      @trigger("wrongDirection")


  ensureDirection : (position) ->

    if (!@branchPointsAllowed and @activeTree.nodes.length == 2 and
        @firstEdgeDirection and @activeTree.treeId == @trees[0].treeId)
      sourceNodeNm = app.scaleInfo.voxelToNm(@activeTree.nodes[1].pos)
      targetNodeNm = app.scaleInfo.voxelToNm(position)
      secondEdgeDirection = [targetNodeNm[0] - sourceNodeNm[0],
                             targetNodeNm[1] - sourceNodeNm[1],
                             targetNodeNm[2] - sourceNodeNm[2]]

      return (@firstEdgeDirection[0] * secondEdgeDirection[0] +
              @firstEdgeDirection[1] * secondEdgeDirection[1] +
              @firstEdgeDirection[2] * secondEdgeDirection[2] > 0)
    else
      true


  getActiveNode : -> @activeNode


  getActiveNodeId : ->

    if @activeNode then @activeNode.id else null


  getActiveNodePos : ->

    if @activeNode then @activeNode.pos else null


  getActiveNodeType : ->

    if @activeNode then @activeNode.type else null


  getActiveNodeRadius : ->

    if @activeNode then @activeNode.radius else 10 * app.scaleInfo.baseVoxel


  getActiveTreeId : ->

    if @activeTree then @activeTree.treeId else null


  getActiveTreeName : ->

    if @activeTree then @activeTree.name else null


  setTreeName : (name) ->

    if @activeTree
      if name
        @activeTree.name = name
      else
        @activeTree.name = "Tree#{('00'+@activeTree.treeId).slice(-3)}"
      @stateLogger.updateTree(@activeTree)

      @trigger("newTreeName")


  getNode : (id) ->

    for tree in @trees
      for node in tree.nodes
        if node.id == id then return node
    return null


  setActiveNode : (nodeID, mergeTree = false) ->

    lastActiveNode = @activeNode
    lastActiveTree = @activeTree
    for tree in @trees
      for node in tree.nodes
        if node.id == nodeID
          @activeNode = node
          @activeTree = tree
          break
    @stateLogger.push()

    if mergeTree
      @mergeTree(lastActiveNode, lastActiveTree)


  setActiveNodeRadius : (radius) ->

    if @activeNode?
      @activeNode.radius = Math.min( @MAX_RADIUS,
                            Math.max( @MIN_RADIUS, radius ) )
      @stateLogger.updateNode( @activeNode, @activeNode.treeId )
      @trigger("newActiveNodeRadius", radius)


  selectNextTree : (forward) ->

    trees = @getTreesSorted(@user.get("sortTreesByName"))
    for i in [0...trees.length]
      if @activeTree.treeId == trees[i].treeId
        break

    diff = (if forward then 1 else -1) + trees.length
    @setActiveTree(trees[ (i + diff) % trees.length ].treeId)


  centerActiveNode : ->

    position = @getActiveNodePos()
    if position
      @flycam.setPosition(position)


  setActiveTree : (id) ->

    for tree in @trees
      if tree.treeId == id
        @activeTree = tree
        break
    if @activeTree.nodes.length == 0
      @activeNode = null
    else
      @activeNode = @activeTree.nodes[0]
      @trigger("newActiveNode", @activeNode.id)
    @stateLogger.push()

    @trigger("newActiveTree")


  getNewTreeColor : ->

    # this generates the most distinct colors possible, using the golden ratio
    @currentHue = @treeIdCount * @GOLDEN_RATIO % 1 unless @currentHue
    color = ColorConverter.setHSV(new THREE.Color(), @currentHue, 1, 1).getHex()
    @currentHue += @GOLDEN_RATIO
    @currentHue %= 1
    color


  shuffleTreeColor : (tree) ->

    tree = @activeTree unless tree
    tree.color = @getNewTreeColor()

    @stateLogger.updateTree(tree)

    @trigger("newTreeColor", tree.treeId)


  shuffleAllTreeColors : ->

    for tree in @trees
      @shuffleTreeColor(tree)


  createNewTree : ->

    tree = new TraceTree(
      @treeIdCount++,
      @getNewTreeColor(),
      "Tree#{('00'+(@treeIdCount-1)).slice(-3)}",
      (new Date()).getTime())
    @trees.push(tree)
    @activeTree = tree
    @activeNode = null

    @stateLogger.createTree(tree)

    @trigger("newTree", tree.treeId, tree.color)


  deleteActiveNode : ->

    unless @activeNode
      return
    # don't delete nodes when the previous tree split isn't finished
    unless @finishedDeferred.state() == "resolved"
      return

    @trigger("deleteComment", @activeNode.id)
    for neighbor in @activeNode.neighbors
      neighbor.removeNeighbor(@activeNode.id)
    @activeTree.removeNode(@activeNode.id)

    deletedNode = @activeNode
    @stateLogger.deleteNode(deletedNode, @activeTree.treeId)

    @deleteBranch(deletedNode)

    if deletedNode.neighbors.length > 1
      # Need to split tree
      newTrees = []
      oldActiveTreeId = @activeTree.treeId

      for i in [0...@activeNode.neighbors.length]
        unless i == 0
          # create new tree for all neighbors, except the first
          @createNewTree()

        @activeTree.nodes = []
        @getNodeListForRoot(@activeTree.nodes, deletedNode.neighbors[i])
        # update tree ids
        unless i == 0
          for node in @activeTree.nodes
            node.treeId = @activeTree.treeId
        @setActiveNode(deletedNode.neighbors[i].id)
        newTrees.push(@activeTree)

        if @activeTree.treeId != oldActiveTreeId
          nodeIds = []
          for node in @activeTree.nodes
            nodeIds.push(node.id)
          @stateLogger.moveTreeComponent(oldActiveTreeId, @activeTree.treeId, nodeIds)

      # this deferred will be resolved once the skeleton has finished reloading the trees
      @finishedDeferred = new $.Deferred()
      @trigger("reloadTrees", newTrees, @finishedDeferred)

    else if @activeNode.neighbors.length == 1
      # no children, so just remove it.
      @setActiveNode(deletedNode.neighbors[0].id)
      @trigger("deleteActiveNode", deletedNode, @activeTree.treeId)
    else
      @deleteTree(false)


  deleteTree : (notify, id, deleteBranchesAndComments, notifyServer) ->

    if notify
      if confirm("Do you really want to delete the whole tree?")
        @reallyDeleteTree(id, deleteBranchesAndComments, notifyServer)
      else
        return
    else
      @reallyDeleteTree(id, deleteBranchesAndComments, notifyServer)


  reallyDeleteTree : (id, deleteBranchesAndComments = true, notifyServer = true) ->

    unless id
      id = @activeTree.treeId
    tree = @getTree(id)

    for i in [0..@trees.length]
      if @trees[i].treeId == tree.treeId
        index = i
        break
    @trees.splice(index, 1)
    # remove branchpoints and comments, NOT when merging trees
    for node in tree.nodes
      if deleteBranchesAndComments
        @trigger("deleteComment", node.id)
        @deleteBranch(node)

    if notifyServer
      @stateLogger.deleteTree(tree)
    @trigger("deleteTree", index)

    # Because we always want an active tree, check if we need
    # to create one.
    if @trees.length == 0
      @createNewTree()
    else
      # just set the last tree to be the active one
      @setActiveTree(@trees[@trees.length - 1].treeId)


  mergeTree : (lastNode, lastTree) ->

    unless lastNode
      return

    activeNodeID = @activeNode.id
    if lastNode.id != activeNodeID
      if lastTree.treeId != @activeTree.treeId
        @activeTree.nodes = @activeTree.nodes.concat(lastTree.nodes)
        @activeNode.appendNext(lastNode)
        lastNode.appendNext(@activeNode)

        # update tree ids
        for node in @activeTree.nodes
          node.treeId = @activeTree.treeId

        @stateLogger.mergeTree(lastTree, @activeTree, lastNode.id, activeNodeID)

        @trigger("mergeTree", lastTree.treeId, lastNode, @activeNode)

        @deleteTree(false, lastTree.treeId, false, false)

        @setActiveNode(activeNodeID)
      else
        @trigger("mergeDifferentTrees")


  getTree : (id) ->

    unless id
      return @activeTree
    for tree in @trees
      if tree.treeId == id
        return tree
    return null


  getTrees : -> @trees


  getTreesSorted : ->

    if @user.get("sortTreesByName")
      return (@trees.slice(0)).sort(@compareNames)
    else
      return (@trees.slice(0)).sort(@compareTimestamps)


  getNodeListForRoot : (result, root, previous) ->
    # returns a list of nodes that are connected to the parent
    #
    # ASSUMPTION:    we are dealing with a tree, circles would
    #                break this algorithm

    result.push(root)
    next = root.getNext(previous)
    while next?
      if _.isArray(next)
        for neighbor in next
          @getNodeListForRoot(result, neighbor, root)
        return
      else
        result.push(next)
        newNext = next.getNext(root)
        root = next
        next = newNext


  getNodeListOfAllTrees : ->

    result = []
    for tree in @trees
      result = result.concat(tree.nodes)
    return result


  rendered : -> @trigger("finishedRender")


  findNodeInList : (list, id) ->
    # Helper method used in initialization

    for node in list
      if node.id == id
        return node
    return null


  compareNames : (a, b) ->

    if a.name < b.name
      return -1
    if a.name > b.name
      return 1
    return 0


  compareTimestamps : (a,b) ->

    if a.timestamp < b.timestamp
      return -1
    if a.timestamp > b.timestamp
      return 1
    return 0


  compareNodes : (a, b) ->

    if a.node.treeId < b.node.treeId
      return -1
    if a.node.treeId > b.node.treeId
      return 1
    return a.node.id - b.node.id

  getPlainComments : =>

    return @comments.toJSON()
