Backbone = require("backbone")
_        = require("lodash")
$        = require("jquery")
app      = require("app")
Request  = require("libs/request")
Toast    = require("libs/toast")

class StateLogger

  PUSH_THROTTLE_TIME : 30000 #30s
  SAVE_RETRY_WAITING_TIME : 5000

  constructor : (@flycam, @version, @tracingId, @tracingType, @allowUpdate, @pipeline) ->

    _.extend(this, Backbone.Events)

    @committedDiffs = []
    @newDiffs = []
    @committedCurrentState = true

    # Push state to server whenever a user moves
    @listenTo(@flycam, "positionChanged", @push)


  pushDiff : (action, value, push = true) ->

    @newDiffs.push({
      action : action
      value : value
    })
    # In order to assure that certain actions are atomic,
    # it is sometimes necessary not to push.
    if push
      @push()


  concatUpdateTracing : ->

    throw new Error("concatUpdateTracing has to be overwritten by subclass!")


  #### SERVER COMMUNICATION

  stateSaved : ->

    return @committedCurrentState and @committedDiffs.length == 0


  push : ->

    if @allowUpdate
      @committedCurrentState = false
      @pushThrottled()


  pushThrottled : ->
    # Pushes the buffered tracing to the server. Pushing happens at most
    # every 30 seconds.

    saveFkt = => @pushImpl(true)
    @pushThrottled = _.throttle(_.mutexDeferred( saveFkt, -1), @PUSH_THROTTLE_TIME)
    @pushThrottled()


  pushNow : ->   # Interface for view & controller

    return @pushImpl(false)
      .then(
        -> Toast.success("Saved!")
        -> Toast.error("Couldn't save. Please try again.")
      )

  # alias for `pushNow`
  # needed for save delegation by `Model`
  # see `model.coffee`
  save : ->

      return @pushNow()


  pushImpl : (notifyOnFailure) ->

    if not @allowUpdate
      return new $.Deferred().resolve().promise()

    @concatUpdateTracing()
    @committedDiffs = @committedDiffs.concat(@newDiffs)
    @newDiffs = []
    @committedCurrentState = true
    console.log "Sending data: ", @committedDiffs
    $.assert(@committedDiffs.length > 0, "Empty update sent to server!", {
      @committedDiffs, @newDiffs
    })

    @pipeline.executeAction( (prevVersion) =>
      Request.send(
        url : "/annotations/#{@tracingType}/#{@tracingId}?version=#{(prevVersion + 1)}"
        method : "PUT"
        data : @committedDiffs
        contentType : "application/json"
      ).pipe (response) ->
        return response.version
    ).fail((responseObject) => @pushFailCallback(responseObject, notifyOnFailure))
    .done(=> @pushDoneCallback())


  pushFailCallback : (responseObject, notifyOnFailure) ->

    $('body').addClass('save-error')

    if responseObject.responseText? && responseObject.responseText != ""
      # restore whatever is send as the response
      try
        response = JSON.parse(responseObject.responseText)
      catch error
        console.error "parsing failed.", response
      if response?.messages?[0]?.error?
        if response.messages[0].error == "annotation.dirtyState"
          $(window).off("beforeunload")
          alert("""
            It seems that you edited the tracing simultaneously in different windows.
            Editing should be done in a single window only.

            In order to restore the current window, a reload is necessary.
          """)
          window.location.reload()

    @push()
    if notifyOnFailure
      @trigger("pushFailed")

    restart = =>
      @pipeline.restart()
          .fail((responseObject) => @pushFailCallback(responseObject, notifyOnFailure))
          .done(=> @pushDoneCallback())

    setTimeout(restart, @SAVE_RETRY_WAITING_TIME)


  pushDoneCallback : ->

    @trigger("pushDone")
    $('body').removeClass('save-error')
    @committedDiffs = []

module.exports = StateLogger
