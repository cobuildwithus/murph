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
  requestHostedOnboardingJson: vi.fn(),
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

vi.mock("../src/components/settings/connected-account-card", () => ({
  ConnectedAccountCard: mocks.ConnectedAccountCard,
}));

vi.mock("../src/components/settings/hosted-settings-session-state", () => ({
  HostedSettingsSessionState: mocks.HostedSettingsSessionState,
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
  DialogContent: createPassthrough("div"),
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
  mocks.requestHostedOnboardingJson.mockResolvedValue({
    ok: true,
    result: {
      cloudflare: {
        alarmCleared: true,
        configured: true,
        deleted: true,
        deletedRootKeyEnvelope: true,
        errorCode: null,
        r2DeletedObjectCount: 1,
        r2SkippedUserScopedPrefixes: false,
        r2Supported: true,
        r2UserScopedSkipReason: null,
        runnerStateDeleted: true,
      },
      deletedAt: "2026-04-29T01:02:03.000Z",
      deletedCounts: {},
      providerRevocations: [],
      retentionNotes: [],
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

    await clickButton(container, "Delete my Murph data", window);

    expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith({
      method: "POST",
      payload: {
        acknowledgedIrreversibleDeletion: true,
        acknowledgedProviderAndBackupLimits: true,
        confirmationPhrase: "DELETE MY MURPH DATA",
        secondConfirmationAccepted: true,
      },
      url: "/api/settings/privacy/delete",
    });
  });
});

function mockHostedDataPrivacyDeleteFlowState() {
  mocks.useStateValues = [
    false,
    false,
    "",
    false,
    null,
    false,
    true,
    "confirm",
    "DELETE MY MURPH DATA",
    true,
    true,
    null,
    null,
    null,
    null,
  ];
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
  const button = [...container.querySelectorAll("button")].find((candidate) =>
    candidate.textContent?.includes(label));
  assert.ok(button, `Button not found: ${label}`);

  await act(async () => {
    button.dispatchEvent(new window.Event("click", { bubbles: true }));
  });
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
