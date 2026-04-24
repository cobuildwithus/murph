import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";

import { act } from "react";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  describeDeviceSyncCallbackError: vi.fn((provider: string, errorCode: string | null) =>
    `${provider}:${errorCode ?? "unknown"}`,
  ),
  formatHostedDeviceSyncProviderLabel: vi.fn((provider: string) => `provider:${provider}`),
  HostedDeviceSyncDisconnectDialog: vi.fn(() =>
    createElement("div", {
      "data-hosted-device-sync-disconnect-dialog": "true",
    }),
  ),
  HostedDeviceSyncSettingsContent: vi.fn(() =>
    createElement("div", {
      "data-hosted-device-sync-settings-content": "true",
    }),
  ),
  HostedDeviceSyncSettingsStatusCard: vi.fn((props: { description: string; title: string }) =>
    createElement(
      "div",
      {
        "data-hosted-device-sync-settings-status-card": "true",
        "data-description": props.description,
        "data-title": props.title,
      },
    )),
  HostedSettingsSessionState: vi.fn(() =>
    createElement("div", {
      "data-hosted-settings-session-state": "true",
    }),
  ),
  requestHostedOnboardingJson: vi.fn(),
  sourceKey: vi.fn(() => "source-key"),
  toErrorMessage: vi.fn((error: unknown, fallback: string) => fallback),
}));

vi.mock("@/src/components/hosted-onboarding/client-api", () => ({
  requestHostedOnboardingJson: mocks.requestHostedOnboardingJson,
}));

vi.mock("@/src/components/settings/hosted-device-sync-settings-sections", () => ({
  HostedDeviceSyncDisconnectDialog: mocks.HostedDeviceSyncDisconnectDialog,
  HostedDeviceSyncSettingsContent: mocks.HostedDeviceSyncSettingsContent,
  HostedDeviceSyncSettingsStatusCard: mocks.HostedDeviceSyncSettingsStatusCard,
}));

vi.mock("@/src/components/settings/hosted-device-sync-settings-utils", () => ({
  describeDeviceSyncCallbackError: mocks.describeDeviceSyncCallbackError,
  sourceKey: mocks.sourceKey,
}));

vi.mock("@/src/components/settings/hosted-settings-session-state", () => ({
  HostedSettingsSessionState: mocks.HostedSettingsSessionState,
}));

vi.mock("@/src/components/settings/hosted-settings-utils", () => ({
  formatHostedDeviceSyncProviderLabel: mocks.formatHostedDeviceSyncProviderLabel,
  toErrorMessage: mocks.toErrorMessage,
}));

import { HostedDeviceSyncSettingsClient } from "@/src/components/settings/hosted-device-sync-settings-client";

const requireFromHostedDeviceSyncSettingsClientTest = createRequire(import.meta.url);

let cleanupRender: (() => Promise<void> | void) | null = null;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(async () => {
  if (cleanupRender) {
    await cleanupRender();
    cleanupRender = null;
  }
});

test("HostedDeviceSyncSettingsClient clears shared callback params from the current URL", async () => {
  const { document, window } = loadLinkedom().parseHTML(
    "<html><body><div id='root'></div></body></html>",
  );
  installHostedDeviceSyncClientGlobals(window, document);
  mockWindowLocation(
    window,
    "https://app.example.test/settings?keep=1&deviceSyncStatus=error&deviceSyncProvider=oura&deviceSyncConnectionId=conn_123&deviceSyncAccountId=acct_123&deviceSyncError=OLD&deviceSyncErrorMessage=legacy",
  );
  const replaceState = vi.fn();
  Object.defineProperty(window, "history", {
    configurable: true,
    value: {
      replaceState,
    },
  });

  const container = document.getElementById("root");
  assert.ok(container);

  const root: Root = createRoot(container);
  cleanupRender = async () => {
    await act(async () => {
      root.unmount();
    });
  };

  await act(async () => {
    root.render(
      createElement(HostedDeviceSyncSettingsClient, {
        authenticated: false,
        initialLoadError: null,
        initialResponse: null,
      }),
    );
  });

  expect(replaceState).toHaveBeenCalledTimes(1);
  const replacementUrl = replaceState.mock.calls[0]?.[2];
  assert.equal(typeof replacementUrl, "string");

  const redirected = new URL(replacementUrl as string);
  expect(redirected.origin).toBe("https://app.example.test");
  expect(redirected.pathname).toBe("/settings");
  expect(redirected.searchParams.get("keep")).toBe("1");
  expect(redirected.searchParams.get("deviceSyncStatus")).toBeNull();
  expect(redirected.searchParams.get("deviceSyncProvider")).toBeNull();
  expect(redirected.searchParams.get("deviceSyncConnectionId")).toBeNull();
  expect(redirected.searchParams.get("deviceSyncAccountId")).toBeNull();
  expect(redirected.searchParams.get("deviceSyncError")).toBeNull();
  expect(redirected.searchParams.get("deviceSyncErrorMessage")).toBeNull();
});

test("HostedDeviceSyncSettingsClient renders an unavailable state instead of the empty state for blocked initial loads", async () => {
  const { document, window } = loadLinkedom().parseHTML(
    "<html><body><div id='root'></div></body></html>",
  );
  installHostedDeviceSyncClientGlobals(window, document);
  mockWindowLocation(window, "https://app.example.test/settings");

  const container = document.getElementById("root");
  assert.ok(container);

  const root: Root = createRoot(container);
  cleanupRender = async () => {
    await act(async () => {
      root.unmount();
    });
  };

  await act(async () => {
    root.render(
      createElement(HostedDeviceSyncSettingsClient, {
        authenticated: true,
        initialLoadError: {
          code: "HOSTED_ACCESS_REQUIRED",
          message: "Your subscription is canceled. Open billing to resume access.",
        },
        initialResponse: null,
      }),
    );
  });

  expect(mocks.HostedDeviceSyncSettingsStatusCard).toHaveBeenCalledWith(expect.objectContaining({
    description: "Your subscription is canceled. Open billing to resume access.",
    title: "Data sources unavailable",
  }), undefined);
  expect(mocks.HostedDeviceSyncSettingsContent).not.toHaveBeenCalled();
});

function loadLinkedom(): {
  parseHTML: (html: string) => { document: Document; window: Window & typeof globalThis };
} {
  const resolvePaths = [
    path.resolve(process.cwd(), "node_modules"),
    path.resolve(process.cwd(), "node_modules/.pnpm/node_modules"),
  ];

  for (const resolvePath of resolvePaths) {
    try {
      const resolvedEntry = requireFromHostedDeviceSyncSettingsClientTest.resolve("linkedom", {
        paths: [resolvePath],
      });
      return requireFromHostedDeviceSyncSettingsClientTest(resolvedEntry) as {
        parseHTML: (html: string) => { document: Document; window: Window & typeof globalThis };
      };
    } catch {
      // Try the next resolution root.
    }
  }

  throw new Error("Unable to resolve linkedom for hosted device sync settings client tests.");
}

function installHostedDeviceSyncClientGlobals(
  window: Window & typeof globalThis,
  document: Document,
) {
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", document);
  vi.stubGlobal("navigator", window.navigator);
  vi.stubGlobal("HTMLElement", window.HTMLElement);
  vi.stubGlobal("Node", window.Node);
  vi.stubGlobal("Event", window.Event);
  vi.stubGlobal("MutationObserver", window.MutationObserver);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
}

function mockWindowLocation(
  window: Window & typeof globalThis,
  href: string,
) {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      href,
    },
  });
}
