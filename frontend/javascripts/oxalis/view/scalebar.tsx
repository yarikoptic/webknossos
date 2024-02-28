import { Tooltip } from "antd";
import { formatNumberToLength } from "libs/format_utils";
import type { OrthoView } from "oxalis/constants";
import constants, { Unicode, OrthoViews } from "oxalis/constants";
import { getZoomValue } from "oxalis/model/accessors/flycam_accessor";
import { getTDViewZoom, getViewportExtents } from "oxalis/model/accessors/view_mode_accessor";
import type { OxalisState } from "oxalis/store";
import { convertPixelsToNm } from "oxalis/view/right-border-tabs/dataset_info_tab_view";
import * as React from "react";
import { connect } from "react-redux";
import type { APIDataset } from "types/api_flow_types";
const { ThinSpace, MultiplicationSymbol } = Unicode;
type OwnProps = {
  viewportID: OrthoView;
};
type StateProps = {
  dataset: APIDataset;
  zoomValue: number;
  viewportWidthInPixels: number;
  viewportHeightInPixels: number;
};
type Props = OwnProps & StateProps;

const getBestScalebarAnchorInNm = (lengthInNm: number): number => {
  const closestExponent = Math.floor(Math.log10(lengthInNm));
  const closestPowerOfTen = 10 ** closestExponent;
  const mantissa = lengthInNm / closestPowerOfTen;
  let bestAnchor = 1;

  for (const anchor of [2, 5, 10]) {
    if (Math.abs(anchor - mantissa) < Math.abs(bestAnchor - mantissa)) {
      bestAnchor = anchor;
    }
  }

  return bestAnchor * closestPowerOfTen;
};

// This factor describes how wide the scalebar would ideally be.
// However, this is only a rough guideline, as the actual width is changed
// so that round length values are represented.
const idealScalebarWidthFactor = 0.3;
const maxScaleBarWidthFactor = 0.45;
const minWidthToFillScalebar = 130;

function Scalebar({ zoomValue, dataset, viewportWidthInPixels, viewportHeightInPixels }: Props) {
  const viewportWidthInNm = convertPixelsToNm(viewportWidthInPixels, zoomValue, dataset);
  const viewportHeightInNm = convertPixelsToNm(viewportHeightInPixels, zoomValue, dataset);
  const idealWidthInNm = viewportWidthInNm * idealScalebarWidthFactor;
  const scalebarWidthInNm = getBestScalebarAnchorInNm(idealWidthInNm);
  const scaleBarWidthFactor = Math.min(
    scalebarWidthInNm / viewportWidthInNm,
    maxScaleBarWidthFactor,
  );
  const tooltip = [
    formatNumberToLength(viewportWidthInNm),
    ThinSpace,
    MultiplicationSymbol,
    ThinSpace,
    formatNumberToLength(viewportHeightInNm),
  ].join("");
  const collapseScalebar = viewportWidthInPixels < minWidthToFillScalebar;
  const limitScalebar = scaleBarWidthFactor === maxScaleBarWidthFactor;
  const padding = 4;
  return (
    <Tooltip
      title={
        <div>
          <div>Viewport Size:</div>
          <div>{tooltip}</div>
        </div>
      }
    >
      <div
        style={{
          position: "absolute",
          bottom: constants.SCALEBAR_OFFSET,
          right: constants.SCALEBAR_OFFSET,
          width: collapseScalebar ? 16 : `${scaleBarWidthFactor * 100}%`,
          height: constants.SCALEBAR_HEIGHT - padding * 2,
          background: "rgba(0, 0, 0, .3)",
          color: "white",
          textAlign: "center",
          fontSize: 12,
          lineHeight: "14px",
          boxSizing: "content-box",
          padding,
        }}
        className="scalebar"
      >
        <div
          style={{
            borderBottom: "1px solid",
            borderLeft: limitScalebar ? "none" : "1px solid",
            borderRight: "1px solid",
          }}
        >
          {collapseScalebar ? "i" : formatNumberToLength(scalebarWidthInNm)}
        </div>
      </div>
    </Tooltip>
  );
}

const mapStateToProps = (state: OxalisState, ownProps: OwnProps): StateProps => {
  const [width, height] = getViewportExtents(state)[ownProps.viewportID];
  const zoomValue =
    ownProps.viewportID === OrthoViews.TDView ? getTDViewZoom(state) : getZoomValue(state.flycam);
  return {
    zoomValue,
    dataset: state.dataset,
    viewportWidthInPixels: width,
    viewportHeightInPixels: height,
  };
};

const connector = connect(mapStateToProps);
export default connector(Scalebar);
