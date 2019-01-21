// @flow

import Store from "oxalis/store";
import constants, {
  ArbitraryViewport,
  OUTER_CSS_BORDER,
  type Rect,
  type Viewport,
  ensureSmallerEdge,
} from "oxalis/constants";

export function getTDViewportSize(): [number, number] {
  const camera = Store.getState().viewModeData.plane.tdCamera;
  return [camera.right - camera.left, camera.top - camera.bottom];
}

export function getInputCatcherRect(viewport: Viewport): Rect {
  if (viewport === ArbitraryViewport) {
    return Store.getState().viewModeData.arbitrary.inputCatcherRect;
  } else {
    // $FlowFixMe Flow does not understand that viewport cannot be ArbitraryViewport at this point
    return Store.getState().viewModeData.plane.inputCatcherRects[viewport];
  }
}

export function getInputCatcherAspectRatio(viewport: Viewport): number {
  const { width, height } = getInputCatcherRect(viewport);
  return width / height;
}

// Given a width and an aspectRatio, this function returns a [width, height] pair
// which corresponds to the defined aspect ratio. Depending on the configured strategy
// (ensureSmallerEdge), this function either uses the smaller or the larger edge as the
// ground truth.
export function applyAspectRatioToWidth(aspectRatio: number, width: number): [number, number] {
  const useWidth = ensureSmallerEdge ? aspectRatio >= 1 : aspectRatio < 1;
  const scaledWidth = width * (useWidth ? 1 : aspectRatio);
  const scaledHeight = width / (!useWidth ? 1 : aspectRatio);

  return [scaledWidth, scaledHeight];
}

// Returns the ratio between VIEWPORT_WIDTH and the actual extent of the viewport for width and height
export function getViewportScale(viewport: Viewport): [number, number] {
  const { width, height } = getInputCatcherRect(viewport);
  // For the orthogonal views the CSS border width was subtracted before, so we'll need to
  // add it back again to get an accurate scale
  const borderWidth = viewport === ArbitraryViewport ? 0 : OUTER_CSS_BORDER;
  const xScale = (width + 2 * borderWidth) / constants.VIEWPORT_WIDTH;
  const yScale = (height + 2 * borderWidth) / constants.VIEWPORT_WIDTH;
  return [xScale, yScale];
}

export function getDominantViewportScale(viewport: Viewport): number {
  const viewportScales = getViewportScale(viewport);

  // This might need changing when ensureSmallerEdge is not set to true anymore
  return Math.max(viewportScales[0], viewportScales[1]);
}

export default {};
