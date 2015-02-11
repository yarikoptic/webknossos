### define
underscore : _
backbone.paginator : Paginator
###

# A helper class to wrap the Backbone.Paginator lib and set some sensible
# defaults
#
# Make sure to always call fetch() with the option 'silent: true' and use
# strings instead of objects for the 'data' option.

class PaginationCollection extends Backbone.Paginator.clientPager

  ##  pagination attributes  ##

  paginator_core :
    url : ->
      return this.url #use url from each individual collection
    type : "GET"
    dataType : "json"
    cache : true

  paginator_ui :
    firstPage : 1
    currentPage : 1
    perPage : 10
    pagesInRange : 4


  server_api = {}


  ##  pagination methods  ##

  parse : (response) ->

    this.totalPages = Math.ceil(response.length / @perPage)
    return response;


  lastPage : ->

    lastPage = @info().totalPages
    @goTo(lastPage)


  firstPage : ->

    @goTo(1)


  ##  collection attributes  ##

  # sortAttribute: 'tralaa'
  # sortDirection: 1


  ##  collection methods  ##

  sortBy: (attribute) ->
    # @sortAttribute = attribute
    @setSort(@sortAttribute, @sortDirection)
  #
  #
  # comparator: (a, b) ->
  #
  #   a = a.get(@sortAttribute)
  #   b = b.get(@sortAttribute)
  #
  #   if a == b then return 0
  #
  #   if @sortDirection == 1
  #     return if a > b then 1 else -1
  #   else
  #     return if a < b then 1 else -1
