import { act, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { HostedLegalConsentCard } from "@/src/components/legal/hosted-legal-consent-card";
import type { HostedConsentStatus } from "@/src/lib/legal/consent";

import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => ({
  requestHostedOnboardingJson: vi.fn(),
  onAccepted: vi.fn(),
}));

vi.mock("@/src/components/hosted-onboarding/client-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/src/components/hosted-onboarding/client-api")>();

  return {
    ...actual,
    requestHostedOnboardingJson: mocks.requestHostedOnboardingJson,
  };
});

let cleanupRender: (() => Promise<void>) | null = null;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(async () => {
  if (cleanupRender) {
    await cleanupRender();
    cleanupRender = null;
  }
});

test("HostedLegalConsentCard uses tokenized flat card styling while loading", () => {
  const panelMarkup = renderToStaticMarkup(
    createElement(HostedLegalConsentCard, {
      source: "join-invite-phone-verify",
    }),
  );
  const compactMarkup = renderToStaticMarkup(
    createElement(HostedLegalConsentCard, {
      mode: "compact",
      source: "settings-device-sync",
    }),
  );

  expect(panelMarkup).toContain("rounded-2xl border border-border bg-card p-6");
  expect(compactMarkup).toContain("rounded-xl border border-border bg-card p-4");
  expect(panelMarkup).toContain('role="status"');
  expect(panelMarkup).toContain('aria-busy="true"');
  expect(panelMarkup).not.toContain("shadow-");
  expect(panelMarkup).not.toContain("#c4a882");
  expect(panelMarkup).not.toContain("#fefdf8");
});

test("HostedLegalConsentCard gates acceptance on the checkbox and posts current settings consent versions", async () => {
  const currentStatus = createConsentStatus({
    connectedHealthGranted: false,
    launchGranted: true,
  });
  const acceptedStatus = createConsentStatus({
    connectedHealthGranted: true,
    launchGranted: true,
  });

  mocks.requestHostedOnboardingJson
    .mockResolvedValueOnce(currentStatus)
    .mockResolvedValueOnce(acceptedStatus);

  const { cleanup, container, window } = await renderClientComponent(
    createElement(HostedLegalConsentCard, {
      mode: "compact",
      preferredScope: "feature.connected-health-source",
      source: "settings-device-sync",
      onAccepted: mocks.onAccepted,
    }),
  );
  cleanupRender = cleanup;

  await vi.waitFor(() => {
    expect(container.textContent).toContain("Connect health sources");
    expect(container.textContent).toContain("Murph Privacy Policy");
    expect(container.textContent).toContain("Murph Consumer Health Data Notice");
  });

  expect(container.textContent).not.toContain("Murph Terms of Service");

  const checkbox = container.querySelector('input[type="checkbox"]');
  expect(checkbox).toBeTruthy();
  expect((checkbox as HTMLInputElement).checked).toBe(false);

  const acceptButton = findButtonByText(container, /Accept and continue/);
  expect(acceptButton.disabled).toBe(true);

  await act(async () => {
    setCheckboxChecked(window, checkbox as HTMLInputElement, true);
  });

  expect((checkbox as HTMLInputElement).checked).toBe(true);
  await vi.waitFor(() => {
    expect(acceptButton.disabled).toBe(false);
  });

  await act(async () => {
    acceptButton.dispatchEvent(new window.Event("click", { bubbles: true }));
  });

  await vi.waitFor(() => {
    expect(mocks.requestHostedOnboardingJson).toHaveBeenNthCalledWith(1, {
      url: "/api/legal/consent/status",
    });
    expect(mocks.requestHostedOnboardingJson).toHaveBeenNthCalledWith(2, {
      method: "POST",
      payload: {
        acceptedDocumentVersions: {
          "consumer-health-data-notice": "2026-04-29",
          "privacy-policy": "2026-04-29",
        },
        scope: "feature.connected-health-source",
        source: "settings-device-sync",
      },
      url: "/api/legal/consent/accept",
    });
    expect(mocks.onAccepted).toHaveBeenCalledWith(acceptedStatus);
  });

  expect(container.textContent).not.toContain("Connect health sources");
  expect(container.querySelector("button")).toBeNull();
});

test("HostedLegalConsentCard marks the accept action busy while consent is recording", async () => {
  const currentStatus = createConsentStatus({
    connectedHealthGranted: false,
    launchGranted: true,
  });
  const acceptedStatus = createConsentStatus({
    connectedHealthGranted: true,
    launchGranted: true,
  });
  const acceptRequest = createDeferred<HostedConsentStatus>();

  mocks.requestHostedOnboardingJson
    .mockResolvedValueOnce(currentStatus)
    .mockReturnValueOnce(acceptRequest.promise);

  const { cleanup, container, window } = await renderClientComponent(
    createElement(HostedLegalConsentCard, {
      mode: "compact",
      preferredScope: "feature.connected-health-source",
      source: "settings-device-sync",
      onAccepted: mocks.onAccepted,
    }),
  );
  cleanupRender = cleanup;

  await vi.waitFor(() => {
    expect(container.textContent).toContain("Connect health sources");
  });

  const checkbox = container.querySelector('input[type="checkbox"]');
  expect(checkbox).toBeTruthy();

  await act(async () => {
    setCheckboxChecked(window, checkbox as HTMLInputElement, true);
  });

  const acceptButton = findButtonByText(container, /Accept and continue/);

  await act(async () => {
    acceptButton.dispatchEvent(new window.Event("click", { bubbles: true }));
  });

  await vi.waitFor(() => {
    expect(acceptButton.textContent).toContain("Recording...");
    expect(acceptButton.getAttribute("aria-busy")).toBe("true");
    expect(acceptButton.disabled).toBe(true);
  });

  await act(async () => {
    acceptRequest.resolve(acceptedStatus);
    await acceptRequest.promise;
  });

  await vi.waitFor(() => {
    expect(mocks.onAccepted).toHaveBeenCalledWith(acceptedStatus);
  });
});

test("HostedLegalConsentCard keeps a retryable error visible when consent status fails to load", async () => {
  const recoveredStatus = createConsentStatus({
    connectedHealthGranted: false,
    launchGranted: true,
  });

  mocks.requestHostedOnboardingJson
    .mockRejectedValueOnce(new Error("Consent status unavailable."))
    .mockResolvedValueOnce(recoveredStatus);

  const { cleanup, container, window } = await renderClientComponent(
    createElement(HostedLegalConsentCard, {
      mode: "compact",
      preferredScope: "feature.connected-health-source",
      source: "settings-device-sync",
      onRequirementChange: () => {},
    }),
  );
  cleanupRender = cleanup;

  await vi.waitFor(() => {
    expect(container.textContent).toContain("Unable to load Murph legal consent");
    expect(container.textContent).toContain("Consent status unavailable.");
  });

  const retryButton = findButtonByText(container, /Try again/);

  await act(async () => {
    retryButton.dispatchEvent(new window.Event("click", { bubbles: true }));
  });

  await vi.waitFor(() => {
    expect(container.textContent).toContain("Connect health sources");
  });

  expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledTimes(2);
});

function createConsentStatus(input: {
  connectedHealthGranted: boolean;
  launchGranted: boolean;
}): HostedConsentStatus {
  const launchDocuments = [
    consentDocument("terms-of-service", "Murph Terms of Service", "/legal/terms"),
    consentDocument("privacy-policy", "Murph Privacy Policy", "/legal/privacy"),
    consentDocument(
      "consumer-health-data-notice",
      "Murph Consumer Health Data Notice",
      "/consumer-health-data-privacy-policy",
    ),
    consentDocument(
      "health-ai-safety-disclosure",
      "Murph Health AI Safety Disclosure",
      "/legal/health-ai-safety-disclosure",
    ),
  ];
  const connectedHealthDocuments = launchDocuments.filter(
    (document) =>
      document.id === "privacy-policy" || document.id === "consumer-health-data-notice",
  );

  return {
    documents: launchDocuments,
    generatedAt: "2026-04-30T00:00:00.000Z",
    launchRequired: {
      granted: input.launchGranted,
      missingDocuments: input.launchGranted ? [] : launchDocuments,
      scope: "launch.required",
    },
    ok: true,
    schema: "murph.hosted-consent-status.v1",
    scopes: [
      consentScope("launch.required", "Launch-required legal consent", false, launchDocuments, input.launchGranted),
      consentScope(
        "feature.connected-health-source",
        "Connected health source consent",
        true,
        connectedHealthDocuments,
        input.connectedHealthGranted,
      ),
    ],
  };
}

function consentDocument(id: string, title: string, href: string) {
  return {
    href,
    id: id as HostedConsentStatus["documents"][number]["id"],
    pdfHref: `${href}.pdf`,
    title,
    version: "2026-04-29",
  };
}

function consentScope(
  scope: HostedConsentStatus["scopes"][number]["scope"],
  label: string,
  revocable: boolean,
  documents: HostedConsentStatus["documents"],
  granted: boolean,
): HostedConsentStatus["scopes"][number] {
  return {
    current: granted,
    documents,
    grant: null,
    granted,
    label,
    missingDocuments: granted ? [] : documents,
    revocable,
    scope,
  };
}

function findButtonByText(container: Element, pattern: RegExp): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")].find((candidate) =>
    pattern.test(candidate.textContent ?? ""),
  );
  expect(button).toBeTruthy();
  return button as HTMLButtonElement;
}

function setCheckboxChecked(
  window: Window & typeof globalThis,
  input: HTMLInputElement,
  checked: boolean,
) {
  input.checked = checked;
  input.dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }));
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
  input.dispatchEvent(new window.Event("change", { bubbles: true }));
}

function createDeferred<T>() {
  let resolvePromise: ((value: T) => void) | null = null;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });

  return {
    promise,
    resolve(value: T) {
      if (!resolvePromise) {
        throw new Error("Deferred promise resolver was not initialized.");
      }
      resolvePromise(value);
    },
  };
}
