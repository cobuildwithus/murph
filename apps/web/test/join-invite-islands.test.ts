import { act, createElement } from "react";
import { beforeEach, expect, test, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

import {
  JoinInviteCheckoutPlanButtonIsland,
  JoinInviteLegalConsentIsland,
  JoinInviteMessagingSetupIsland,
  JoinInvitePhoneVerificationIsland,
  JoinInviteStatusRefreshIsland,
} from "@/src/components/hosted-onboarding/join-invite-islands";
import { JoinInviteAutoTrialIsland } from "@/src/components/hosted-onboarding/join-invite-auto-trial-island";
import {
  HostedOnboardingApiError,
  type HostedAutoPulseTrialEnrollmentResponse,
} from "@/src/components/hosted-onboarding/client-api";
import {
  getHostedDefaultBillingPlanCode,
  listHostedBillingPlanPresentations,
} from "@/src/lib/hosted-onboarding/billing-plans";
import type { HostedInviteStatusPayload } from "@/src/lib/hosted-onboarding/types";
import type { HostedConsentStatus } from "@/src/lib/legal/consent";
import { buildJoinInviteStatusRefreshSnapshot } from "@/src/components/hosted-onboarding/join-invite-state";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  replace: vi.fn(),
  requestHostedAutoPulseTrialEnrollment: vi.fn(),
  requestHostedBillingCheckout: vi.fn(),
  requestHostedOnboardingJson: vi.fn(),
  hostedEmailAuthProps: null as Record<string, unknown> | null,
  hostedPhoneAuthProps: null as Record<string, unknown> | null,
  useHostedInviteStatusRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: mocks.refresh,
    replace: mocks.replace,
  }),
}));

vi.mock("@privy-io/react-auth", () => ({
  useCreateWallet: () => ({
    createWallet: vi.fn(),
  }),
  usePrivy: () => ({
    logout: vi.fn(),
  }),
  useUser: () => ({
    refreshUser: vi.fn(),
    user: null,
  }),
}));

vi.mock("@/src/components/hosted-onboarding/hosted-phone-auth", () => ({
  HostedPhoneAuth(props: Record<string, unknown>) {
    mocks.hostedPhoneAuthProps = props;
    return createElement(
      "div",
      {
        "data-hosted-phone-auth": "true",
      },
      "Hosted phone auth",
    );
  },
}));

vi.mock("@/src/components/hosted-onboarding/hosted-email-auth-button", () => ({
  HostedEmailAuthButton(props: Record<string, unknown>) {
    mocks.hostedEmailAuthProps = props;
    return createElement(
      "div",
      {
        "data-hosted-email-auth": "true",
      },
      "Hosted email auth",
    );
  },
}));

vi.mock("@/src/components/settings/hosted-telegram-settings", () => ({
  ConnectTelegram(props: { initialTelegramAccount: { username: string | null } | null }) {
    return createElement(
      "div",
      {
        "data-connect-telegram": "true",
      },
      props.initialTelegramAccount?.username ?? "Connect Telegram",
    );
  },
}));

vi.mock("@/src/components/ui/payment-button", () => ({
  PaymentButton(props: {
    disabled?: boolean;
    idleLabel: string;
    onClick: () => Promise<void> | void;
    onError?: (error: unknown) => void;
    onSuccess?: () => void;
  }) {
    async function handleClick() {
      try {
        await props.onClick();
        props.onSuccess?.();
      } catch (error) {
        props.onError?.(error);
      }
    }

    return createElement(
      "button",
      {
        disabled: props.disabled,
        onClick: handleClick,
        type: "button",
      },
      props.idleLabel,
    );
  },
}));

vi.mock("@/src/components/hosted-onboarding/client-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/src/components/hosted-onboarding/client-api")>();

  return {
    ...actual,
    requestHostedAutoPulseTrialEnrollment: mocks.requestHostedAutoPulseTrialEnrollment,
    requestHostedBillingCheckout: mocks.requestHostedBillingCheckout,
    requestHostedOnboardingJson: mocks.requestHostedOnboardingJson,
  };
});

vi.mock("@/src/components/hosted-onboarding/invite-status-client", () => ({
  useHostedInviteStatusRefresh: mocks.useHostedInviteStatusRefresh,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.hostedEmailAuthProps = null;
  mocks.hostedPhoneAuthProps = null;
});

test("JoinInviteCheckoutPlanButtonIsland sends the clicked plan code to checkout", async () => {
  mocks.requestHostedBillingCheckout.mockResolvedValue({
    alreadyActive: false,
    url: "https://stripe.example.test/edge",
  });

  const { assign, button, cleanup } = await renderClientComponent(
    createElement(JoinInviteCheckoutPlanButtonIsland, {
      billingReady: true,
      idleLabel: "Get Edge",
      inviteCode: "invite-code",
      planCode: "launch_edge_monthly",
    }),
  );

  await act(async () => {
    button.click();
  });

  expect(mocks.requestHostedBillingCheckout).toHaveBeenCalledWith({
    billingPlanCode: "launch_edge_monthly",
    inviteCode: "invite-code",
  });
  expect(assign).toHaveBeenCalledWith("https://stripe.example.test/edge");
  await cleanup();
});

test("JoinInviteCheckoutPlanButtonIsland sends Pulse Trial checkout offer to checkout", async () => {
  mocks.requestHostedBillingCheckout.mockResolvedValue({
    alreadyActive: false,
    url: "https://stripe.example.test/trial",
  });

  const { assign, button, cleanup } = await renderClientComponent(
    createElement(JoinInviteCheckoutPlanButtonIsland, {
      billingReady: true,
      checkoutOffer: "pulse_trial_7d",
      idleLabel: "Start 7-day trial",
      inviteCode: "invite-code",
      planCode: "launch_monthly",
    }),
  );

  await act(async () => {
    button.click();
  });

  expect(mocks.requestHostedBillingCheckout).toHaveBeenCalledWith({
    billingPlanCode: "launch_monthly",
    checkoutOffer: "pulse_trial_7d",
    inviteCode: "invite-code",
  });
  expect(assign).toHaveBeenCalledWith("https://stripe.example.test/trial");
  await cleanup();
});

test("JoinInviteCheckoutPlanButtonIsland uses the disabled label when trial checkout is not ready", async () => {
  const { button, cleanup } = await renderClientComponent(
    createElement(JoinInviteCheckoutPlanButtonIsland, {
      billingReady: false,
      checkoutOffer: "pulse_trial_7d",
      disabledLabel: "Trial unavailable",
      idleLabel: "Start 7-day trial",
      inviteCode: "invite-code",
      planCode: "launch_monthly",
    }),
  );

  expect((button as HTMLButtonElement).disabled).toBe(true);
  expect(button.textContent).toBe("Trial unavailable");
  await cleanup();
});

test("JoinInviteCheckoutPlanButtonIsland refreshes instead of redirecting when checkout is already active", async () => {
  mocks.requestHostedBillingCheckout.mockResolvedValue({
    alreadyActive: true,
    url: null,
  });

  const { assign, button, cleanup } = await renderClientComponent(
    createElement(JoinInviteCheckoutPlanButtonIsland, {
      billingReady: true,
      idleLabel: "Get Pulse",
      inviteCode: "invite-code",
      planCode: "launch_monthly",
    }),
  );

  await act(async () => {
    button.click();
  });

  expect(assign).not.toHaveBeenCalled();
  expect(mocks.refresh).toHaveBeenCalledTimes(1);
  await cleanup();
});

test("JoinInviteAutoTrialIsland redirects after successful enrollment", async () => {
  mocks.requestHostedAutoPulseTrialEnrollment.mockResolvedValue({
    redirectPath: "/home",
    status: "enrolled",
  });

  const { cleanup } = await renderClientComponent(
    createElement(JoinInviteAutoTrialIsland, {
      inviteCode: "invite-code",
    }),
    { requireButton: false },
  );

  await act(async () => {
    await Promise.resolve();
  });

  expect(mocks.requestHostedAutoPulseTrialEnrollment).toHaveBeenCalledWith({
    inviteCode: "invite-code",
  });
  expect(mocks.replace).toHaveBeenCalledWith("/home");
  await cleanup();
});

test("JoinInviteAutoTrialIsland preserves the enrollment redirect after unmount", async () => {
  let resolveEnrollment!: (value: HostedAutoPulseTrialEnrollmentResponse) => void;
  mocks.requestHostedAutoPulseTrialEnrollment.mockReturnValue(
    new Promise<HostedAutoPulseTrialEnrollmentResponse>((resolve) => {
      resolveEnrollment = resolve;
    }),
  );

  const { cleanup } = await renderClientComponent(
    createElement(JoinInviteAutoTrialIsland, {
      inviteCode: "invite-code",
    }),
    { requireButton: false },
  );

  await cleanup();

  await act(async () => {
    resolveEnrollment({
      redirectPath: "/home",
      status: "enrolled",
    });
    await Promise.resolve();
  });

  expect(mocks.replace).toHaveBeenCalledWith("/home");
});

test("JoinInviteAutoTrialIsland renders a distinct retry state after enrollment fails", async () => {
  mocks.requestHostedAutoPulseTrialEnrollment.mockRejectedValue(new Error("Trial unavailable"));

  const { container, cleanup } = await renderClientComponent(
    createElement(JoinInviteAutoTrialIsland, {
      inviteCode: "invite-code",
    }),
    { requireButton: false },
  );

  await act(async () => {
    await Promise.resolve();
  });

  expect(container.textContent).toContain("Trial setup paused");
  expect(container.textContent).toContain("Unable to start your trial");
  expect(container.textContent).toContain("Trial unavailable");
  expect(container.textContent).toContain("Try again");
  expect(container.textContent).not.toContain("Setting up your Pulse trial");
  expect(container.querySelector("[role='status']")).toBeNull();
  expect(container.querySelector("[role='alert']")).not.toBeNull();
  await cleanup();
});

test("JoinInviteAutoTrialIsland offers paid checkout when the trial was already used", async () => {
  mocks.requestHostedAutoPulseTrialEnrollment.mockRejectedValue(
    new HostedOnboardingApiError({
      code: "HOSTED_PULSE_TRIAL_ALREADY_REDEEMED",
      message: "This hosted account has already used its Pulse Trial. Continue with Pulse instead.",
    }),
  );
  mocks.requestHostedBillingCheckout.mockResolvedValue({
    alreadyActive: false,
    url: "https://stripe.example.test/paid-pulse",
  });

  const { assign, cleanup, container, window } = await renderClientComponent(
    createElement(JoinInviteAutoTrialIsland, {
      inviteCode: "invite-code",
    }),
    { requireButton: false },
  );

  await act(async () => {
    await Promise.resolve();
  });

  expect(container.textContent).toContain("Trial unavailable");
  expect(container.textContent).toContain(
    "This account cannot use the trial, but you can continue with paid Pulse.",
  );
  expect(container.textContent).toContain("Continue with paid Pulse");
  expect(container.textContent).not.toContain("Contact support to restore access");
  expect(container.textContent).not.toContain("Try again");

  await act(async () => {
    findButtonByText(container, /Continue with paid Pulse/).dispatchEvent(
      new window.Event("click", { bubbles: true }),
    );
  });

  expect(mocks.requestHostedBillingCheckout).toHaveBeenCalledWith({
    billingPlanCode: "launch_monthly",
    inviteCode: "invite-code",
  });
  expect(assign).toHaveBeenCalledWith("https://stripe.example.test/paid-pulse");
  await cleanup();
});

test("JoinInviteAutoTrialIsland refreshes stale messaging-required state into setup", async () => {
  mocks.requestHostedAutoPulseTrialEnrollment.mockRejectedValue(
    new HostedOnboardingApiError({
      code: "HOSTED_MESSAGING_CHANNEL_REQUIRED",
      message: "Verify your phone number or connect Telegram before checkout so Murph can message you.",
    }),
  );

  const { cleanup, container, window } = await renderClientComponent(
    createElement(JoinInviteAutoTrialIsland, {
      inviteCode: "invite-code",
    }),
    { requireButton: false },
  );

  await act(async () => {
    await Promise.resolve();
  });

  expect(container.textContent).toContain("Continue setup");
  expect(container.textContent).toContain("Finish setup so Murph can message you.");
  expect(container.textContent).not.toContain("Email support");
  expect(container.textContent).not.toContain("Continue with paid Pulse");

  await act(async () => {
    findButtonByText(container, /Continue setup/).dispatchEvent(
      new window.Event("click", { bubbles: true }),
    );
  });

  expect(mocks.refresh).toHaveBeenCalledTimes(1);
  await cleanup();
});

test("JoinInviteAutoTrialIsland shows support for non-checkout account errors", async () => {
  mocks.requestHostedAutoPulseTrialEnrollment.mockRejectedValue(
    new HostedOnboardingApiError({
      code: "HOSTED_MEMBER_SUSPENDED",
      message: "This hosted account is suspended. Contact support to restore access.",
    }),
  );

  const { cleanup, container } = await renderClientComponent(
    createElement(JoinInviteAutoTrialIsland, {
      inviteCode: "invite-code",
    }),
    { requireButton: false },
  );

  await act(async () => {
    await Promise.resolve();
  });

  expect(container.textContent).toContain("Pulse setup needs support");
  expect(container.textContent).toContain("Email support");
  expect(container.textContent).not.toContain("Try again");
  expect(container.textContent).not.toContain("Continue with paid Pulse");
  expect(container.querySelector("a[href^='mailto:']")).toBeTruthy();
  await cleanup();
});

test("JoinInviteStatusRefreshIsland ignores stale verify payloads after checkout", async () => {
  const { cleanup } = await renderClientComponent(
    createElement(JoinInviteStatusRefreshIsland, {
      current: buildJoinInviteStatusRefreshSnapshot(createStatus({
        session: {
          authenticated: true,
          expiresAt: null,
          matchesInvite: true,
        },
        stage: "checkout",
      })),
      inviteCode: "invite-code",
      legalGateActive: false,
    }),
    { requireButton: false },
  );

  const refreshOptions = mocks.useHostedInviteStatusRefresh.mock.calls[0]?.[0];
  expect(refreshOptions).toMatchObject({
    disabled: false,
    inviteCode: "invite-code",
    shouldPoll: true,
  });

  act(() => {
    refreshOptions.onStatus(createStatus({
      session: {
        authenticated: true,
        expiresAt: null,
        matchesInvite: true,
      },
      stage: "verify",
    }));
  });

  expect(mocks.refresh).not.toHaveBeenCalled();
  await cleanup();
});

test("JoinInviteStatusRefreshIsland refreshes when a pending server state changes", async () => {
  const { cleanup } = await renderClientComponent(
    createElement(JoinInviteStatusRefreshIsland, {
      current: buildJoinInviteStatusRefreshSnapshot(createStatus({
        messagingSetupRequired: true,
        session: {
          authenticated: true,
          expiresAt: null,
          matchesInvite: true,
        },
        stage: "checkout",
      })),
      inviteCode: "invite-code",
      legalGateActive: false,
    }),
    { requireButton: false },
  );

  const refreshOptions = mocks.useHostedInviteStatusRefresh.mock.calls[0]?.[0];

  act(() => {
    refreshOptions.onStatus(createStatus({
      messagingSetupRequired: false,
      session: {
        authenticated: true,
        expiresAt: null,
        matchesInvite: true,
      },
      stage: "checkout",
    }));
  });

  expect(mocks.refresh).toHaveBeenCalledTimes(1);
  await cleanup();
});

test("JoinInviteStatusRefreshIsland surfaces refresh failures with a retry action", async () => {
  const currentStatus = createStatus({
    session: {
      authenticated: true,
      expiresAt: null,
      matchesInvite: false,
    },
  });
  const { cleanup, container, window } = await renderClientComponent(
    createElement(JoinInviteStatusRefreshIsland, {
      current: buildJoinInviteStatusRefreshSnapshot(currentStatus),
      inviteCode: "invite-code",
      legalGateActive: false,
    }),
    { requireButton: false },
  );

  const refreshOptions = mocks.useHostedInviteStatusRefresh.mock.calls[0]?.[0];

  await act(async () => {
    refreshOptions.onError(new Error("Status unavailable."));
  });

  expect(container.textContent).toContain("Unable to refresh invite status");
  expect(container.textContent).toContain("Status unavailable.");

  await act(async () => {
    refreshOptions.onStatus(currentStatus);
  });

  expect(container.textContent).not.toContain("Unable to refresh invite status");

  await act(async () => {
    refreshOptions.onError(new Error("Status unavailable."));
  });

  const retryButton = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.includes("Try again"),
  );
  expect(retryButton).toBeTruthy();

  await act(async () => {
    retryButton?.dispatchEvent(new window.Event("click", { bubbles: true }));
  });

  expect(mocks.refresh).toHaveBeenCalledTimes(1);
  expect(container.textContent).not.toContain("Unable to refresh invite status");
  await cleanup();
});

test("JoinInviteMessagingSetupIsland defaults to Telegram when a Telegram seed exists", async () => {
  const { cleanup, container } = await renderClientComponent(
    createElement(JoinInviteMessagingSetupIsland, {
      authenticated: true,
      initialTelegramAccount: {
        telegramUserId: "telegram-test-user",
        username: "murph_test",
      },
    }),
    { requireButton: false },
  );

  expect(container.textContent).toContain("Phone");
  expect(container.textContent).toContain("Telegram");
  expect(container.textContent).toContain("murph_test");
  expect(container.querySelector('[role="radiogroup"]')).toBeTruthy();
  expect((container.querySelector('input[value="telegram"]') as HTMLInputElement | null)?.checked).toBe(true);
  expect((container.querySelector('input[value="phone"]') as HTMLInputElement | null)?.checked).toBe(false);
  expect(container.querySelector('[data-connect-telegram="true"]')).toBeTruthy();
  expect(container.querySelector('[data-hosted-phone-auth="true"]')).toBeNull();
  await cleanup();
});

test("JoinInviteMessagingSetupIsland keeps phone first without a Telegram seed", async () => {
  const { cleanup, container } = await renderClientComponent(
    createElement(JoinInviteMessagingSetupIsland, {
      authenticated: true,
      initialTelegramAccount: null,
    }),
    { requireButton: false },
  );

  expect((container.querySelector('input[value="phone"]') as HTMLInputElement | null)?.checked).toBe(true);
  expect((container.querySelector('input[value="telegram"]') as HTMLInputElement | null)?.checked).toBe(false);
  expect(container.querySelector('[data-hosted-phone-auth="true"]')).toBeTruthy();
  expect(mocks.hostedPhoneAuthProps).toMatchObject({
    intent: "link",
  });
  await cleanup();
});

test("JoinInvitePhoneVerificationIsland uses email auth for invite email verification", async () => {
  const { cleanup, container } = await renderClientComponent(
    createElement(JoinInvitePhoneVerificationIsland, {
      emailAuthTarget: {
        emailAddress: "buddy@example.com",
        kind: "saved",
      },
      inviteCode: "invite-code",
      phoneAuthTarget: {
        kind: "manual",
      },
      phoneHint: null,
      verificationMode: "invite_email",
    }),
    { requireButton: false },
  );

  expect(container.querySelector('[data-hosted-email-auth="true"]')).toBeTruthy();
  expect(container.querySelector('[data-hosted-phone-auth="true"]')).toBeNull();
  expect(mocks.hostedEmailAuthProps).toMatchObject({
    active: true,
    initialEmailAddress: "buddy@example.com",
    inline: true,
    onAuthenticated: expect.any(Function),
  });
  expect(mocks.hostedPhoneAuthProps).toBeNull();
  await cleanup();
});

test("JoinInviteLegalConsentIsland keeps accepted consent visible while route refresh loads", async () => {
  const currentStatus = createConsentStatus({
    launchGranted: false,
  });
  const legalAcceptedStatus = createConsentStatus({
    launchHealthDataGranted: false,
    launchLegalGranted: true,
  });
  const acceptedStatus = createConsentStatus({
    launchGranted: true,
  });

  mocks.requestHostedOnboardingJson
    .mockResolvedValueOnce(legalAcceptedStatus)
    .mockResolvedValueOnce(acceptedStatus);

  const { cleanup, container, window } = await renderClientComponent(
    createElement(JoinInviteLegalConsentIsland, {
      initialStatus: currentStatus,
    }),
    { requireButton: false },
  );

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
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  expect(container.textContent).toContain("Terms of Service");
  expect(container.textContent).toContain("Consumer Health Data Notice");
  expect(container.textContent).toContain("Continuing...");
  expect(continueButton.disabled).toBe(true);
  await cleanup();
});

function createStatus(
  overrides: Partial<HostedInviteStatusPayload> & {
    capabilities?: Partial<HostedInviteStatusPayload["capabilities"]>;
  },
): HostedInviteStatusPayload {
  return {
    billing: {
      defaultPlanCode: getHostedDefaultBillingPlanCode(),
      plans: listHostedBillingPlanPresentations(),
    },
    capabilities: {
      billingReady: true,
      phoneAuthReady: true,
      ...overrides.capabilities,
    },
    invite: {
      code: "invite-code",
      expiresAt: "2026-03-27T12:00:00.000Z",
      phoneAuthTarget: {
        kind: "saved",
        phoneHint: "*** 2671",
      },
      phoneHint: "*** 2671",
      verificationMode: "invite_phone",
    },
    messagingSetupRequired: overrides.messagingSetupRequired ?? false,
    murphPhoneNumber: overrides.murphPhoneNumber ?? null,
    session: {
      authenticated: false,
      expiresAt: null,
      matchesInvite: false,
    },
    stage: "verify",
    ...overrides,
  };
}

function createConsentStatus(input: {
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
      consentScope("launch.legal", "Terms, privacy, and AI disclosure", legalDocuments, launchLegalGranted),
      consentScope("launch.health-data", "Health data collection consent", healthDataDocuments, launchHealthDataGranted),
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
