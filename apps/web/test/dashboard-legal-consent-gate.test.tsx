import { act, createElement, Fragment, type ReactNode } from "react";
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

vi.mock("next/link", () => ({
  default: ({
    children,
    className,
    href,
  }: {
    children: ReactNode;
    className?: string;
    href: string;
  }) => createElement("a", { className, href }, children),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => window.location.pathname,
}));

vi.mock("@/src/components/hosted-onboarding/auth-dialog-provider", () => ({
  useAuth: () => ({
    authenticated: true,
    openAuthDialog: vi.fn(),
  }),
}));

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

  expect(continueButton.textContent).toContain("Refreshing your dashboard");
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
    .mockResolvedValueOnce(legalAcceptedStatus)
    .mockRejectedValueOnce(new Error("Consent save is temporarily unavailable."))
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
  expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledTimes(2);
  expect(readRequestedConsentScopes()).toEqual([
    "launch.legal",
    "launch.health-data",
  ]);
  expect(rendered.reload).not.toHaveBeenCalled();

  await act(async () => {
    continueButton.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
    await flushPromises();
  });

  expect(continueButton.textContent).toContain("Refreshing your dashboard");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });

  expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledTimes(3);
  expect(readRequestedConsentScopes()).toEqual([
    "launch.legal",
    "launch.health-data",
    "launch.health-data",
  ]);
  expect(rendered.reload).toHaveBeenCalledTimes(1);
});

test("persisted partial consent submits only the missing scope and reloads the exact route", async () => {
  const partialStatus = createLaunchConsentStatus({
    launchLegalGranted: true,
  });
  const acceptedStatus = createLaunchConsentStatus({
    launchHealthDataGranted: true,
    launchLegalGranted: true,
  });
  mocks.requestHostedOnboardingJson.mockResolvedValueOnce(acceptedStatus);

  const rendered = await renderClientComponent(
    createElement(DashboardLegalConsentGate, {
      initialStatus: partialStatus,
      variant: "initial",
    }),
    {
      location: {
        hash: "#garmin",
        href: "https://app.example.test/connect?source=garmin#garmin",
        origin: "https://app.example.test",
        pathname: "/connect",
        search: "?source=garmin",
      },
      requireButton: false,
    },
  );
  cleanupRender = rendered.cleanup;

  expect(rendered.container.textContent).toContain("Finish your consent");
  expect(rendered.container.textContent).not.toContain("Review what changed");
  const checkboxes = [
    ...rendered.container.querySelectorAll('input[type="checkbox"]'),
  ] as HTMLInputElement[];
  expect(checkboxes).toHaveLength(1);

  await act(async () => {
    const healthDataCheckbox = checkboxes[0]!;
    healthDataCheckbox.checked = true;
    healthDataCheckbox.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true, cancelable: true }),
    );
    healthDataCheckbox.dispatchEvent(
      new rendered.window.Event("input", { bubbles: true }),
    );
    healthDataCheckbox.dispatchEvent(
      new rendered.window.Event("change", { bubbles: true }),
    );
  });

  const continueButton = findButton(rendered.container, "Continue");
  await act(async () => {
    continueButton.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
    await flushPromises();
    await vi.advanceTimersByTimeAsync(100);
  });

  expect(readRequestedConsentScopes()).toEqual(["launch.health-data"]);
  expect(rendered.replaceState).toHaveBeenCalledWith(
    rendered.window.history.state,
    "",
    "https://app.example.test/connect?source=garmin#garmin",
  );
  expect(rendered.reload).toHaveBeenCalledTimes(1);
});

test.each([
  {
    acceptedStatuses: [
      createLaunchConsentStatus({ launchLegalGranted: true }),
      createLaunchConsentStatus({
        launchHealthDataGranted: true,
        launchLegalGranted: true,
      }),
    ],
    initialStatus: createLaunchConsentStatus(),
    label: "zero grants",
    submittedScopes: ["launch.legal", "launch.health-data"],
    variant: "initial" as const,
  },
  {
    acceptedStatuses: [
      createLaunchConsentStatus({
        launchHealthDataGranted: true,
        launchLegalGranted: true,
      }),
    ],
    initialStatus: createLaunchConsentStatus({ launchLegalGranted: true }),
    label: "only legal granted",
    submittedScopes: ["launch.health-data"],
    variant: "initial" as const,
  },
  {
    acceptedStatuses: [
      createLaunchConsentStatus({
        launchHealthDataGranted: true,
        launchLegalGranted: true,
      }),
    ],
    initialStatus: createLaunchConsentStatus({
      launchHealthDataGranted: true,
    }),
    label: "only health data granted",
    submittedScopes: ["launch.legal"],
    variant: "initial" as const,
  },
  {
    acceptedStatuses: [
      createLaunchConsentStatus({ launchLegalGranted: true }),
      createLaunchConsentStatus({
        launchHealthDataGranted: true,
        launchLegalGranted: true,
      }),
    ],
    initialStatus: createLaunchConsentStatus(),
    label: "stale current versions",
    submittedScopes: ["launch.legal", "launch.health-data"],
    variant: "update" as const,
  },
])("clinical records keeps one consent owner with $label", async ({
  acceptedStatuses,
  initialStatus,
  submittedScopes,
  variant,
}) => {
  const claim = `cr_${"a".repeat(32)}`;
  mocks.requestHostedOnboardingJson.mockResolvedValueOnce(initialStatus);
  for (const acceptedStatus of acceptedStatuses) {
    mocks.requestHostedOnboardingJson.mockResolvedValueOnce(acceptedStatus);
  }
  const { RecordsConnectClient } = await import(
    "../app/(dashboard)/records/connect/records-connect-client"
  );

  const rendered = await renderClientComponent(
    createElement(
      Fragment,
      null,
      createElement(DashboardLegalConsentGate, {
        initialStatus,
        variant,
      }),
      createElement(RecordsConnectClient, { authenticated: true }),
    ),
    {
      location: {
        hash: `#clinicalRecordsIntent=${claim}`,
        href: `https://app.example.test/records/connect#clinicalRecordsIntent=${claim}`,
        origin: "https://app.example.test",
        pathname: "/records/connect",
        search: "",
      },
      requireButton: false,
    },
  );
  cleanupRender = rendered.cleanup;

  await vi.waitFor(() => {
    expect(rendered.container.textContent).toContain(
      "Review how Murph uses your health data",
    );
  });
  expect(rendered.container.textContent).not.toContain("Finish your consent");
  expect(rendered.container.textContent).not.toContain("Review what changed");
  expect(
    [...rendered.container.querySelectorAll("button")].filter((button) =>
      button.textContent?.includes("Continue"),
    ),
  ).toHaveLength(1);

  const checkboxes = [
    ...rendered.container.querySelectorAll('input[type="checkbox"]'),
  ] as HTMLInputElement[];
  expect(checkboxes).toHaveLength(submittedScopes.length);
  for (const checkbox of checkboxes) {
    await act(async () => {
      checkbox.checked = true;
      checkbox.dispatchEvent(
        new rendered.window.Event("click", { bubbles: true, cancelable: true }),
      );
      checkbox.dispatchEvent(
        new rendered.window.Event("input", { bubbles: true }),
      );
      checkbox.dispatchEvent(
        new rendered.window.Event("change", { bubbles: true }),
      );
    });
  }

  const continueButton = findButton(rendered.container, "Continue");
  await act(async () => {
    continueButton.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
    await flushPromises();
  });

  expect(rendered.reload).toHaveBeenCalledTimes(1);
  expect(rendered.container.textContent).not.toContain("Where do you get care?");
  expect(rendered.window.location.href).toBe(
    "https://app.example.test/records/connect",
  );
  expect(JSON.stringify(rendered.window.history.state)).toContain(claim);
  const submittedBeforeReload = readRequestedConsentScopes().filter(Boolean);
  const stagedHistoryState = rendered.window.history.state;

  await cleanupRender();
  cleanupRender = null;
  mocks.requestHostedOnboardingJson.mockReset();
  const acceptedStatus = acceptedStatuses.at(-1)!;
  mocks.requestHostedOnboardingJson.mockResolvedValueOnce(acceptedStatus);
  const reloaded = await renderClientComponent(
    createElement(
      Fragment,
      null,
      createElement(DashboardLegalConsentGate, {
        initialStatus: acceptedStatus,
        variant,
      }),
      createElement(RecordsConnectClient, { authenticated: true }),
    ),
    {
      historyState: stagedHistoryState,
      location: {
        hash: "",
        href: "https://app.example.test/records/connect",
        origin: "https://app.example.test",
        pathname: "/records/connect",
        search: "",
      },
      requireButton: false,
    },
  );
  cleanupRender = reloaded.cleanup;

  await vi.waitFor(() => {
    expect(reloaded.container.textContent).toContain("Where do you get care?");
  });
  expect(reloaded.container.textContent).not.toContain("Consent required");
  expect(submittedBeforeReload).toEqual(submittedScopes);
  expect(readRequestedConsentScopes().filter(Boolean)).toEqual([]);

  Object.assign(reloaded.window.location, {
    hash: "",
    href: "https://app.example.test/records",
    pathname: "/records",
    search: "",
  });
  await reloaded.rerender(
    createElement("p", null, "Medical records"),
  );
  expect(reloaded.container.textContent).toContain("Medical records");
  expect(reloaded.container.textContent).not.toContain("Consent required");
  expect(reloaded.container.textContent).not.toContain("Review what changed");
  expect(readRequestedConsentScopes().filter(Boolean)).toEqual([]);
});

test("a consent preview uses only its injected in-memory acceptance owner", async () => {
  const currentStatus = createLaunchConsentStatus();
  const legalAcceptedStatus = createLaunchConsentStatus({
    launchLegalGranted: true,
  });
  const acceptedStatus = createLaunchConsentStatus({
    launchHealthDataGranted: true,
    launchLegalGranted: true,
  });
  const acceptScope = vi.fn()
    .mockResolvedValueOnce(legalAcceptedStatus)
    .mockResolvedValueOnce(acceptedStatus);
  const onAccepted = vi.fn();

  const rendered = await renderClientComponent(
    createElement(DashboardLegalConsentGate, {
      acceptScope,
      initialStatus: currentStatus,
      onAccepted,
    }),
    { requireButton: false },
  );
  cleanupRender = rendered.cleanup;

  await acceptBothLaunchScopes(rendered.container, rendered.window);
  const continueButton = findButton(rendered.container, "Continue");
  await act(async () => {
    continueButton.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
    await flushPromises();
  });

  expect(acceptScope).toHaveBeenCalledTimes(2);
  expect(acceptScope.mock.calls.map(([input]) => input.scope)).toEqual([
    "launch.legal",
    "launch.health-data",
  ]);
  expect(mocks.requestHostedOnboardingJson).not.toHaveBeenCalled();
  expect(onAccepted).toHaveBeenCalledWith(acceptedStatus);
  expect(rendered.reload).not.toHaveBeenCalled();
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

function readRequestedConsentScopes(): unknown[] {
  return mocks.requestHostedOnboardingJson.mock.calls.map(
    ([request]) => request.payload?.scope,
  );
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
