import _ from "lodash";
import type { Action } from "oxalis/model/actions/actions";
import { ContourModeEnum, Vector2, Vector3, Vector4 } from "oxalis/constants";
import type { Saga } from "oxalis/model/sagas/effect-generators";
import { call, put } from "typed-redux-saga";
import { select } from "oxalis/model/sagas/effect-generators";
import { V2, V3 } from "libs/mjs";
import {
  enforceActiveVolumeTracing,
  getActiveSegmentationTracingLayer,
} from "oxalis/model/accessors/volumetracing_accessor";
import { finishAnnotationStrokeAction } from "oxalis/model/actions/volumetracing_actions";
import { takeEveryUnlessBusy } from "oxalis/model/sagas/saga_helpers";
import BoundingBox from "oxalis/model/bucket_data_handling/bounding_box";
import api from "oxalis/api/internal_api";
import ndarray, { NdArray } from "ndarray";
import { createVolumeLayer, labelWithVoxelBuffer2D } from "./volume/helpers";
// const ort = require("onnxruntime-web");

const EXPECTED_INPUT_SHAPE: Vector4 = [1, 4, 58, 58];
const OUTPUT_SHAPE: Vector4 = [1, 1, 26, 26];
const OUTPUT_SIZE = OUTPUT_SHAPE.reduce((agg, val) => agg * val, 1);

function takeLatest2(vec4: Vector4): Vector2 {
  return [vec4[2], vec4[3]];
}

function* performMagicWand(action: Action): Saga<void> {
  // @ts-ignore
  if (action.type !== "MAGIC_WAND_FOR_RECT") {
    throw new Error("Satisfy typescript.");
  }

  // const session = yield ort.InferenceSession.create("/public/ml-models/FFN.onnx");
  // console.log(session);
  // const results = yield* session.run(input);

  const { startPosition, endPosition } = action;
  const boundingBoxObj = {
    min: V3.floor(V3.min(startPosition, endPosition)),
    max: V3.floor(V3.add(V3.max(startPosition, endPosition), [0, 0, 1])),
  };

  const unpaddedBoundingBoxMag1 = new BoundingBox(boundingBoxObj);
  const boundingBoxMag1 = unpaddedBoundingBoxMag1.paddedWithMargins([16, 16, 0]);

  const volumeTracingLayer = yield* select((store) => getActiveSegmentationTracingLayer(store));
  const volumeTracing = yield* select(enforceActiveVolumeTracing);

  if (!volumeTracingLayer) {
    console.log("No volumeTracing available.");
    return;
  }
  const resolutionIndex = 0;

  const targetMag: Vector3 = [1, 1, 1];
  const boundingBoxTarget = boundingBoxMag1.fromMag1ToMag(targetMag);

  console.log(`Loading data... (for ${boundingBoxTarget.getVolume()} vx)`);
  const inputData = yield* call(
    [api.data, api.data.getDataForBoundingBox],
    "color",
    boundingBoxMag1,
    resolutionIndex,
  );
  const size = boundingBoxMag1.getSize();
  const stride = [1, size[0], size[0] * size[1]];
  const inputNd = ndarray(inputData, size, stride);

  const output = ndarray(new Uint8Array(inputNd.size), inputNd.shape);

  const labeledResolution = [1, 1, 1];
  const labeledZoomStep = 0;
  const activeViewport = "PLANE_XY";
  const firstDim = 0;
  const secondDim = 1;
  const thirdDim = 2;
  const interpolationLayer = yield* call(
    createVolumeLayer,
    volumeTracing,
    activeViewport,
    labeledResolution,
    boundingBoxMag1.min[thirdDim],
  );
  const voxelBuffer2D = interpolationLayer.createVoxelBuffer2D(
    V2.floor(interpolationLayer.globalCoordToMag2DFloat(boundingBoxMag1.min)),
    size[firstDim],
    size[secondDim],
  );

  const USE_SIMPLE_HEURISTIC = false;
  if (USE_SIMPLE_HEURISTIC) {
    for (let u = 0; u < inputNd.shape[0]; u++) {
      for (let v = 0; v < inputNd.shape[1]; v++) {
        if (inputNd.get(u, v, 0) > 128) {
          output.set(u, v, 0, 1);
          voxelBuffer2D.setValue(u, v, 1);
        }
      }
    }
  } else {
    const { min, max } = boundingBoxMag1;
    const center = V3.floor(V3.scale(V3.add(min, max), 0.5));
    const margin2D = V2.scale(takeLatest2(EXPECTED_INPUT_SHAPE), 0.5);

    // todo: off-by-one error ?
    const marginLeft: Vector3 = [margin2D[0], margin2D[1], 0];
    const marginRight: Vector3 = [margin2D[0], margin2D[1], 1];
    const inputCutoutBBox = new BoundingBox({ min: center, max: center }).paddedWithMargins(
      marginLeft,
      marginRight,
    );
  }

  const overwriteMode = yield* select((state) => state.userConfiguration.overwriteMode);

  yield* call(
    labelWithVoxelBuffer2D,
    voxelBuffer2D,
    ContourModeEnum.DRAW,
    overwriteMode,
    labeledZoomStep,
    activeViewport,
  );
  yield* put(finishAnnotationStrokeAction(volumeTracing.tracingId));
}

function mockedPredict(input: NdArray) {
  // - stride is 8
  // - input shape (1, 4, 58, 58)
  //     - graustufe, predicted_mask, gt_mask, distance_gt_mask
  // - output shape (1, 1, 26, 26)
  // - predicted_mask ist initialisiert mit nullen außer am mittelpunkt (1)
  if (!_.isEqual(input.shape, EXPECTED_INPUT_SHAPE)) {
    throw new Error(`Did not expect input shape: ${input.shape}`);
  }

  const output = ndarray(new Uint8Array(OUTPUT_SIZE), OUTPUT_SHAPE);

  for (let u = 0; u < OUTPUT_SHAPE[0] / 2; u++) {
    for (let v = 0; v < OUTPUT_SHAPE[1]; v++) {
      output.set(0, 0, u, v, 1);
    }
  }

  return output;
}

export default function* listenToMinCut(): Saga<void> {
  yield* takeEveryUnlessBusy("MAGIC_WAND_FOR_RECT", performMagicWand, "Min-cut is being computed.");
}
