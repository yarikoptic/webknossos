import { Button, Modal } from "antd";
import * as React from "react";
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import Markdown from "react-remarkable";
type Props = {
  description: string;
  destroy: () => void;
  title: string;
};
type State = {
  mayClose: boolean;
  isOpen: boolean;
};
export default class NewTaskDescriptionModal extends React.Component<Props, State> {
  timeoutId: ReturnType<typeof setTimeout> | undefined;
  state: State = {
    mayClose: false,
    isOpen: true,
  };

  componentDidMount() {
    this.timeoutId = setTimeout(
      () => {
        this.allowClose();
      },
      process.env.NODE_ENV === "production" ? 10000 : 2000,
    );
  }

  componentWillUnmount() {
    if (this.timeoutId != null) {
      clearTimeout(this.timeoutId);
    }
  }

  allowClose() {
    this.setState({
      mayClose: true,
    });
  }

  handleOk = () => {
    if (!this.state.mayClose) {
      return;
    }

    this.setState({
      isOpen: false,
    });
    this.props.destroy();
  };

  render() {
    return (
      <Modal
        maskClosable={false}
        open={this.state.isOpen}
        title={this.props.title}
        onOk={this.handleOk}
        onCancel={this.handleOk}
        footer={[
          <Button
            key="submit"
            type="primary"
            loading={!this.state.mayClose}
            onClick={this.handleOk}
            disabled={!this.state.mayClose}
          >
            Ok
          </Button>,
        ]}
      >
        <Markdown
          source={this.props.description}
          options={{
            html: false,
            breaks: true,
            linkify: true,
          }}
        />
      </Modal>
    );
  }
}
