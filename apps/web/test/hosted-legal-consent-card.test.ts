import { act, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { HostedLegalConsentCard } from "@/src/components/legal/hosted-legal-consent-card";
import type { HostedConsentStatus } from "@/src/lib/legal/consent";

import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => ({
  onAccepted: vi.fn(),
  requestHostedOnboardingJson: vi.fn(),
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
  expect(panelMarkup).toContain('role="status"');
  expect(panelMarkup).toContain('aria-busy="true"');
  expect(panelMarkup).not.toContain("shadow-");
  expect(panelMarkup).not.toContain("#c4a882");
  expect(panelMarkup).not.toContain("#fefdf8");
});

test("launch consent renders one enabled affirmative action without checkboxes", async () => {
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
    expect(container.textContent).toContain("Use your health data with Murph");
    expect(container.textContent).toContain("contracted AI providers");
  });

  expect(container.textContent).toContain("Terms");
  expect(container.textContent).toContain("Privacy");
  expect(container.textContent).toContain("AI Safety");
  expect(container.textContent).toContain("Health Data Notice");
  expect(container.querySelector('input[type="checkbox"]')).toBeNull();

  const continueButton = findButtonByText(container, /Agree, consent & continue/);
  expect(continueButton.disabled).toBe(false);
  expect(mocks.requestHostedOnboardingJson).not.toHaveBeenCalled();
});

test("launch consent records both launch scopes from one click", async () => {
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
      mode: "compact",
      onAccepted: mocks.onAccepted,
      source: "homepage-signup-dialog",
    }),
    { requireButton: false },
  );
  cleanupRender = cleanup;

  await vi.waitFor(() => {
    expect(container.textContent).toContain("Use your health data with Murph");
  });

  expect(container.querySelector('input[type="checkbox"]')).toBeNull();
  const continueButton = findButtonByText(container, /Agree, consent & continue/);

  await act(async () => {
    continueButton.dispatchEvent(new window.Event("click", { bubbles: true }));
  });

  await vi.waitFor(() => {
    expect(mocks.requestHostedOnboardingJson).toHaveBeenNthCalledWith(1, {
      url: "/api/legal/consent/status",
    });
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

  expect(container.textContent).toContain("Continuing...");
  expect(continueButton.getAttribute("aria-busy")).toBe("true");
  expect(continueButton.disabled).toBe(true);
});

test("a legal-only update uses concise legal copy and records only that scope", async () => {
  const currentStatus = createConsentStatus({
    connectedHealthGranted: false,
    launchHealthDataGranted: true,
    launchLegalGranted: false,
  });
  const acceptedStatus = createConsentStatus({
    connectedHealthGranted: false,
    launchGranted: true,
  });

  mocks.requestHostedOnboardingJson
    .mockResolvedValueOnce(currentStatus)
    .mockResolvedValueOnce(acceptedStatus);

  const { cleanup, container, window } = await renderClientComponent(
    createElement(HostedLegalConsentCard, {
      mode: "compact",
      onAccepted: mocks.onAccepted,
      source: "legal-version-refresh",
    }),
    { requireButton: false },
  );
  cleanupRender = cleanup;

  await vi.waitFor(() => {
    expect(container.textContent).toContain("Review Murph’s terms");
  });

  expect(container.textContent).not.toContain("contracted AI providers");
  expect(container.textContent).not.toContain("Health Data Notice");
  const continueButton = findButtonByText(container, /Agree & continue/);

  await act(async () => {
    continueButton.dispatchEvent(new window.Event("click", { bubbles: true }));
  });

  await vi.waitFor(() => {
    expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledTimes(2);
    expect(mocks.requestHostedOnboardingJson).toHaveBeenNthCalledWith(2, {
      method: "POST",
      payload: {
        acceptedDocumentVersions: {
          "health-ai-safety-disclosure": "2026-04-29",
          "privacy-policy": "2026-06-24",
          "terms-of-service": "2026-04-29",
        },
        scope: "launch.legal",
        source: "legal-version-refresh",
      },
      url: "/api/legal/consent/accept",
    });
    expect(mocks.onAccepted).toHaveBeenCalledWith(acceptedStatus);
  });
});

test("optional feature consent keeps its just-in-time checkbox gate", async () => {
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
      onAccepted: mocks.onAccepted,
      preferredScope: "feature.connected-health-source",
      source: "test-device-sync",
    }),
    { requireButton: false },
  );
  cleanupRender = cleanup;

  await vi.waitFor(() => {
    expect(container.textContent).toContain("Murph Privacy Policy");
    expect(container.textContent).toContain("Murph Consumer Health Data Notice");
  });

  const checkbox = container.querySelector('input[type="checkbox"]');
  expect(checkbox).toBeTruthy();
  const continueButton = findButtonByText(container, /Continue/);
  expect(continueButton.disabled).toBe(true);

  await act(async () => {
    setCheckboxChecked(window, checkbox as HTMLInputElement, true);
  });

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
});

test("launch consent shows a busy state while the second scope is recording", async () => {
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
  const acceptRequest = createDeferred<HostedConsentStatus>();

  mocks.requestHostedOnboardingJson
    .mockResolvedValueOnce(legalAcceptedStatus)
    .mockReturnValueOnce(acceptRequest.promise);

  const { cleanup, container, window } = await renderClientComponent(
    createElement(HostedLegalConsentCard, {
      initialStatus: currentStatus,
      mode: "compact",
      onAccepted: mocks.onAccepted,
      source: "join-invite-phone-verify",
    }),
    { requireButton: false },
  );
  cleanupRender = cleanup;

  const continueButton = findButtonByText(container, /Agree, consent & continue/);

  await act(async () => {
    continueButton.dispatchEvent(new window.Event("click", { bubbles: true }));
  });

  await vi.waitFor(() => {
    expect(continueButton.textContent).toContain("Saving...");
    expect(continueButton.getAttribute("aria-busy")).toBe("true");
    expect(continueButton.disabled).toBe(true);
  });

  await act(async () => {
    acceptRequest.resolve(acceptedStatus);
    await acceptRequest.promise;
  });

  await vi.waitFor(() => {
    expect(mocks.onAccepted).toHaveBeenCalledWith(acceptedStatus);
  });
});

test("HostedLegalConsentCard keeps a retryable error visible when status loading fails", async () => {
  const recoveredStatus = createConsentStatus({
    connectedHealthGranted: false,
    launchGranted: false,
  });

  mocks.requestHostedOnboardingJson
    .mockRejectedValueOnce(new Error("Consent status unavailable."))
    .mockResolvedValueOnce(recoveredStatus);

  const { cleanup, container, window } = await renderClientComponent(
    createElement(HostedLegalConsentCard, {
      mode: "compact",
      source: "homepage-signup-dialog",
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
    expect(container.textContent).toContain("Use your health data with Murph");
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
  const launchHealthDataGranted =
    input.launchHealthDataGranted ?? input.launchGranted ?? false;
  const launchGranted = launchLegalGranted && launchHealthDataGranted;

  return {
    documents: allDocuments,
    generatedAt: "2026-04-30T00:00:00.000Z",
    launchGranted,
    launchScopes: [
      {
        granted: launchLegalGranted,
        missingDocuments: launchLegalGranted ? [] : legalDocuments,
        scope: "launch.legal" as const,
      },
      {
        granted: launchHealthDataGranted,
        missingDocuments: launchHealthDataGranted ? [] : healthDataDocuments,
        scope: "launch.health-data" as const,
      },
    ],
    ok: true,
    schema: "murph.hosted-consent-status.v1",
    scopes: [
      consentScope(
        "launch.legal",
        "Terms, privacy, and AI disclosure",
        false,
        legalDocuments,
        launchLegalGranted,
      ),
      consentScope(
        "launch.health-data",
        "Health data collection consent",
        false,
        healthDataDocuments,
        launchHealthDataGranted,
      ),
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
