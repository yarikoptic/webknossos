// @flow
import * as THREE from "three";
import GL from "gl";
import Constants from "oxalis/constants";

let renderer = null;
function getRenderer() {
  if (renderer != null) {
    return renderer;
  }
  renderer = false
    ? new THREE.WebGLRenderer({
        canvas: document.getElementById("render-canvas"),
        antialias: true,
      })
    : new THREE.WebGLRenderer({
        antialias: false,
        canvas: {
          addEventListener: () => {},
          style: {},
        },
        context: GL(Constants.VIEWPORT_WIDTH, Constants.VIEWPORT_WIDTH, {
          preserveDrawingBuffer: true,
        }),
      });

  return renderer;
}

export { getRenderer };

export default {};
