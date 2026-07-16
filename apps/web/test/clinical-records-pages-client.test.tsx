import assert from "node:assert/strict";

import {
  act,
  createElement,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ClinicalRecordConnectionContract } from "@/src/lib/clinical-records/client-contracts";

import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => ({
  openAuthDialog: vi.fn(),
  refresh: vi.fn(),
  requestHostedOnboardingJson: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, className }: { children: ReactNode; className?: string; href: string }) =>
    createElement("a", { className, href }, children),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

vi.mock("@/src/components/hosted-onboarding/auth-dialog-provider", () => ({
  useAuth: () => ({ authenticated: true, openAuthDialog: mocks.openAuthDialog }),
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

vi.mock("@/src/components/legal/hosted-legal-consent-card", () => ({
  HostedLegalConsentCard({
    onAccepted,
    onRequirementChange,
  }: {
    onAccepted?: () => void;
    onRequirementChange?: (required: boolean) => void;
  }) {
    return createElement(
      "button",
      {
        onClick: () => {
          onRequirementChange?.(false);
          onAccepted?.();
        },
        type: "button",
      },
      "Accept health-data consent",
    );
  },
}));

vi.mock("@/src/components/ui/button", () => ({
  Button({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
    return createElement("button", props, children);
  },
  buttonVariants: () => "button",
}));

vi.mock("@/src/components/ui/input", () => ({
  Input(props: InputHTMLAttributes<HTMLInputElement> & { inputSize?: string }) {
    const inputProps = { ...props };
    delete inputProps.inputSize;
    return createElement("input", inputProps);
  },
}));

vi.mock("@/src/components/ui/spinner", () => ({
  Spinner: () => createElement("span", null, "Loading"),
}));

vi.mock("@/src/components/ui/skeleton", () => ({
  Skeleton: (props: Record<string, unknown>) => createElement("div", props),
}));

vi.mock("@/src/components/ui/dialog", () => ({
  Dialog: ({ children, open }: { children: ReactNode; open?: boolean }) =>
    open ? createElement("div", null, children) : null,
  DialogContent: ({ children }: { children: ReactNode }) => createElement("div", null, children),
  DialogDescription: ({ children }: { children: ReactNode }) => createElement("p", null, children),
  DialogFooter: ({ children }: { children: ReactNode }) => createElement("div", null, children),
  DialogHeader: ({ children }: { children: ReactNode }) => createElement("div", null, children),
  DialogTitle: ({ children }: { children: ReactNode }) => createElement("h2", null, children),
}));

let cleanup: (() => Promise<void>) | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requestHostedOnboardingJson.mockReset();
});

afterEach(async () => {
  if (cleanup) {
    await cleanup();
    cleanup = null;
  }
  vi.unstubAllGlobals();
});

describe("Clinical Records connect page", () => {
  it("scrubs the claim before search and sends it only in the exact SMART start body", async () => {
    const claim = `cr_${"a".repeat(32)}`;
    mocks.requestHostedOnboardingJson
      .mockResolvedValueOnce({
        directoryVersion: "test-v1",
        ok: true,
        providers: [{
          brandName: "Piedmont Healthcare",
          facilities: [{ city: "Atlanta", name: "Piedmont Atlanta", postalCode: "30309", state: "GA" }],
          id: "epic-piedmont",
          sourceSystem: "epic-fhir",
        }],
      })
      .mockResolvedValueOnce({
        authorizationUrl: "https://epic.example.test/oauth2/authorize?state=safe-state",
        expiresAt: "2026-07-16T18:15:00.000Z",
        ok: true,
      });

    const { RecordsConnectClient } = await import(
      "../app/(dashboard)/records/connect/records-connect-client"
    );
    const rendered = await renderClientComponent(
      createElement(RecordsConnectClient, { authenticated: true }),
      {
        location: {
          hash: `#clinicalRecordsIntent=${claim}`,
          href: `https://join.example.test/records/connect#clinicalRecordsIntent=${claim}`,
          origin: "https://join.example.test",
          pathname: "/records/connect",
          search: "",
        },
      },
    );
    cleanup = rendered.cleanup;

    expect(mocks.requestHostedOnboardingJson).not.toHaveBeenCalled();
    expect(rendered.replaceState).toHaveBeenCalled();
    expect(String(rendered.replaceState.mock.lastCall?.[2])).not.toContain(claim);

    await clickButton(rendered, "Accept health-data consent");
    const searchInput = rendered.container.querySelector("#clinical-provider-search");
    assert.ok(searchInput instanceof rendered.window.HTMLInputElement);
    await act(async () => {
      setInputValue(rendered.window, searchInput, " Piedmont ");
    });
    await clickButton(rendered, "Search");

    await vi.waitFor(() => {
      expect(mocks.requestHostedOnboardingJson).toHaveBeenNthCalledWith(1, {
        method: "POST",
        payload: { query: "Piedmont" },
        url: "/api/clinical-records/providers/search",
      });
    });
    expect(JSON.stringify(mocks.requestHostedOnboardingJson.mock.calls[0])).not.toContain(claim);
    expect(rendered.container.textContent).toContain("Piedmont Healthcare");

    await clickButton(rendered, "Continue");

    await vi.waitFor(() => {
      expect(mocks.requestHostedOnboardingJson).toHaveBeenNthCalledWith(2, {
        method: "POST",
        payload: {
          claim,
          providerDirectoryEntryId: "epic-piedmont",
        },
        url: "/api/clinical-records/connect-intents/start",
      });
      expect(rendered.assign).toHaveBeenCalledWith(
        "https://epic.example.test/oauth2/authorize?state=safe-state",
      );
    });
    expect(String(mocks.requestHostedOnboardingJson.mock.calls[1]?.[0]?.url)).not.toContain(claim);
  });

  it("blocks duplicate provider searches while the first request is pending", async () => {
    const claim = `cr_${"b".repeat(32)}`;
    let resolveSearch!: (value: unknown) => void;
    mocks.requestHostedOnboardingJson.mockReturnValueOnce(new Promise((resolve) => {
      resolveSearch = resolve;
    }));

    const { RecordsConnectClient } = await import(
      "../app/(dashboard)/records/connect/records-connect-client"
    );
    const rendered = await renderClientComponent(
      createElement(RecordsConnectClient, { authenticated: true }),
      {
        location: {
          hash: `#clinicalRecordsIntent=${claim}`,
          href: `https://join.example.test/records/connect#clinicalRecordsIntent=${claim}`,
          origin: "https://join.example.test",
          pathname: "/records/connect",
          search: "",
        },
      },
    );
    cleanup = rendered.cleanup;

    await clickButton(rendered, "Accept health-data consent");
    const input = rendered.container.querySelector("#clinical-provider-search");
    assert.ok(input instanceof rendered.window.HTMLInputElement);
    await act(async () => {
      setInputValue(rendered.window, input, "Atlanta");
    });
    const searchButton = findButton(rendered, "Search");

    await act(async () => {
      searchButton.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
      searchButton.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveSearch({ directoryVersion: "test-v1", ok: true, providers: [] });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(rendered.container.textContent).toContain("No matching Epic organizations found");
  });

  it("refuses a non-HTTPS provider authorization redirect", async () => {
    const claim = `cr_${"d".repeat(32)}`;
    mocks.requestHostedOnboardingJson
      .mockResolvedValueOnce({
        directoryVersion: "test-v1",
        ok: true,
        providers: [{
          brandName: "Piedmont Healthcare",
          facilities: [],
          id: "epic-piedmont",
          sourceSystem: "epic-fhir",
        }],
      })
      .mockResolvedValueOnce({
        authorizationUrl: "http://epic.example.test/oauth2/authorize",
        expiresAt: "2026-07-16T18:15:00.000Z",
        ok: true,
      });

    const { RecordsConnectClient } = await import(
      "../app/(dashboard)/records/connect/records-connect-client"
    );
    const rendered = await renderClientComponent(
      createElement(RecordsConnectClient, { authenticated: true }),
      {
        location: {
          hash: `#clinicalRecordsIntent=${claim}`,
          href: `https://join.example.test/records/connect#clinicalRecordsIntent=${claim}`,
          origin: "https://join.example.test",
          pathname: "/records/connect",
          search: "",
        },
      },
    );
    cleanup = rendered.cleanup;

    await clickButton(rendered, "Accept health-data consent");
    const input = rendered.container.querySelector("#clinical-provider-search");
    assert.ok(input instanceof rendered.window.HTMLInputElement);
    await act(async () => {
      setInputValue(rendered.window, input, "Piedmont");
    });
    await clickButton(rendered, "Search");
    await vi.waitFor(() => {
      expect(rendered.container.textContent).toContain("Piedmont Healthcare");
    });

    await clickButton(rendered, "Continue");

    await vi.waitFor(() => {
      expect(rendered.container.textContent).toContain(
        "Could not continue with Piedmont Healthcare",
      );
    });
    expect(rendered.assign).not.toHaveBeenCalled();
  });
});

describe("Clinical Records status page", () => {
  it("creates a fresh private intent from the empty state without provider authority", async () => {
    const claim = `cr_${"c".repeat(32)}`;
    mocks.requestHostedOnboardingJson.mockResolvedValue({
      claim,
      expiresAt: "2026-07-16T18:15:00.000Z",
      ok: true,
    });
    const { RecordsPageClient } = await import(
      "../app/(dashboard)/records/records-page-client"
    );
    const rendered = await renderClientComponent(createElement(RecordsPageClient, {
      authenticated: true,
      initialCallback: null,
      initialConnections: [],
      initialLoadError: false,
    }), {
      location: {
        hash: "",
        href: "https://join.example.test/records",
        origin: "https://join.example.test",
        pathname: "/records",
        search: "",
      },
      requireButton: false,
    });
    cleanup = rendered.cleanup;

    await clickButton(rendered, "Connect Epic");

    expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith({
      method: "POST",
      payload: {},
      url: "/api/clinical-records/connect-intents",
    });
    await vi.waitFor(() => {
      expect(rendered.assign).toHaveBeenCalledWith(
        `/records/connect#clinicalRecordsIntent=${claim}`,
      );
    });
  });

  it("renders truthful partial status, strips callback state, and disconnects once", async () => {
    const connection = makeConnection();
    mocks.requestHostedOnboardingJson.mockResolvedValue({
      connectionId: connection.connectionId,
      ok: true,
      status: "disconnected",
    });
    const { RecordsPageClient } = await import(
      "../app/(dashboard)/records/records-page-client"
    );
    const rendered = await renderClientComponent(createElement(RecordsPageClient, {
      authenticated: true,
      initialCallback: "connected",
      initialConnections: [connection],
      initialLoadError: false,
    }), {
      location: {
        hash: "",
        href: "https://join.example.test/records?clinicalRecords=connected&keep=1",
        origin: "https://join.example.test",
        pathname: "/records",
        search: "?clinicalRecords=connected&keep=1",
      },
      requireButton: false,
    });
    cleanup = rendered.cleanup;

    expect(rendered.container.textContent).toContain("Epic connected");
    expect(rendered.container.textContent).toContain("Partially imported");
    expect(rendered.container.textContent).toContain("3 imported");
    expect(String(rendered.replaceState.mock.lastCall?.[2])).toBe(
      "https://join.example.test/records?keep=1",
    );

    await clickButton(rendered, "Disconnect");
    const confirmButtons = Array.from(rendered.container.querySelectorAll("button"))
      .filter((button) => button.textContent?.trim() === "Disconnect");
    expect(confirmButtons).toHaveLength(2);
    await act(async () => {
      confirmButtons[1]?.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
      confirmButtons[1]?.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledTimes(1);
    expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith({
      method: "POST",
      url: "/api/clinical-records/connections/crc_1/disconnect",
    });
    await vi.waitFor(() => {
      expect(rendered.container.textContent).toContain("Results already imported into your vault stay there");
      expect(rendered.container.textContent).toContain("No active Epic connections");
      expect(rendered.container.textContent).not.toContain("Epic connected");
      expect(rendered.container.textContent).not.toContain("Partially imported");
    });
  });

  it("refreshes the server-rendered source of truth for an active import", async () => {
    const connection = makeConnection();
    const { RecordsPageClient } = await import(
      "../app/(dashboard)/records/records-page-client"
    );
    const rendered = await renderClientComponent(createElement(RecordsPageClient, {
      authenticated: true,
      initialCallback: null,
      initialConnections: [{
        ...connection,
        lastSyncCompletedAt: null,
        latestRun: {
          completedAt: null,
          importedCount: 0,
          reviewCount: 0,
          runId: "crr_1",
          status: "retrieving",
        },
      }],
      initialLoadError: false,
    }), {
      location: {
        hash: "",
        href: "https://join.example.test/records",
        origin: "https://join.example.test",
        pathname: "/records",
        search: "",
      },
      requireButton: false,
    });
    cleanup = rendered.cleanup;

    expect(rendered.container.textContent).toContain("Retrieving results");
    expect(rendered.container.querySelector('[role="status"]')?.textContent).toContain(
      "Retrieving results",
    );
    await clickButton(rendered, "Refresh status");

    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });
});

async function clickButton(
  rendered: Awaited<ReturnType<typeof renderClientComponent>>,
  label: string,
) {
  const button = findButton(rendered, label);
  await act(async () => {
    button.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
  });
}

function findButton(
  rendered: Awaited<ReturnType<typeof renderClientComponent>>,
  label: string,
): HTMLButtonElement {
  const button = Array.from(rendered.container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  assert.ok(button instanceof rendered.window.HTMLButtonElement, `Missing ${label} button`);
  return button;
}

function setInputValue(
  window: Window & typeof globalThis,
  input: HTMLInputElement,
  value: string,
) {
  const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
  if (descriptor?.set) {
    descriptor.set.call(input, value);
  } else {
    input.value = value;
  }
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
}

function makeConnection(): ClinicalRecordConnectionContract {
  return {
    connectedAt: "2026-07-16T18:00:00.000Z",
    connectionId: "crc_1",
    displayName: "Piedmont Healthcare",
    lastErrorCode: null,
    lastSyncCompletedAt: "2026-07-16T18:05:00.000Z",
    latestRun: {
      completedAt: "2026-07-16T18:05:00.000Z",
      importedCount: 3,
      reviewCount: 1,
      runId: "crr_1",
      status: "partial",
    },
    providerDirectoryEntryId: "epic-piedmont",
    sourceSystem: "epic-fhir",
    status: "active",
  };
}
