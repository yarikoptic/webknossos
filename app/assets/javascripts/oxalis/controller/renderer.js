// @flow
import * as THREE from "three";
import GL from "gl";
import Constants from "oxalis/constants";

let renderer = null;
function getRenderer() {
  if (renderer != null) {
    return renderer;
  }
  renderer =
    typeof document !== "undefined" && document.getElementById
      ? new THREE.WebGLRenderer({
          canvas: document.getElementById("render-canvas"),
          antialias: true,
        })
      : new THREE.WebGLRenderer({
          antialias: false,
          canvas: {
            addEventListener: () => {},
          },
          context: GL(Constants.VIEWPORT_WIDTH, Constants.VIEWPORT_WIDTH, {
            preserveDrawingBuffer: true,
          }),
        });

  return renderer;
}

export { getRenderer };

export default {};
