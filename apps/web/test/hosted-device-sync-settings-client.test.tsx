import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";

import { act } from "react";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import type { HostedDeviceSyncSettingsSource } from "@/src/lib/device-sync/settings-surface";

const mocks = vi.hoisted(() => ({
  HostedDeviceSyncDisconnectDialog: vi.fn(() =>
    createElement("div", {
      "data-hosted-device-sync-disconnect-dialog": "true",
    }),
  ),
  HostedDeviceSyncSettingsContent: vi.fn((props: {
    sources: HostedDeviceSyncSettingsSource[];
  }) =>
    createElement(
      "div",
      {
        "data-hosted-device-sync-settings-content": "true",
      },
      props.sources.length,
    ),
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
}));

vi.mock("@/src/components/hosted-onboarding/client-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/src/components/hosted-onboarding/client-api")>();

  return {
    ...actual,
    requestHostedOnboardingJson: mocks.requestHostedOnboardingJson,
  };
});

vi.mock("@/src/components/settings/hosted-device-sync-settings-sections", () => ({
  HostedDeviceSyncDisconnectDialog: mocks.HostedDeviceSyncDisconnectDialog,
  HostedDeviceSyncSettingsContent: mocks.HostedDeviceSyncSettingsContent,
  HostedDeviceSyncSettingsStatusCard: mocks.HostedDeviceSyncSettingsStatusCard,
}));

vi.mock("@/src/components/settings/hosted-device-sync-settings-utils", () => ({
  sourceKey: mocks.sourceKey,
}));

vi.mock("@/src/components/settings/hosted-settings-session-state", () => ({
  HostedSettingsSessionState: mocks.HostedSettingsSessionState,
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

test("HostedDeviceSyncSettingsClient renders settings content without a connect handler", async () => {
  const source = createConnectedSource();
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
        initialLoadError: null,
        initialResponse: {
          generatedAt: "2026-05-01T00:00:00.000Z",
          ok: true,
          sources: [source],
        },
      }),
    );
  });

  expect(mocks.HostedDeviceSyncSettingsContent).toHaveBeenCalledWith(expect.objectContaining({
    sources: [source],
  }), undefined);
  const contentProps = mocks.HostedDeviceSyncSettingsContent.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
  expect(contentProps).toBeDefined();
  expect(contentProps && "onConnect" in contentProps).toBe(false);
  expect(mocks.requestHostedOnboardingJson).not.toHaveBeenCalled();
});

test("HostedDeviceSyncSettingsClient clears stale callback params without surfacing a settings callback", async () => {
  const { document, window } = loadLinkedom().parseHTML(
    "<html><body><div id='root'></div></body></html>",
  );
  installHostedDeviceSyncClientGlobals(window, document);
  mockWindowLocation(
    window,
    "https://app.example.test/settings?keep=1&deviceSyncStatus=connected&deviceSyncProvider=junction&connectSource=garmin&connectTarget=garmin&deviceSyncErrorMessage=legacy",
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
        authenticated: true,
        initialLoadError: null,
        initialResponse: {
          generatedAt: "2026-05-01T00:00:00.000Z",
          ok: true,
          sources: [],
        },
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
  expect(redirected.searchParams.get("connectSource")).toBeNull();
  expect(redirected.searchParams.get("connectTarget")).toBeNull();
  expect(redirected.searchParams.get("deviceSyncErrorMessage")).toBeNull();
  expect(mocks.requestHostedOnboardingJson).not.toHaveBeenCalled();
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
    title: "Wearables unavailable",
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

function createConnectedSource(): HostedDeviceSyncSettingsSource {
  return {
    connectionId: "dspc_garmin_123",
    connectedAt: "2026-05-01T00:00:00.000Z",
    detail: "Murph has a fresh sync from this source.",
    displayName: null,
    guidance: "Nothing to do here.",
    headline: "Connected and syncing normally",
    lastActivityAt: "2026-05-01T00:00:00.000Z",
    lastSuccessfulSyncAt: "2026-05-01T00:00:00.000Z",
    lastWebhookAt: null,
    nextReconcileAt: null,
    primaryAction: null,
    provider: "garmin",
    providerConfigured: true,
    providerLabel: "Garmin",
    secondaryAction: {
      kind: "disconnect",
      label: "Disconnect",
    },
    state: "active",
    statusLabel: "Connected",
    tone: "calm",
    updatedAt: "2026-05-01T00:00:00.000Z",
    upstreamSources: [],
  };
}
