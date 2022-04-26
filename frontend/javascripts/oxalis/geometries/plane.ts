import * as THREE from "three";
import _ from "lodash";
import { getBaseVoxelFactors } from "oxalis/model/scaleinfo";
import Dimensions from "oxalis/model/dimensions";
import PlaneMaterialFactory from "oxalis/geometries/materials/plane_material_factory";
import Store from "oxalis/store";
import type { OrthoView, Vector3, Vector4 } from "oxalis/constants";
import constants, {
  OrthoViewColors,
  OrthoViewCrosshairColors,
  OrthoViewGrayCrosshairColor,
  OrthoViewValues,
} from "oxalis/constants";

class Plane {
  // This class is supposed to collect all the Geometries that belong to one single plane such as
  // the plane itself, its texture, borders and crosshairs.
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'plane' has no initializer and is not def... Remove this comment to see the full error message
  plane: THREE.Mesh;
  planeID: OrthoView;
  displayCrosshair: boolean;
  baseScaleVector: THREE.Vector3;
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'crosshair' has no initializer and is not... Remove this comment to see the full error message
  crosshair: Array<THREE.LineSegments>;
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'TDViewBorders' has no initializer and is... Remove this comment to see the full error message
  TDViewBorders: THREE.Line;
  lastScaleFactors: [number, number];

  constructor(planeID: OrthoView) {
    this.planeID = planeID;
    this.displayCrosshair = true;
    this.lastScaleFactors = [-1, -1];
    // VIEWPORT_WIDTH means that the plane should be that many voxels wide in the
    // dimension with the highest resolution. In all other dimensions, the plane
    // is smaller in voxels, so that it is squared in nm.
    // --> scaleInfo.baseVoxel
    const baseVoxelFactors = getBaseVoxelFactors(Store.getState().dataset.dataSource.scale);
    const scaleArray = Dimensions.transDim(baseVoxelFactors, this.planeID);
    this.baseScaleVector = new THREE.Vector3(...scaleArray);
    this.createMeshes();
  }

  createMeshes(): void {
    const pWidth = constants.VIEWPORT_WIDTH;
    // create plane
    const planeGeo = new THREE.PlaneGeometry(pWidth, pWidth, 1, 1);
    const textureMaterial = new PlaneMaterialFactory(
      this.planeID,
      true,
      OrthoViewValues.indexOf(this.planeID),
    )
      .setup()
      .getMaterial();
    this.plane = new THREE.Mesh(planeGeo, textureMaterial);
    // create crosshair
    const crosshairGeometries = new Array(2);
    this.crosshair = new Array(2);

    for (let i = 0; i <= 1; i++) {
      crosshairGeometries[i] = new THREE.Geometry();
      crosshairGeometries[i].vertices.push(
        new THREE.Vector3((-pWidth / 2) * i, (-pWidth / 2) * (1 - i), 0),
      );
      crosshairGeometries[i].vertices.push(new THREE.Vector3(-25 * i, -25 * (1 - i), 0));
      crosshairGeometries[i].vertices.push(new THREE.Vector3(25 * i, 25 * (1 - i), 0));
      crosshairGeometries[i].vertices.push(
        new THREE.Vector3((pWidth / 2) * i, (pWidth / 2) * (1 - i), 0),
      );
      this.crosshair[i] = new THREE.LineSegments(
        crosshairGeometries[i],
        this.getLineBasicMaterial(OrthoViewCrosshairColors[this.planeID][i], 1),
      );
      // Objects are rendered according to their renderOrder (lowest to highest).
      // The default renderOrder is 0. In order for the crosshairs to be shown
      // render them AFTER the plane has been rendered.
      this.crosshair[i].renderOrder = 1;
    }

    // create borders
    const TDViewBordersGeo = new THREE.Geometry();
    TDViewBordersGeo.vertices.push(new THREE.Vector3(-pWidth / 2, -pWidth / 2, 0));
    TDViewBordersGeo.vertices.push(new THREE.Vector3(-pWidth / 2, pWidth / 2, 0));
    TDViewBordersGeo.vertices.push(new THREE.Vector3(pWidth / 2, pWidth / 2, 0));
    TDViewBordersGeo.vertices.push(new THREE.Vector3(pWidth / 2, -pWidth / 2, 0));
    TDViewBordersGeo.vertices.push(new THREE.Vector3(-pWidth / 2, -pWidth / 2, 0));
    this.TDViewBorders = new THREE.Line(
      TDViewBordersGeo,
      this.getLineBasicMaterial(OrthoViewColors[this.planeID], 1),
    );
  }

  setDisplayCrosshair = (value: boolean): void => {
    this.displayCrosshair = value;
  };

  getLineBasicMaterial = _.memoize(
    (color: number, linewidth: number) =>
      new THREE.LineBasicMaterial({
        color,
        linewidth,
      }),
    (color: number, linewidth: number) => `${color}_${linewidth}`,
  );

  setOriginalCrosshairColor = (): void => {
    [0, 1].forEach((i) => {
      this.crosshair[i].material = this.getLineBasicMaterial(
        OrthoViewCrosshairColors[this.planeID][i],
        1,
      );
    });
  };

  setGrayCrosshairColor = (): void => {
    [0, 1].forEach((i) => {
      this.crosshair[i].material = this.getLineBasicMaterial(OrthoViewGrayCrosshairColor, 1);
    });
  };

  updateAnchorPoints(
    anchorPoint: Vector4 | null | undefined,
    fallbackAnchorPoint?: Vector4 | null | undefined,
  ): void {
    if (anchorPoint) {
      // @ts-expect-error ts-migrate(2339) FIXME: Property 'setAnchorPoint' does not exist on type '... Remove this comment to see the full error message
      this.plane.material.setAnchorPoint(anchorPoint);
    }

    if (fallbackAnchorPoint) {
      // @ts-expect-error ts-migrate(2339) FIXME: Property 'setFallbackAnchorPoint' does not exist o... Remove this comment to see the full error message
      this.plane.material.setFallbackAnchorPoint(fallbackAnchorPoint);
    }
  }

  setScale(xFactor: number, yFactor: number): void {
    if (this.lastScaleFactors[0] !== xFactor || this.lastScaleFactors[1] !== yFactor) {
      this.lastScaleFactors[0] = xFactor;
      this.lastScaleFactors[1] = yFactor;
    } else {
      return;
    }

    const scaleVec = new THREE.Vector3().multiplyVectors(
      new THREE.Vector3(xFactor, yFactor, 1),
      this.baseScaleVector,
    );
    this.plane.scale.copy(scaleVec);
    this.TDViewBorders.scale.copy(scaleVec);
    this.crosshair[0].scale.copy(scaleVec);
    this.crosshair[1].scale.copy(scaleVec);
  }

  setRotation = (rotVec: THREE.Euler): void => {
    [this.plane, this.TDViewBorders, this.crosshair[0], this.crosshair[1]].map((mesh) =>
      mesh.setRotationFromEuler(rotVec),
    );
  };

  // In case the plane's position was offset to make geometries
  // on the plane visible (by moving the plane to the back), one can
  // additionall pass the originalPosition (which is necessary for the
  // shader)
  setPosition = (pos: Vector3, originalPosition?: Vector3): void => {
    const [x, y, z] = pos;
    this.TDViewBorders.position.set(x, y, z);
    this.crosshair[0].position.set(x, y, z);
    this.crosshair[1].position.set(x, y, z);
    this.plane.position.set(x, y, z);

    if (originalPosition == null) {
      // @ts-expect-error ts-migrate(2339) FIXME: Property 'setGlobalPosition' does not exist on typ... Remove this comment to see the full error message
      this.plane.material.setGlobalPosition(x, y, z);
    } else {
      // @ts-expect-error ts-migrate(2339) FIXME: Property 'setGlobalPosition' does not exist on typ... Remove this comment to see the full error message
      this.plane.material.setGlobalPosition(
        originalPosition[0],
        originalPosition[1],
        originalPosition[2],
      );
    }
  };

  setVisible = (isVisible: boolean, isDataVisible?: boolean): void => {
    this.plane.visible = isDataVisible != null ? isDataVisible : isVisible;
    this.TDViewBorders.visible = isVisible;
    this.crosshair[0].visible = isVisible && this.displayCrosshair;
    this.crosshair[1].visible = isVisible && this.displayCrosshair;
  };

  getMeshes = () => [this.plane, this.TDViewBorders, this.crosshair[0], this.crosshair[1]];
  setLinearInterpolationEnabled = (enabled: boolean) => {
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'setUseBilinearFiltering' does not exist ... Remove this comment to see the full error message
    this.plane.material.setUseBilinearFiltering(enabled);
  };
}

export default Plane;