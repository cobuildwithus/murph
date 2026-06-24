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
      source: "test-device-sync",
    }),
  );

  expect(panelMarkup).toContain("rounded-2xl border border-border bg-card p-6");
  expect(compactMarkup).toContain("w-full");
  expect(compactMarkup).not.toContain("rounded-xl border border-border bg-card p-4");
  expect(panelMarkup).toContain('role="status"');
  expect(panelMarkup).toContain('aria-busy="true"');
  expect(panelMarkup).not.toContain("shadow-");
  expect(panelMarkup).not.toContain("#c4a882");
  expect(panelMarkup).not.toContain("#fefdf8");
});

test("HostedLegalConsentCard can render server-provided launch consent status without refetching", async () => {
  const initialStatus = createConsentStatus({
    connectedHealthGranted: false,
    launchGranted: false,
  });

  const { cleanup, container } = await renderClientComponent(
    createElement(HostedLegalConsentCard, {
      initialStatus,
      mode: "compact",
      source: "join-invite-phone-verify",
    }),
    { requireButton: false },
  );
  cleanupRender = cleanup;

  await vi.waitFor(() => {
    expect(container.textContent).toContain("Terms of Service");
    expect(container.textContent).toContain("Consumer Health Data Notice");
  });

  expect(mocks.requestHostedOnboardingJson).not.toHaveBeenCalled();
});

test("HostedLegalConsentCard gates acceptance on the checkbox and holds the UI during handoff", async () => {
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
      source: "test-device-sync",
      onAccepted: mocks.onAccepted,
    }),
    { requireButton: false },
  );
  cleanupRender = cleanup;

  await vi.waitFor(() => {
    expect(container.textContent).toContain("Murph Privacy Policy");
    expect(container.textContent).toContain("Murph Consumer Health Data Notice");
  });

  expect(container.textContent).not.toContain("Murph Terms of Service");

  const checkbox = container.querySelector('input[type="checkbox"]');
  expect(checkbox).toBeTruthy();
  expect((checkbox as HTMLInputElement).checked).toBe(false);

  const acceptButton = findButtonByText(container, /Continue/);
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
          "privacy-policy": "2026-06-24",
        },
        scope: "feature.connected-health-source",
        source: "test-device-sync",
      },
      url: "/api/legal/consent/accept",
    });
    expect(mocks.onAccepted).toHaveBeenCalledWith(acceptedStatus);
  });

  expect(container.textContent).toContain("Murph Privacy Policy");
  expect(container.textContent).toContain("Murph Consumer Health Data Notice");
  expect(container.textContent).toContain("Continuing...");
  expect(acceptButton.getAttribute("aria-busy")).toBe("true");
  expect(acceptButton.disabled).toBe(true);
});

test("HostedLegalConsentCard records launch consent only after both checkboxes and Continue", async () => {
  const currentStatus = createConsentStatus({
    connectedHealthGranted: false,
    launchGranted: false,
  });
  const legalAcceptedStatus = createConsentStatus({
    connectedHealthGranted: false,
    launchHealthDataGranted: false,
    launchLegalGranted: true,
  });
  const acceptedStatus = createConsentStatus({
    connectedHealthGranted: false,
    launchGranted: true,
  });

  mocks.requestHostedOnboardingJson
    .mockResolvedValueOnce(currentStatus)
    .mockResolvedValueOnce(legalAcceptedStatus)
    .mockResolvedValueOnce(acceptedStatus);

  const { cleanup, container, window } = await renderClientComponent(
    createElement(HostedLegalConsentCard, {
      source: "homepage-signup-dialog",
      onAccepted: mocks.onAccepted,
    }),
    { requireButton: false },
  );
  cleanupRender = cleanup;

  await vi.waitFor(() => {
    expect(container.textContent).toContain("Before you start");
    expect(container.textContent).toContain("Terms of Service");
    expect(container.textContent).toContain("Consumer Health Data Notice");
  });

  const checkboxes = [...container.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[];
  expect(checkboxes).toHaveLength(2);
  const continueButton = findButtonByText(container, /Continue/);
  expect(continueButton.disabled).toBe(true);

  await act(async () => {
    setCheckboxChecked(window, checkboxes[0]!, true);
  });

  expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledTimes(1);
  expect(checkboxes[0]?.checked).toBe(true);
  expect(container.textContent).toContain("Terms of Service");
  expect(continueButton.disabled).toBe(true);

  await act(async () => {
    setCheckboxChecked(window, checkboxes[1]!, true);
  });

  expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledTimes(1);
  expect(checkboxes[0]?.checked).toBe(true);
  expect(checkboxes[1]?.checked).toBe(true);
  expect(container.textContent).toContain("Consumer Health Data Notice");
  await vi.waitFor(() => {
    expect(continueButton.disabled).toBe(false);
  });

  await act(async () => {
    continueButton.dispatchEvent(new window.Event("click", { bubbles: true }));
  });

  await vi.waitFor(() => {
    expect(mocks.requestHostedOnboardingJson).toHaveBeenNthCalledWith(2, {
      method: "POST",
      payload: {
        acceptedDocumentVersions: {
          "health-ai-safety-disclosure": "2026-04-29",
          "privacy-policy": "2026-06-24",
          "terms-of-service": "2026-04-29",
        },
        scope: "launch.legal",
        source: "homepage-signup-dialog",
      },
      url: "/api/legal/consent/accept",
    });
    expect(mocks.requestHostedOnboardingJson).toHaveBeenNthCalledWith(3, {
      method: "POST",
      payload: {
        acceptedDocumentVersions: {
          "consumer-health-data-notice": "2026-04-29",
        },
        scope: "launch.health-data",
        source: "homepage-signup-dialog",
      },
      url: "/api/legal/consent/accept",
    });
    expect(mocks.onAccepted).toHaveBeenCalledWith(acceptedStatus);
  });
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
      source: "test-device-sync",
      onAccepted: mocks.onAccepted,
    }),
    { requireButton: false },
  );
  cleanupRender = cleanup;

  await vi.waitFor(() => {
    expect(container.textContent).toContain("I agree to the above");
  });

  const checkbox = container.querySelector('input[type="checkbox"]');
  expect(checkbox).toBeTruthy();

  await act(async () => {
    setCheckboxChecked(window, checkbox as HTMLInputElement, true);
  });

  const acceptButton = findButtonByText(container, /Continue/);

  await act(async () => {
    acceptButton.dispatchEvent(new window.Event("click", { bubbles: true }));
  });

  await vi.waitFor(() => {
    expect(acceptButton.textContent).toContain("Saving...");
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

test("HostedLegalConsentCard keeps accepted consent visible during a route handoff", async () => {
  const currentStatus = createConsentStatus({
    connectedHealthGranted: false,
    launchGranted: false,
  });
  const legalAcceptedStatus = createConsentStatus({
    connectedHealthGranted: false,
    launchHealthDataGranted: false,
    launchLegalGranted: true,
  });
  const acceptedStatus = createConsentStatus({
    connectedHealthGranted: false,
    launchGranted: true,
  });

  mocks.requestHostedOnboardingJson
    .mockResolvedValueOnce(legalAcceptedStatus)
    .mockResolvedValueOnce(acceptedStatus);

  const { cleanup, container, window } = await renderClientComponent(
    createElement(HostedLegalConsentCard, {
      acceptedPendingLabel: "Continuing...",
      initialStatus: currentStatus,
      mode: "compact",
      source: "join-invite-phone-verify",
      onAccepted: mocks.onAccepted,
    }),
    { requireButton: false },
  );
  cleanupRender = cleanup;

  await vi.waitFor(() => {
    expect(container.textContent).toContain("Terms of Service");
    expect(container.textContent).toContain("Consumer Health Data Notice");
  });

  const checkboxes = [...container.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[];
  expect(checkboxes).toHaveLength(2);

  for (const checkbox of checkboxes) {
    await act(async () => {
      setCheckboxChecked(window, checkbox, true);
    });
  }

  const continueButton = findButtonByText(container, /Continue/);

  await act(async () => {
    continueButton.dispatchEvent(new window.Event("click", { bubbles: true }));
  });

  await vi.waitFor(() => {
    expect(mocks.onAccepted).toHaveBeenCalledWith(acceptedStatus);
  });

  expect(container.textContent).toContain("Terms of Service");
  expect(container.textContent).toContain("Consumer Health Data Notice");
  expect(container.textContent).toContain("Continuing...");
  expect(continueButton.getAttribute("aria-busy")).toBe("true");
  expect(continueButton.disabled).toBe(true);
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
      source: "test-device-sync",
      onRequirementChange: () => {},
    }),
    { requireButton: false },
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
    expect(container.textContent).toContain("I agree to the above");
  });

  expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledTimes(2);
});

function createConsentStatus(input: {
  connectedHealthGranted: boolean;
  launchGranted?: boolean;
  launchHealthDataGranted?: boolean;
  launchLegalGranted?: boolean;
}): HostedConsentStatus {
  const legalDocuments = [
    consentDocument("terms-of-service", "Murph Terms of Service", "/legal/terms"),
    consentDocument("privacy-policy", "Murph Privacy Policy", "/legal/privacy"),
    consentDocument(
      "health-ai-safety-disclosure",
      "Murph Health AI Safety Disclosure",
      "/legal/health-ai-safety-disclosure",
    ),
  ];
  const healthDataDocuments = [
    consentDocument(
      "consumer-health-data-notice",
      "Murph Consumer Health Data Notice",
      "/consumer-health-data-privacy-policy",
    ),
  ];
  const allDocuments = [...legalDocuments, ...healthDataDocuments];
  const connectedHealthDocuments = allDocuments.filter(
    (document) =>
      document.id === "privacy-policy" || document.id === "consumer-health-data-notice",
  );
  const launchLegalGranted = input.launchLegalGranted ?? input.launchGranted ?? false;
  const launchHealthDataGranted = input.launchHealthDataGranted ?? input.launchGranted ?? false;
  const launchGranted = launchLegalGranted && launchHealthDataGranted;

  return {
    documents: allDocuments,
    generatedAt: "2026-04-30T00:00:00.000Z",
    launchGranted,
    launchScopes: [
      { granted: launchLegalGranted, missingDocuments: launchLegalGranted ? [] : legalDocuments, scope: "launch.legal" as const },
      { granted: launchHealthDataGranted, missingDocuments: launchHealthDataGranted ? [] : healthDataDocuments, scope: "launch.health-data" as const },
    ],
    ok: true,
    schema: "murph.hosted-consent-status.v1",
    scopes: [
      consentScope("launch.legal", "Terms, privacy, and AI disclosure", false, legalDocuments, launchLegalGranted),
      consentScope("launch.health-data", "Health data collection consent", false, healthDataDocuments, launchHealthDataGranted),
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
    version: id === "privacy-policy" ? "2026-06-24" : "2026-04-29",
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
