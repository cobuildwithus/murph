import { act, createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { DashboardLegalConsentGate } from "@/src/components/legal/dashboard-legal-consent-gate";
import type { HostedConsentStatus } from "@/src/lib/legal/consent";

import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => ({
  requestHostedOnboardingJson: vi.fn(),
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
  vi.useFakeTimers();
});

afterEach(async () => {
  if (cleanupRender) {
    await cleanupRender();
    cleanupRender = null;
  }
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("dashboard consent reloads the exact route once after the accepted handoff", async () => {
  const currentStatus = createLaunchConsentStatus();
  const legalAcceptedStatus = createLaunchConsentStatus({
    launchLegalGranted: true,
  });
  const acceptedStatus = createLaunchConsentStatus({
    launchHealthDataGranted: true,
    launchLegalGranted: true,
  });

  mocks.requestHostedOnboardingJson
    .mockResolvedValueOnce(legalAcceptedStatus)
    .mockResolvedValueOnce(acceptedStatus);

  const rendered = await renderClientComponent(
    createElement(DashboardLegalConsentGate, {
      initialStatus: currentStatus,
    }),
    {
      location: {
        hash: "#weekly",
        href: "https://app.example.test/home?view=progress#weekly",
        origin: "https://app.example.test",
        pathname: "/home",
        search: "?view=progress",
      },
      requireButton: false,
    },
  );
  cleanupRender = rendered.cleanup;

  await acceptBothLaunchScopes(rendered.container, rendered.window);

  const continueButton = findButton(rendered.container, "Continue");
  await act(async () => {
    continueButton.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
    await flushPromises();
  });

  expect(continueButton.textContent).toContain("Opening your dashboard");
  expect(rendered.reload).not.toHaveBeenCalled();

  await act(async () => {
    await vi.advanceTimersByTimeAsync(99);
  });
  expect(rendered.reload).not.toHaveBeenCalled();

  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });

  expect(rendered.replaceState).toHaveBeenCalledTimes(1);
  expect(rendered.replaceState).toHaveBeenCalledWith(
    rendered.window.history.state,
    "",
    "https://app.example.test/home?view=progress#weekly",
  );
  expect(rendered.reload).toHaveBeenCalledTimes(1);

  await act(async () => {
    await vi.runAllTimersAsync();
  });
  expect(rendered.reload).toHaveBeenCalledTimes(1);
});

test("dashboard consent keeps a failed save retryable and continues after retry", async () => {
  const currentStatus = createLaunchConsentStatus();
  const legalAcceptedStatus = createLaunchConsentStatus({
    launchLegalGranted: true,
  });
  const acceptedStatus = createLaunchConsentStatus({
    launchHealthDataGranted: true,
    launchLegalGranted: true,
  });

  mocks.requestHostedOnboardingJson
    .mockRejectedValueOnce(new Error("Consent save is temporarily unavailable."))
    .mockResolvedValueOnce(legalAcceptedStatus)
    .mockResolvedValueOnce(acceptedStatus);

  const rendered = await renderClientComponent(
    createElement(DashboardLegalConsentGate, {
      initialStatus: currentStatus,
    }),
    {
      location: {
        hash: "",
        href: "https://app.example.test/settings?tab=privacy",
        origin: "https://app.example.test",
        pathname: "/settings",
        search: "?tab=privacy",
      },
      requireButton: false,
    },
  );
  cleanupRender = rendered.cleanup;

  await acceptBothLaunchScopes(rendered.container, rendered.window);

  const continueButton = findButton(rendered.container, "Continue");
  await act(async () => {
    continueButton.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
    await flushPromises();
  });

  expect(rendered.container.textContent).toContain("Unable to record consent");
  expect(rendered.container.textContent).toContain(
    "Consent save is temporarily unavailable.",
  );
  expect(continueButton.disabled).toBe(false);
  expect(rendered.reload).not.toHaveBeenCalled();

  await act(async () => {
    continueButton.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
    await flushPromises();
  });

  expect(continueButton.textContent).toContain("Opening your dashboard");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });

  expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledTimes(3);
  expect(rendered.reload).toHaveBeenCalledTimes(1);
});

async function acceptBothLaunchScopes(
  container: HTMLElement,
  window: Window & typeof globalThis,
) {
  const checkboxes = [
    ...container.querySelectorAll('input[type="checkbox"]'),
  ] as HTMLInputElement[];
  expect(checkboxes).toHaveLength(2);

  for (const checkbox of checkboxes) {
    await act(async () => {
      checkbox.checked = true;
      checkbox.dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }));
      checkbox.dispatchEvent(new window.Event("input", { bubbles: true }));
      checkbox.dispatchEvent(new window.Event("change", { bubbles: true }));
    });
  }
}

function createLaunchConsentStatus(input: {
  launchHealthDataGranted?: boolean;
  launchLegalGranted?: boolean;
} = {}): HostedConsentStatus {
  const legalDocuments: HostedConsentStatus["documents"] = [
    consentDocument("terms-of-service", "Murph Terms of Service", "/legal/terms"),
    consentDocument("privacy-policy", "Murph Privacy Policy", "/legal/privacy"),
    consentDocument(
      "health-ai-safety-disclosure",
      "Murph Health AI Safety Disclosure",
      "/legal/health-ai-safety-disclosure",
    ),
  ];
  const healthDataDocuments: HostedConsentStatus["documents"] = [
    consentDocument(
      "consumer-health-data-notice",
      "Murph Consumer Health Data Notice",
      "/consumer-health-data-privacy-policy",
    ),
  ];
  const launchLegalGranted = input.launchLegalGranted ?? false;
  const launchHealthDataGranted = input.launchHealthDataGranted ?? false;
  const documents = [...legalDocuments, ...healthDataDocuments];

  return {
    documents,
    generatedAt: "2026-07-23T12:00:00.000Z",
    launchGranted: launchLegalGranted && launchHealthDataGranted,
    launchScopes: [
      {
        granted: launchLegalGranted,
        missingDocuments: launchLegalGranted ? [] : legalDocuments,
        scope: "launch.legal",
      },
      {
        granted: launchHealthDataGranted,
        missingDocuments: launchHealthDataGranted ? [] : healthDataDocuments,
        scope: "launch.health-data",
      },
    ],
    ok: true,
    schema: "murph.hosted-consent-status.v1",
    scopes: [
      consentScope(
        "launch.legal",
        "Terms, privacy, and AI disclosure",
        legalDocuments,
        launchLegalGranted,
      ),
      consentScope(
        "launch.health-data",
        "Health data notice and processing authorization",
        healthDataDocuments,
        launchHealthDataGranted,
      ),
    ],
  };
}

function consentDocument(
  id: HostedConsentStatus["documents"][number]["id"],
  title: string,
  href: string,
): HostedConsentStatus["documents"][number] {
  return {
    href,
    id,
    pdfHref: `${href}.pdf`,
    title,
    version: "2026-07-23",
  };
}

function consentScope(
  scope: "launch.legal" | "launch.health-data",
  label: string,
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
    revocable: false,
    scope,
  };
}

function findButton(container: Element, label: string): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")].find((candidate) =>
    candidate.textContent?.includes(label),
  );
  expect(button).toBeTruthy();
  return button as HTMLButtonElement;
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
