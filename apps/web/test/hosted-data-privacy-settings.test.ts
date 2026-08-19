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
  publishBrowserVaultSessionEnding: vi.fn(),
  publishBrowserVaultSessionInvalidation: vi.fn(),
  privyLogoutOnDone: null as (() => void) | null,
  reloadCurrentHostedAuthDocument: vi.fn(),
  requestHostedOnboardingJson: vi.fn(),
  loadBrowserVaultExport: vi.fn(),
  useStateRecords: [] as Array<{
    setValue: ReturnType<typeof vi.fn>;
    value: unknown;
  }>,
  useStateSetters: [] as Array<ReturnType<typeof vi.fn>>,
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
      const setValue = vi.fn();
      mocks.useStateRecords.push({ setValue, value });
      mocks.useStateSetters.push(setValue);
      return [value, setValue] as ReturnType<typeof actual.useState>;
    }) as typeof actual.useState,
  };
});

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    const imageProps = { ...props };
    delete imageProps.priority;
    return createElement("img", imageProps);
  },
}));

vi.mock("@/src/components/hosted-onboarding/client-api", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/src/components/hosted-onboarding/client-api")
  >();

  return {
    ...actual,
    requestHostedOnboardingJson: mocks.requestHostedOnboardingJson,
  };
});

vi.mock("@/src/lib/browser-vault/session-invalidation", () => ({
  publishBrowserVaultSessionEnding:
    mocks.publishBrowserVaultSessionEnding,
  publishBrowserVaultSessionInvalidation:
    mocks.publishBrowserVaultSessionInvalidation,
}));

vi.mock("@/src/components/hosted-onboarding/hosted-auth-navigation", () => ({
  reloadCurrentHostedAuthDocument: mocks.reloadCurrentHostedAuthDocument,
}));

vi.mock("@/src/components/sensitive-actions/use-sensitive-action-authorization", () => ({
  useSensitiveActionAuthorization: () => ({ authorize: mocks.authorize }),
}));

vi.mock("@/src/lib/browser-vault/export", () => ({
  loadBrowserVaultExport: mocks.loadBrowserVaultExport,
  normalizeBrowserVaultExportError: (error: unknown) =>
    error instanceof Error ? error.message : "Your dashboard data is not available right now.",
}));

vi.mock("../src/components/settings/connected-account-card", () => ({
  ConnectedAccountCard: mocks.ConnectedAccountCard,
}));

vi.mock("../src/components/settings/hosted-settings-session-state", () => ({
  HostedSettingsSessionState: mocks.HostedSettingsSessionState,
}));

vi.mock("@/src/components/hosted-onboarding/hosted-privy-logout", () => ({
  HostedPrivyLogout: ({ onDone }: { onDone: () => void }) => {
    mocks.privyLogoutOnDone = onDone;
    return null;
  },
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

import {
  formatVaultExportSuccess,
  hasIncompleteHostedAccountDeletionCleanup,
  HostedDataPrivacySettings,
} from "@/src/components/settings/hosted-data-privacy-settings";

const requireFromHostedDataPrivacySettingsTest = createRequire(import.meta.url);

let cleanupRender: (() => Promise<void> | void) | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useStateRecords = [];
  mocks.useStateSetters = [];
  mocks.useStateValues = [];
  mocks.privyLogoutOnDone = null;
  mocks.authorize.mockResolvedValue({
    signature: `0x${"11".repeat(65)}`,
    token: "sac_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef",
  });
  mocks.loadBrowserVaultExport.mockResolvedValue({
    blob: createBrowserVaultExportBlobForTest(),
    deviceSyncImportPending: false,
    freshness: "fresh",
    generatedAt: "2026-04-29T01:02:03.000Z",
    refreshPending: false,
    workspaceVersion: null,
  });
  mocks.requestHostedOnboardingJson.mockResolvedValue({
    ok: true,
    result: {
      cleanupPending: false,
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
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("HostedDataPrivacySettings", () => {
  test("treats every nonconfirmed Cloudflare result as pending for legacy servers", () => {
    expect(hasIncompleteHostedAccountDeletionCleanup({
      cloudflare: { configured: false, deleted: false },
      deletedAt: "2026-07-26T12:00:00.000Z",
      vendorAccounts: {
        privyUser: { errorCode: null, status: "completed" },
        stripeCustomer: { errorCode: null, status: "completed" },
        stripeSubscription: { errorCode: null, status: "completed" },
      },
    })).toBe(true);
    expect(hasIncompleteHostedAccountDeletionCleanup({
      cleanupPending: false,
      cloudflare: { configured: false, deleted: false },
      deletedAt: "2026-07-26T12:00:00.000Z",
      vendorAccounts: {
        privyUser: { errorCode: null, status: "completed" },
        stripeCustomer: { errorCode: null, status: "completed" },
        stripeSubscription: { errorCode: null, status: "completed" },
      },
    })).toBe(false);
  });

  test.each([
    {
      deviceSyncImportPending: true,
      freshness: "fresh" as const,
      refreshPending: false,
    },
    {
      deviceSyncImportPending: false,
      freshness: "stale" as const,
      refreshPending: false,
    },
    {
      deviceSyncImportPending: false,
      freshness: "fresh" as const,
      refreshPending: true,
    },
  ])("warns about incomplete retained exports for each pending signal", (result) => {
    expect(formatVaultExportSuccess(result)).toContain(
      "Recent changes Murph had not finished processing may be absent.",
    );
  });

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

    assert.equal(
      container.querySelector("#hosted-data-export-title")?.textContent,
      "Export your data",
    );
    assert.match(
      container.querySelector("#hosted-data-export-description")?.textContent ?? "",
      /latest dashboard data Murph has retained/u,
    );
    assert.equal(
      container.querySelector('[aria-labelledby="hosted-data-export-title"]')
        ?.getAttribute("aria-describedby"),
      "hosted-data-export-description",
    );

    const button = findButton(container, "Download my data");
    assert.equal(button.disabled, true);

    await act(async () => {
      button.dispatchEvent(new window.Event("click", { bubbles: true }));
    });

    expect(mocks.authorize).not.toHaveBeenCalled();
    expect(mocks.loadBrowserVaultExport).not.toHaveBeenCalled();
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

    await clickButton(container, "Download my data", window);

    expect(mocks.authorize).toHaveBeenCalledWith("vault.export");
    expect(mocks.loadBrowserVaultExport).toHaveBeenCalledWith({
      authorization: {
        signature: `0x${"11".repeat(65)}`,
        token: "sac_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef",
      },
    });
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:vault-export");
    expect(clickDownloadLink).toHaveBeenCalledTimes(1);
    assert.equal(downloadedBlobs.length, 1);
    const downloadedBlob = downloadedBlobs[0];
    assert.ok(downloadedBlob);
    const exportedJson = await downloadedBlob.text();
    expect(exportedJson).toContain("\"schema\": \"murph.browser-vault-replica\"");
    expect(exportedJson).toContain("\"entity-title\"");
    expect(JSON.parse(exportedJson).labResultRows).toEqual([
      expect.objectContaining({
        analyte: "Hemoglobin A1c",
        biomarkerKey: "biomarker:hba1c",
        metricKey: "hba1c",
        value: 5.4,
      }),
    ]);
  });

  test("accepts the route-authorized latest retained replica without a page consent projection", async () => {
    mockHostedVaultExportFlowState();
    mocks.loadBrowserVaultExport.mockResolvedValueOnce({
      blob: createBrowserVaultExportBlobForTest(),
      deviceSyncImportPending: true,
      freshness: "stale",
      generatedAt: "2026-04-29T01:02:03.000Z",
      refreshPending: true,
      workspaceVersion: null,
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

    await clickButton(container, "Download my data", window);

    expect(mocks.loadBrowserVaultExport).toHaveBeenCalledTimes(1);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickDownloadLink).toHaveBeenCalledTimes(1);
    expect(formatVaultExportSuccess({
      deviceSyncImportPending: true,
      freshness: "stale",
      refreshPending: true,
    })).toContain(
      "Recent changes Murph had not finished processing may be absent.",
    );
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
      onSuccessfulResponseError: mocks.reloadCurrentHostedAuthDocument,
      onSuccessfulResponseHeaders: expect.any(Function),
      payload: {
        authorization: {
          signature: `0x${"11".repeat(65)}`,
          token: "sac_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef",
        },
        confirmationPhrase: "DELETE MY ACCOUNT",
      },
      url: "/api/settings/privacy/delete",
    });
    expect(mocks.requestHostedOnboardingJson.mock.calls[0]?.[0])
      .not.toHaveProperty("signal");
    expect(mocks.publishBrowserVaultSessionEnding).toHaveBeenCalledTimes(1);
    expect(
      mocks.publishBrowserVaultSessionEnding.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.requestHostedOnboardingJson.mock.invocationCallOrder[0]);
  });

  test("sends the answered exit reason and note alongside the deletion", async () => {
    mockHostedDataPrivacyDeleteFlowState({
      exitNote: "Texts were great, price was not.",
      exitReason: "too_expensive",
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

    await clickButton(container, "Delete account", window);

    expect(mocks.requestHostedOnboardingJson.mock.calls[0]?.[0]?.payload).toEqual({
      authorization: {
        signature: `0x${"11".repeat(65)}`,
        token: "sac_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef",
      },
      confirmationPhrase: "DELETE MY ACCOUNT",
      exitNote: "Texts were great, price was not.",
      exitReason: "too_expensive",
    });
  });

  test("omits exit fields entirely when the member skips the question", async () => {
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

    const payload = mocks.requestHostedOnboardingJson.mock.calls[0]?.[0]?.payload;
    expect(payload).not.toHaveProperty("exitReason");
    expect(payload).not.toHaveProperty("exitNote");
  });

  test("requires provider-access confirmation after an ambiguous OAuth callback", async () => {
    mockHostedDataPrivacyDeleteFlowState({
      dialogError: "Remove Murph access in the Oura provider account, then confirm below.",
      providerAccessRemovalRequired: true,
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

    expect(container.textContent).toContain(
      "I removed Murph access from every provider above.",
    );
    assert.equal(findButton(container, "Delete account").disabled, true);
    expect(mocks.requestHostedOnboardingJson).not.toHaveBeenCalled();
  });

  test("submits explicit provider-access confirmation on the recovery retry", async () => {
    mockHostedDataPrivacyDeleteFlowState({
      providerAccessRemovalConfirmed: true,
      providerAccessRemovalConfirmationToken: "a".repeat(64),
      providerAccessRemovalRequired: true,
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

    await clickButton(container, "Delete account", window);

    expect(mocks.requestHostedOnboardingJson.mock.calls[0]?.[0]?.payload)
      .toMatchObject({ providerAccessRemovalConfirmationToken: "a".repeat(64) });
  });

  test("allows account deletion to succeed after the vault receiver lease window", async () => {
    vi.useFakeTimers();
    mockHostedDataPrivacyDeleteFlowState();
    mocks.requestHostedOnboardingJson.mockImplementationOnce(async (input: {
      onSuccessfulResponseHeaders?: () => void;
      signal?: AbortSignal;
    }) => {
      expect(input).not.toHaveProperty("signal");
      await new Promise((resolve) => setTimeout(resolve, 30_001));
      input.onSuccessfulResponseHeaders?.();
      return {
        ok: true,
        result: {
          cleanupPending: false,
          cloudflare: { configured: true, deleted: true },
          deletedAt: "2026-04-29T01:02:03.000Z",
          vendorAccounts: {
            privyUser: { errorCode: null, status: "completed" },
            stripeCustomer: { errorCode: null, status: "completed" },
            stripeSubscription: { errorCode: null, status: "completed" },
          },
        },
      };
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

    await clickButton(container, "Delete account", window);
    expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledTimes(1);
    expect(mocks.publishBrowserVaultSessionInvalidation).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_001);
    });

    expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledTimes(1);
    expect(mocks.publishBrowserVaultSessionInvalidation).toHaveBeenCalledTimes(1);
    expect(mocks.reloadCurrentHostedAuthDocument).not.toHaveBeenCalled();
  });

  test("publishes deletion invalidation before a successful response body can fail", async () => {
    mockHostedDataPrivacyDeleteFlowState();
    mocks.requestHostedOnboardingJson.mockImplementationOnce(async (input: {
      onSuccessfulResponseError?: () => void;
      onSuccessfulResponseHeaders?: () => void;
    }) => {
      input.onSuccessfulResponseHeaders?.();
      input.onSuccessfulResponseError?.();
      throw new Error("response body unavailable");
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

    await clickButton(container, "Delete account", window);

    expect(mocks.publishBrowserVaultSessionEnding).toHaveBeenCalledTimes(1);
    expect(mocks.publishBrowserVaultSessionInvalidation).toHaveBeenCalledTimes(1);
    expect(mocks.reloadCurrentHostedAuthDocument).toHaveBeenCalledTimes(1);
  });

  test("does not replay account deletion when ambient authority may change after transport failure", async () => {
    mockHostedDataPrivacyDeleteFlowState();
    mocks.requestHostedOnboardingJson.mockRejectedValueOnce(
      new TypeError("network unavailable"),
    );

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

    expect(mocks.publishBrowserVaultSessionEnding).toHaveBeenCalledTimes(1);
    expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledTimes(1);
    expect(mocks.requestHostedOnboardingJson.mock.calls[0]?.[0])
      .not.toHaveProperty("signal");
    expect(mocks.publishBrowserVaultSessionInvalidation).toHaveBeenCalledTimes(1);
    expect(mocks.reloadCurrentHostedAuthDocument).toHaveBeenCalledTimes(1);
  });

  test("revalidates current authority when deletion receives an explicit HTTP rejection", async () => {
    mockHostedDataPrivacyDeleteFlowState();
    const { HostedOnboardingApiError } = await import(
      "@/src/components/hosted-onboarding/client-api"
    );
    mocks.requestHostedOnboardingJson.mockRejectedValueOnce(
      new HostedOnboardingApiError({
        code: "ACCOUNT_DELETE_REJECTED",
        message: "Deletion was rejected.",
      }),
    );

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

    expect(mocks.publishBrowserVaultSessionEnding).toHaveBeenCalledTimes(1);
    expect(mocks.publishBrowserVaultSessionInvalidation).toHaveBeenCalledTimes(1);
    expect(mocks.reloadCurrentHostedAuthDocument).toHaveBeenCalledTimes(1);
  });

  test("keeps reconnect-required deletion guidance in the open dialog without reloading", async () => {
    mockHostedDataPrivacyDeleteFlowState();
    const { HostedOnboardingApiError } = await import(
      "@/src/components/hosted-onboarding/client-api"
    );
    mocks.requestHostedOnboardingJson.mockRejectedValueOnce(
      new HostedOnboardingApiError({
        code: "ACCOUNT_DELETION_DEVICE_TOKEN_REFRESH_RECOVERY_REQUIRED",
        details: {
          connectionId: "dsc_123",
          providerLabel: "Oura",
        },
        message: "The Oura credential refresh did not finish safely. Reconnect that source, then retry account deletion.",
      }),
    );

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

    expect(mocks.publishBrowserVaultSessionEnding).toHaveBeenCalledTimes(1);
    expect(mocks.publishBrowserVaultSessionInvalidation).toHaveBeenCalledTimes(1);
    expect(mocks.reloadCurrentHostedAuthDocument).not.toHaveBeenCalled();
  });

  test.each([
    {
      code: "HOSTED_STRIPE_EFFECT_PENDING",
      message: "Billing is already changing. Try again shortly.",
    },
    {
      code: "ACCOUNT_DELETION_CONNECTED_APP_SETUP_IN_PROGRESS",
      message: "Connected-app setup is still finishing. Try account deletion again after it finishes or times out.",
    },
    {
      code: "ACCOUNT_DELETION_CONNECTED_APP_CLEANUP_BACKLOG",
      message: "Multiple connected-app setups are still finishing. Try account deletion again after they finish or time out.",
    },
  ])("keeps $code guidance and confirmation in the open dialog", async ({
    code,
    message,
  }) => {
    mockHostedDataPrivacyDeleteFlowState();
    const { HostedOnboardingApiError } = await import(
      "@/src/components/hosted-onboarding/client-api"
    );
    mocks.requestHostedOnboardingJson.mockRejectedValueOnce(
      new HostedOnboardingApiError({ code, message }),
    );

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
    await vi.waitFor(() => {
      expect(mocks.useStateSetters[11]).toHaveBeenLastCalledWith(message);
    });

    const confirmationState = mocks.useStateRecords.find(
      (state) => state.value === "DELETE MY ACCOUNT",
    );
    assert.ok(confirmationState);
    expect(confirmationState.setValue).not.toHaveBeenCalled();
    expect(mocks.publishBrowserVaultSessionEnding).toHaveBeenCalledTimes(1);
    expect(mocks.publishBrowserVaultSessionInvalidation).toHaveBeenCalledTimes(1);
    expect(mocks.reloadCurrentHostedAuthDocument).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
    cleanupRender = null;
    mocks.useStateRecords = [];
    mocks.useStateSetters = [];
    mockHostedDataPrivacyDeleteFlowState({
      confirmationPhrase: "DELETE MY ACCOUNT",
      dialogError: message,
    });
    const retryRoot: Root = createRoot(container);
    cleanupRender = async () => {
      await act(async () => {
        retryRoot.unmount();
      });
    };
    await act(async () => {
      retryRoot.render(createElement(HostedDataPrivacySettings, { authenticated: true }));
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(message);
    expect(container.querySelector<HTMLInputElement>(
      "#hosted-account-delete-phrase",
    )?.value).toBe("DELETE MY ACCOUNT");

    await clickButton(container, "Delete account", window);
    await vi.waitFor(() => {
      expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledTimes(2);
    });
    expect(mocks.authorize).toHaveBeenNthCalledWith(2, "account.delete");
    expect(mocks.authorize).toHaveBeenCalledTimes(2);
  });

  test("links reconnect-required deletion guidance to the wearables recovery surface", async () => {
    const recoveryMessage = "The Oura credential refresh did not finish safely. Reconnect that source, then retry account deletion.";
    mockHostedDataPrivacyDeleteFlowState({
      deviceReconnectRequired: true,
      dialogError: recoveryMessage,
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

    expect(container.textContent).toContain(recoveryMessage);
    const recoveryLink = [...container.querySelectorAll("a")]
      .find((link) => link.textContent?.trim() === "Manage wearables");
    assert.ok(recoveryLink);
    expect(recoveryLink.getAttribute("href")).toBe("/connect");
  });

  test("an authorization failure does not invalidate an unchanged session", async () => {
    mockHostedDataPrivacyDeleteFlowState();
    mocks.authorize.mockRejectedValueOnce(new Error("authorization unavailable"));

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

    expect(mocks.requestHostedOnboardingJson).not.toHaveBeenCalled();
    expect(mocks.publishBrowserVaultSessionEnding).not.toHaveBeenCalled();
    expect(mocks.publishBrowserVaultSessionInvalidation).not.toHaveBeenCalled();
    expect(mocks.reloadCurrentHostedAuthDocument).not.toHaveBeenCalled();
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

    assert.ok(
      container.textContent?.includes(
        "Your Murph account and live data have been deleted.",
      ),
    );
    assert.ok(container.textContent?.includes("Farewell for now."));
    assert.ok(container.querySelector('[data-account-deletion-farewell="true"]'));
    assert.equal([...container.querySelectorAll("button")].length, 0);
  });

  test("replaces the deleted dashboard with the public farewell after Privy logout", async () => {
    mockHostedDataPrivacyDeletedState();

    const { document, window } = loadLinkedom().parseHTML(
      "<html><body><div id='root'></div></body></html>",
    );
    const replace = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { replace },
    });
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
    assert.ok(mocks.privyLogoutOnDone);

    await act(async () => {
      mocks.privyLogoutOnDone?.();
    });

    expect(replace).toHaveBeenCalledWith("/farewell");
  });

  test("falls back to the pending-cleanup farewell when Privy logout does not settle", async () => {
    vi.useFakeTimers();
    mockHostedDataPrivacyDeletedState({ cleanupPending: true });

    const { document, window } = loadLinkedom().parseHTML(
      "<html><body><div id='root'></div></body></html>",
    );
    const replace = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { replace },
    });
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
    expect(replace).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(8_000);
    });

    expect(replace).toHaveBeenCalledWith("/farewell?cleanup=pending");
  });

  test("reports durable external cleanup as pending after account deletion", async () => {
    mockHostedDataPrivacyDeletedState({ cleanupPending: true });

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

    assert.ok(
      container.textContent?.includes(
        "Your account has been deleted. Murph is finishing a small amount of technical cleanup in the background; no action is needed.",
      ),
    );
    assert.equal(
      container.querySelector('[data-account-deletion-farewell="true"]')
        ?.getAttribute("class")
        ?.includes("fixed"),
      true,
    );
    assert.equal([...container.querySelectorAll("button")].length, 0);
  });
});

// Values follow the component's useState declaration order:
// exportPending, exportDialogOpen, acknowledgedSensitiveDownload, exportDialogError,
// exportSuccess, deletePending, dialogOpen, dialogStep, exitReason, exitNote,
// confirmationPhrase, dialogError, deviceReconnectRequired, providerAccessRemovalRequired,
// providerAccessRemovalConfirmed, providerAccessRemovalConfirmationToken,
// deleted, cleanupPending.
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
    "reason",
    null,
    "",
    "",
    null,
    false,
    false,
    false,
    null,
    false,
    false,
  ];
}

function mockHostedDataPrivacyDeleteFlowState(input: {
  confirmationPhrase?: string;
  deviceReconnectRequired?: boolean;
  dialogError?: string | null;
  exitNote?: string;
  exitReason?: string | null;
  providerAccessRemovalConfirmed?: boolean;
  providerAccessRemovalConfirmationToken?: string | null;
  providerAccessRemovalRequired?: boolean;
} = {}) {
  mocks.useStateValues = [
    false,
    false,
    false,
    null,
    null,
    false,
    true,
    // These tests exercise the confirmation step, so start past the optional
    // exit-reason step unless a case opts into an answered reason.
    "confirm",
    input.exitReason ?? null,
    input.exitNote ?? "",
    input.confirmationPhrase ?? "DELETE MY ACCOUNT",
    input.dialogError ?? null,
    input.deviceReconnectRequired ?? false,
    input.providerAccessRemovalRequired ?? false,
    input.providerAccessRemovalConfirmed ?? false,
    input.providerAccessRemovalConfirmationToken ?? null,
    false,
    false,
  ];
}

function mockHostedDataPrivacyDeletedState(input: {
  cleanupPending?: boolean;
} = {}) {
  mocks.useStateValues = [
    false,
    false,
    false,
    null,
    null,
    false,
    false,
    "reason",
    null,
    "",
    "",
    null,
    false,
    false,
    false,
    null,
    true,
    input.cleanupPending ?? false,
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
    labResultRows: [
      {
        analyte: "Hemoglobin A1c",
        biomarkerKey: "biomarker:hba1c",
        comparator: null,
        date: "2024-09-18",
        flag: "normal",
        id: "lab-result-row:synthetic-hba1c",
        labName: "Example Laboratory",
        metricKey: "hba1c",
        normalizedUnit: "percent",
        normalizedValue: 5.4,
        observedAt: "2024-09-18T08:30:00.000Z",
        referenceRange: {
          high: 5.6,
          low: 4,
          text: "4.0-5.6",
        },
        rowSchema: "murph.browser-vault.lab-result-row.v1",
        sourceLabel: "Clinical records",
        specimenKind: "serum",
        textValue: null,
        unit: "%",
        value: 5.4,
      },
    ],
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

function createBrowserVaultExportBlobForTest(): Blob {
  return new Blob(
    [JSON.stringify(createBrowserVaultReplicaForTest(), null, 2)],
    { type: "application/json; charset=utf-8" },
  );
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
