### define
underscore : _
backbone.marionette : Marionette
./dataset_list_item_view : DatasetListItemView
./team_assignment_modal_view: TeamAssignmentModalView
libs/behaviors/sort_table_behavior : SortTableBehavior
###

class DatasetListView extends Backbone.Marionette.CompositeView

  template : _.template("""
    <table class="table table-double-striped table-details sortable-table">
      <thead>
        <tr>
          <th class="details-toggle-all">
            <i class="caret-right"></i>
            <i class="caret-down"></i>
          </th>
          <th>Name</th>
          <th>Datastore</th>
          <th>Scale</th>
          <th>Owning Team</th>
          <th>Allowed Teams</th>
          <th>Active</th>
          <th>Public</th>
          <th>Data Layers</th>
          <th>Actions</th>
        </tr>
      </thead>
    </table>
    <div id="modal-wrapper"></div>
  """)

  events :
    "click .team-label" : "showModal"
    "click .details-toggle-all" : "toggleAllDetails"


  ui :
    "modalWrapper" : "#modal-wrapper"
    "detailsToggle" : ".details-toggle-all"

  childView : DatasetListItemView
  childViewContainer: "table"

  behaviors :
    SortTableBehavior:
      behaviorClass: SortTableBehavior

  initialize : ->

    @collection.sortBy("created")


    @collection.fetch(
      silent : true
      data : "isEditable=true"
    ).done( =>
      @collection.goTo(1)
    )

    @listenTo(app.vent, "paginationView:filter", @filterBySearch)
    @listenTo(app.vent, "TeamAssignmentModalView:refresh", @render)


  toggleAllDetails : ->

    @ui.detailsToggle.toggleClass("open")
    app.vent.trigger("datasetListView:toggleDetails")


  showModal : (evt) ->

    dataset = @collection.findWhere(
      name : $(evt.target).closest("tbody").data("dataset-name")
    )

    modalView = new TeamAssignmentModalView({dataset : dataset})
    modalView.render()
    @ui.modalWrapper.html(modalView.el)
    modalView.$el.modal("show")
    @modalView = modalView


  filterBySearch : (searchQuery) ->

    @collection.setFilter(["name", "owningTeam"], searchQuery)


  onDestroy : ->

    @modalView?.destroy()
