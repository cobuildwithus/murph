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

  expect(panelMarkup).toContain("rounded-xl border border-border bg-card p-5 sm:p-6");
  expect(compactMarkup).toContain("w-full");
  expect(panelMarkup).toContain('role="status"');
  expect(panelMarkup).toContain('aria-busy="true"');
  expect(panelMarkup).not.toContain("shadow-");
  expect(panelMarkup).not.toContain("#c4a882");
  expect(panelMarkup).not.toContain("#fefdf8");
  expect(panelMarkup).not.toContain("sm:grid-cols-[minmax(0,1fr)_auto]");
});

test("launch consent keeps decline available while status is loading", async () => {
  const statusRequest = createDeferred<HostedConsentStatus>();
  const onDecline = vi.fn();
  mocks.requestHostedOnboardingJson.mockReturnValueOnce(statusRequest.promise);

  const { cleanup, container, window } = await renderClientComponent(
    createElement(HostedLegalConsentCard, {
      mode: "compact",
      onDecline,
      source: "homepage-signup-dialog",
    }),
    { requireButton: false },
  );
  cleanupRender = cleanup;

  const declineButton = findButtonByText(container, /^Decline$/);
  expect(declineButton.disabled).toBe(false);

  await act(async () => {
    declineButton.dispatchEvent(new window.Event("click", { bubbles: true }));
  });

  expect(onDecline).toHaveBeenCalledTimes(1);
  expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledTimes(1);

  await act(async () => {
    statusRequest.resolve(createConsentStatus({
      connectedHealthGranted: false,
      launchGranted: false,
    }));
    await statusRequest.promise;
  });
});

test("launch consent keeps decline available while a status retry is unresolved", async () => {
  const retryRequest = createDeferred<HostedConsentStatus>();
  const onDecline = vi.fn();
  mocks.requestHostedOnboardingJson
    .mockRejectedValueOnce(new Error("Consent status is unavailable."))
    .mockReturnValueOnce(retryRequest.promise);

  const { cleanup, container, window } = await renderClientComponent(
    createElement(HostedLegalConsentCard, {
      mode: "compact",
      onDecline,
      source: "homepage-signup-dialog",
    }),
    { requireButton: false },
  );
  cleanupRender = cleanup;

  await vi.waitFor(() => {
    expect(container.textContent).toContain("Consent status is unavailable.");
  });

  const tryAgainButton = findButtonByText(container, /^Try again$/);
  await act(async () => {
    tryAgainButton.dispatchEvent(new window.Event("click", { bubbles: true }));
  });

  await vi.waitFor(() => {
    expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledTimes(2);
  });

  const declineButton = findButtonByText(container, /^Decline$/);
  expect(declineButton.disabled).toBe(false);

  await act(async () => {
    declineButton.dispatchEvent(new window.Event("click", { bubbles: true }));
  });

  expect(onDecline).toHaveBeenCalledTimes(1);

  await act(async () => {
    retryRequest.resolve(
      createConsentStatus({ connectedHealthGranted: false, launchGranted: false }),
    );
    await retryRequest.promise;
  });
});

test("launch consent renders one explicit decision without checkboxes", async () => {
  const initialStatus = createConsentStatus({
    connectedHealthGranted: false,
    launchGranted: false,
  });

  const { cleanup, container } = await renderClientComponent(
    createElement(HostedLegalConsentCard, {
      initialStatus,
      mode: "compact",
      onDecline: () => {},
      source: "join-invite-phone-verify",
    }),
    { requireButton: false },
  );
  cleanupRender = cleanup;

  await vi.waitFor(() => {
    expect(container.textContent).toContain("Use your health data");
    expect(container.textContent).toContain(
      "Murph uses health data you share to personalize answers and insights.",
    );
    expect(container.textContent).toContain(
      "AI providers process relevant data on Murph’s behalf.",
    );
  });

  expect(container.textContent).toContain("Terms");
  expect(container.textContent).toContain("Privacy");
  expect(container.textContent).toContain("AI safety");
  expect(container.textContent).toContain("Health data");
  expect(container.textContent).not.toContain("Health data consent");
  expect(container.textContent).toContain(
    "Not sold or used to train general-purpose AI models. Withdraw anytime in Settings.",
  );
  expect(container.querySelector('input[type="checkbox"]')).toBeNull();

  const continueButton = findButtonByText(container, /^Consent$/);
  const declineButton = findButtonByText(container, /^Decline$/);
  expect(continueButton.disabled).toBe(false);
  expect(continueButton.classList.contains("flex-1")).toBe(true);
  expect(continueButton.classList.contains("w-auto")).toBe(false);
  expect(declineButton.disabled).toBe(false);
  expect(
    [...container.querySelectorAll("button")].indexOf(declineButton),
  ).toBeLessThan(
    [...container.querySelectorAll("button")].indexOf(continueButton),
  );
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
    expect(container.textContent).toContain("Use your health data");
  });

  expect(container.querySelector('input[type="checkbox"]')).toBeNull();
  const continueButton = findButtonByText(container, /^Consent$/);

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
          "health-ai-safety-disclosure": "2026-07-23",
          "privacy-policy": "2026-07-23",
          "terms-of-service": "2026-07-23",
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
          "consumer-health-data-notice": "2026-07-23",
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
  expect(container.textContent).not.toContain("Terms update");
  expect(container.textContent).not.toContain("We do not sell health data.");
  const continueButton = findButtonByText(container, /^Agree$/);
  expect(continueButton.classList.contains("flex-1")).toBe(true);
  expect(continueButton.classList.contains("w-auto")).toBe(false);

  await act(async () => {
    continueButton.dispatchEvent(new window.Event("click", { bubbles: true }));
  });

  await vi.waitFor(() => {
    expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledTimes(2);
    expect(mocks.requestHostedOnboardingJson).toHaveBeenNthCalledWith(2, {
      method: "POST",
      payload: {
        acceptedDocumentVersions: {
          "health-ai-safety-disclosure": "2026-07-23",
          "privacy-policy": "2026-07-23",
          "terms-of-service": "2026-07-23",
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
          "consumer-health-data-notice": "2026-07-23",
          "privacy-policy": "2026-07-23",
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
      onDecline: () => {},
      source: "join-invite-phone-verify",
    }),
    { requireButton: false },
  );
  cleanupRender = cleanup;

  const continueButton = findButtonByText(container, /^Consent$/);
  const declineButton = findButtonByText(container, /^Decline$/);

  await act(async () => {
    continueButton.dispatchEvent(new window.Event("click", { bubbles: true }));
  });

  await vi.waitFor(() => {
    expect(continueButton.textContent).toContain("Saving...");
    expect(continueButton.getAttribute("aria-busy")).toBe("true");
    expect(continueButton.disabled).toBe(true);
    expect(declineButton.disabled).toBe(true);
  });

  await act(async () => {
    acceptRequest.resolve(acceptedStatus);
    await acceptRequest.promise;
  });

  await vi.waitFor(() => {
    expect(mocks.onAccepted).toHaveBeenCalledWith(acceptedStatus);
  });
});

test("launch consent retries only the remaining scope after a partial failure", async () => {
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
    .mockRejectedValueOnce(new Error("Health data consent unavailable."))
    .mockResolvedValueOnce(acceptedStatus);

  const { cleanup, container, window } = await renderClientComponent(
    createElement(HostedLegalConsentCard, {
      initialStatus: currentStatus,
      mode: "compact",
      onAccepted: mocks.onAccepted,
      source: "homepage-signup-dialog",
    }),
    { requireButton: false },
  );
  cleanupRender = cleanup;

  const firstContinueButton = findButtonByText(container, /^Consent$/);
  await act(async () => {
    firstContinueButton.dispatchEvent(new window.Event("click", { bubbles: true }));
  });

  await vi.waitFor(() => {
    expect(container.textContent).toContain("Health data consent unavailable.");
  });
  expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledTimes(2);

  const retryButton = findButtonByText(container, /^Consent$/);
  await act(async () => {
    retryButton.dispatchEvent(new window.Event("click", { bubbles: true }));
  });

  await vi.waitFor(() => {
    expect(mocks.onAccepted).toHaveBeenCalledWith(acceptedStatus);
  });
  expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledTimes(3);
  expect(mocks.requestHostedOnboardingJson.mock.calls[0]?.[0]?.payload?.scope).toBe(
    "launch.legal",
  );
  expect(mocks.requestHostedOnboardingJson.mock.calls[1]?.[0]?.payload?.scope).toBe(
    "launch.health-data",
  );
  expect(mocks.requestHostedOnboardingJson.mock.calls[2]?.[0]?.payload?.scope).toBe(
    "launch.health-data",
  );
});

test("launch consent keeps the prompt visible when the accepted handoff fails", async () => {
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
  mocks.onAccepted
    .mockRejectedValueOnce(new Error("Could not finish sign in."))
    .mockResolvedValueOnce(undefined);

  const { cleanup, container, window } = await renderClientComponent(
    createElement(HostedLegalConsentCard, {
      initialStatus: currentStatus,
      mode: "compact",
      onAccepted: mocks.onAccepted,
      source: "homepage-signup-dialog",
    }),
    { requireButton: false },
  );
  cleanupRender = cleanup;

  const continueButton = findButtonByText(container, /^Consent$/);
  await act(async () => {
    continueButton.dispatchEvent(new window.Event("click", { bubbles: true }));
  });

  await vi.waitFor(() => {
    expect(container.textContent).toContain("Could not finish sign in.");
  });
  const retryButton = findButtonByText(container, /^Consent$/);
  expect(retryButton.disabled).toBe(false);

  await act(async () => {
    retryButton.dispatchEvent(new window.Event("click", { bubbles: true }));
  });

  await vi.waitFor(() => {
    expect(mocks.onAccepted).toHaveBeenCalledTimes(2);
  });
  expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledTimes(2);
});

test("launch consent offers support after three failed attempts", async () => {
  const currentStatus = createConsentStatus({
    connectedHealthGranted: false,
    launchGranted: false,
  });

  mocks.requestHostedOnboardingJson.mockRejectedValue(
    new Error("Could not record consent. Try again."),
  );

  const { cleanup, container, window } = await renderClientComponent(
    createElement(HostedLegalConsentCard, {
      initialStatus: currentStatus,
      mode: "compact",
      onAccepted: mocks.onAccepted,
      source: "homepage-signup-dialog",
    }),
    { requireButton: false },
  );
  cleanupRender = cleanup;

  for (const attempt of [1, 2, 3]) {
    const consentButton = findButtonByText(container, /^Consent$/);
    await act(async () => {
      consentButton.dispatchEvent(new window.Event("click", { bubbles: true }));
    });

    await vi.waitFor(() => {
      expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledTimes(attempt);
    });

    if (attempt < 3) {
      expect(container.querySelector('a[href^="mailto:"]')).toBeNull();
    }
  }

  await vi.waitFor(() => {
    const supportLink = container.querySelector('a[href^="mailto:"]');
    expect(supportLink).toBeTruthy();
    expect(supportLink?.getAttribute("href")).toContain("support@withmurph.ai");
    expect(supportLink?.textContent).toContain("Contact support");
  });

  expect(container.textContent).toContain("Our team can finish this for you.");
  const retryLater = findButtonByText(container, /^Try again later$/);
  expect(retryLater.disabled).toBe(false);
  expect(
    [...container.querySelectorAll("button")].some(
      (button) => button.textContent?.trim() === "Consent",
    ),
  ).toBe(false);

  await act(async () => {
    retryLater.dispatchEvent(new window.Event("click", { bubbles: true }));
  });

  await vi.waitFor(() => {
    expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledTimes(4);
  });
});

test("HostedLegalConsentCard keeps decline available when status loading fails", async () => {
  const recoveredStatus = createConsentStatus({
    connectedHealthGranted: false,
    launchGranted: false,
  });
  const onDecline = vi.fn();

  mocks.requestHostedOnboardingJson
    .mockRejectedValueOnce(new Error("Consent status unavailable."))
    .mockResolvedValueOnce(recoveredStatus);

  const { cleanup, container, window } = await renderClientComponent(
    createElement(HostedLegalConsentCard, {
      mode: "compact",
      onDecline,
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
  const declineButton = findButtonByText(container, /^Decline$/);
  expect(declineButton.disabled).toBe(false);

  await act(async () => {
    declineButton.dispatchEvent(new window.Event("click", { bubbles: true }));
  });
  expect(onDecline).toHaveBeenCalledTimes(1);
  expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledTimes(1);

  await act(async () => {
    retryButton.dispatchEvent(new window.Event("click", { bubbles: true }));
  });

  await vi.waitFor(() => {
    expect(container.textContent).toContain("Use your health data");
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
        "Health data notice and processing authorization",
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
    version: "2026-07-23",
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
