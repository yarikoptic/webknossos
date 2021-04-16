/**
 * plane_controller.js
 * @flow
 */

import { connect } from "react-redux";
import BackboneEvents from "backbone-events-standalone";
import Clipboard from "clipboard-js";
import * as React from "react";
import _ from "lodash";

import { InputKeyboard, InputKeyboardNoLoop, InputMouse, type ModifierKeys } from "libs/input";
import { document } from "libs/window";
import { getBaseVoxel, getBaseVoxelFactors } from "oxalis/model/scaleinfo";
import { getViewportScale, getInputCatcherRect } from "oxalis/model/accessors/view_mode_accessor";
import {
  getPosition,
  getRequestLogZoomStep,
  getPlaneScalingFactor,
} from "oxalis/model/accessors/flycam_accessor";
import { getResolutions, is2dDataset } from "oxalis/model/accessors/dataset_accessor";
import { listenToStoreProperty } from "oxalis/model/helpers/listener_helpers";
import {
  movePlaneFlycamOrthoAction,
  moveFlycamOrthoAction,
  zoomByDeltaAction,
} from "oxalis/model/actions/flycam_actions";
import { setMousePositionAction } from "oxalis/model/actions/volumetracing_actions";
import { setViewportAction, zoomTDViewAction } from "oxalis/model/actions/view_mode_actions";
import { updateUserSettingAction } from "oxalis/model/actions/settings_actions";
import Dimensions from "oxalis/model/dimensions";
import Model from "oxalis/model";
import PlaneView from "oxalis/view/plane_view";
import Store, { type OxalisState, type Tracing } from "oxalis/store";
import TDController from "oxalis/controller/td_controller";
import Toast from "libs/toast";
import * as Utils from "libs/utils";
import api from "oxalis/api/internal_api";
import {
  MoveTool,
  SkeletonTool,
  VolumeTool,
  movePlane,
} from "oxalis/controller/combinations/tool_controls";
import constants, {
  type OrthoView,
  type OrthoViewMap,
  OrthoViewValuesWithoutTDView,
  OrthoViews,
  type Point2,
  type Vector3,
  AnnotationToolEnum,
} from "oxalis/constants";
import getSceneController from "oxalis/controller/scene_controller_provider";
import * as skeletonController from "oxalis/controller/combinations/skeletontracing_plane_controller";
import * as volumeController from "oxalis/controller/combinations/volumetracing_plane_controller";
import { downloadScreenshot } from "oxalis/view/rendering_utils";

const MAX_BRUSH_CHANGE_VALUE = 5;
const BRUSH_CHANGING_CONSTANT = 0.02;

function ensureNonConflictingHandlers(skeletonControls: Object, volumeControls: Object): void {
  const conflictingHandlers = _.intersection(
    Object.keys(skeletonControls),
    Object.keys(volumeControls),
  );
  if (conflictingHandlers.length > 0) {
    throw new Error(
      `There are unsolved conflicts between skeleton and volume controller: ${conflictingHandlers.join(
        ", ",
      )}`,
    );
  }
}

type OwnProps = {| showNodeContextMenuAt: (number, number, ?number, Vector3, OrthoView) => void |};

type StateProps = {|
  tracing: Tracing,
  is2d: boolean,
|};

type Props = {|
  ...StateProps,
  ...OwnProps,
|};

class PlaneController extends React.PureComponent<Props> {
  // See comment in Controller class on general controller architecture.
  //
  // Plane Controller: Responsible for Plane Modes
  planeView: PlaneView;
  input: {
    mouseControllers: OrthoViewMap<InputMouse>,
    keyboard?: InputKeyboard,
    keyboardNoLoop?: InputKeyboardNoLoop,
    keyboardLoopDelayed?: InputKeyboard,
    keyboardNoLoop?: InputKeyboardNoLoop,
  };

  storePropertyUnsubscribers: Array<Function>;
  isStarted: boolean;
  zoomPos: Vector3;
  // Copied from backbone events (TODO: handle this better)
  listenTo: Function;
  stopListening: Function;

  constructor(...args: any) {
    super(...args);
    _.extend(this, BackboneEvents);
    this.storePropertyUnsubscribers = [];
  }

  componentDidMount() {
    this.input = {
      mouseControllers: {},
    };
    this.isStarted = false;

    this.planeView = new PlaneView();
    this.forceUpdate();

    Store.dispatch(setViewportAction(OrthoViews.PLANE_XY));
    this.start();
  }

  componentWillUnmount() {
    this.stop();
  }

  initMouse(): void {
    // Workaround: We are only waiting for tdview since this introduces
    // the necessary delay to attach the events to the newest input
    // catchers (only necessary for HammerJS). We should refactor the
    // InputMouse handling so that this is not necessary anymore.
    // See: https://github.com/scalableminds/webknossos/issues/3475
    const tdId = `inputcatcher_${OrthoViews.TDView}`;
    Utils.waitForElementWithId(tdId).then(() => {
      OrthoViewValuesWithoutTDView.forEach(id => {
        const inputcatcherId = `inputcatcher_${OrthoViews[id]}`;
        Utils.waitForElementWithId(inputcatcherId).then(el => {
          if (!document.body.contains(el)) {
            console.error("el is not attached anymore");
          }
          this.input.mouseControllers[id] = new InputMouse(
            inputcatcherId,
            this.getPlaneMouseControls(id),
            id,
            true,
          );
        });
      });
    });
  }

  getPlaneMouseControls(planeId: OrthoView): Object {
    const moveControls = MoveTool.getMouseControls(
      planeId,
      this.planeView,
      this.props.showNodeContextMenuAt,
      {
        zoom: this.zoom,
        scrollPlanes: this.scrollPlanes,
      },
    );

    const skeletonControls = SkeletonTool.getMouseControls(
      this.planeView,
      this.props.showNodeContextMenuAt,
    );

    const volumeControls = VolumeTool.getPlaneMouseControls(planeId);

    const allControlKeys = _.union(
      Object.keys(moveControls),
      Object.keys(skeletonControls),
      Object.keys(volumeControls),
    );
    const controls = {};

    for (const controlKey of allControlKeys) {
      controls[controlKey] = this.createToolDependentHandler(
        skeletonControls[controlKey],
        volumeControls[controlKey],
        moveControls[controlKey],
      );
    }

    return controls;
  }

  initKeyboard(): void {
    // avoid scrolling while pressing space
    document.addEventListener("keydown", (event: KeyboardEvent) => {
      if (
        (event.which === 32 || event.which === 18 || (event.which >= 37 && event.which <= 40)) &&
        Utils.isNoElementFocussed()
      ) {
        event.preventDefault();
      }
    });

    const getMoveValue = timeFactor => {
      const state = Store.getState();
      return (
        (state.userConfiguration.moveValue * timeFactor) /
        getBaseVoxel(state.dataset.dataSource.scale) /
        constants.FPS
      );
    };

    this.input.keyboard = new InputKeyboard({
      // Move
      left: timeFactor => this.moveX(-getMoveValue(timeFactor)),
      right: timeFactor => this.moveX(getMoveValue(timeFactor)),
      up: timeFactor => this.moveY(-getMoveValue(timeFactor)),
      down: timeFactor => this.moveY(getMoveValue(timeFactor)),
    });

    const notLoopedKeyboardControls = this.getNotLoopedKeyboardControls();
    const loopedKeyboardControls = this.getLoopedKeyboardControls();
    ensureNonConflictingHandlers(notLoopedKeyboardControls, loopedKeyboardControls);

    this.input.keyboardLoopDelayed = new InputKeyboard(
      {
        // KeyboardJS is sensitive to ordering (complex combos first)
        "shift + f": (timeFactor, first) => this.moveZ(getMoveValue(timeFactor) * 5, first),
        "shift + d": (timeFactor, first) => this.moveZ(-getMoveValue(timeFactor) * 5, first),

        "shift + i": () => this.changeBrushSizeIfBrushIsActiveBy(-1),
        "shift + o": () => this.changeBrushSizeIfBrushIsActiveBy(1),

        "shift + space": (timeFactor, first) => this.moveZ(-getMoveValue(timeFactor), first),
        "ctrl + space": (timeFactor, first) => this.moveZ(-getMoveValue(timeFactor), first),
        space: (timeFactor, first) => this.moveZ(getMoveValue(timeFactor), first),
        f: (timeFactor, first) => this.moveZ(getMoveValue(timeFactor), first),
        d: (timeFactor, first) => this.moveZ(-getMoveValue(timeFactor), first),

        // Zoom in/out
        i: () => this.zoom(1, false),
        o: () => this.zoom(-1, false),

        h: () => this.changeMoveValue(25),
        g: () => this.changeMoveValue(-25),
        ...loopedKeyboardControls,
      },
      { delay: Store.getState().userConfiguration.keyboardDelay },
    );

    this.input.keyboardNoLoop = new InputKeyboardNoLoop(notLoopedKeyboardControls);

    this.storePropertyUnsubscribers.push(
      listenToStoreProperty(
        state => state.userConfiguration.keyboardDelay,
        keyboardDelay => {
          const { keyboardLoopDelayed } = this.input;
          if (keyboardLoopDelayed != null) {
            keyboardLoopDelayed.delay = keyboardDelay;
          }
        },
      ),
    );
  }

  getNotLoopedKeyboardControls(): Object {
    const baseControls = {
      "ctrl + i": event => {
        const segmentationLayer = Model.getSegmentationLayer();
        if (!segmentationLayer) {
          return;
        }
        const { mousePosition } = Store.getState().temporaryConfiguration;
        if (mousePosition) {
          const [x, y] = mousePosition;
          const globalMousePosition = calculateGlobalPos({ x, y });
          const { cube } = segmentationLayer;
          const mapping = event.altKey ? cube.getMapping() : null;
          const hoveredId = cube.getDataValue(
            globalMousePosition,
            mapping,
            getRequestLogZoomStep(Store.getState()),
          );
          Clipboard.copy(String(hoveredId)).then(() =>
            Toast.success(`Cell id ${hoveredId} copied to clipboard.`),
          );
        } else {
          Toast.warning("No cell under cursor.");
        }
      },
      q: downloadScreenshot,
    };

    // TODO: Find a nicer way to express this, while satisfying flow
    const emptyDefaultHandler = { c: null, "1": null };
    const { c: skeletonCHandler, "1": skeletonOneHandler, ...skeletonControls } =
      this.props.tracing.skeleton != null
        ? skeletonController.getKeyboardControls()
        : emptyDefaultHandler;

    const { c: volumeCHandler, "1": volumeOneHandler, ...volumeControls } =
      this.props.tracing.volume != null
        ? volumeController.getKeyboardControls()
        : emptyDefaultHandler;

    ensureNonConflictingHandlers(skeletonControls, volumeControls);

    return {
      ...baseControls,
      ...skeletonControls,
      // $FlowIssue[exponential-spread] See https://github.com/facebook/flow/issues/8299
      ...volumeControls,
      c: this.createToolDependentHandler(skeletonCHandler, volumeCHandler),
      "1": this.createToolDependentHandler(skeletonOneHandler, volumeOneHandler),
    };
  }

  getLoopedKeyboardControls() {
    // Note that this code needs to be adapted in case the volumeController also starts to expose
    // looped keyboard controls. For the hybrid case, these two controls would need t be combined then.
    return this.props.tracing.skeleton != null
      ? skeletonController.getLoopedKeyboardControls()
      : {};
  }

  init(): void {
    const { clippingDistance } = Store.getState().userConfiguration;
    getSceneController().setClippingDistance(clippingDistance);
  }

  start(): void {
    this.bindToEvents();

    getSceneController().startPlaneMode();
    this.planeView.start();

    this.initKeyboard();
    this.initMouse();
    this.init();
    this.isStarted = true;
  }

  stop(): void {
    if (this.isStarted) {
      this.destroyInput();
    }

    getSceneController().stopPlaneMode();
    this.planeView.stop();
    this.stopListening();

    this.isStarted = false;
  }

  bindToEvents(): void {
    this.listenTo(this.planeView, "render", this.onPlaneViewRender);
  }

  onPlaneViewRender(): void {
    getSceneController().update();
  }

  moveX = (x: number): void => {
    movePlane([x, 0, 0]);
  };

  moveY = (y: number): void => {
    movePlane([0, y, 0]);
  };

  moveZ = (z: number, oneSlide: boolean): void => {
    if (this.props.is2d) {
      return;
    }
    const { activeViewport } = Store.getState().viewModeData.plane;
    if (activeViewport === OrthoViews.TDView) {
      return;
    }

    if (oneSlide) {
      const logZoomStep = getRequestLogZoomStep(Store.getState());
      const w = Dimensions.getIndices(activeViewport)[2];
      const zStep = getResolutions(Store.getState().dataset)[logZoomStep][w];

      Store.dispatch(
        moveFlycamOrthoAction(
          Dimensions.transDim([0, 0, (z < 0 ? -1 : 1) * Math.max(1, zStep)], activeViewport),
          activeViewport,
          true,
        ),
      );
    } else {
      movePlane([0, 0, z], false);
    }
  };

  zoom = (value: number, zoomToMouse: boolean) => {
    const { activeViewport } = Store.getState().viewModeData.plane;
    if (OrthoViewValuesWithoutTDView.includes(activeViewport)) {
      this.zoomPlanes(value, zoomToMouse);
    } else {
      this.zoomTDView(value);
    }
  };

  zoomPlanes = (value: number, zoomToMouse: boolean) => {
    if (zoomToMouse) {
      this.zoomPos = this.getMousePosition();
    }

    Store.dispatch(zoomByDeltaAction(value));

    if (zoomToMouse) {
      this.finishZoom();
    }
  };

  zoomTDView(value: number): void {
    const zoomToPosition = null;
    const { width, height } = getInputCatcherRect(Store.getState(), OrthoViews.TDView);
    Store.dispatch(zoomTDViewAction(value, zoomToPosition, width, height));
  }

  finishZoom = (): void => {
    // Move the plane so that the mouse is at the same position as
    // before the zoom
    const { activeViewport } = Store.getState().viewModeData.plane;
    if (this.isMouseOver() && activeViewport !== OrthoViews.TDView) {
      const mousePos = this.getMousePosition();
      const moveVector = [
        this.zoomPos[0] - mousePos[0],
        this.zoomPos[1] - mousePos[1],
        this.zoomPos[2] - mousePos[2],
      ];
      Store.dispatch(moveFlycamOrthoAction(moveVector, activeViewport));
    }
  };

  getMousePosition(): Vector3 {
    const { activeViewport } = Store.getState().viewModeData.plane;
    const pos = this.input.mouseControllers[activeViewport].position;
    if (pos != null) {
      return calculateGlobalPos(pos);
    }
    return [0, 0, 0];
  }

  isMouseOver(): boolean {
    return this.input.mouseControllers[Store.getState().viewModeData.plane.activeViewport]
      .isMouseOver;
  }

  changeMoveValue(delta: number): void {
    const moveValue = Store.getState().userConfiguration.moveValue + delta;
    Store.dispatch(updateUserSettingAction("moveValue", moveValue));
  }

  changeBrushSizeIfBrushIsActiveBy(factor: number) {
    const isBrushActive = this.props.tracing.activeTool === AnnotationToolEnum.BRUSH;
    if (isBrushActive) {
      const currentBrushSize = Store.getState().userConfiguration.brushSize;
      const newBrushSize =
        Math.min(Math.ceil(currentBrushSize * BRUSH_CHANGING_CONSTANT), MAX_BRUSH_CHANGE_VALUE) *
          factor +
        currentBrushSize;
      Store.dispatch(updateUserSettingAction("brushSize", newBrushSize));
    }
  }

  scrollPlanes = (delta: number, type: ?ModifierKeys) => {
    switch (type) {
      case null: {
        this.moveZ(delta, true);
        break;
      }
      case "alt":
      case "ctrl": {
        this.zoomPlanes(Utils.clamp(-1, delta, 1), true);
        break;
      }
      case "shift": {
        const isBrushActive = this.props.tracing.activeTool === AnnotationToolEnum.BRUSH;
        if (isBrushActive) {
          // Different browsers send different deltas, this way the behavior is comparable
          if (delta > 0) {
            this.changeBrushSizeIfBrushIsActiveBy(1);
          } else {
            this.changeBrushSizeIfBrushIsActiveBy(-1);
          }
        } else if (this.props.tracing.skeleton) {
          // Different browsers send different deltas, this way the behavior is comparable
          api.tracing.setNodeRadius(delta > 0 ? 5 : -5);
        }
        break;
      }
      default: // ignore other cases
    }
  };

  unsubscribeStoreListeners() {
    this.storePropertyUnsubscribers.forEach(unsubscribe => unsubscribe());
    this.storePropertyUnsubscribers = [];
  }

  destroyInput() {
    for (const mouse of _.values(this.input.mouseControllers)) {
      mouse.destroy();
    }
    this.input.mouseControllers = {};
    Utils.__guard__(this.input.keyboard, x => x.destroy());
    Utils.__guard__(this.input.keyboardNoLoop, x1 => x1.destroy());
    Utils.__guard__(this.input.keyboardLoopDelayed, x2 => x2.destroy());
    this.unsubscribeStoreListeners();
  }

  createToolDependentHandler(
    skeletonHandler: ?Function,
    volumeHandler: ?Function,
    viewHandler?: ?Function,
  ): Function {
    return (...args) => {
      const tool = this.props.tracing.activeTool;
      if (tool === AnnotationToolEnum.MOVE) {
        if (viewHandler != null) {
          viewHandler(...args);
        } else if (skeletonHandler != null) {
          skeletonHandler(...args);
        }
      } else if (tool === AnnotationToolEnum.SKELETON) {
        if (skeletonHandler != null) {
          skeletonHandler(...args);
        } else if (viewHandler != null) {
          viewHandler(...args);
        }
      } else {
        // eslint-disable-next-line no-lonely-if
        if (volumeHandler != null) {
          volumeHandler(...args);
        } else if (viewHandler != null) {
          viewHandler(...args);
        }
      }
    };
  }

  render() {
    if (!this.planeView) {
      return null;
    }

    return (
      <TDController
        cameras={this.planeView.getCameras()}
        tracing={this.props.tracing}
        planeView={this.planeView}
      />
    );
  }
}

export function calculateGlobalPos(clickPos: Point2): Vector3 {
  let position;
  const state = Store.getState();
  const { activeViewport } = state.viewModeData.plane;
  const curGlobalPos = getPosition(state.flycam);
  const zoomFactors = getPlaneScalingFactor(state, state.flycam, activeViewport);
  const viewportScale = getViewportScale(state, activeViewport);
  const planeRatio = getBaseVoxelFactors(state.dataset.dataSource.scale);

  const center = [0, 1].map(dim => (constants.VIEWPORT_WIDTH * viewportScale[dim]) / 2);
  const diffX = ((center[0] - clickPos.x) / viewportScale[0]) * zoomFactors[0];
  const diffY = ((center[1] - clickPos.y) / viewportScale[1]) * zoomFactors[1];

  switch (activeViewport) {
    case OrthoViews.PLANE_XY:
      position = [
        curGlobalPos[0] - diffX * planeRatio[0],
        curGlobalPos[1] - diffY * planeRatio[1],
        curGlobalPos[2],
      ];
      break;
    case OrthoViews.PLANE_YZ:
      position = [
        curGlobalPos[0],
        curGlobalPos[1] - diffY * planeRatio[1],
        curGlobalPos[2] - diffX * planeRatio[2],
      ];
      break;
    case OrthoViews.PLANE_XZ:
      position = [
        curGlobalPos[0] - diffX * planeRatio[0],
        curGlobalPos[1],
        curGlobalPos[2] - diffY * planeRatio[2],
      ];
      break;
    default:
      console.error(
        `Trying to calculate the global position, but no viewport is active: ${activeViewport}`,
      );
      return [0, 0, 0];
  }

  return position;
}

export function mapStateToProps(state: OxalisState): StateProps {
  return {
    tracing: state.tracing,
    is2d: is2dDataset(state.dataset),
  };
}

export { PlaneController as PlaneControllerClass };
export default connect<Props, OwnProps, _, _, _, _>(mapStateToProps)(PlaneController);
