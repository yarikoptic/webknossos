import { Root } from "protobufjs/light";
import type { ServerTracing } from "types/api_flow_types";
// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module 'SkeletonTracing.proto' or its ... Remove this comment to see the full error message
import SkeletonTracingProto from "SkeletonTracing.proto";
// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module 'VolumeTracing.proto' or its co... Remove this comment to see the full error message
import VolumeTracingProto from "VolumeTracing.proto";
// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module 'ListOfLong.proto' or its co... Remove this comment to see the full error message
import ListOfLongProto from "ListOfLong.proto";

const PROTO_FILES = {
  skeleton: SkeletonTracingProto,
  volume: VolumeTracingProto,
};
const PROTO_PACKAGE = "com.scalableminds.webknossos.datastore";
const PROTO_TYPES = {
  skeleton: `${PROTO_PACKAGE}.SkeletonTracing`,
  volume: `${PROTO_PACKAGE}.VolumeTracing`,
};

export function parseProtoTracing(
  tracingArrayBuffer: ArrayBuffer,
  annotationType: "skeleton" | "volume",
): ServerTracing {
  const protoRoot = Root.fromJSON(PROTO_FILES[annotationType]);
  const messageType = protoRoot.lookupType(PROTO_TYPES[annotationType]);
  const message = messageType.decode(new Uint8Array(tracingArrayBuffer));
  return messageType.toObject(message, {
    arrays: true,
    objects: true,
    enums: String,
    longs: Number,
  }) as ServerTracing;
}

export function serializeProtoListOfLong(numbers: Array<number | bigint>): ArrayBuffer {
  const listOfLong = { items: numbers };
  const protoRoot = Root.fromJSON(ListOfLongProto);
  const messageType = protoRoot.lookupType(`${PROTO_PACKAGE}.ListOfLong`);
  const errMsg = messageType.verify(listOfLong);
  if (errMsg) throw Error(errMsg);
  const message = messageType.create(listOfLong);
  return messageType.encode(message).finish();
}

export function parseProtoListOfLong(listArrayBuffer: ArrayBuffer): Array<number | bigint> {
  const protoRoot = Root.fromJSON(ListOfLongProto);
  const messageType = protoRoot.lookupType(`${PROTO_PACKAGE}.ListOfLong`);
  const message = messageType.decode(new Uint8Array(listArrayBuffer));
  return messageType.toObject(message, {
    arrays: true,
    objects: true,
    enums: String,
    longs: Number,
  }).items;
}
export default {};
