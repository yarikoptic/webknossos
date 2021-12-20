// @flow
import { type ModifierKeys } from "libs/input";
import {
  type OrthoView,
  OrthoViews,
  type Point2,
  ContourModeEnum,
  type ShowContextMenuFunction,
  type AnnotationTool,
  AnnotationToolEnum,
  OrthoViewValuesWithoutTDView,
} from "oxalis/constants";
import {
  enforceActiveVolumeTracing,
  getContourTracingMode,
} from "oxalis/model/accessors/volumetracing_accessor";
import {
  handleAgglomerateSkeletonAtClick,
  handleClickSegment,
} from "oxalis/controller/combinations/segmentation_handlers";
import { hideBrushAction } from "oxalis/model/actions/volumetracing_actions";
import { isBrushTool } from "oxalis/model/accessors/tool_accessor";
import getSceneController from "oxalis/controller/scene_controller_provider";
import { finishedResizingUserBoundingBoxAction } from "oxalis/model/actions/annotation_actions";
import * as MoveHandlers from "oxalis/controller/combinations/move_handlers";
import PlaneView from "oxalis/view/plane_view";
import * as SkeletonHandlers from "oxalis/controller/combinations/skeleton_handlers";
import {
  type SelectedEdge,
  getClosestHoveredBoundingBox,
  handleResizingBoundingBox,
  highlightAndSetCursorOnHoveredBoundingBox,
} from "oxalis/controller/combinations/bounding_box_handlers";
import Store from "oxalis/store";
import * as Utils from "libs/utils";
import * as VolumeHandlers from "oxalis/controller/combinations/volume_handlers";
import { document } from "libs/window";
import api from "oxalis/api/internal_api";

/*
  This module contains classes for the different tools, such as MoveTool, SkeletonTool, DrawTool etc.
  Each tool class defines getMouseControls which declares how mouse bindings are mapped (depending on
  modifiers) to actions. For the actions, code from oxalis/controller/combinations is called.

  If a tool does not define a specific mouse binding, the bindings of the MoveTool are used as a fallback.
  See `createToolDependentMouseHandler` in plane_controller.js

  In general, each tool has to check the pressed modifiers and delegate to another tool if necessary.
  For example, the drawing tool delegates to the pick-cell-tool if shift is pressed.
  In other modules, we usually use `adaptActiveToolToShortcuts` to know which tool should be active
  when pressing a modifier, but in this module we keep explicit control over which tool is really active
  and delegate manually.

  Note that `getActionDescriptors` must not delegate to other tools. Instead, the semantic is always
  so that the returned hint of class X is only rendered if `adaptActiveToolToShortcuts` returns X.
  Therefore, the returned actions of a tool class should only refer to the actions of that tool class.
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
            MoveHandlers.moveW(delta, true);
            break;
          }
          case "alt":
          case "ctrl": {
            MoveHandlers.zoomPlanes(Utils.clamp(-1, delta, 1), true);
            break;
          }
          case "shift": {
            const { uiInformation, tracing } = Store.getState();
            const isBrushActive = isBrushTool(uiInformation.activeTool);
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
      leftClick: (pos: Point2, plane: OrthoView, event: MouseEvent, isTouch: boolean) => {
        const { useLegacyBindings } = Store.getState().userConfiguration;

        if (event.shiftKey || !useLegacyBindings) {
          if (SkeletonHandlers.handleSelectNode(planeView, pos, plane, isTouch)) {
            return;
          }
        }
        handleClickSegment(pos);
      },
      pinch: delta => MoveHandlers.zoom(delta, true),
      mouseMove: MoveHandlers.moveWhenAltIsPressed,
      out: () => {
        MoveHandlers.setMousePosition(null);
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
      SkeletonHandlers.handleOpenContextMenu(
        planeView,
        pos,
        plane,
        isTouch,
        event,
        showNodeContextMenuAt,
      );
  }

  static getActionDescriptors(
    _activeTool: AnnotationTool,
    useLegacyBindings: boolean,
    shiftKey: boolean,
    _ctrlKey: boolean,
    _altKey: boolean,
  ): Object {
    // In legacy mode, don't display a hint for
    // left click as it would be equal to left drag
    const leftClickInfo =
      useLegacyBindings && !shiftKey
        ? {}
        : {
            leftClick: "Select Node",
          };

    return {
      ...leftClickInfo,
      leftDrag: "Move",
      rightClick: "Context Menu",
    };
  }

  static onToolDeselected() {}
}

export class SkeletonTool {
  static getMouseControls(planeView: PlaneView, showNodeContextMenuAt: ShowContextMenuFunction) {
    const legacyRightClick = (
      position: Point2,
      plane: OrthoView,
      event: MouseEvent,
      isTouch: boolean,
    ) => {
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
    };

    let draggingNodeId = null;

    return {
      leftMouseDown: (pos: Point2, plane: OrthoView, event: MouseEvent, isTouch: boolean) => {
        const { useLegacyBindings } = Store.getState().userConfiguration;
        if (useLegacyBindings) {
          // There's no implicit node selection happening in the legacy mode
          return;
        }
        draggingNodeId = SkeletonHandlers.maybeGetNodeIdFromPosition(
          planeView,
          pos,
          plane,
          isTouch,
        );
      },
      leftMouseUp: () => {
        draggingNodeId = null;
      },
      leftDownMove: (delta: Point2, pos: Point2, _id: ?string, event: MouseEvent) => {
        const { tracing } = Store.getState();
        const { useLegacyBindings } = Store.getState().userConfiguration;
        if (
          tracing.skeleton != null &&
          (draggingNodeId != null || (useLegacyBindings && event.ctrlKey))
        ) {
          SkeletonHandlers.moveNode(delta.x, delta.y, draggingNodeId);
        } else {
          MoveHandlers.handleMovePlane(delta);
        }
      },
      leftClick: (pos: Point2, plane: OrthoView, event: MouseEvent, isTouch: boolean) => {
        const { useLegacyBindings } = Store.getState().userConfiguration;

        if (useLegacyBindings) {
          this.onLegacyLeftClick(
            planeView,
            pos,
            event.shiftKey,
            event.altKey,
            event.ctrlKey,
            plane,
            isTouch,
          );
          return;
        }

        const didSelectNode = SkeletonHandlers.handleSelectNode(planeView, pos, plane, isTouch);
        if (!didSelectNode) {
          SkeletonHandlers.handleCreateNode(planeView, pos, event.ctrlKey);
        }
      },
      rightClick: (position: Point2, plane: OrthoView, event: MouseEvent, isTouch: boolean) => {
        const { useLegacyBindings } = Store.getState().userConfiguration;
        if (useLegacyBindings) {
          legacyRightClick(position, plane, event, isTouch);
          return;
        }

        SkeletonHandlers.handleOpenContextMenu(
          planeView,
          position,
          plane,
          isTouch,
          event,
          showNodeContextMenuAt,
        );
      },

      middleClick: (pos: Point2, plane: OrthoView, event: MouseEvent) => {
        if (event.shiftKey) {
          handleAgglomerateSkeletonAtClick(pos);
        }
      },
    };
  }

  static onLegacyLeftClick(
    planeView: PlaneView,
    position: Point2,
    shiftPressed: boolean,
    altPressed: boolean,
    ctrlPressed: boolean,
    plane: OrthoView,
    isTouch: boolean,
  ): void {
    const { useLegacyBindings } = Store.getState().userConfiguration;

    // The following functions are all covered by the context menu, too.
    // (At least, in the XY/XZ/YZ viewports).
    if (shiftPressed && altPressed) {
      SkeletonHandlers.handleMergeTrees(planeView, position, plane, isTouch);
    } else if (shiftPressed && ctrlPressed) {
      SkeletonHandlers.handleDeleteEdge(planeView, position, plane, isTouch);
    } else if (shiftPressed || !useLegacyBindings) {
      SkeletonHandlers.handleSelectNode(planeView, position, plane, isTouch);
    }
  }

  static getActionDescriptors(
    _activeTool: AnnotationTool,
    useLegacyBindings: boolean,
    shiftKey: boolean,
    _ctrlKey: boolean,
    _altKey: boolean,
  ): Object {
    // In legacy mode, don't display a hint for
    // left click as it would be equal to left drag
    const leftClickInfo = useLegacyBindings
      ? {}
      : {
          leftClick: "Place/Select Node",
        };

    return {
      ...leftClickInfo,
      leftDrag: "Move",
      rightClick: useLegacyBindings && !shiftKey ? "Place Node" : "Context Menu",
    };
  }

  static onToolDeselected() {}
}

export class DrawTool {
  static getPlaneMouseControls(
    _planeId: OrthoView,
    planeView: PlaneView,
    showNodeContextMenuAt: ShowContextMenuFunction,
  ): * {
    return {
      leftDownMove: (delta: Point2, pos: Point2) => {
        VolumeHandlers.handleMoveForDrawOrErase(pos);
      },

      leftMouseDown: (pos: Point2, plane: OrthoView, event: MouseEvent) => {
        if (event.shiftKey && !event.ctrlKey) {
          // Should select cell. Do nothing, since case is covered by leftClick.
          return;
        }
        if (event.ctrlKey && VolumeHandlers.isAutomaticBrushEnabled()) {
          return;
        }
        if (event.ctrlKey && event.shiftKey) {
          VolumeHandlers.handleEraseStart(pos, plane);
          return;
        }
        VolumeHandlers.handleDrawStart(pos, plane);
      },

      leftMouseUp: () => {
        VolumeHandlers.handleEndForDrawOrErase();
      },

      rightDownMove: (delta: Point2, pos: Point2) => {
        const { useLegacyBindings } = Store.getState().userConfiguration;
        if (!useLegacyBindings) {
          return;
        }
        const state = Store.getState();
        const volumeTracing = enforceActiveVolumeTracing(state);
        const contourTracingMode = getContourTracingMode(volumeTracing);

        if (contourTracingMode === ContourModeEnum.DELETE) {
          VolumeHandlers.handleMoveForDrawOrErase(pos);
        }
      },

      rightMouseDown: (pos: Point2, plane: OrthoView, event: MouseEvent) => {
        const { useLegacyBindings } = Store.getState().userConfiguration;
        if (!useLegacyBindings) {
          return;
        }

        if (!event.shiftKey) {
          VolumeHandlers.handleEraseStart(pos, plane);
        }
      },

      rightMouseUp: () => {
        const { useLegacyBindings } = Store.getState().userConfiguration;
        if (!useLegacyBindings) {
          return;
        }

        VolumeHandlers.handleEndForDrawOrErase();
      },

      leftClick: (pos: Point2, plane: OrthoView, event: MouseEvent) => {
        const shouldPickCell = event.shiftKey && !event.ctrlKey;
        const shouldErase = event.shiftKey && event.ctrlKey;

        if (shouldPickCell) {
          VolumeHandlers.handlePickCell(pos);
        } else if (shouldErase) {
          // Do nothing. This case is covered by leftMouseDown.
        } else if (event.metaKey) {
          VolumeHandlers.handleAutoBrush(pos);
        }
      },

      rightClick: (pos: Point2, plane: OrthoView, event: MouseEvent, isTouch: boolean) => {
        const { useLegacyBindings } = Store.getState().userConfiguration;
        if (useLegacyBindings) {
          // Don't do anything. rightMouse* will take care of brushing.
          return;
        }

        SkeletonHandlers.handleOpenContextMenu(
          planeView,
          pos,
          plane,
          isTouch,
          event,
          showNodeContextMenuAt,
        );
      },

      out: () => {
        Store.dispatch(hideBrushAction());
      },
    };
  }

  static getActionDescriptors(
    activeTool: AnnotationTool,
    useLegacyBindings: boolean,
    _shiftKey: boolean,
    _ctrlKey: boolean,
    _altKey: boolean,
  ): Object {
    let rightClick;
    if (!useLegacyBindings) {
      rightClick = "Context Menu";
    } else {
      rightClick = `Erase (${activeTool === AnnotationToolEnum.BRUSH ? "Brush" : "Trace"})`;
    }

    return {
      leftDrag: activeTool === AnnotationToolEnum.BRUSH ? "Brush" : "Trace",
      rightClick,
    };
  }

  static onToolDeselected() {}
}

export class EraseTool {
  static getPlaneMouseControls(
    _planeId: OrthoView,
    planeView: PlaneView,
    showNodeContextMenuAt: ShowContextMenuFunction,
  ): * {
    return {
      leftDownMove: (delta: Point2, pos: Point2) => {
        VolumeHandlers.handleMoveForDrawOrErase(pos);
      },

      leftMouseDown: (pos: Point2, plane: OrthoView, _event: MouseEvent) => {
        VolumeHandlers.handleEraseStart(pos, plane);
      },

      leftMouseUp: () => {
        VolumeHandlers.handleEndForDrawOrErase();
      },

      rightClick: (pos: Point2, plane: OrthoView, event: MouseEvent, isTouch: boolean) => {
        SkeletonHandlers.handleOpenContextMenu(
          planeView,
          pos,
          plane,
          isTouch,
          event,
          showNodeContextMenuAt,
        );
      },

      out: () => {
        Store.dispatch(hideBrushAction());
      },
    };
  }

  static getActionDescriptors(
    activeTool: AnnotationTool,
    _useLegacyBindings: boolean,
    _shiftKey: boolean,
    _ctrlKey: boolean,
    _altKey: boolean,
  ): Object {
    return {
      leftDrag: `Erase (${activeTool === AnnotationToolEnum.ERASE_BRUSH ? "Brush" : "Trace"})`,
      rightClick: "Context Menu",
    };
  }

  static onToolDeselected() {}
}

export class PickCellTool {
  static getPlaneMouseControls(_planeId: OrthoView): * {
    return {
      leftClick: (pos: Point2, _plane: OrthoView, _event: MouseEvent) => {
        VolumeHandlers.handlePickCell(pos);
      },
    };
  }

  static getActionDescriptors(
    _activeTool: AnnotationTool,
    _useLegacyBindings: boolean,
    _shiftKey: boolean,
    _ctrlKey: boolean,
    _altKey: boolean,
  ): Object {
    return {
      leftClick: "Pick Segment",
      rightClick: "Context Menu",
    };
  }

  static onToolDeselected() {}
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

  static getActionDescriptors(
    _activeTool: AnnotationTool,
    _useLegacyBindings: boolean,
    _shiftKey: boolean,
    _ctrlKey: boolean,
    _altKey: boolean,
  ): Object {
    return {
      leftClick: "Fill Segment",
      rightClick: "Context Menu",
    };
  }

  static onToolDeselected() {}
}

export class BoundingBoxTool {
  static getPlaneMouseControls(
    planeId: OrthoView,
    planeView: PlaneView,
    showNodeContextMenuAt: ShowContextMenuFunction,
  ): * {
    let primarySelectedEdge: ?SelectedEdge = null;
    let secondarySelectedEdge: ?SelectedEdge = null;
    return {
      leftDownMove: (delta: Point2, pos: Point2, _id: ?string, _event: MouseEvent) => {
        if (primarySelectedEdge != null) {
          handleResizingBoundingBox(pos, planeId, primarySelectedEdge, secondarySelectedEdge);
        } else {
          MoveHandlers.handleMovePlane(delta);
        }
      },
      leftMouseDown: (pos: Point2, _plane: OrthoView, _event: MouseEvent) => {
        const hoveredEdgesInfo = getClosestHoveredBoundingBox(pos, planeId);
        if (hoveredEdgesInfo) {
          [primarySelectedEdge, secondarySelectedEdge] = hoveredEdgesInfo;
          getSceneController().highlightUserBoundingBox(primarySelectedEdge.boxId);
        }
      },

      leftMouseUp: () => {
        if (primarySelectedEdge) {
          Store.dispatch(finishedResizingUserBoundingBoxAction(primarySelectedEdge.boxId));
        }
        primarySelectedEdge = null;
        secondarySelectedEdge = null;
        getSceneController().highlightUserBoundingBox(null);
      },

      mouseMove: (delta: Point2, position: Point2, _id, event: MouseEvent) => {
        if (primarySelectedEdge == null && planeId !== OrthoViews.TDView) {
          MoveHandlers.moveWhenAltIsPressed(delta, position, _id, event);
          highlightAndSetCursorOnHoveredBoundingBox(delta, position, planeId);
        }
      },

      rightClick: (pos: Point2, plane: OrthoView, event: MouseEvent, isTouch: boolean) => {
        SkeletonHandlers.handleOpenContextMenu(
          planeView,
          pos,
          plane,
          isTouch,
          event,
          showNodeContextMenuAt,
        );
      },
    };
  }

  static getActionDescriptors(
    _activeTool: AnnotationTool,
    _useLegacyBindings: boolean,
    _shiftKey: boolean,
    _ctrlKey: boolean,
    _altKey: boolean,
  ): Object {
    return {
      leftDrag: "Resize Bounding Boxes",
      rightClick: "Context Menu",
    };
  }

  static onToolDeselected() {
    const { body } = document;
    if (body == null) {
      return;
    }
    for (const planeId of OrthoViewValuesWithoutTDView) {
      const inputCatcher = document.getElementById(`inputcatcher_${planeId}`);
      if (inputCatcher) {
        inputCatcher.style.cursor = "auto";
      }
    }
    getSceneController().highlightUserBoundingBox(null);
  }
}

const toolToToolClass = {
  [AnnotationToolEnum.MOVE]: MoveTool,
  [AnnotationToolEnum.SKELETON]: SkeletonTool,
  [AnnotationToolEnum.BOUNDING_BOX]: BoundingBoxTool,
  [AnnotationToolEnum.BRUSH]: DrawTool,
  [AnnotationToolEnum.TRACE]: DrawTool,
  [AnnotationToolEnum.ERASE_TRACE]: EraseTool,
  [AnnotationToolEnum.ERASE_BRUSH]: EraseTool,
  [AnnotationToolEnum.FILL_CELL]: FillCellTool,
  [AnnotationToolEnum.PICK_CELL]: PickCellTool,
};

export function getToolClassForAnnotationTool(activeTool: AnnotationTool) {
  return toolToToolClass[activeTool];
}
