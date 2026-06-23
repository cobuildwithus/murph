import assert from "node:assert/strict";

import {
  act,
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

  test("shows connection failed status when runtime signaling fails after a connect attempt", async () => {
    const [
      { HostedOnboardingApiError },
      { HostedChatGptSettings },
    ] = await Promise.all([
      import("@/src/components/hosted-onboarding/client-api"),
      import("@/src/components/settings/hosted-chatgpt-settings"),
    ]);
    mocks.requestHostedOnboardingJson.mockRejectedValueOnce(new HostedOnboardingApiError({
      code: "HOSTED_CODEX_AUTH_RUNTIME_UNAVAILABLE",
      message: "Could not start ChatGPT connection right now.",
      retryable: true,
    }));
    const rendered = await renderClientComponent(createElement(HostedChatGptSettings, {
      initialConnection: { state: "disconnected" },
    }));
    const close = vi.fn();
    rendered.open.mockReturnValueOnce({
      close,
      document: {
        body: {},
      },
    } as unknown as Window);

    await act(async () => {
      rendered.button.dispatchEvent(new rendered.window.Event("click", {
        bubbles: true,
      }));
    });

    assert.deepEqual(mocks.requestHostedOnboardingJson.mock.calls[0]?.[0], {
      method: "POST",
      payload: {},
      url: "/api/settings/chatgpt",
    });
    assert.equal(close.mock.calls.length, 1);
    const text = rendered.window.document.body.textContent ?? "";
    assert.match(text, /Connection failed/);
    assert.match(text, /Could not start ChatGPT connection right now\./);
    assert.match(text, /Connect ChatGPT/);
    assert.doesNotMatch(text, /Connected/);

    await rendered.cleanup();
  });

  test("shows disconnect failed status when runtime signaling fails after a disconnect attempt", async () => {
    const [
      { HostedOnboardingApiError },
      { HostedChatGptSettings },
    ] = await Promise.all([
      import("@/src/components/hosted-onboarding/client-api"),
      import("@/src/components/settings/hosted-chatgpt-settings"),
    ]);
    mocks.requestHostedOnboardingJson.mockRejectedValueOnce(new HostedOnboardingApiError({
      code: "HOSTED_CODEX_AUTH_RUNTIME_UNAVAILABLE",
      message: "Could not disconnect ChatGPT right now.",
      retryable: true,
    }));
    const rendered = await renderClientComponent(createElement(HostedChatGptSettings, {
      initialConnection: { state: "connected" },
    }));

    await act(async () => {
      rendered.button.dispatchEvent(new rendered.window.Event("click", {
        bubbles: true,
      }));
    });

    assert.deepEqual(mocks.requestHostedOnboardingJson.mock.calls[0]?.[0], {
      method: "DELETE",
      payload: {},
      url: "/api/settings/chatgpt",
    });
    const text = rendered.window.document.body.textContent ?? "";
    assert.match(text, /Disconnect failed/);
    assert.match(text, /Could not disconnect ChatGPT right now\./);
    assert.match(text, /Disconnect/);
    assert.doesNotMatch(text, /Connected/);

    await rendered.cleanup();
  });
});
