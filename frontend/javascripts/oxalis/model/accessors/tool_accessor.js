// @flow
import type { OxalisState } from "oxalis/store";
import { AnnotationToolEnum, type AnnotationTool } from "oxalis/constants";
import { isVolumeAnnotationDisallowedForZoom } from "oxalis/model/accessors/volumetracing_accessor";
import {
  isLayerVisible,
  getRenderableResolutionForSegmentation,
  getSegmentationLayer,
} from "oxalis/model/accessors/dataset_accessor";
import { isMagRestrictionViolated } from "oxalis/model/accessors/flycam_accessor";
import memoizeOne from "memoize-one";

const zoomInToUseToolMessage =
  "Your zoom is too low to use this tool. Please zoom in further to use it.";

const isZoomStepTooHighFor = (state, tool) => isVolumeAnnotationDisallowedForZoom(tool, state);

const getExplanationForDisabledVolume = (
  isSegmentationActivated,
  isInMergerMode,
  isSegmentationVisibleForMag,
  isZoomInvalidForTracing,
) => {
  if (!isSegmentationActivated) {
    return "Volume annotation is disabled since the segmentation layer is invisible. Enable it in the left settings sidebar.";
  }
  if (isZoomInvalidForTracing) {
    return "Volume annotation is disabled since the current zoom value is not in the required range. Please adjust the zoom level.";
  }
  if (isInMergerMode) {
    return "Volume annotation is disabled while the merger mode is active.";
  }
  if (!isSegmentationVisibleForMag) {
    return "Volume annotation is disabled since no segmentation data can be shown at the current magnification. Please adjust the zoom level.";
  }
  return "Volume annotation is currently disabled.";
};

export function isVolumeDrawingTool(activeTool: AnnotationTool): boolean {
  return (
    activeTool === AnnotationToolEnum.TRACE ||
    activeTool === AnnotationToolEnum.BRUSH ||
    activeTool === AnnotationToolEnum.ERASE_TRACE ||
    activeTool === AnnotationToolEnum.ERASE_BRUSH
  );
}

export function isBrushTool(activeTool: AnnotationTool): boolean {
  return activeTool === AnnotationToolEnum.BRUSH || activeTool === AnnotationToolEnum.ERASE_BRUSH;
}

export function isTraceTool(activeTool: AnnotationTool): boolean {
  return activeTool === AnnotationToolEnum.TRACE || activeTool === AnnotationToolEnum.ERASE_TRACE;
}

const disabledSkeletonExplanation =
  "This annotation does not have a skeleton. Please convert it to a hybrid annotation.";

function _getDisabledInfoWhenVolumeIsDisabled(
  genericDisabledExplanation: string,
  hasSkeleton: boolean,
) {
  const disabledInfo = {
    isDisabled: true,
    explanation: genericDisabledExplanation,
  };
  return {
    [AnnotationToolEnum.MOVE]: {
      isDisabled: false,
      explanation: "",
    },
    [AnnotationToolEnum.SKELETON]: {
      isDisabled: !hasSkeleton,
      explanation: disabledSkeletonExplanation,
    },
    [AnnotationToolEnum.BRUSH]: disabledInfo,
    [AnnotationToolEnum.ERASE_BRUSH]: disabledInfo,
    [AnnotationToolEnum.TRACE]: disabledInfo,
    [AnnotationToolEnum.ERASE_TRACE]: disabledInfo,
    [AnnotationToolEnum.FILL_CELL]: disabledInfo,
    [AnnotationToolEnum.PICK_CELL]: disabledInfo,
  };
}
const getDisabledInfoWhenVolumeIsDisabled = memoizeOne(_getDisabledInfoWhenVolumeIsDisabled);

function _getDisabledInfoFromArgs(
  hasSkeleton: boolean,
  isZoomStepTooHighForBrushing: boolean,
  isZoomStepTooHighForTracing: boolean,
  isZoomStepTooHighForFilling: boolean,
  genericDisabledExplanation: string,
) {
  return {
    [AnnotationToolEnum.MOVE]: {
      isDisabled: false,
      explanation: "",
    },
    [AnnotationToolEnum.SKELETON]: {
      isDisabled: !hasSkeleton,
      explanation: disabledSkeletonExplanation,
    },
    [AnnotationToolEnum.BRUSH]: {
      isDisabled: isZoomStepTooHighForBrushing,
      explanation: zoomInToUseToolMessage,
    },
    [AnnotationToolEnum.ERASE_BRUSH]: {
      isDisabled: isZoomStepTooHighForBrushing,
      explanation: zoomInToUseToolMessage,
    },
    [AnnotationToolEnum.ERASE_TRACE]: {
      isDisabled: isZoomStepTooHighForTracing,
      explanation: zoomInToUseToolMessage,
    },
    [AnnotationToolEnum.TRACE]: {
      isDisabled: isZoomStepTooHighForTracing,
      explanation: zoomInToUseToolMessage,
    },
    [AnnotationToolEnum.FILL_CELL]: {
      isDisabled: isZoomStepTooHighForFilling,
      explanation: zoomInToUseToolMessage,
    },
    [AnnotationToolEnum.PICK_CELL]: {
      isDisabled: false,
      explanation: genericDisabledExplanation,
    },
  };
}
const getDisabledInfoFromArgs = memoizeOne(_getDisabledInfoFromArgs);

export function getDisabledInfoForTools(
  state: OxalisState,
): { [key: AnnotationTool]: { isDisabled: boolean, explanation: string } } {
  const isInMergerMode = state.temporaryConfiguration.isMergerModeEnabled;
  const isZoomInvalidForTracing = isMagRestrictionViolated(state);
  const maybeResolutionWithZoomStep = getRenderableResolutionForSegmentation(state);
  const labeledResolution =
    maybeResolutionWithZoomStep != null ? maybeResolutionWithZoomStep.resolution : null;
  const isSegmentationVisibleForMag = labeledResolution != null;

  const hasVolume = state.tracing.volume != null;
  const hasSkeleton = state.tracing.skeleton != null;
  const isSegmentationActivated = (() => {
    const segmentationLayer = getSegmentationLayer(state.dataset);
    if (segmentationLayer == null) {
      return false;
    }
    return isLayerVisible(
      state.dataset,
      segmentationLayer.name,
      state.datasetConfiguration,
      state.temporaryConfiguration.viewMode,
    );
  })();

  const genericDisabledExplanation = getExplanationForDisabledVolume(
    isSegmentationActivated,
    isInMergerMode,
    isSegmentationVisibleForMag,
    isZoomInvalidForTracing,
  );

  if (!hasVolume || !isSegmentationActivated || !isSegmentationVisibleForMag || isInMergerMode) {
    // All segmentation-related tools are disabled.
    return getDisabledInfoWhenVolumeIsDisabled(genericDisabledExplanation, hasSkeleton);
  }

  const isZoomStepTooHighForBrushing = isZoomStepTooHighFor(state, AnnotationToolEnum.BRUSH);
  const isZoomStepTooHighForTracing = isZoomStepTooHighFor(state, AnnotationToolEnum.TRACE);
  const isZoomStepTooHighForFilling = isZoomStepTooHighFor(state, AnnotationToolEnum.FILL_CELL);

  return getDisabledInfoFromArgs(
    hasSkeleton,
    isZoomStepTooHighForBrushing,
    isZoomStepTooHighForTracing,
    isZoomStepTooHighForFilling,
    genericDisabledExplanation,
  );
}
