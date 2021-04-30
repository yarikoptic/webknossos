// @flow
import { Space, Tooltip } from "antd";
import _ from "lodash";
import { connect } from "react-redux";
import type { Dispatch } from "redux";
import React from "react";

import type { OxalisState } from "oxalis/store";
import {
  type Vector2,
  type Vector3,
  type OrthoView,
  OrthoViews,
  type VolumeTool,
  VolumeToolEnum,
} from "oxalis/constants";
import { NumberInputPopoverSetting } from "oxalis/view/components/setting_input_views";
import { getCurrentResolution } from "oxalis/model/accessors/flycam_accessor";
import { isPlaneMode } from "oxalis/model/accessors/view_mode_accessor";
import api from "oxalis/api/internal_api";
import { calculateGlobalPos } from "oxalis/controller/viewmodes/plane_controller";
import Cube from "oxalis/model/bucket_data_handling/data_cube";
import { setActiveCellAction } from "oxalis/model/actions/volumetracing_actions";
import {
  setActiveNodeAction,
  setActiveTreeAction,
} from "oxalis/model/actions/skeletontracing_actions";
import { V3 } from "libs/mjs";
import Model from "oxalis/model";
import { MoreOutlined } from "@ant-design/icons";

type OwnProps = {||};
type StateProps = {|
  activeResolution: Vector3,
  activeViewport: OrthoView,
  mousePosition: ?Vector2,
  isSkeletonAnnotation: boolean,
  isVolumeAnnotation: boolean,
  activeTool: ?VolumeTool,
  isPlaneMode: boolean,
  activeCellId: ?number,
  activeNodeId: ?number,
  activeTreeId: ?number,
|};

type DispatchProps = {|
  onChangeActiveNodeId: (value: number) => void,
  onChangeActiveTreeId: (value: number) => void,
  onChangeActiveCellId: (value: number) => void,
|};

type Props = {| ...OwnProps, ...StateProps, ...DispatchProps |};
type State = {||};

const spaceBetweenItems = 25;
const lineColor = "rgba(255, 255, 255, 0.67)";

const defaultShortcutStyle = { marginLeft: spaceBetweenItems };

const hasSegmentation = () => Model.getSegmentationLayer() != null;

class Statusbar extends React.PureComponent<Props, State> {
  getSegmentationCube(): Cube {
    const segmentationLayer = Model.getSegmentationLayer();
    return segmentationLayer.cube;
  }

  getPosString(pos: Vector3) {
    return V3.floor(pos).join(",");
  }

  getZoomShortcut() {
    return (
      <span key="zoom" style={defaultShortcutStyle}>
        <span
          key="zoom-i"
          className="keyboard-key-icon-small"
          style={{ borderColor: lineColor, marginTop: -1 }}
        >
          {/* Move text up to vertically center it in the border from keyboard-key-icon-small */}
          <span style={{ position: "relative", top: -2 }}>Alt</span>
        </span>{" "}
        +
        <img
          className="keyboard-mouse-icon"
          src="/assets/images/icon-statusbar-mouse-wheel.svg"
          alt="Mouse Wheel"
        />
        Zoom in/out
      </span>
    );
  }

  getRightClickShortcut() {
    const rightClickToLabel = {
      MOVE: this.props.isSkeletonAnnotation ? "Place Node" : null,
      BRUSH: "Erase",
      TRACE: "Erase",
      FILL_CELL: null,
      PICK_CELL: null,
    };
    const label = this.props.activeTool
      ? rightClickToLabel[this.props.activeTool]
      : rightClickToLabel[VolumeToolEnum.MOVE];
    return (
      label && (
        <span style={defaultShortcutStyle}>
          <img
            className="keyboard-mouse-icon"
            src="/assets/images/icon-statusbar-mouse-right.svg"
            alt="Mouse Left"
          />
          {label}
        </span>
      )
    );
  }

  getShortcuts() {
    const moreShortcutsLink = (
      <a
        target="_blank"
        href="https://docs.webknossos.org/reference/keyboard_shortcuts"
        rel="noopener noreferrer"
        style={{ marginLeft: 10 }}
      >
        <Tooltip title="More Shortcuts">
          <MoreOutlined rotate={90} style={{ height: 14, color: lineColor }} />
        </Tooltip>
      </a>
    );
    if (!this.props.isPlaneMode) {
      return (
        <React.Fragment>
          <span
            style={{
              marginLeft: "auto",
              textTransform: "capitalize",
            }}
          >
            <img
              className="keyboard-mouse-icon"
              src="/assets/images/icon-statusbar-mouse-left-drag.svg"
              alt="Mouse Left Drag"
            />
            Move
          </span>
          <span key="zoom" style={defaultShortcutStyle}>
            <span
              key="zoom-i"
              className="keyboard-key-icon-small"
              style={{ borderColor: lineColor, marginTop: -1 }}
            >
              {/* Move text up to vertically center it in the border from keyboard-key-icon-small */}
              <span style={{ position: "relative", top: -2 }}>Space</span>
            </span>{" "}
            Trace forward
          </span>
          {moreShortcutsLink}
        </React.Fragment>
      );
    }

    return (
      <React.Fragment>
        <span
          style={{
            marginLeft: "auto",
            textTransform: "capitalize",
          }}
        >
          <img
            className="keyboard-mouse-icon"
            src={
              this.props.activeTool === VolumeToolEnum.PICK_CELL ||
              this.props.activeTool === VolumeToolEnum.FILL_CELL
                ? "/assets/images/icon-statusbar-mouse-left.svg"
                : "/assets/images/icon-statusbar-mouse-left-drag.svg"
            }
            alt="Mouse Left Drag"
          />
          {this.props.activeTool ? this.props.activeTool.replace("_", " ").toLowerCase() : "Move"}
        </span>
        {this.getRightClickShortcut()}
        <span style={defaultShortcutStyle}>
          <img
            className="keyboard-mouse-icon"
            src="/assets/images/icon-statusbar-mouse-wheel.svg"
            alt="Mouse Wheel"
          />
          Move along 3rd axis
        </span>
        <span style={defaultShortcutStyle}>
          <img
            className="keyboard-mouse-icon"
            src="/assets/images/icon-statusbar-mouse-right-drag.svg"
            alt="Mouse Right"
          />
          Rotate 3D View
        </span>
        {this.getZoomShortcut()}
        {moreShortcutsLink}
      </React.Fragment>
    );
  }

  getCellInfo(globalMousePosition: ?Vector3) {
    if (!hasSegmentation()) return null;
    const segmentationLayerName = Model.getSegmentationLayer().name;
    const cube = this.getSegmentationCube();
    const renderedZoomStepForMousePosition = api.data.getRenderedZoomStepAtPosition(
      segmentationLayerName,
      globalMousePosition,
    );
    const getIdForPos = (pos, usableZoomStep) => {
      const id = cube.getDataValue(pos, null, usableZoomStep);
      return cube.mapId(id);
    };
    const getSegmentIdString = () => {
      if (!globalMousePosition) return "-";
      const id = getIdForPos(globalMousePosition, renderedZoomStepForMousePosition);
      return cube.isMappingEnabled() ? `${id} (mapped)` : id;
    };

    return (
      <span className="info-element" style={{ minWidth: 140 }}>
        Segment {getSegmentIdString()}
      </span>
    );
  }

  getInfos() {
    const {
      activeViewport,
      mousePosition,
      activeResolution,
      isSkeletonAnnotation,
      isVolumeAnnotation,
      activeCellId,
      activeNodeId,
      activeTreeId,
    } = this.props;
    let globalMousePosition;
    if (mousePosition && activeViewport !== OrthoViews.TDView) {
      const [x, y] = mousePosition;
      globalMousePosition = calculateGlobalPos({ x, y });
    }

    return (
      <Space size={spaceBetweenItems} style={{ display: "flex", flexWrap: "wrap" }}>
        <span>
          <img
            src="/assets/images/icon-statusbar-downsampling.svg"
            style={{ height: 14, marginTop: -2 }}
            alt="Resolution"
          />{" "}
          {activeResolution.join("-")}{" "}
        </span>
        {this.props.isPlaneMode ? (
          <span className="info-element" style={{ minWidth: 140 }}>
            Pos [{globalMousePosition ? this.getPosString(globalMousePosition) : "-,-,-"}]
          </span>
        ) : null}
        {this.props.isPlaneMode ? this.getCellInfo(globalMousePosition) : null}
        {isSkeletonAnnotation ? (
          <span className="info-element" style={{ minWidth: 120 }}>
            <NumberInputPopoverSetting
              value={activeCellId}
              label="Active Cell"
              detailedLabel="Change Active Cell ID"
              onChange={this.props.onChangeActiveCellId}
            />
          </span>
        ) : null}
        {isVolumeAnnotation ? (
          <span className="info-element" style={{ minWidth: 120 }}>
            <NumberInputPopoverSetting
              value={activeNodeId}
              label="Active Node"
              detailedLabel="Change Active Node ID"
              onChange={this.props.onChangeActiveNodeId}
            />
          </span>
        ) : null}
        {isSkeletonAnnotation ? (
          <span className="info-element" style={{ minWidth: 120 }}>
            <NumberInputPopoverSetting
              value={activeTreeId}
              label="Active Tree"
              detailedLabel="Change Active Tree ID"
              onChange={this.props.onChangeActiveTreeId}
            />
          </span>
        ) : null}
      </Space>
    );
  }

  render() {
    return (
      <span className="statusbar">
        {this.getInfos()}
        {this.getShortcuts()}
      </span>
    );
  }
}

const mapStateToProps = (state: OxalisState): StateProps => ({
  activeResolution: getCurrentResolution(state),
  mousePosition: state.temporaryConfiguration.mousePosition,
  activeViewport: state.viewModeData.plane.activeViewport,
  isSkeletonAnnotation: state.tracing.skeleton != null,
  isVolumeAnnotation: state.tracing.volume != null,
  activeTool: state.tracing.volume ? state.tracing.volume.activeTool : null,
  activeCellId: state.tracing.volume ? state.tracing.volume.activeCellId : null,
  activeNodeId: state.tracing.skeleton ? state.tracing.skeleton.activeNodeId : null,
  activeTreeId: state.tracing.skeleton ? state.tracing.skeleton.activeTreeId : null,
  isPlaneMode: isPlaneMode(state),
});

const mapDispatchToProps = (dispatch: Dispatch<*>) => ({
  onChangeActiveNodeId(id: number) {
    dispatch(setActiveNodeAction(id));
  },
  onChangeActiveTreeId(id: number) {
    dispatch(setActiveTreeAction(id));
  },
  onChangeActiveCellId(id: number) {
    dispatch(setActiveCellAction(id));
  },
});

export default connect<Props, OwnProps, _, _, _, _>(
  mapStateToProps,
  mapDispatchToProps,
)(Statusbar);
