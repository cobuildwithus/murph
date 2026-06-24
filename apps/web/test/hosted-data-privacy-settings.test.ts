import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";

import { act, createElement } from "react";
import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ConnectedAccountCard: vi.fn(({ action, label, value }: {
    action?: React.ReactNode;
    label: string;
    value: string;
  }) =>
    createElement(
      "section",
      {
        "data-card-label": label,
        "data-card-value": value,
      },
      action,
    )),
  HostedSettingsSessionState: vi.fn(() =>
    createElement("div", {
      "data-hosted-settings-session-state": "true",
    }),
  ),
  authorize: vi.fn(),
  requestHostedOnboardingJson: vi.fn(),
  loadBrowserVaultReplica: vi.fn(),
  useStateValues: [] as unknown[],
}));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");

  return {
    ...actual,
    useState: ((initialState: unknown) => {
      const resolvedInitial = typeof initialState === "function"
        ? (initialState as () => unknown)()
        : initialState;
      const value = mocks.useStateValues.length > 0 ? mocks.useStateValues.shift() : resolvedInitial;
      return [value, vi.fn()] as ReturnType<typeof actual.useState>;
    }) as typeof actual.useState,
  };
});

vi.mock("@/src/components/hosted-onboarding/client-api", () => ({
  requestHostedOnboardingJson: mocks.requestHostedOnboardingJson,
}));

vi.mock("@/src/components/sensitive-actions/use-sensitive-action-authorization", () => ({
  useSensitiveActionAuthorization: () => ({ authorize: mocks.authorize }),
}));

vi.mock("@/src/lib/browser-vault/loader", () => ({
  loadBrowserVaultReplica: mocks.loadBrowserVaultReplica,
  normalizeBrowserVaultError: (error: unknown) =>
    error instanceof Error ? error.message : "Your dashboard data is not available right now.",
}));

vi.mock("../src/components/settings/connected-account-card", () => ({
  ConnectedAccountCard: mocks.ConnectedAccountCard,
}));

vi.mock("../src/components/settings/hosted-settings-session-state", () => ({
  HostedSettingsSessionState: mocks.HostedSettingsSessionState,
}));

vi.mock("@/src/components/hosted-onboarding/hosted-privy-logout", () => ({
  HostedPrivyLogout: () => null,
}));

vi.mock("@/src/components/ui/alert", () => ({
  Alert: createPassthrough("div"),
  AlertDescription: createPassthrough("div"),
  AlertTitle: createPassthrough("div"),
}));

vi.mock("@/src/components/ui/button", () => ({
  Button: createPassthrough("button"),
}));

vi.mock("@/src/components/ui/dialog", () => ({
  Dialog: ({ children, open }: { children?: ReactNode; open: boolean }) =>
    open ? createElement("div", { "data-dialog": "true" }, children) : null,
  DialogContent: (props: Record<string, unknown> & { children?: ReactNode }) => {
    const { children, ...rest } = props;
    delete rest.showCloseButton;
    return createElement("div", rest, children);
  },
  DialogDescription: createPassthrough("p"),
  DialogFooter: createPassthrough("div"),
  DialogHeader: createPassthrough("div"),
  DialogTitle: createPassthrough("h2"),
}));

vi.mock("@/src/components/ui/input", () => ({
  Input: createPassthrough("input"),
}));

vi.mock("@/src/components/ui/label", () => ({
  Label: createPassthrough("label"),
}));

import { HostedDataPrivacySettings } from "@/src/components/settings/hosted-data-privacy-settings";

const requireFromHostedDataPrivacySettingsTest = createRequire(import.meta.url);

let cleanupRender: (() => Promise<void> | void) | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorize.mockResolvedValue({
    signature: `0x${"11".repeat(65)}`,
    token: "sac_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef",
  });
  mocks.loadBrowserVaultReplica.mockResolvedValue({
    client: {
      replica: createBrowserVaultReplicaForTest(),
    },
    replicaRef: {
      dataVersion: "d".repeat(64),
    },
    state: "ready",
  });
  mocks.requestHostedOnboardingJson.mockResolvedValue({
    ok: true,
    result: {
      cloudflare: {
        configured: true,
        deleted: true,
      },
      deletedAt: "2026-04-29T01:02:03.000Z",
      vendorAccounts: {
        privyUser: { errorCode: null, status: "completed" },
        stripeCustomer: { errorCode: null, status: "completed" },
        stripeSubscription: { errorCode: null, status: "completed" },
      },
    },
  });
});

afterEach(async () => {
  if (cleanupRender) {
    await cleanupRender();
    cleanupRender = null;
  }
  vi.restoreAllMocks();
});

describe("HostedDataPrivacySettings", () => {
  test("does not export the browser vault without the sensitive-data acknowledgement", async () => {
    mockHostedVaultExportFlowState({
      acknowledgedSensitiveDownload: false,
    });

    const { document, window } = loadLinkedom().parseHTML(
      "<html><body><div id='root'></div></body></html>",
    );
    installGlobals(window, document);
    const createObjectURL = vi.fn(() => "blob:vault-export");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(window, "URL", {
      configurable: true,
      value: {
        createObjectURL,
        revokeObjectURL,
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
      root.render(createElement(HostedDataPrivacySettings, { authenticated: true }));
    });

    const button = findButton(container, "Download vault JSON");
    assert.equal(button.disabled, true);

    await act(async () => {
      button.dispatchEvent(new window.Event("click", { bubbles: true }));
    });

    expect(mocks.authorize).not.toHaveBeenCalled();
    expect(mocks.loadBrowserVaultReplica).not.toHaveBeenCalled();
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });

  test("downloads the browser vault replica when the export flow is submitted", async () => {
    mockHostedVaultExportFlowState();

    const { document, window } = loadLinkedom().parseHTML(
      "<html><body><div id='root'></div></body></html>",
    );
    installGlobals(window, document);
    const downloadedBlobs: Blob[] = [];
    const createObjectURL = vi.fn((blob: Blob) => {
      downloadedBlobs.push(blob);
      return "blob:vault-export";
    });
    const revokeObjectURL = vi.fn();
    Object.defineProperty(window, "URL", {
      configurable: true,
      value: {
        createObjectURL,
        revokeObjectURL,
      },
    });
    const clickDownloadLink = vi.fn();
    Object.defineProperty(window.HTMLElement.prototype, "click", {
      configurable: true,
      value: clickDownloadLink,
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
      root.render(createElement(HostedDataPrivacySettings, { authenticated: true }));
    });

    await clickButton(container, "Download vault JSON", window);

    expect(mocks.authorize).toHaveBeenCalledWith("vault.export");
    expect(mocks.loadBrowserVaultReplica).toHaveBeenCalledWith({
      authorization: {
        signature: `0x${"11".repeat(65)}`,
        token: "sac_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef",
      },
      emptyOnUnauthorized: false,
      endpoint: "/api/settings/vault-export/session",
      knownReplicaRef: null,
    });
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:vault-export");
    expect(clickDownloadLink).toHaveBeenCalledTimes(1);
    assert.equal(downloadedBlobs.length, 1);
    await expect(downloadedBlobs[0]?.text()).resolves.toContain("\"schema\": \"murph.browser-vault-replica\"");
    await expect(downloadedBlobs[0]?.text()).resolves.toContain("\"entity-title\"");
  });

  test("sends the typed deletion confirmation phrase when the delete flow is submitted", async () => {
    mockHostedDataPrivacyDeleteFlowState();

    const { document, window } = loadLinkedom().parseHTML(
      "<html><body><div id='root'></div></body></html>",
    );
    installGlobals(window, document);
    const container = document.getElementById("root");
    assert.ok(container);

    const root: Root = createRoot(container);
    cleanupRender = async () => {
      await act(async () => {
        root.unmount();
      });
    };

    await act(async () => {
      root.render(createElement(HostedDataPrivacySettings, { authenticated: true }));
    });

    await clickButton(container, "Delete account", window);

    expect(mocks.authorize).toHaveBeenCalledWith("account.delete");
    expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith({
      method: "POST",
      payload: {
        authorization: {
          signature: `0x${"11".repeat(65)}`,
          token: "sac_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef",
        },
        confirmationPhrase: "DELETE MY ACCOUNT",
      },
      url: "/api/settings/privacy/delete",
    });
  });

  test("does not submit deletion until the exact confirmation phrase is typed", async () => {
    mockHostedDataPrivacyDeleteFlowState({
      confirmationPhrase: "delete my account",
    });

    const { document, window } = loadLinkedom().parseHTML(
      "<html><body><div id='root'></div></body></html>",
    );
    installGlobals(window, document);
    const container = document.getElementById("root");
    assert.ok(container);

    const root: Root = createRoot(container);
    cleanupRender = async () => {
      await act(async () => {
        root.unmount();
      });
    };

    await act(async () => {
      root.render(createElement(HostedDataPrivacySettings, { authenticated: true }));
    });

    const button = findButton(container, "Delete account");
    assert.equal(button.disabled, true);

    await act(async () => {
      button.dispatchEvent(new window.Event("click", { bubbles: true }));
    });

    expect(mocks.requestHostedOnboardingJson).not.toHaveBeenCalled();
  });

  test("shows the account-deleted confirmation once deletion has completed", async () => {
    mockHostedDataPrivacyDeletedState();

    const { document, window } = loadLinkedom().parseHTML(
      "<html><body><div id='root'></div></body></html>",
    );
    installGlobals(window, document);
    const container = document.getElementById("root");
    assert.ok(container);

    const root: Root = createRoot(container);
    cleanupRender = async () => {
      await act(async () => {
        root.unmount();
      });
    };

    await act(async () => {
      root.render(createElement(HostedDataPrivacySettings, { authenticated: true }));
    });

    assert.ok(container.textContent?.includes("Your account and all your data have been deleted"));
    assert.equal([...container.querySelectorAll("button")].length, 0);
  });
});

// Values follow the component's useState declaration order:
// exportPending, exportDialogOpen, acknowledgedSensitiveDownload, exportDialogError,
// exportSuccess, deletePending, dialogOpen, confirmationPhrase, dialogError, deleted,
// cleanupPending, privyLogoutDone.
function mockHostedVaultExportFlowState(input: {
  acknowledgedSensitiveDownload?: boolean;
} = {}) {
  mocks.useStateValues = [
    false,
    true,
    input.acknowledgedSensitiveDownload ?? true,
    null,
    null,
    false,
    false,
    "",
    null,
    false,
    false,
    false,
  ];
}

function mockHostedDataPrivacyDeleteFlowState(input: {
  confirmationPhrase?: string;
} = {}) {
  mocks.useStateValues = [
    false,
    false,
    false,
    null,
    null,
    false,
    true,
    input.confirmationPhrase ?? "DELETE MY ACCOUNT",
    null,
    false,
    false,
    false,
  ];
}

function mockHostedDataPrivacyDeletedState() {
  mocks.useStateValues = [
    false,
    false,
    false,
    null,
    null,
    false,
    false,
    "",
    null,
    true,
    false,
    false,
  ];
}

function createBrowserVaultReplicaForTest() {
  return {
    assistantSummary: {
      highlights: [],
      latestDate: null,
    },
    entities: [
      {
        attributes: {},
        bodyPreview: "entity-body",
        date: "2026-04-29",
        experimentSlug: null,
        family: "journal",
        id: "entity-1",
        kind: "note",
        links: [],
        lookupIds: ["entity-1"],
        occurredAt: "2026-04-29T01:02:03.000Z",
        recordClass: "journal",
        status: null,
        stream: null,
        tags: [],
        title: "entity-title",
      },
    ],
    generatedAt: "2026-04-29T01:02:03.000Z",
    metricGoalProgressRows: [],
    metricRows: [],
    metricSelectionRows: [],
    policy: {
      bodyPreviewChars: 280,
      excludedFamilies: [],
      id: "health-vault-browser",
      includedFamilies: ["journal"],
      metricLookbackDays: 365,
    },
    schema: "murph.browser-vault-replica",
    searchRows: [],
    source: {
      dataVersion: "d".repeat(64),
      sourceBundleHash: "a".repeat(64),
    },
    sourceHealthRows: [],
    timelineRows: [],
    weeklySampleSummaries: [],
  };
}

function createPassthrough(tagName: string) {
  return function PassthroughComponent(props: Record<string, unknown> & { children?: ReactNode }) {
    const { children, ...rest } = props;
    return createElement(tagName, rest, children);
  };
}

async function clickButton(
  container: HTMLElement,
  label: string,
  window: Window & typeof globalThis,
) {
  const button = findButton(container, label);

  await act(async () => {
    button.dispatchEvent(new window.Event("click", { bubbles: true }));
  });
}

function findButton(container: HTMLElement, label: string): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")].find((candidate) =>
    candidate.textContent?.includes(label));
  assert.ok(button, `Button not found: ${label}`);
  return button;
}

function loadLinkedom(): {
  parseHTML: (html: string) => { document: Document; window: Window & typeof globalThis };
} {
  const resolvePaths = [
    path.resolve(process.cwd(), "node_modules"),
    path.resolve(process.cwd(), "node_modules/.pnpm/node_modules"),
  ];

  for (const resolvePath of resolvePaths) {
    try {
      const resolvedEntry = requireFromHostedDataPrivacySettingsTest.resolve("linkedom", {
        paths: [resolvePath],
      });
      return requireFromHostedDataPrivacySettingsTest(resolvedEntry) as {
        parseHTML: (html: string) => { document: Document; window: Window & typeof globalThis };
      };
    } catch {
      // Try the next resolution root.
    }
  }

  throw new Error("Unable to resolve linkedom for hosted data privacy settings tests.");
}

function installGlobals(
  window: Window & typeof globalThis,
  document: Document,
) {
  vi.stubGlobal("window", window);
  vi.stubGlobal("self", window);
  vi.stubGlobal("document", document);
  vi.stubGlobal("navigator", window.navigator);
  vi.stubGlobal("HTMLElement", window.HTMLElement);
  vi.stubGlobal("Node", window.Node);
  vi.stubGlobal("Event", window.Event);
  vi.stubGlobal("MouseEvent", window.MouseEvent);
  vi.stubGlobal("MutationObserver", window.MutationObserver);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
}
