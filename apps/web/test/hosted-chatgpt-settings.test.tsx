import assert from "node:assert/strict";

import {
  createElement,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { beforeEach, describe, test, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => ({
  requestHostedOnboardingJson: vi.fn(),
}));

vi.mock("@/src/components/hosted-onboarding/client-api", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/src/components/hosted-onboarding/client-api")>();
  return {
    ...actual,
    requestHostedOnboardingJson: mocks.requestHostedOnboardingJson,
  };
});

vi.mock("@/src/components/ui/button", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  type TestButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
    children?: ReactNode;
    size?: string;
    variant?: string;
  };
  return {
    Button(props: TestButtonProps) {
      const {
        children,
        size,
        variant,
        ...buttonProps
      } = props;
      void size;
      void variant;
      return React.createElement("button", buttonProps, children);
    },
  };
});

describe("HostedChatGptSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("shows connection failed status", async () => {
    const { HostedChatGptSettings } =
      await import("@/src/components/settings/hosted-chatgpt-settings");
    const rendered = await renderClientComponent(createElement(HostedChatGptSettings, {
      initialConnection: { state: "connect_error" },
    }));

    const text = rendered.window.document.body.textContent ?? "";
    assert.match(text, /Connection failed/);
    assert.match(text, /Could not finish ChatGPT sign in\. Try connecting again\./);
    assert.match(text, /Connect ChatGPT/);
    assert.doesNotMatch(text, /Connected/);

    await rendered.cleanup();
  });

  test("shows disconnect failed status", async () => {
    const { HostedChatGptSettings } =
      await import("@/src/components/settings/hosted-chatgpt-settings");
    const rendered = await renderClientComponent(createElement(HostedChatGptSettings, {
      initialConnection: { state: "disconnect_error" },
    }));
    const text = rendered.window.document.body.textContent ?? "";
    assert.match(text, /Disconnect failed/);
    assert.match(text, /Could not disconnect ChatGPT\. Try disconnecting again\./);
    assert.match(text, /Disconnect/);
    assert.doesNotMatch(text, /Connected/);

    await rendered.cleanup();
  });
});
