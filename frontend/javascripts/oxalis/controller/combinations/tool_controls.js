// @flow
import { hideBrushAction } from "oxalis/model/actions/volumetracing_actions";
import PlaneView from "oxalis/view/plane_view";
import Store from "oxalis/store";
import {
  type OrthoView,
  OrthoViews,
  AnnotationToolEnum,
  type Point2,
  ContourModeEnum,
  type ShowContextMenuFunction,
} from "oxalis/constants";
import { type ModifierKeys } from "libs/input";
import * as Utils from "libs/utils";
import api from "oxalis/api/internal_api";
import * as SkeletonHandlers from "oxalis/controller/combinations/skeleton_handlers";
import * as VolumeHandlers from "oxalis/controller/combinations/volume_handlers";
import * as MoveHandlers from "oxalis/controller/combinations/move_handlers";
import { handleAgglomerateSkeletonAtClick } from "oxalis/controller/combinations/segmentation_handlers";
import {
  getContourTracingMode,
  enforceVolumeTracing,
} from "oxalis/model/accessors/volumetracing_accessor";

/*
  This module contains classes for the different tools, such as MoveTool, SkeletonTool, DrawTool etc.
  Each tool class defines getMouseControls which declares how mouse bindings are mapped (depending on
  modifiers) to actions. For the actions, code from oxalis/controller/combinations is called.

  If a tool does not define a specific mouse binding, the bindings of the MoveTool are used as a fallback.
  See `createToolDependentMouseHandler` in plane_controller.js
*/

export class MoveTool {
  static getMouseControls(
    planeId: OrthoView,
    planeView: PlaneView,
    showNodeContextMenuAt: ShowContextMenuFunction,
  ): Object {
    return {
      scroll: (delta: number, type: ?ModifierKeys) => {
        switch (type) {
          case null: {
            MoveHandlers.moveZ(delta, true);
            break;
          }
          case "alt":
          case "ctrl": {
            MoveHandlers.zoomPlanes(Utils.clamp(-1, delta, 1), true);
            break;
          }
          case "shift": {
            const { tracing } = Store.getState();
            const isBrushActive = tracing.activeTool === AnnotationToolEnum.BRUSH;
            if (isBrushActive) {
              // Different browsers send different deltas, this way the behavior is comparable
              if (delta > 0) {
                VolumeHandlers.changeBrushSizeIfBrushIsActiveBy(1);
              } else {
                VolumeHandlers.changeBrushSizeIfBrushIsActiveBy(-1);
              }
            } else if (tracing.skeleton) {
              // Different browsers send different deltas, this way the behavior is comparable
              api.tracing.setNodeRadius(delta > 0 ? 5 : -5);
            }
            break;
          }
          default: // ignore other cases
        }
      },
      over: () => {
        MoveHandlers.handleOverViewport(planeId);
      },
      pinch: delta => MoveHandlers.zoom(delta, true),
      mouseMove: (delta: Point2, position: Point2, id, event) => {
        // Always set the correct mouse position. Otherwise, using alt + mouse move and
        // alt + scroll won't result in the correct zoomToMouse behavior.
        MoveHandlers.setMousePosition(position);
        if (event.altKey && !event.shiftKey) {
          MoveHandlers.handleMovePlane(delta);
        }
      },
      leftDownMove: (delta: Point2, _pos: Point2, _id: ?string, _event: MouseEvent) => {
        MoveHandlers.handleMovePlane(delta);
      },
      middleDownMove: MoveHandlers.handleMovePlane,
      rightClick: MoveTool.createRightClickHandler(planeView, showNodeContextMenuAt),
    };
  }

  static createRightClickHandler(
    planeView: PlaneView,
    showNodeContextMenuAt: ShowContextMenuFunction,
  ) {
    return (pos: Point2, plane: OrthoView, event: MouseEvent, isTouch: boolean) =>
      SkeletonHandlers.openContextMenu(
        planeView,
        pos,
        plane,
        isTouch,
        event,
        showNodeContextMenuAt,
      );
  }
}

export class SkeletonTool {
  static getMouseControls(planeView: PlaneView, showNodeContextMenuAt: ShowContextMenuFunction) {
    return {
      leftDownMove: (delta: Point2, pos: Point2, _id: ?string, event: MouseEvent) => {
        const { tracing } = Store.getState();
        if (tracing.skeleton != null && event.ctrlKey) {
          SkeletonHandlers.moveNode(delta.x, delta.y);
        } else {
          MoveHandlers.handleMovePlane(delta);
        }
      },
      leftClick: (pos: Point2, plane: OrthoView, event: MouseEvent, isTouch: boolean) =>
        this.onClick(planeView, pos, event.shiftKey, event.altKey, event.ctrlKey, plane, isTouch),
      rightClick: (position: Point2, plane: OrthoView, event: MouseEvent, isTouch: boolean) => {
        const { activeViewport } = Store.getState().viewModeData.plane;
        if (activeViewport === OrthoViews.TDView) {
          return;
        }

        if (event.shiftKey) {
          SkeletonHandlers.handleOpenContextMenu(
            planeView,
            position,
            plane,
            isTouch,
            event,
            showNodeContextMenuAt,
          );
        } else {
          SkeletonHandlers.handleCreateNode(planeView, position, event.ctrlKey);
        }
      },
      middleClick: (pos: Point2, plane: OrthoView, event: MouseEvent) => {
        if (event.shiftKey) {
          handleAgglomerateSkeletonAtClick(pos);
        }
      },
    };
  }

  static onClick(
    planeView: PlaneView,
    position: Point2,
    shiftPressed: boolean,
    altPressed: boolean,
    ctrlPressed: boolean,
    plane: OrthoView,
    isTouch: boolean,
  ): void {
    if (!shiftPressed && !isTouch && !ctrlPressed) {
      // do nothing
      return;
    }

    if (altPressed) {
      SkeletonHandlers.handleMergeTrees(planeView, position, plane, isTouch);
    } else if (ctrlPressed) {
      SkeletonHandlers.handleDeleteEdge(planeView, position, plane, isTouch);
    } else {
      SkeletonHandlers.handleSelectNode(planeView, position, plane, isTouch);
    }
  }
}

export class DrawTool {
  static getPlaneMouseControls(_planeId: OrthoView): * {
    return {
      leftDownMove: (delta: Point2, pos: Point2) => {
        const { tracing } = Store.getState();
        const volumeTracing = enforceVolumeTracing(tracing);
        const contourTracingMode = getContourTracingMode(volumeTracing);

        if (contourTracingMode === ContourModeEnum.DRAW) {
          VolumeHandlers.handleDrawDeleteMove(pos);
        }
      },

      leftMouseDown: (pos: Point2, plane: OrthoView, event: MouseEvent) => {
        if (event.shiftKey) {
          return;
        }
        if (event.ctrlKey && VolumeHandlers.isAutomaticBrushEnabled()) {
          return;
        }
        VolumeHandlers.handleDrawStart(pos, plane);
      },

      leftMouseUp: () => {
        VolumeHandlers.handleDrawEraseEnd();
      },

      rightDownMove: (delta: Point2, pos: Point2) => {
        const { tracing } = Store.getState();
        const volumeTracing = enforceVolumeTracing(tracing);
        const contourTracingMode = getContourTracingMode(volumeTracing);

        if (contourTracingMode === ContourModeEnum.DELETE) {
          VolumeHandlers.handleDrawDeleteMove(pos);
        }
      },

      rightMouseDown: (pos: Point2, plane: OrthoView, event: MouseEvent) => {
        if (!event.shiftKey) {
          VolumeHandlers.handleEraseStart(pos, plane);
        }
      },

      rightMouseUp: () => {
        VolumeHandlers.handleDrawEraseEnd();
      },

      leftClick: (pos: Point2, plane: OrthoView, event: MouseEvent) => {
        const shouldPickCell = event.shiftKey && !event.ctrlKey;
        const shouldFillCell = event.shiftKey && event.ctrlKey;

        if (shouldPickCell) {
          VolumeHandlers.handlePickCell(pos);
        } else if (shouldFillCell) {
          VolumeHandlers.handleFloodFill(pos, plane);
        } else if (event.metaKey) {
          VolumeHandlers.handleAutoBrush(pos);
        }
      },

      rightClick: (_pos: Point2, _plane: OrthoView, _event: MouseEvent) => {
        // Don't do anything. rightMouse* will take care of brushing.
        // This handler has to be defined, as the rightClick handler of the move tool
        // would overtake otherwise.
      },

      out: () => {
        Store.dispatch(hideBrushAction());
      },
    };
  }
}

export class PickCellTool {
  static getPlaneMouseControls(_planeId: OrthoView): * {
    return {
      leftClick: (pos: Point2, _plane: OrthoView, _event: MouseEvent) => {
        VolumeHandlers.handlePickCell(pos);
      },
    };
  }
}

export class FillCellTool {
  static getPlaneMouseControls(_planeId: OrthoView): * {
    return {
      leftClick: (pos: Point2, plane: OrthoView, event: MouseEvent) => {
        const shouldPickCell = event.shiftKey && !event.ctrlKey;
        const shouldAutoBrush = event.metaKey && VolumeHandlers.isAutomaticBrushEnabled();

        if (shouldPickCell) {
          VolumeHandlers.handlePickCell(pos);
        } else if (shouldAutoBrush) {
          VolumeHandlers.handleAutoBrush(pos);
        } else {
          VolumeHandlers.handleFloodFill(pos, plane);
        }
      },
    };
  }
}