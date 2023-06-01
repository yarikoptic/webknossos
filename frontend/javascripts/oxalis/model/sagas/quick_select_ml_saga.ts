import _ from "lodash";
import * as ort from "onnxruntime-web";
import { OrthoView, Vector2, Vector3 } from "oxalis/constants";
import type { Saga } from "oxalis/model/sagas/effect-generators";
import { call } from "typed-redux-saga";
import { select } from "oxalis/model/sagas/effect-generators";
import { V3 } from "libs/mjs";
import {
  ComputeQuickSelectForRectAction,
  MaybePrefetchEmbeddingAction,
} from "oxalis/model/actions/volumetracing_actions";
import BoundingBox from "oxalis/model/bucket_data_handling/bounding_box";
import ndarray from "ndarray";
import Toast from "libs/toast";
import { OxalisState } from "oxalis/store";
import { map3 } from "libs/utils";
import { APIDataset } from "types/api_flow_types";
import { getSamEmbedding, sendAnalyticsEvent } from "admin/admin_rest_api";
import Dimensions from "../dimensions";
import { InferenceSession } from "onnxruntime-web";
import { finalizeQuickSelect, prepareQuickSelect } from "./quick_select_heuristic_saga";

// /predictions/sam_vit_l_small

(window as any).USE_SMALL_MODEL = true;
(window as any).USE_LOW_RES_AS_REFINEMENT = true;

const getEmbeddingSize = () =>
  ((window as any).USE_SMALL_MODEL ? [512, 512, 0] : [1024, 1024, 0]) as Vector3;
type CacheEntry = {
  embeddingPromise: Promise<Float32Array>;
  embeddingBoxMag1: BoundingBox;
  mag: Vector3;
  layerName: string;
  useSmallModel: boolean;
};
const MAXIMUM_CACHE_SIZE = 5;
// Sorted from most recently to least recently used.
let embeddingCache: Array<CacheEntry> = [];

function removeEmbeddingPromiseFromCache(embeddingPromise: Promise<Float32Array>) {
  embeddingCache = embeddingCache.filter((entry) => entry.embeddingPromise !== embeddingPromise);
}

function getEmbedding(
  dataset: APIDataset,
  layerName: string,
  userBoxMag1: BoundingBox,
  mag: Vector3,
  activeViewport: OrthoView,
  useSmallModel: boolean,
  intensityRange?: Vector2 | null,
): CacheEntry {
  if (userBoxMag1.getVolume() === 0) {
    throw new Error("User bounding box should not have empty volume.");
  }
  const matchingCacheEntry = embeddingCache.find(
    (entry) =>
      entry.embeddingBoxMag1.containsBoundingBox(userBoxMag1) &&
      V3.equals(entry.mag, mag) &&
      entry.layerName === layerName &&
      entry.useSmallModel === useSmallModel,
  );
  if (matchingCacheEntry) {
    // Move entry to the front.
    embeddingCache = [
      matchingCacheEntry,
      ...embeddingCache.filter((el) => el !== matchingCacheEntry),
    ];
    console.debug("Use", matchingCacheEntry, "from cache.");
    return matchingCacheEntry;
  } else {
    const embeddingCenter = V3.round(userBoxMag1.getCenter());
    const sizeInMag1 = V3.scale3(Dimensions.transDim(getEmbeddingSize(), activeViewport), mag);
    const embeddingTopLeft = V3.alignWithMag(
      V3.sub(embeddingCenter, V3.scale(sizeInMag1, 0.5)),
      mag,
    );
    // Effectively, zero the first and second dimension in the mag.
    const depthSummand = V3.scale3(mag, Dimensions.transDim([0, 0, 1], activeViewport));
    const embeddingBottomRight = V3.add(embeddingTopLeft, sizeInMag1);
    const embeddingBoxMag1 = new BoundingBox({
      min: embeddingTopLeft,
      max: V3.add(embeddingBottomRight, depthSummand),
    });

    if (!embeddingBoxMag1.containsBoundingBox(userBoxMag1)) {
      // This is unlikely as the embedding size of 1024**2 is quite large.
      // The UX can certainly be optimized in case users run into this problem
      // more often.
      throw new Error("Selected bounding box is too large for AI selection.");
    }

    const embeddingPromise = getSamEmbedding(
      dataset,
      layerName,
      mag,
      embeddingBoxMag1,
      intensityRange,
      (window as any).USE_SMALL_MODEL,
    );

    const newEntry = { embeddingPromise, embeddingBoxMag1, mag, layerName, useSmallModel };
    embeddingCache = [newEntry, ...embeddingCache.slice(0, MAXIMUM_CACHE_SIZE - 1)];

    return newEntry;
  }
}

let sessionBig: Promise<InferenceSession> | null;
let sessionSmall: Promise<InferenceSession> | null;

export async function getInferenceSession(useSmallModel: boolean) {
  if (useSmallModel) {
    if (sessionSmall == null) {
      sessionSmall = ort.InferenceSession.create(
        "/assets/models/vit_l_0b3195_small_decoder_quantized.onnx",
      );
    }
    return sessionSmall;
  } else {
    if (sessionBig == null) {
      sessionBig = ort.InferenceSession.create(
        "/assets/models/vit_l_0b3195_decoder_quantized.onnx",
      );
    }
    return sessionBig;
  }
}

async function inferFromEmbedding(
  embedding: Float32Array,
  embeddingBoxInTargetMag: BoundingBox,
  userBoxInTargetMag: BoundingBox,
  activeViewport: OrthoView,
) {
  const [firstDim, secondDim, _thirdDim] = Dimensions.getIndices(activeViewport);
  const topLeft = V3.sub(userBoxInTargetMag.min, embeddingBoxInTargetMag.min);
  const bottomRight = V3.sub(userBoxInTargetMag.max, embeddingBoxInTargetMag.min);

  let ortSession;
  try {
    ortSession = await getInferenceSession((window as any).USE_SMALL_MODEL);
  } catch (exception) {
    console.error(exception);
    return null;
  }

  // Somewhere between the front-end, the back-end and the embedding
  // server, there seems to be a different linearization of the 2D image
  // data which is why the code here deals with the YZ plane as a special
  // case.
  const onnxCoord =
    activeViewport === "PLANE_YZ"
      ? new Float32Array([
          topLeft[secondDim],
          topLeft[firstDim],
          bottomRight[secondDim],
          bottomRight[firstDim],
        ])
      : new Float32Array([
          topLeft[firstDim],
          topLeft[secondDim],
          bottomRight[firstDim],
          bottomRight[secondDim],
        ]);
  // Inspired by https://github.com/facebookresearch/segment-anything/blob/main/notebooks/onnx_model_example.ipynb
  const onnxLabel = new Float32Array([2, 3]);
  const smallDivisor = (window as any).USE_SMALL_MODEL ? 2 : 1;
  const onnxMaskInput = new Float32Array(((256 / smallDivisor) * 256) / smallDivisor);
  const onnxHasMaskInput = new Float32Array([0]);
  const EMBEDDING_SIZE = getEmbeddingSize();
  const origImSize = new Float32Array([EMBEDDING_SIZE[0], EMBEDDING_SIZE[1]]);

  const getOrtInputs = (maskInput: ort.Tensor) => ({
    image_embeddings: new ort.Tensor("float32", embedding, [
      1,
      256,
      64 / smallDivisor,
      64 / smallDivisor,
    ]),
    point_coords: new ort.Tensor("float32", onnxCoord, [1, 2, 2]),
    point_labels: new ort.Tensor("float32", onnxLabel, [1, 2]),
    mask_input: maskInput,
    has_mask_input: new ort.Tensor("float32", onnxHasMaskInput, [1]),
    orig_im_size: new ort.Tensor("float32", origImSize, [2]),
  });

  const maskInput = new ort.Tensor("float32", onnxMaskInput, [
    1,
    1,
    256 / smallDivisor,
    256 / smallDivisor,
  ]);

  let masks;
  let iouPredictions;

  console.log(`Infer with ${(window as any).USE_SMALL_MODEL ? "small" : "default"} model.`);
  console.time("Infer (first pass)");
  // Get low resolution masks.
  const {
    masks: firstPassMasks,
    iou_predictions: firstPassIouPredictions,
    low_res_masks,
  } = await ortSession.run(getOrtInputs(maskInput));
  console.timeEnd("Infer (first pass)");

  if ((window as any).USE_LOW_RES_AS_REFINEMENT) {
    // Pass these into the decoder again
    // Use intersection-over-union estimates to pick the best mask.
    console.time("Infer (second pass)");
    const { masks: secondPassMasks, iou_predictions: secondPassIouPredictions } =
      await ortSession.run(getOrtInputs(low_res_masks));
    console.timeEnd("Infer (second pass)");

    masks = secondPassMasks;
    iouPredictions = secondPassIouPredictions;
  } else {
    masks = firstPassMasks;
    iouPredictions = firstPassIouPredictions;
  }

  // @ts-ignore
  const bestMaskIndex = iouPredictions.data.indexOf(Math.max(...iouPredictions.data));
  const maskData = new Uint8Array(EMBEDDING_SIZE[0] * EMBEDDING_SIZE[1]);
  // Fill the mask data with a for loop (slicing/mapping would incur additional
  // data copies).
  const startOffset = bestMaskIndex * EMBEDDING_SIZE[0] * EMBEDDING_SIZE[1];
  for (let idx = 0; idx < EMBEDDING_SIZE[0] * EMBEDDING_SIZE[1]; idx++) {
    maskData[idx] = masks.data[idx + startOffset] > 0 ? 1 : 0;
  }

  const size = embeddingBoxInTargetMag.getSize();
  const userSizeInTargetMag = userBoxInTargetMag.getSize();
  // Somewhere between the front-end, the back-end and the embedding
  // server, there seems to be a different linearization of the 2D image
  // data which is why the code here deals with the XZ plane as a special
  // case.
  const stride =
    activeViewport === "PLANE_XZ"
      ? [size[1], size[0], size[0] * size[1] * size[2]]
      : [size[2], size[0], size[0] * size[1] * size[2]];

  let mask = ndarray(maskData, size, stride);
  mask = mask
    // a.lo(x,y) => a[x:, y:]
    .lo(topLeft[firstDim], topLeft[secondDim], 0)
    // a.hi(x,y) => a[:x, :y]
    .hi(userSizeInTargetMag[firstDim], userSizeInTargetMag[secondDim], 1);
  return mask;
}

export function* prefetchEmbedding(action: MaybePrefetchEmbeddingAction) {
  const preparation = yield* call(prepareQuickSelect, action);
  if (preparation == null) {
    return;
  }
  const { labeledResolution, activeViewport, colorLayer } = preparation;
  const { startPosition } = action;
  const PREFETCH_WINDOW_SIZE = [100, 100, 0] as Vector3;
  const endPosition = V3.add(
    startPosition,
    Dimensions.transDim(PREFETCH_WINDOW_SIZE, activeViewport),
  );

  // Effectively, zero the first and second dimension in the mag.
  const depthSummand = V3.scale3(labeledResolution, Dimensions.transDim([0, 0, 1], activeViewport));
  const alignedUserBoxMag1 = new BoundingBox({
    min: V3.floor(startPosition),
    max: V3.floor(V3.add(endPosition, depthSummand)),
  }).alignWithMag(labeledResolution, "floor");

  const dataset = yield* select((state: OxalisState) => state.dataset);
  const layerConfiguration = yield* select(
    (state) => state.datasetConfiguration.layers[colorLayer.name],
  );
  const { intensityRange } = layerConfiguration;

  try {
    // Won't block, because the return value is not a promise (but contains
    // a promise instead)
    const { embeddingPromise } = yield* call(
      getEmbedding,
      dataset,
      colorLayer.name,
      alignedUserBoxMag1,
      labeledResolution,
      activeViewport,
      (window as any).USE_SMALL_MODEL,
      colorLayer.elementClass === "uint8" ? null : intensityRange,
    );
    // Also prefetch session (will block). After the first time, it's basically
    // a noop.
    yield* call(getInferenceSession, (window as any).USE_SMALL_MODEL);

    // Await the promise here so that the saga finishes once the embedding was loaded
    // (this simplifies debugging and time measurement).
    yield embeddingPromise;
  } catch (exception) {
    console.error(exception);
    // Don't notify user because we are only prefetching.
  }
}

export default function* performQuickSelect(action: ComputeQuickSelectForRectAction): Saga<void> {
  const preparation = yield* call(prepareQuickSelect, action);
  if (preparation == null) {
    return;
  }
  const {
    labeledZoomStep,
    labeledResolution,
    firstDim,
    secondDim,
    thirdDim,
    activeViewport,
    volumeTracing,
    colorLayer,
  } = preparation;
  const { startPosition, endPosition, quickSelectGeometry } = action;

  // Effectively, zero the first and second dimension in the mag.
  const depthSummand = V3.scale3(labeledResolution, Dimensions.transDim([0, 0, 1], activeViewport));
  const unalignedUserBoxMag1 = new BoundingBox({
    min: V3.floor(V3.min(startPosition, endPosition)),
    max: V3.floor(V3.add(V3.max(startPosition, endPosition), depthSummand)),
  });
  // Ensure that the third dimension is inclusive (otherwise, the center of the passed
  // coordinates wouldn't be exactly on the W plane on which the user started this action).
  const inclusiveMaxW = map3(
    (el, idx) => (idx === thirdDim ? el - 1 : el),
    unalignedUserBoxMag1.max,
  );
  quickSelectGeometry.setCoordinates(unalignedUserBoxMag1.min, inclusiveMaxW);

  const alignedUserBoxMag1 = unalignedUserBoxMag1.alignWithMag(labeledResolution, "floor");
  const dataset = yield* select((state: OxalisState) => state.dataset);
  const layerConfiguration = yield* select(
    (state) => state.datasetConfiguration.layers[colorLayer.name],
  );
  const { intensityRange } = layerConfiguration;

  const { embeddingPromise, embeddingBoxMag1 } = yield* call(
    getEmbedding,
    dataset,
    colorLayer.name,
    alignedUserBoxMag1,
    labeledResolution,
    activeViewport,
    (window as any).USE_SMALL_MODEL,
    colorLayer.elementClass === "uint8" ? null : intensityRange,
  );
  let embedding;
  try {
    embedding = yield embeddingPromise;
  } catch (exception) {
    console.error(exception);
    removeEmbeddingPromiseFromCache(embeddingPromise);
    throw new Error("Could not load embedding. See console for details.");
  }

  const embeddingBoxInTargetMag = embeddingBoxMag1.fromMag1ToMag(labeledResolution);
  const userBoxInTargetMag = alignedUserBoxMag1.fromMag1ToMag(labeledResolution);

  if (embeddingBoxInTargetMag.getVolume() === 0) {
    Toast.warning("The drawn rectangular had a width or height of zero.");
    return;
  }

  let mask = yield* call(
    inferFromEmbedding,
    embedding,
    embeddingBoxInTargetMag,
    userBoxInTargetMag,
    activeViewport,
  );
  if (!mask) {
    Toast.error("Could not infer mask. See console for details.");
    return;
  }

  const overwriteMode = yield* select(
    (state: OxalisState) => state.userConfiguration.overwriteMode,
  );

  sendAnalyticsEvent("used_quick_select_with_ai");
  yield* finalizeQuickSelect(
    quickSelectGeometry,
    volumeTracing,
    activeViewport,
    labeledResolution,
    alignedUserBoxMag1,
    thirdDim,
    userBoxInTargetMag.getSize(),
    firstDim,
    secondDim,
    mask,
    overwriteMode,
    labeledZoomStep,
  );
}
