// @flow

import * as React from "react";

import { ArbitraryViewport, allViewports, type Rect, type Viewport } from "oxalis/constants";
import { setInputCatcherRects } from "oxalis/model/actions/view_mode_actions";
import Scalebar from "oxalis/view/scalebar";
import ViewportStatusIndicator from "oxalis/view/viewport_status_indicator";
import Store from "oxalis/store";
import makeRectRelativeToCanvas from "oxalis/view/layouting/layout_canvas_adapter";

type Props = {
  viewportID: Viewport,
  children?: React.Node,
  displayScalebars?: boolean,
};

const getEmptyRect = () => ({ top: 0, left: 0, width: 0, height: 0 });

function ignoreContextMenu(event: SyntheticInputEvent<>) {
  // hide contextmenu, while rightclicking a canvas
  event.preventDefault();
}

// Is able to make the input catcher a square (if makeQuadratic is true)
// and returns its position within the document relative to the rendering canvas
function adaptInputCatcher(inputCatcherDOM: HTMLElement, makeQuadratic: boolean): Rect {
  const noneOverflowWrapper = inputCatcherDOM.closest(".flexlayout-dont-overflow");
  if (!noneOverflowWrapper) {
    return getEmptyRect();
  }
  if (makeQuadratic) {
    const getQuadraticExtent = () => {
      let { width, height } = noneOverflowWrapper.getBoundingClientRect();
      // These values should be floored, so that the rendered area does not overlap
      // with the containers.
      width = Math.floor(width);
      height = Math.floor(height);
      const extent = Math.min(width, height);
      return [extent, extent];
    };
    const [width, height] = getQuadraticExtent();
    inputCatcherDOM.style.width = `${width}px`;
    inputCatcherDOM.style.height = `${height}px`;
  }
  return makeRectRelativeToCanvas(inputCatcherDOM.getBoundingClientRect());
}

const renderedInputCatchers = new Map();
const notRenderedInputCatchers = new Set(allViewports);

// TODO: Look why the tests fail
export function recalculateInputCatcherSizes() {
  const viewportRects = {};
  for (const [viewportID, inputCatcher] of renderedInputCatchers.entries()) {
    const makeQuadratic = viewportID === ArbitraryViewport;
    const rect = adaptInputCatcher(inputCatcher, makeQuadratic);
    viewportRects[viewportID] = rect;
  }
  for (const viewportID of notRenderedInputCatchers) {
    viewportRects[viewportID] = getEmptyRect();
  }
  Store.dispatch(setInputCatcherRects(viewportRects));
}

class InputCatcher extends React.PureComponent<Props, {}> {
  domElement: ?HTMLElement;

  componentDidMount() {
    if (this.domElement) {
      renderedInputCatchers.set(this.props.viewportID, this.domElement);
      notRenderedInputCatchers.delete(this.props.viewportID);
    }
  }

  componentWillUnmount() {
    if (this.domElement) {
      renderedInputCatchers.delete(this.props.viewportID);
      notRenderedInputCatchers.add(this.props.viewportID);
    }
  }

  render() {
    const { viewportID } = this.props;

    return (
      <div className="flexlayout-dont-overflow">
        <div
          id={`inputcatcher_${viewportID}`}
          ref={domElement => {
            this.domElement = domElement;
          }}
          onContextMenu={ignoreContextMenu}
          data-value={viewportID}
          className={`inputcatcher ${viewportID}`}
          style={{ position: "relative" }}
        >
          <ViewportStatusIndicator />
          {this.props.displayScalebars && viewportID !== "arbitraryViewport" ? (
            <Scalebar viewportID={viewportID} />
          ) : null}
          {this.props.children}
        </div>
      </div>
    );
  }
}

export default InputCatcher;
