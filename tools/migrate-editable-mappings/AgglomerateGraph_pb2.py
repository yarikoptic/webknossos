# -*- coding: utf-8 -*-
# Generated by the protocol buffer compiler.  DO NOT EDIT!
# source: AgglomerateGraph.proto
"""Generated protocol buffer code."""
from google.protobuf.internal import builder as _builder
from google.protobuf import descriptor as _descriptor
from google.protobuf import descriptor_pool as _descriptor_pool
from google.protobuf import symbol_database as _symbol_database
# @@protoc_insertion_point(imports)

_sym_db = _symbol_database.Default()


import geometry_pb2 as geometry__pb2


DESCRIPTOR = _descriptor_pool.Default().AddSerializedFile(b'\n\x16\x41gglomerateGraph.proto\x12&com.scalableminds.webknossos.datastore\x1a\x0egeometry.proto\"1\n\x0f\x41gglomerateEdge\x12\x0e\n\x06source\x18\x01 \x02(\x03\x12\x0e\n\x06target\x18\x02 \x02(\x03\"\xc9\x01\n\x10\x41gglomerateGraph\x12\x10\n\x08segments\x18\x01 \x03(\x03\x12\x46\n\x05\x65\x64ges\x18\x02 \x03(\x0b\x32\x37.com.scalableminds.webknossos.datastore.AgglomerateEdge\x12G\n\tpositions\x18\x03 \x03(\x0b\x32\x34.com.scalableminds.webknossos.datastore.Vec3IntProto\x12\x12\n\naffinities\x18\x04 \x03(\x02')

_builder.BuildMessageAndEnumDescriptors(DESCRIPTOR, globals())
_builder.BuildTopDescriptorsAndMessages(DESCRIPTOR, 'AgglomerateGraph_pb2', globals())
if _descriptor._USE_C_DESCRIPTORS == False:

  DESCRIPTOR._options = None
  _AGGLOMERATEEDGE._serialized_start=82
  _AGGLOMERATEEDGE._serialized_end=131
  _AGGLOMERATEGRAPH._serialized_start=134
  _AGGLOMERATEGRAPH._serialized_end=335
# @@protoc_insertion_point(module_scope)
