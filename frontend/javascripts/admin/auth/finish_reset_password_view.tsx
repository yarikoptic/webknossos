import React from "react";
import { RouteComponentProps, withRouter } from "react-router-dom";
import { Form, Input, Button, Col, Row } from "antd";
import { LockOutlined } from "@ant-design/icons";
import Request from "libs/request";
import messages from "messages";
import Toast from "libs/toast";
const FormItem = Form.Item;
const { Password } = Input;
type Props = {
  history: RouteComponentProps["history"];
  resetToken: string;
};

function FinishResetPasswordView(props: Props) {
  const [form] = Form.useForm();

  function onFinish(formValues: Record<string, any>) {
    const data = formValues;

    if (props.resetToken === "") {
      Toast.error(messages["auth.reset_token_not_supplied"]);
      return;
    }

    data.token = props.resetToken;
    Request.sendJSONReceiveJSON("/api/auth/resetPassword", {
      data,
    }).then(() => {
      Toast.success(messages["auth.reset_pw_confirmation"]);
      props.history.push("/auth/login");
    });
  }

  // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'value' implicitly has an 'any' type.
  function checkPasswordsAreMatching(value, otherPasswordFieldKey) {
    const otherFieldValue = form.getFieldValue(otherPasswordFieldKey);

    if (value && otherFieldValue) {
      if (value !== otherFieldValue) {
        return Promise.reject(new Error(messages["auth.registration_password_mismatch"]));
      } else if (form.getFieldError(otherPasswordFieldKey).length > 0) {
        // If the other password field still has errors, revalidate it.
        form.validateFields([otherPasswordFieldKey]);
      }
    }

    return Promise.resolve();
  }

  return (
    <Row
      // @ts-expect-error ts-migrate(2322) FIXME: Type '{ children: Element; type: string; justify: ... Remove this comment to see the full error message
      type="flex"
      justify="center"
      style={{
        padding: 50,
      }}
      align="middle"
    >
      <Col span={8}>
        <h3>Reset Password</h3>
        <Form onFinish={onFinish} form={form}>
          <FormItem
            hasFeedback
            name={["password", "password1"]}
            rules={[
              {
                required: true,
                message: messages["auth.reset_new_password"],
              },
              {
                min: 8,
                message: messages["auth.registration_password_length"],
              },
              {
                validator: (_, value) =>
                  checkPasswordsAreMatching(value, ["password", "password2"]),
              },
            ]}
          >
            <Password
              prefix={
                <LockOutlined
                  style={{
                    fontSize: 13,
                  }}
                />
              }
              placeholder="New Password"
            />
          </FormItem>
          <FormItem
            hasFeedback
            name={["password", "password2"]}
            rules={[
              {
                required: true,
                message: messages["auth.reset_new_password2"],
              },
              {
                min: 8,
                message: messages["auth.registration_password_length"],
              },
              {
                validator: (_, value) =>
                  checkPasswordsAreMatching(value, ["password", "password1"]),
              },
            ]}
          >
            <Password
              prefix={
                <LockOutlined
                  style={{
                    fontSize: 13,
                  }}
                />
              }
              placeholder="Confirm New Password"
            />
          </FormItem>
          <FormItem>
            <Button
              type="primary"
              htmlType="submit"
              style={{
                width: "100%",
              }}
            >
              Reset Password
            </Button>
          </FormItem>
        </Form>
      </Col>
    </Row>
  );
}

export default withRouter<RouteComponentProps & Props, any>(FinishResetPasswordView);
