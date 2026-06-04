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
    onReconnect: (source: HostedDeviceSyncSettingsSource) => Promise<void>;
    sources: HostedDeviceSyncSettingsSource[];
  }) =>
    createElement(
      "div",
      {
        "data-hosted-device-sync-settings-content": "true",
      },
      props.sources.length,
      props.sources[0]?.primaryAction?.kind === "reconnect"
        ? createElement(
            "button",
            {
              "data-hosted-device-sync-reconnect": "true",
              onClick: () => void props.onReconnect(props.sources[0] as HostedDeviceSyncSettingsSource),
              type: "button",
            },
            "Reconnect",
          )
        : null,
    ),
  ),
  HostedDeviceSyncReconnectConsentDialog: vi.fn((props: {
    onAccepted: (source: HostedDeviceSyncSettingsSource) => Promise<void>;
    source: HostedDeviceSyncSettingsSource | null;
  }) =>
    props.source
      ? createElement(
          "button",
          {
            "data-hosted-device-sync-reconnect-consent": "true",
            onClick: () => void props.onAccepted(props.source as HostedDeviceSyncSettingsSource),
            type: "button",
          },
          "Accept consent",
        )
      : null
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
  HostedDeviceSyncReconnectConsentDialog: mocks.HostedDeviceSyncReconnectConsentDialog,
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

test("HostedDeviceSyncSettingsClient retries reconnect after consent is accepted", async () => {
  const { HostedOnboardingApiError } = await import("@/src/components/hosted-onboarding/client-api");
  const source = createReconnectSource();
  mocks.requestHostedOnboardingJson
    .mockRejectedValueOnce(new HostedOnboardingApiError({
      code: "HOSTED_CONSENT_REQUIRED",
      message: "Accept the current Murph legal consent before continuing.",
    }))
    .mockResolvedValueOnce({
      authorizationUrl: "https://provider.example.test/oauth/start",
    });

  const { document, window } = loadLinkedom().parseHTML(
    "<html><body><div id='root'></div></body></html>",
  );
  installHostedDeviceSyncClientGlobals(window, document);
  const assign = mockWindowLocation(window, "https://app.example.test/settings");

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

  const reconnectButton = container.querySelector("[data-hosted-device-sync-reconnect='true']");
  assert.ok(reconnectButton instanceof window.HTMLButtonElement);

  await act(async () => {
    reconnectButton.dispatchEvent(new window.Event("click", { bubbles: true }));
  });

  await vi.waitFor(() => {
    expect(mocks.HostedDeviceSyncReconnectConsentDialog).toHaveBeenCalledWith(expect.objectContaining({
      source,
    }), undefined);
  });

  const consentButton = container.querySelector("[data-hosted-device-sync-reconnect-consent='true']");
  assert.ok(consentButton instanceof window.HTMLButtonElement);

  await act(async () => {
    consentButton.dispatchEvent(new window.Event("click", { bubbles: true }));
  });

  await vi.waitFor(() => {
    expect(assign).toHaveBeenCalledWith("https://provider.example.test/oauth/start");
  });
  expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledTimes(2);
  expect(mocks.requestHostedOnboardingJson).toHaveBeenNthCalledWith(1, {
    method: "POST",
    payload: {
      connectTarget: "whoop",
      provider: "whoop",
    },
    url: "/api/connect-sources/whoop/start",
  });
  expect(mocks.requestHostedOnboardingJson).toHaveBeenNthCalledWith(2, {
    method: "POST",
    payload: {
      connectTarget: "whoop",
      provider: "whoop",
    },
    url: "/api/connect-sources/whoop/start",
  });
});

test("HostedDeviceSyncSettingsClient reconnects Junction WHOOP through the Junction target", async () => {
  const source = createReconnectSource({
    provider: "junction",
    providerLabel: "WHOOP",
  });
  mocks.requestHostedOnboardingJson.mockResolvedValueOnce({
    authorizationUrl: "https://provider.example.test/oauth/start",
  });

  const { document, window } = loadLinkedom().parseHTML(
    "<html><body><div id='root'></div></body></html>",
  );
  installHostedDeviceSyncClientGlobals(window, document);
  const assign = mockWindowLocation(window, "https://app.example.test/settings");

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

  const reconnectButton = container.querySelector("[data-hosted-device-sync-reconnect='true']");
  assert.ok(reconnectButton instanceof window.HTMLButtonElement);

  await act(async () => {
    reconnectButton.dispatchEvent(new window.Event("click", { bubbles: true }));
  });

  await vi.waitFor(() => {
    expect(assign).toHaveBeenCalledWith("https://provider.example.test/oauth/start");
  });
  expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith({
    method: "POST",
    payload: {
      connectTarget: "whoop",
      provider: "junction",
    },
    url: "/api/connect-sources/whoop/start",
  });
});

test("HostedDeviceSyncSettingsClient closes reconnect consent dialog when retry fails normally", async () => {
  const { HostedOnboardingApiError } = await import("@/src/components/hosted-onboarding/client-api");
  const source = createReconnectSource();
  mocks.requestHostedOnboardingJson
    .mockRejectedValueOnce(new HostedOnboardingApiError({
      code: "HOSTED_CONSENT_REQUIRED",
      message: "Accept the current Murph legal consent before continuing.",
    }))
    .mockRejectedValueOnce(new HostedOnboardingApiError({
      code: "DEVICE_SYNC_CONNECT_START_FAILED",
      message: "Provider authorization could not start.",
    }));

  const { document, window } = loadLinkedom().parseHTML(
    "<html><body><div id='root'></div></body></html>",
  );
  installHostedDeviceSyncClientGlobals(window, document);
  const assign = mockWindowLocation(window, "https://app.example.test/settings");

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

  const reconnectButton = container.querySelector("[data-hosted-device-sync-reconnect='true']");
  assert.ok(reconnectButton instanceof window.HTMLButtonElement);

  await act(async () => {
    reconnectButton.dispatchEvent(new window.Event("click", { bubbles: true }));
  });

  await vi.waitFor(() => {
    expect(container.querySelector("[data-hosted-device-sync-reconnect-consent='true']")).not.toBeNull();
  });
  const consentButton = container.querySelector("[data-hosted-device-sync-reconnect-consent='true']");
  assert.ok(consentButton instanceof window.HTMLButtonElement);

  await act(async () => {
    consentButton.dispatchEvent(new window.Event("click", { bubbles: true }));
  });

  await vi.waitFor(() => {
    expect(container.querySelector("[data-hosted-device-sync-reconnect-consent='true']")).toBeNull();
  });
  expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledTimes(2);
  expect(assign).not.toHaveBeenCalled();
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
  const assign = vi.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      assign,
      href,
    },
  });
  return assign;
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

function createReconnectSource(
  overrides: Partial<HostedDeviceSyncSettingsSource> = {},
): HostedDeviceSyncSettingsSource {
  return {
    ...createConnectedSource(),
    connectSourceId: "whoop",
    connectTarget: "whoop",
    connectionId: "dspc_whoop_123",
    detail: "The provider asked Murph to renew access before it can keep syncing.",
    headline: "Access needs attention",
    primaryAction: {
      kind: "reconnect",
      label: "Reconnect",
    },
    provider: "whoop",
    providerLabel: "WHOOP",
    state: "reauthorization_required",
    statusLabel: "Needs access",
    tone: "attention",
    ...overrides,
  };
}
