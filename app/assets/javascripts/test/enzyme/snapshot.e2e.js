// @flow
/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */
/* eslint-disable import/first */

// This needs to be the very first import
import {
  createSnapshotable,
  debugWrapper,
  waitForAllRequests,
  resetDatabase,
  tokenUserA,
  setCurrToken,
} from "./e2e-setup";
import _ from "lodash";
import { mount } from "enzyme";
import test from "ava";
import mockRequire from "mock-require";
import React from "react";
import { Provider } from "react-redux";
import { Router } from "react-router-dom";
import createBrowserHistory from "history/createBrowserHistory";
import { ControlModeEnum } from "oxalis/constants";
import { APITracingTypeEnum } from "admin/api_flow_types";
import Utils from "libs/utils";

// Those wrappers interfere with global.window and global.document otherwise
mockRequire("libs/hammerjs_wrapper", {});
mockRequire("libs/keyboardjs_wrapper", {});
mockRequire("libs/window", global.window);

// The following components cannot be rendered by enzyme. Let's mock them
mockRequire("antd/lib/upload", () => <div />);

// ErrorHandling is not initialized and is not needed
const ErrorHandling = {
  assertExtendContext: _.noop,
  assertExists: _.noop,
  assert: _.noop,
};
mockRequire("libs/error_handling", ErrorHandling);

// Antd makes use of fancy effects, which is why the rendering output is not reliable.
// Mock these components to avoid this issue.
mockRequire("antd/lib/spin", props => <div className="mock-spinner">{props.children}</div>);
const MockButton = props => (
  <div className="mock-button" {...props}>
    {props.children}
  </div>
);
const MockButtonGroup = props => (
  <div className="mock-button-group" {...props}>
    {props.children}
  </div>
);
MockButton.Group = MockButtonGroup;
mockRequire("antd/lib/button", MockButton);

const ProjectListView = mockRequire.reRequire("../../admin/project/project_list_view").default;
const Dashboard = mockRequire.reRequire("../../dashboard/dashboard_view").default;
const UserListView = mockRequire.reRequire("../../admin/user/user_list_view").default;
const Store = mockRequire.reRequire("../../oxalis/throttled_store").default;
const { setActiveUserAction } = mockRequire.reRequire("../../oxalis/model/actions/user_actions");
const api = mockRequire.reRequire("../../admin/admin_rest_api");
// Cannot be rendered for some reason
const TracingLayoutView = mockRequire.reRequire("../../oxalis/view/tracing_layout_view").default;

const browserHistory = createBrowserHistory();

test.before(() => {
  resetDatabase();
});

test.beforeEach(async __ => {
  // There needs to be an active user in the store for the pages to render correctly
  const user = await api.getActiveUser();
  console.log("USER", user);
  Store.dispatch(setActiveUserAction(user));
  setCurrToken(tokenUserA);
});

// test("Dashboard", async t => {
//   const dashboard = mount(
//     <Provider store={Store}>
//       <Router history={browserHistory}>
//         <Dashboard userId={null} isAdminView={false} />
//       </Router>
//     </Provider>,
//   );
//   await waitForAllRequests(dashboard);

//   t.is(dashboard.find(".TestDatasetHeadline").length, 1);
//   debugWrapper(dashboard, "Dashboard-1");
//   t.snapshot(createSnapshotable(dashboard), { id: "Dashboard-Datasets" });

//   dashboard
//     .find(".ant-tabs-tab")
//     .at(1)
//     .simulate("click");
//   await waitForAllRequests(dashboard);

//   t.is(dashboard.find(".TestAdvancedDatasetView").length, 1);
//   debugWrapper(dashboard, "Dashboard-2");
//   t.snapshot(createSnapshotable(dashboard), { id: "Dashboard-Datasets-Advanced" });

//   // Active tasks tab
//   dashboard
//     .find(".ant-tabs-tab")
//     .at(2)
//     .simulate("click");
//   await waitForAllRequests(dashboard);

//   t.is(dashboard.find(".TestTasksHeadline").length, 1);
//   debugWrapper(dashboard, "Dashboard-3");
//   t.snapshot(createSnapshotable(dashboard), { id: "Dashboard-Tasks" });

//   // Active explorative annotations tab
//   dashboard
//     .find(".ant-tabs-tab")
//     .at(3)
//     .simulate("click");
//   await waitForAllRequests(dashboard);

//   t.is(dashboard.find(".TestExplorativeAnnotationsView").length, 1);
//   debugWrapper(dashboard, "Dashboard-4");
//   t.snapshot(createSnapshotable(dashboard), { id: "Dashboard-Explorative-Annotations" });
// });

// test("Users", async t => {
//   const userListView = mount(
//     <Provider store={Store}>
//       <Router history={browserHistory}>
//         <UserListView />
//       </Router>
//     </Provider>,
//   );
//   await waitForAllRequests(userListView);

//   debugWrapper(userListView, "UserListView");
//   t.snapshot(createSnapshotable(userListView), { id: "UserListView" });
// });

// test("Projects", async t => {
//   const projectListView = mount(
//     <Provider store={Store}>
//       <Router history={browserHistory}>
//         <ProjectListView />
//       </Router>
//     </Provider>,
//   );
//   await waitForAllRequests(projectListView);
//   t.is(projectListView.find(".TestProjectListView").length, 1);

//   debugWrapper(projectListView, "ProjectListView");
//   t.snapshot(createSnapshotable(projectListView), { id: "ProjectListView" });
// });

test("Tracing View", async t => {
  process.on("unhandledRejection", (err, promise) => {
    console.error("###### Unhandled rejection (promise: ", promise, ", reason: ", err, ").");
  });
  const annotationId = "570b9ff12a7c0e980056fe8f";
  const tracingView = mount(
    <Provider store={Store}>
      <Router history={browserHistory}>
        <TracingLayoutView
          initialTracingType={APITracingTypeEnum.Explorational}
          initialAnnotationId={annotationId}
          initialControlmode={ControlModeEnum.TRACE}
        />
      </Router>
    </Provider>,
  );
  await waitForAllRequests(tracingView);
  await api.triggerDatasetCheck("http://localhost:9000");
  console.log(await api.getActiveDatasets());
  t.is(tracingView.find(".TestTracingView").length, 1);
  debugWrapper(tracingView, "TracingView");
  t.snapshot(createSnapshotable(tracingView), { id: "TracingView" });
});
