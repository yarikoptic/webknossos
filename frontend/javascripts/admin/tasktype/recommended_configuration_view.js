// @flow
import { Checkbox, Col, Collapse, Form, Input, Row, Table, Button } from "antd";
import { FormInstance } from "antd/lib/form";
import * as React from "react";
import _ from "lodash";

import type { DatasetConfiguration, UserConfiguration } from "oxalis/store";
import { jsonEditStyle } from "dashboard/dataset/helper_components";
import { jsonStringify } from "libs/utils";
import { settings } from "messages";
import { validateUserSettingsJSON } from "types/validation";
import { TDViewDisplayModeEnum } from "oxalis/constants";

const FormItem = Form.Item;
const { Panel } = Collapse;

const recommendedConfigByCategory = {
  orthogonal: {
    clippingDistance: 80,
    moveValue: 500,
    displayScalebars: false,
    newNodeNewTree: false,
    centerNewNode: true,
    tdViewDisplayPlanes: TDViewDisplayModeEnum.WIREFRAME,
    tdViewDisplayDatasetBorders: true,
  },
  all: {
    dynamicSpaceDirection: true,
    highlightCommentedNodes: false,
    overrideNodeRadius: true,
    particleSize: 5,
    keyboardDelay: 0,
    displayCrosshair: true,
  },
  dataset: {
    fourBit: false,
    interpolation: true,
    segmentationOpacity: 0,
    highlightHoveredCellId: false,
    segmentationPatternOpacity: 40,
    zoom: 0.8,
    renderMissingDataBlack: false,
    loadingStrategy: "BEST_QUALITY_FIRST",
  },
  flight: {
    clippingDistanceArbitrary: 60,
    moveValue3d: 600,
    mouseRotateValue: 0.001,
    rotateValue: 0.01,
    sphericalCapRadius: 500,
  },
  volume: {
    brushSize: 50,
  },
};

export const DEFAULT_RECOMMENDED_CONFIGURATION: $Shape<{|
  ...UserConfiguration,
  ...DatasetConfiguration,
  segmentationOpacity: number,
|}> = {
  ...recommendedConfigByCategory.orthogonal,
  ...recommendedConfigByCategory.all,
  ...recommendedConfigByCategory.dataset,
  ...recommendedConfigByCategory.flight,
  ...recommendedConfigByCategory.volume,
};

export const settingComments = {
  clippingDistance: "orthogonal mode",
  moveValue: "orthogonal mode",
  clippingDistanceArbitrary: "flight/oblique mode",
  moveValue3d: "flight/oblique mode",
  loadingStrategy: "BEST_QUALITY_FIRST or PROGRESSIVE_QUALITY",
  tdViewDisplayPlanes: Object.values(TDViewDisplayModeEnum).join(" or "),
};

const columns = [
  {
    title: "Display Name",
    dataIndex: "name",
  },
  {
    title: "Key",
    dataIndex: "key",
  },
  {
    title: "Default Value",
    dataIndex: "value",
  },
  {
    title: "Comment",
    dataIndex: "comment",
  },
];

const removeSettings = (form, settingsKey: string) => {
  const settingsString = form.getFieldValue("recommendedConfiguration");
  try {
    const settingsObject = JSON.parse(settingsString);
    const newSettings = _.omit(
      settingsObject,
      Object.keys(recommendedConfigByCategory[settingsKey]),
    );
    form.setFieldsValue({ recommendedConfiguration: jsonStringify(newSettings) });
  } catch (e) {
    console.error(e);
  }
};

export default function RecommendedConfigurationView({
  form,
  enabled,
  onChangeEnabled,
}: {
  form: typeof FormInstance,
  enabled: boolean,
  onChangeEnabled: boolean => void,
}) {
  return (
    <Collapse
      onChange={openedPanels => onChangeEnabled(openedPanels.length === 1)}
      activeKey={enabled ? "config" : null}
    >
      <Panel
        key="config"
        header={
          <React.Fragment>
            <Checkbox checked={enabled} style={{ marginRight: 10 }} /> Add Recommended User Settings
          </React.Fragment>
        }
        showArrow={false}
      >
        <Row gutter={32}>
          <Col span={12}>
            <div>
              The recommended configuration will be displayed to users when starting to trace a task
              with this task type. The user is able to accept or decline this recommendation.
              <br />
              <br />
              <FormItem
                name="recommendedConfiguration"
                hasFeedback
                rules={[
                  {
                    validator: (rule, value) =>
                      enabled ? validateUserSettingsJSON(rule, value) : Promise.resolve(),
                  },
                ]}
              >
                <Input.TextArea
                  spellCheck={false}
                  autoSize={{ minRows: 20 }}
                  style={jsonEditStyle}
                />
              </FormItem>
            </div>
            <Button className="button-margin" onClick={() => removeSettings(form, "orthogonal")}>
              Remove Orthogonal-only Settings
            </Button>
            <Button className="button-margin" onClick={() => removeSettings(form, "flight")}>
              Remove Flight/Oblique-only Settings
            </Button>
            <Button className="button-margin" onClick={() => removeSettings(form, "volume")}>
              Remove Volume-only Settings
            </Button>
          </Col>
          <Col span={12}>
            Valid settings and their default values: <br />
            <br />
            <Table
              columns={columns}
              dataSource={_.map(DEFAULT_RECOMMENDED_CONFIGURATION, (value, key) => ({
                name: settings[key],
                key,
                value: value.toString(),
                comment: settingComments[key] || "",
              }))}
              size="small"
              pagination={false}
              className="large-table"
              scroll={{ x: "max-content" }}
            />
          </Col>
        </Row>
      </Panel>
    </Collapse>
  );
}
