// @flow

import { Input } from "antd";
import React, { type Element } from "react";

type Props = {
  icon: Element<*>,
  onChange: Function,
};

type State = {
  isEditing: boolean,
  value: string,
};

class EditableTextIcon extends React.PureComponent<Props, State> {
  state = {
    isEditing: false,
    value: "",
  };

  handleInputChange = (event: SyntheticInputEvent<>) => {
    this.setState({ value: event.target.value });
  };

  handleInputSubmit = (event: SyntheticInputEvent<>) => {
    const { value } = this.state;

    if (value !== "") {
      this.props.onChange(this.state.value, event);
    }
    this.setState({ isEditing: false, value: "" });
  };

  render() {
    const iconStyle = { cursor: "pointer" };
    if (this.state.isEditing) {
      return (
        <Input
          value={this.state.value}
          onChange={this.handleInputChange}
          onPressEnter={this.handleInputSubmit}
          onBlur={this.handleInputSubmit}
          style={{ width: 75 }}
          size="small"
          autoFocus
        />
      );
    } else {
      return React.cloneElement(this.props.icon, {
        style: iconStyle,
        onClick: () => this.setState({ isEditing: true }),
      });
    }
  }
}

export default EditableTextIcon;
