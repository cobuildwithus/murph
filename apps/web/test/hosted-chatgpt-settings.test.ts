import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => ({
  requestHostedOnboardingJson: vi.fn(),
}));

vi.mock("@/src/components/hosted-onboarding/client-api", () => ({
  HostedOnboardingApiError: class HostedOnboardingApiError extends Error {},
  requestHostedOnboardingJson: mocks.requestHostedOnboardingJson,
}));

let cleanupRender: (() => Promise<void>) | null = null;

describe("HostedChatGptSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  afterEach(async () => {
    if (cleanupRender) {
      await cleanupRender();
      cleanupRender = null;
    }
    vi.useRealTimers();
  });

  it("renders the disconnected state and starts a connect attempt", async () => {
    const { HostedChatGptSettings } =
      await import("@/src/components/settings/hosted-chatgpt-settings");
    mocks.requestHostedOnboardingJson.mockResolvedValueOnce({
      state: "connecting",
      userCode: null,
      verificationUrl: null,
    });

    const rendered = await renderClientComponent(
      createElement(HostedChatGptSettings, {
        authenticated: true,
        initialConnection: {
          state: "disconnected",
        },
      }),
    );
    cleanupRender = rendered.cleanup;

    expect(rendered.container.textContent).toContain("ChatGPT");
    expect(rendered.container.textContent).toContain("Not connected");
    expect(rendered.button.textContent).toBe("Connect");

    await act(async () => {
      rendered.button.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
    });

    expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith({
      method: "POST",
      payload: {},
      url: "/api/settings/chatgpt",
    });
    expect(rendered.container.textContent).toContain("Starting connection");
    expect(rendered.container.textContent).toContain("Waiting for a verification code.");
    expect(rendered.container.querySelector("button")?.getAttribute("aria-label")).toBe(
      "Refresh ChatGPT connection",
    );
  });

  it("renders a device-code connection link and polls until connected", async () => {
    vi.useFakeTimers();
    const { HostedChatGptSettings } =
      await import("@/src/components/settings/hosted-chatgpt-settings");
    mocks.requestHostedOnboardingJson.mockResolvedValueOnce({
      state: "connected",
    });

    const rendered = await renderClientComponent(
      createElement(HostedChatGptSettings, {
        authenticated: true,
        initialConnection: {
          state: "connecting",
          userCode: "ABCD-EFGH",
          verificationUrl: "https://auth.openai.com/device",
        },
      }),
    );
    cleanupRender = rendered.cleanup;

    expect(rendered.container.textContent).toContain("Code ABCD-EFGH");
    expect(rendered.container.textContent).toContain("Waiting for ChatGPT confirmation.");
    expect(rendered.container.querySelector("a")?.getAttribute("href")).toBe(
      "https://auth.openai.com/device",
    );
    expect(rendered.container.querySelector("a")?.textContent).toContain("Open ChatGPT");
    expect(rendered.container.querySelector("a")?.getAttribute("aria-label")).toBe(
      "Open ChatGPT verification page",
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith({
      url: "/api/settings/chatgpt",
    });
    expect(rendered.container.textContent).toContain("Connected");
  });

  it("retries disconnect from the disconnect error state", async () => {
    const { HostedChatGptSettings } =
      await import("@/src/components/settings/hosted-chatgpt-settings");
    mocks.requestHostedOnboardingJson.mockResolvedValueOnce({
      state: "disconnecting",
    });

    const rendered = await renderClientComponent(
      createElement(HostedChatGptSettings, {
        authenticated: true,
        initialConnection: {
          state: "disconnect_error",
        },
      }),
    );
    cleanupRender = rendered.cleanup;

    expect(rendered.button.textContent).toBe("Disconnect");

    await act(async () => {
      rendered.button.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
    });

    expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith({
      method: "DELETE",
      payload: {},
      url: "/api/settings/chatgpt",
    });
    expect(rendered.container.textContent).toContain("Disconnecting");
  });
});
