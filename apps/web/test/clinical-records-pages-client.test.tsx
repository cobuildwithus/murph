import assert from "node:assert/strict";

import {
  act,
  createElement,
  StrictMode,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HostedOnboardingApiError } from "@/src/components/hosted-onboarding/client-api";
import type { ClinicalRecordConnectionContract } from "@/src/lib/clinical-records/client-contracts";

import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => ({
  inputProps: vi.fn(),
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
    mocks.inputProps(props);
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
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Clinical Records connect page", () => {
  it("announces preparation while the private connection claim is loading", async () => {
    const queueMicrotask = vi.fn();
    vi.stubGlobal("queueMicrotask", queueMicrotask);
    const { RecordsConnectClient } = await import(
      "../app/(dashboard)/records/connect/records-connect-client"
    );
    const rendered = await renderClientComponent(
      createElement(RecordsConnectClient, { authenticated: true }),
      { requireButton: false },
    );
    cleanup = rendered.cleanup;

    const loadingStatus = rendered.container.querySelector('[role="status"]');
    assert.ok(loadingStatus);
    expect(loadingStatus.getAttribute("aria-busy")).toBe("true");
    expect(loadingStatus.getAttribute("aria-label")).toBe("Preparing records connection");
    expect(queueMicrotask).toHaveBeenCalled();
  });

  it("creates the short-lived claim only after an authenticated launcher opens", async () => {
    const claim = `cr_${"l".repeat(32)}`;
    mocks.requestHostedOnboardingJson.mockResolvedValueOnce({
      claim,
      expiresAt: "2026-07-16T18:15:00.000Z",
      ok: true,
    });
    const { RecordsConnectClient } = await import(
      "../app/(dashboard)/records/connect/records-connect-client"
    );
    const rendered = await renderClientComponent(
      createElement(
        StrictMode,
        null,
        createElement(RecordsConnectClient, {
          authenticated: true,
          launchConnectIntent: true,
        }),
      ),
      {
        historyState: { __NA: true },
        location: {
          hash: "",
          href: "https://join.example.test/records/connect?launch=clinical-records",
          origin: "https://join.example.test",
          pathname: "/records/connect",
          search: "?launch=clinical-records",
        },
      },
    );
    cleanup = rendered.cleanup;

    await vi.waitFor(() => {
      expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledExactlyOnceWith({
        method: "POST",
        payload: {},
        url: "/api/clinical-records/connect-intents",
      });
      expect(rendered.replaceState).toHaveBeenCalledWith(
        expect.objectContaining({
          __NA: true,
          __murphClinicalRecordsConnectIntent: claim,
        }),
        "",
        "https://join.example.test/records/connect?launch=clinical-records",
      );
      expect(rendered.window.location.href).not.toContain(claim);
      expect(rendered.container.textContent).toContain(
        "Review how Murph uses your health data",
      );
    });
  });

  it("retries a transient launcher failure in place", async () => {
    const claim = `cr_${"r".repeat(32)}`;
    mocks.requestHostedOnboardingJson
      .mockRejectedValueOnce(new Error("temporary connect-intent failure"))
      .mockResolvedValueOnce({
        claim,
        expiresAt: "2026-07-16T18:15:00.000Z",
        ok: true,
      });
    const { RecordsConnectClient } = await import(
      "../app/(dashboard)/records/connect/records-connect-client"
    );
    const rendered = await renderClientComponent(
      createElement(RecordsConnectClient, {
        authenticated: true,
        launchConnectIntent: true,
      }),
      {
        historyState: {},
        location: {
          hash: "",
          href: "https://join.example.test/records/connect?launch=clinical-records",
          origin: "https://join.example.test",
          pathname: "/records/connect",
          search: "?launch=clinical-records",
        },
      },
    );
    cleanup = rendered.cleanup;

    await vi.waitFor(() => {
      expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledTimes(1);
      expect(rendered.container.textContent).toContain(
        "Couldn't start Clinical Records",
      );
    });
    const retryButton = Array.from(
      rendered.container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("Try again"));
    assert.ok(retryButton);
    await act(async () => {
      retryButton.dispatchEvent(new rendered.window.Event("click", {
        bubbles: true,
      }));
    });

    await vi.waitFor(() => {
      expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledTimes(2);
      expect(rendered.container.textContent).toContain(
        "Review how Murph uses your health data",
      );
      expect(rendered.window.location.href).not.toContain(claim);
    });
  });

  it("scrubs the claim, sends it only in the SMART start body, and closes a committed BFCache flow", async () => {
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
    const connectionProgress = rendered.container.querySelector(
      '[aria-label="Medical records connection progress"]',
    );
    assert.ok(connectionProgress);
    expect(connectionProgress.querySelector('[aria-current="step"]')?.textContent).toContain(
      "Review",
    );

    await clickButton(rendered, "Accept health-data consent");
    expect(rendered.container.textContent).toContain(
      "Murph copies records once. It does not keep checking your chart.",
    );
    expect(rendered.container.textContent).toContain("Where do you get care?");
    expect(rendered.container.textContent).toContain(
      "Murph supports selected portals right now.",
    );
    expect(rendered.container.textContent).not.toContain("Epic organization");
    expect(connectionProgress.textContent).toContain("Patient portal");
    expect(connectionProgress.querySelector('[aria-current="step"]')?.textContent).toContain(
      "Where you get care",
    );
    const searchInput = rendered.container.querySelector("#clinical-provider-search");
    assert.ok(searchInput instanceof rendered.window.HTMLInputElement);
    await act(async () => {
      setInputValue(rendered.window, searchInput, " Piedmont ");
    });
    await submitProviderSearch(rendered);

    await vi.waitFor(() => {
      expect(mocks.requestHostedOnboardingJson).toHaveBeenNthCalledWith(1, {
        method: "POST",
        payload: { query: "Piedmont" },
        url: "/api/clinical-records/providers/search",
      });
    });
    expect(JSON.stringify(mocks.requestHostedOnboardingJson.mock.calls[0])).not.toContain(claim);
    expect(rendered.container.textContent).toContain("Piedmont Healthcare");

    await clickButton(rendered, "Continue to portal");

    await vi.waitFor(() => {
      expect(mocks.requestHostedOnboardingJson).toHaveBeenNthCalledWith(2, {
        method: "POST",
        onSuccessfulResponseHeaders: expect.any(Function),
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
    expect(JSON.stringify(rendered.replaceState.mock.lastCall?.[0])).not.toContain(claim);
    expect(rendered.container.textContent).toContain("Opening portal");
    expect(connectionProgress.querySelector('[aria-current="step"]')?.textContent).toContain(
      "Where you get care",
    );

    await restoreFromBackForwardCache(rendered);

    expect(rendered.container.textContent).toContain("Connection link unavailable");
    expect(rendered.container.textContent).not.toContain("Piedmont Healthcare");
  });

  it("blocks duplicate searches and ignores a stale response after BFCache restore", async () => {
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
    await act(async () => {
      const form = input.closest("form");
      assert.ok(form);
      form.dispatchEvent(new rendered.window.Event("submit", {
        bubbles: true,
        cancelable: true,
      }));
      form.dispatchEvent(new rendered.window.Event("submit", {
        bubbles: true,
        cancelable: true,
      }));
      await Promise.resolve();
    });
    expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => {
      expect(input.hasAttribute("readOnly")).toBe(true);
    });

    await restoreFromBackForwardCache(rendered);

    expect(input.hasAttribute("readOnly")).toBe(false);
    expect(findButton(rendered, "Search").disabled).toBe(false);

    await act(async () => {
      resolveSearch({ directoryVersion: "test-v1", ok: true, providers: [] });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(rendered.container.textContent).not.toContain("No matches");
    expect(rendered.container.textContent).not.toContain("This portal may not be supported");
    await vi.waitFor(() => {
      expect(input.hasAttribute("readOnly")).toBe(false);
    });
  });

  it("closes a stale SMART start after its committed response reaches a BFCache-restored page", async () => {
    const claim = `cr_${"d".repeat(32)}`;
    let resolveStart!: (value: unknown) => void;
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
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveStart = resolve;
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
      setInputValue(rendered.window, input, "Piedmont");
    });
    await submitProviderSearch(rendered);
    await vi.waitFor(() => {
      expect(rendered.container.textContent).toContain("Piedmont Healthcare");
    });

    await clickButton(rendered, "Continue to portal");
    await vi.waitFor(() => {
      expect(rendered.container.textContent).toContain("Opening portal");
    });
    await restoreFromBackForwardCache(rendered);

    await act(async () => {
      resolveStart({
        authorizationUrl: "https://epic.example.test/oauth2/authorize?state=safe-state",
        expiresAt: "2026-07-16T18:15:00.000Z",
        ok: true,
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(rendered.assign).not.toHaveBeenCalled();
    expect(rendered.container.textContent).toContain("Connection link unavailable");
  });

  it("marks earlier results stale while a new search is pending", async () => {
    const claim = `cr_${"c".repeat(32)}`;
    let resolveSecondSearch!: (value: unknown) => void;
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
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveSecondSearch = resolve;
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
      setInputValue(rendered.window, input, "Piedmont");
    });
    await submitProviderSearch(rendered);
    await vi.waitFor(() => {
      expect(rendered.container.textContent).toContain("Piedmont Healthcare");
    });

    const results = rendered.container.querySelector("div[aria-busy]");
    assert.ok(results instanceof rendered.window.HTMLElement);
    expect(results.getAttribute("aria-busy")).toBe("false");
    expect(results.className).not.toContain("opacity-60");

    await submitProviderSearch(rendered);

    expect(results.getAttribute("aria-busy")).toBe("true");
    expect(results.className).toContain("opacity-60");

    await act(async () => {
      resolveSecondSearch({ directoryVersion: "test-v1", ok: true, providers: [] });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(rendered.container.textContent).toContain("No matches");
    expect(results.getAttribute("aria-busy")).toBe("false");
    expect(results.className).not.toContain("opacity-60");
  });

  it("moves keyboard focus into the provider search field when it appears", async () => {
    const claim = `cr_${"g".repeat(32)}`;
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

    const focusSpy = vi.spyOn(rendered.window.HTMLInputElement.prototype, "focus");
    await clickButton(rendered, "Accept health-data consent");

    const input = rendered.container.querySelector("#clinical-provider-search");
    assert.ok(input instanceof rendered.window.HTMLInputElement);
    expect(focusSpy.mock.instances).toContain(input);
  });

  it("leaves focus alone when the member is already interacting elsewhere", async () => {
    const claim = `cr_${"h".repeat(32)}`;
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

    const pageDocument = rendered.container.ownerDocument;
    assert.ok(pageDocument);
    const consentButton = findButton(rendered, "Accept health-data consent");
    Object.defineProperty(pageDocument, "activeElement", {
      configurable: true,
      value: consentButton,
    });
    const focusSpy = vi.spyOn(rendered.window.HTMLInputElement.prototype, "focus");
    await clickButton(rendered, "Accept health-data consent");

    const input = rendered.container.querySelector("#clinical-provider-search");
    assert.ok(input instanceof rendered.window.HTMLInputElement);
    expect(focusSpy.mock.instances).not.toContain(input);
  });

  it("uses native required validation for an empty provider search", async () => {
    const claim = `cr_${"e".repeat(32)}`;
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
    expect(input.hasAttribute("required")).toBe(true);
    expect(mocks.inputProps).toHaveBeenCalledWith(expect.objectContaining({ maxLength: 120 }));
    expect(findButton(rendered, "Search").getAttribute("type")).toBe("submit");

    const reportValidity = vi.fn(() => false);
    Object.defineProperty(input, "reportValidity", { value: reportValidity });
    await act(async () => {
      setInputValue(rendered.window, input, "   ");
    });
    await submitProviderSearch(rendered);

    expect(mocks.requestHostedOnboardingJson).not.toHaveBeenCalled();
    expect(rendered.container.textContent).not.toContain("Search unavailable");
    expect(input.value).toBe("");
    expect(reportValidity).toHaveBeenCalledTimes(1);
  });

  it("keeps keyboard focus in the search field when provider search fails", async () => {
    const claim = `cr_${"f".repeat(32)}`;
    const technicalMessage = "Clinical Records provider returned a raw FHIR directory error.";
    mocks.requestHostedOnboardingJson.mockRejectedValueOnce(new HostedOnboardingApiError({
      code: "CLINICAL_PROVIDER_DIRECTORY_ERROR",
      message: technicalMessage,
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
    const form = input?.closest("form");
    assert.ok(input instanceof rendered.window.HTMLInputElement);
    assert.ok(form);
    await act(async () => {
      input.focus();
      setInputValue(rendered.window, input, "Atlanta");
      form.dispatchEvent(new rendered.window.Event("submit", {
        bubbles: true,
        cancelable: true,
      }));
      await Promise.resolve();
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(rendered.container.textContent).toContain("Search unavailable");
      expect(rendered.container.textContent).toContain(
        "Hospitals and clinics could not be searched right now. Try again.",
      );
    });
    expect(rendered.container.textContent).not.toContain(technicalMessage);
    expect(input.hasAttribute("disabled")).toBe(false);
    expect(input.hasAttribute("readOnly")).toBe(false);
  });

  it("closes a committed connection flow when a successful response has a non-HTTPS redirect", async () => {
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
    await submitProviderSearch(rendered);
    await vi.waitFor(() => {
      expect(rendered.container.textContent).toContain("Piedmont Healthcare");
    });

    await clickButton(rendered, "Continue to portal");

    await vi.waitFor(() => {
      expect(rendered.container.textContent).toContain("Connection link unavailable");
    });
    expect(rendered.assign).not.toHaveBeenCalled();
  });

  it("does not resurrect a server-rejected connection claim after remount", async () => {
    const claim = `cr_${"e".repeat(32)}`;
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
      .mockRejectedValueOnce(new HostedOnboardingApiError({
        code: "CLINICAL_RECORD_CONNECT_INTENT_USED",
        message: "This connection link has already been used.",
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
      setInputValue(rendered.window, input, "Piedmont");
    });
    await submitProviderSearch(rendered);
    await vi.waitFor(() => {
      expect(rendered.container.textContent).toContain("Piedmont Healthcare");
    });
    await clickButton(rendered, "Continue to portal");
    await vi.waitFor(() => {
      expect(rendered.container.textContent).toContain("Connection link unavailable");
    });

    await rendered.rerender(createElement(RecordsConnectClient, {
      authenticated: true,
      key: "reloaded",
    }));

    expect(rendered.container.textContent).toContain("Connection link unavailable");
    expect(rendered.container.textContent).not.toContain("Accept health-data consent");
    expect(JSON.stringify(rendered.window.history.state)).not.toContain(claim);
  });
});

describe("Clinical Records status page", () => {
  it("creates a fresh private intent from the empty state without provider authority", async () => {
    const claim = `cr_${"c".repeat(32)}`;
    const technicalMessage = "Clinical Records connect-intent issuance failed.";
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

    expect(rendered.container.textContent).toContain("Connect a supported patient portal.");
    expect(rendered.container.textContent).toContain(
      "Murph copies available lab results and report summaries once",
    );

    await clickButton(rendered, "Connect records");

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
    expect(rendered.container.textContent).toContain("Getting things ready");

    await restoreFromBackForwardCache(rendered);

    expect(findButton(rendered, "Connect records").disabled).toBe(false);

    mocks.requestHostedOnboardingJson.mockRejectedValueOnce(new HostedOnboardingApiError({
      code: "CLINICAL_RECORD_CONNECT_INTENT_FAILED",
      message: technicalMessage,
    }));
    await clickButton(rendered, "Connect records");

    await vi.waitFor(() => {
      expect(rendered.container.textContent).toContain(
        "Murph could not get the records connection ready. Try again.",
      );
    });
    expect(rendered.container.textContent).not.toContain(technicalMessage);
  });

  it("ignores a stale private-intent response after BFCache restore", async () => {
    const claim = `cr_${"e".repeat(32)}`;
    let resolveIntent!: (value: unknown) => void;
    mocks.requestHostedOnboardingJson.mockReturnValueOnce(new Promise((resolve) => {
      resolveIntent = resolve;
    }));
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

    await clickButton(rendered, "Connect records");
    expect(rendered.container.textContent).toContain("Getting things ready");
    await restoreFromBackForwardCache(rendered);

    await act(async () => {
      resolveIntent({
        claim,
        expiresAt: "2026-07-16T18:15:00.000Z",
        ok: true,
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(rendered.assign).not.toHaveBeenCalled();
    expect(findButton(rendered, "Connect records").disabled).toBe(false);
  });

  it("renders truthful partial status, strips callback state, and deduplicates disconnect attempts", async () => {
    const connection = makeConnection();
    const technicalMessage = "Clinical Records credential revocation failed upstream.";
    mocks.requestHostedOnboardingJson
      .mockRejectedValueOnce(new HostedOnboardingApiError({
        code: "CLINICAL_RECORD_DISCONNECT_FAILED",
        message: technicalMessage,
      }))
      .mockResolvedValueOnce({
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

    expect(rendered.container.querySelector('[role="alert"]')).toBeNull();
    expect(rendered.container.textContent).toContain("Partly complete");
    expect(rendered.container.textContent).toContain(
      "Murph added some lab results or report summaries, but part of the copy could not finish.",
    );
    const addedLabel = Array.from(rendered.container.querySelectorAll("p"))
      .find((paragraph) => paragraph.textContent === "Added");
    assert.ok(addedLabel);
    expect(addedLabel.nextElementSibling?.textContent).toBe("3");
    const reviewLabel = Array.from(rendered.container.querySelectorAll("p"))
      .find((paragraph) => paragraph.textContent === "Held for review");
    assert.ok(reviewLabel);
    expect(reviewLabel.nextElementSibling?.textContent).toBe("1");
    const partialBadge = Array.from(rendered.container.querySelectorAll("span"))
      .find((span) => span.textContent === "Partly complete");
    assert.ok(partialBadge);
    expect(partialBadge.className).not.toContain("bg-primary");
    expect(String(rendered.replaceState.mock.lastCall?.[2])).toBe(
      "https://join.example.test/records?keep=1",
    );

    await clickButton(rendered, "Disconnect");
    expect(Array.from(rendered.container.querySelectorAll("button"))
      .slice(-2)
      .map((button) => button.textContent?.trim())).toEqual(["Cancel", "Disconnect"]);
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
    expect(mocks.requestHostedOnboardingJson).toHaveBeenLastCalledWith({
      method: "POST",
      url: "/api/clinical-records/connections/crc_1/disconnect",
    });
    await vi.waitFor(() => {
      expect(rendered.container.textContent).toContain(
        "Could not disconnect Piedmont Healthcare. Try again.",
      );
    });
    expect(rendered.container.textContent).not.toContain(technicalMessage);

    await act(async () => {
      confirmButtons[1]?.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
      confirmButtons[1]?.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledTimes(2);
    expect(mocks.requestHostedOnboardingJson).toHaveBeenLastCalledWith({
      method: "POST",
      url: "/api/clinical-records/connections/crc_1/disconnect",
    });
    await vi.waitFor(() => {
      expect(rendered.container.textContent).toContain("Results already copied into Murph stay there");
      expect(rendered.container.textContent).toContain("No patient portals connected");
      expect(rendered.container.textContent).not.toContain("Partly complete");
    });
    const disconnectNotice = Array.from(rendered.container.querySelectorAll('[role="alert"]'))
      .find((alert) => alert.textContent?.includes("Patient portal disconnected"));
    assert.ok(disconnectNotice);
    expect(disconnectNotice.getAttribute("tabindex")).toBe("-1");
    expect(disconnectNotice.className).toContain("focus-visible:ring-2");
    expect(disconnectNotice.className).not.toContain("focus:ring-2");
  });

  it("ignores a stale disconnect response after BFCache restore", async () => {
    const connection = makeConnection();
    let resolveDisconnect!: (value: unknown) => void;
    mocks.requestHostedOnboardingJson.mockReturnValueOnce(new Promise((resolve) => {
      resolveDisconnect = resolve;
    }));
    const { RecordsPageClient } = await import(
      "../app/(dashboard)/records/records-page-client"
    );
    const rendered = await renderClientComponent(createElement(RecordsPageClient, {
      authenticated: true,
      initialCallback: null,
      initialConnections: [connection],
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

    await clickButton(rendered, "Disconnect");
    const confirmButtons = Array.from(rendered.container.querySelectorAll("button"))
      .filter((button) => button.textContent?.trim() === "Disconnect");
    expect(confirmButtons).toHaveLength(2);
    await act(async () => {
      confirmButtons[1]?.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(rendered.container.textContent).toContain("Disconnecting");
    await restoreFromBackForwardCache(rendered);

    await act(async () => {
      resolveDisconnect({
        connectionId: connection.connectionId,
        ok: true,
        status: "disconnected",
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(rendered.container.textContent).toContain(connection.displayName);
    expect(rendered.container.textContent).toContain("Partly complete");
    expect(rendered.container.textContent).not.toContain("No patient portals connected");
    expect(rendered.container.textContent).not.toContain("Patient portal disconnected");
  });

  it("derives terminal copy from the status and added count", async () => {
    const connection = makeConnection();
    const { RecordsPageClient } = await import(
      "../app/(dashboard)/records/records-page-client"
    );
    const renderWithConnection = (nextConnection: ClinicalRecordConnectionContract) =>
      createElement(RecordsPageClient, {
        authenticated: true,
        initialCallback: null,
        initialConnections: [nextConnection],
        initialLoadError: false,
      });
    const rendered = await renderClientComponent(renderWithConnection({
      ...connection,
      latestRun: {
        completedAt: "2026-07-16T18:15:00.000Z",
        importedCount: 3,
        reviewCount: 0,
        runId: "crr_complete",
        status: "complete",
      },
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

    const completeBadge = Array.from(rendered.container.querySelectorAll("span"))
      .find((span) => span.textContent === "Copy complete");
    assert.ok(completeBadge);
    expect(completeBadge.className).toContain("bg-primary");
    expect(rendered.container.textContent).toContain(
      "The totals below show how many lab results and report summaries were added",
    );

    await rendered.rerender(renderWithConnection({
      ...connection,
      latestRun: {
        completedAt: "2026-07-16T18:15:00.000Z",
        importedCount: 0,
        reviewCount: 1,
        runId: "crr_complete_empty",
        status: "complete",
      },
    }));
    const nothingAddedBadge = Array.from(rendered.container.querySelectorAll("span"))
      .find((span) => span.textContent === "Nothing added");
    assert.ok(nothingAddedBadge);
    expect(nothingAddedBadge.className).not.toContain("bg-primary");
    expect(rendered.container.textContent).toContain(
      "Murph finished this copy, but nothing was added.",
    );

    await rendered.rerender(renderWithConnection({
      ...connection,
      latestRun: {
        completedAt: "2026-07-16T18:15:00.000Z",
        importedCount: 0,
        reviewCount: 0,
        runId: "crr_partial_empty",
        status: "partial",
      },
    }));
    const emptyPartialBadge = Array.from(rendered.container.querySelectorAll("span"))
      .find((span) => span.textContent === "Could not finish");
    assert.ok(emptyPartialBadge);
    expect(emptyPartialBadge.className).not.toContain("bg-primary");
    expect(rendered.container.textContent).toContain(
      "Part of the copy could not finish, and nothing was added.",
    );

    await rendered.rerender(renderWithConnection({
      ...connection,
      status: "needs_reauth",
    }));
    const reauthorizationBadge = Array.from(rendered.container.querySelectorAll("span"))
      .find((span) => span.textContent === "Portal access ended");
    assert.ok(reauthorizationBadge);
    expect(reauthorizationBadge.className).not.toContain("bg-primary");
    expect(rendered.container.textContent).toContain(
      "Access from your patient portal ended before Murph finished copying records. Connecting it again is not available in this beta.",
    );

    await rendered.rerender(renderWithConnection({
      ...connection,
      status: "error",
    }));
    const failedBadge = Array.from(rendered.container.querySelectorAll("span"))
      .find((span) => span.textContent === "Could not add records");
    assert.ok(failedBadge);
    expect(failedBadge.className).not.toContain("bg-primary");
    expect(rendered.container.textContent).toContain(
      "Murph could not finish copying records. Anything already saved remains in your private vault.",
    );
  });

  it("presents a declined Epic callback as a neutral outcome", async () => {
    const { RecordsPageClient } = await import(
      "../app/(dashboard)/records/records-page-client"
    );
    const rendered = await renderClientComponent(createElement(RecordsPageClient, {
      authenticated: true,
      initialCallback: "declined",
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

    const callbackNotice = Array.from(rendered.container.querySelectorAll('[role="alert"]'))
      .find((alert) => alert.textContent?.includes("Connection canceled"));
    assert.ok(callbackNotice);
    expect(callbackNotice.textContent).toContain("The patient portal was not connected and no records were copied.");
    expect(callbackNotice.className).toContain("before:bg-border");
    expect(callbackNotice.className).not.toContain("before:bg-primary");
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

    expect(rendered.container.textContent).toContain("Getting records");
    expect(rendered.container.querySelector('[role="status"]')?.textContent).toContain(
      "Getting records",
    );
    const copyProgress = rendered.container.querySelector('[aria-label="Records copy progress"]');
    assert.ok(copyProgress);
    expect(copyProgress.querySelector('[aria-current="step"]')?.textContent).toBe("Copying");
    await clickButton(rendered, "Refresh status");

    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("updates on its own and shows a live indicator while an import is running", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
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
          status: "importing",
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

    expect(rendered.container.textContent).toContain(
      "This page updates on its own while Murph is copying records.",
    );
    expect(rendered.container.querySelector('[role="status"]')?.textContent).toContain("Loading");
    const copyProgress = rendered.container.querySelector('[aria-label="Records copy progress"]');
    assert.ok(copyProgress);
    expect(copyProgress.querySelector('[aria-current="step"]')?.textContent).toBe("Saving");

    await act(async () => {
      vi.advanceTimersByTime(15_000);
    });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    expect(mocks.refresh).toHaveBeenCalledTimes(3);
  });

  it("stays static without a live indicator once every import is settled", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const { RecordsPageClient } = await import(
      "../app/(dashboard)/records/records-page-client"
    );
    const rendered = await renderClientComponent(createElement(RecordsPageClient, {
      authenticated: true,
      initialCallback: null,
      initialConnections: [makeConnection()],
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

    expect(rendered.container.textContent).not.toContain(
      "This page updates on its own while Murph is copying records.",
    );
    expect(rendered.container.querySelector('[role="status"]')?.textContent).not.toContain("Loading");

    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("skips the scheduled refresh while the tab is hidden and resumes when visible", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const { RecordsPageClient } = await import(
      "../app/(dashboard)/records/records-page-client"
    );
    const rendered = await renderClientComponent(
      createElement(RecordsPageClient, {
        authenticated: true,
        initialCallback: null,
        initialConnections: [makeImportingConnection()],
        initialLoadError: false,
      }),
      { location: makeRecordsLocation(), requireButton: false },
    );
    cleanup = rendered.cleanup;

    const pageDocument = rendered.container.ownerDocument;
    assert.ok(pageDocument);
    Object.defineProperty(pageDocument, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    expect(mocks.refresh).not.toHaveBeenCalled();

    Object.defineProperty(pageDocument, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    await act(async () => {
      vi.advanceTimersByTime(15_000);
    });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("catches up as soon as a hidden tab becomes visible again", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const { RecordsPageClient } = await import(
      "../app/(dashboard)/records/records-page-client"
    );
    const rendered = await renderClientComponent(
      createElement(RecordsPageClient, {
        authenticated: true,
        initialCallback: null,
        initialConnections: [makeImportingConnection()],
        initialLoadError: false,
      }),
      { location: makeRecordsLocation(), requireButton: false },
    );
    cleanup = rendered.cleanup;

    const pageDocument = rendered.container.ownerDocument;
    assert.ok(pageDocument);
    Object.defineProperty(pageDocument, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    expect(mocks.refresh).not.toHaveBeenCalled();

    Object.defineProperty(pageDocument, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    await act(async () => {
      pageDocument.dispatchEvent(new rendered.window.Event("visibilitychange"));
    });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("stops updating on its own once the last active import settles", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const { RecordsPageClient } = await import(
      "../app/(dashboard)/records/records-page-client"
    );
    const renderWithConnection = (nextConnection: ClinicalRecordConnectionContract) =>
      createElement(RecordsPageClient, {
        authenticated: true,
        initialCallback: null,
        initialConnections: [nextConnection],
        initialLoadError: false,
      });
    const rendered = await renderClientComponent(
      renderWithConnection(makeImportingConnection()),
      { location: makeRecordsLocation(), requireButton: false },
    );
    cleanup = rendered.cleanup;

    await act(async () => {
      vi.advanceTimersByTime(15_000);
    });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);

    await rendered.rerender(renderWithConnection({
      ...makeConnection(),
      latestRun: {
        completedAt: "2026-07-16T18:15:00.000Z",
        importedCount: 3,
        reviewCount: 0,
        runId: "crr_1",
        status: "complete",
      },
    }));

    expect(rendered.container.textContent).not.toContain(
      "This page updates on its own while Murph is copying records.",
    );
    expect(rendered.container.querySelector('[role="status"]')?.textContent).not.toContain("Loading");
    await act(async () => {
      vi.advanceTimersByTime(45_000);
    });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("stops updating on its own when the page unmounts mid-import", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const { RecordsPageClient } = await import(
      "../app/(dashboard)/records/records-page-client"
    );
    const rendered = await renderClientComponent(
      createElement(RecordsPageClient, {
        authenticated: true,
        initialCallback: null,
        initialConnections: [makeImportingConnection()],
        initialLoadError: false,
      }),
      { location: makeRecordsLocation(), requireButton: false },
    );

    await act(async () => {
      vi.advanceTimersByTime(15_000);
    });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);

    await rendered.cleanup();
    vi.advanceTimersByTime(45_000);
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

async function submitProviderSearch(
  rendered: Awaited<ReturnType<typeof renderClientComponent>>,
) {
  const form = rendered.container.querySelector('form[role="search"]');
  assert.ok(form);
  await act(async () => {
    form.dispatchEvent(new rendered.window.Event("submit", {
      bubbles: true,
      cancelable: true,
    }));
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function restoreFromBackForwardCache(
  rendered: Awaited<ReturnType<typeof renderClientComponent>>,
) {
  const event = new rendered.window.Event("pageshow");
  Object.defineProperty(event, "persisted", { value: true });
  await act(async () => {
    rendered.window.dispatchEvent(event);
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

function makeImportingConnection(): ClinicalRecordConnectionContract {
  return {
    ...makeConnection(),
    lastSyncCompletedAt: null,
    latestRun: {
      completedAt: null,
      importedCount: 0,
      reviewCount: 0,
      runId: "crr_1",
      status: "importing",
    },
  };
}

function makeRecordsLocation(): Record<string, string> {
  return {
    hash: "",
    href: "https://join.example.test/records",
    origin: "https://join.example.test",
    pathname: "/records",
    search: "",
  };
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
