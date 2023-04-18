package com.scalableminds.webknossos.datastore

import javax.inject.Inject

import play.api.http.HttpFilters
import brave.play.filter.ZipkinTraceFilter
import play.filters.headers.SecurityHeadersFilter

class Filters @Inject()(securityHeadersFilter: SecurityHeadersFilter, zipkinTraceFilter: ZipkinTraceFilter)
    extends HttpFilters {
  def filters = Seq(securityHeadersFilter, zipkinTraceFilter)
}
