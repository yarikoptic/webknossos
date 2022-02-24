// @flow
import { type Point2, type Vector3, MappingStatusEnum } from "oxalis/constants";
import Model from "oxalis/model";
import { calculateGlobalPos } from "oxalis/model/accessors/view_mode_accessor";
import { getMappingInfo } from "oxalis/model/accessors/dataset_accessor";
import { loadAgglomerateSkeletonAction } from "oxalis/model/actions/skeletontracing_actions";
import Store, { type OxalisState } from "oxalis/store";
import Toast from "libs/toast";
import messages from "messages";
import { clickSegmentAction } from "oxalis/model/actions/volumetracing_actions";
import api from "oxalis/api/internal_api";
import { getSegmentIdForPosition } from "oxalis/controller/combinations/volume_handlers";

export function hasAgglomerateMapping(state: OxalisState) {
  const segmentation = Model.getVisibleSegmentationLayer();
  if (!segmentation) {
    return {
      value: false,
      reason: "A segmentation layer needs to be visible to load an agglomerate skeleton.",
    };
  }
  const { mappingName, mappingType, mappingStatus } = getMappingInfo(
    state.temporaryConfiguration.activeMappingByLayer,
    segmentation.name,
  );
  if (mappingName == null || mappingStatus !== MappingStatusEnum.ENABLED) {
    return {
      value: false,
      reason: messages["tracing.agglomerate_skeleton.no_mapping"],
    };
  }

  if (mappingType !== "HDF5") {
    return {
      value: false,
      reason: messages["tracing.agglomerate_skeleton.no_agglomerate_file"],
    };
  }
  return {
    value: true,
    reason: "",
  };
}

export async function handleAgglomerateSkeletonAtClick(clickPosition: Point2) {
  const state = Store.getState();
  const globalPosition = calculateGlobalPos(state, clickPosition);
  loadAgglomerateSkeletonAtPosition(globalPosition);
}

export async function loadAgglomerateSkeletonAtPosition(position: Vector3): Promise<void> {
  const segmentation = Model.getVisibleSegmentationLayer();
  if (!segmentation) {
    return;
  }
  const renderedZoomStep = api.data.getRenderedZoomStepAtPosition(segmentation.name, position);
  const segmentId = segmentation.cube.getMappedDataValue(position, renderedZoomStep);

  loadAgglomerateSkeletonForSegmentId(segmentId);
}

export function loadAgglomerateSkeletonForSegmentId(segmentId: number): void {
  const state = Store.getState();
  const segmentation = Model.getVisibleSegmentationLayer();
  if (!segmentation) {
    return;
  }
  const { mappingName } = getMappingInfo(
    state.temporaryConfiguration.activeMappingByLayer,
    segmentation.name,
  );

  const isAgglomerateMappingEnabled = hasAgglomerateMapping(state);

  if (mappingName && isAgglomerateMappingEnabled.value) {
    Store.dispatch(loadAgglomerateSkeletonAction(segmentation.name, mappingName, segmentId));
  } else {
    Toast.error(isAgglomerateMappingEnabled.reason);
  }
}

export function handleClickSegment(clickPosition: Point2) {
  const state = Store.getState();
  const globalPosition = calculateGlobalPos(state, clickPosition);
  const cellId = getSegmentIdForPosition(globalPosition);
  if (cellId > 0) {
    Store.dispatch(clickSegmentAction(cellId, globalPosition));
  }
}
