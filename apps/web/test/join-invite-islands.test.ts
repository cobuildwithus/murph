import { act, createElement } from "react";
import { beforeEach, expect, test, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

import {
  JoinInviteCheckoutPlanButtonIsland,
  JoinInviteLegalConsentIsland,
  JoinInviteMessagingSetupIsland,
  JoinInvitePhoneVerificationIsland,
  JoinInviteSignOutButtonIsland,
  JoinInviteStatusRefreshIsland,
} from "@/src/components/hosted-onboarding/join-invite-islands";
import { JoinInviteStarterUsageIsland } from "@/src/components/hosted-onboarding/join-invite-starter-usage-island";
import {
  HostedOnboardingApiError,
  type HostedStarterUsageEnrollmentResponse,
} from "@/src/components/hosted-onboarding/client-api";
import {
  getHostedDefaultBillingPlanCode,
  listHostedBillingPlanPresentations,
} from "@/src/lib/hosted-onboarding/billing-plans";
import type { HostedInviteStatusPayload } from "@/src/lib/hosted-onboarding/types";
import type { HostedConsentStatus } from "@/src/lib/legal/consent";
import { buildJoinInviteStatusRefreshSnapshot } from "@/src/components/hosted-onboarding/join-invite-state";

const mocks = vi.hoisted(() => ({
  privyLogout: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
  requestHostedStarterUsageEnrollment: vi.fn(),
  requestHostedBillingCheckout: vi.fn(),
  requestHostedOnboardingJson: vi.fn(),
  hostedEmailAuthProps: null as Record<string, unknown> | null,
  hostedPhoneAuthProps: null as Record<string, unknown> | null,
  hostedPhoneSettingsProps: null as Record<string, unknown> | null,
  connectTelegramProps: null as Record<string, unknown> | null,
  reportPhoneDiagnostic: vi.fn(),
  useHostedPhoneLinkDiagnostics: vi.fn(),
  usePrivy: vi.fn(),
  useUser: vi.fn(),
  useHostedInviteStatusRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: mocks.refresh,
    replace: mocks.replace,
  }),
}));

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: mocks.usePrivy,
  useUser: mocks.useUser,
}));

vi.mock("@/src/components/settings/hosted-phone-link-diagnostics", () => ({
  useHostedPhoneLinkDiagnostics: mocks.useHostedPhoneLinkDiagnostics,
}));

vi.mock("@/src/components/settings/hosted-phone-settings", () => ({
  HostedPhoneSettings(props: Record<string, unknown>) {
    mocks.hostedPhoneSettingsProps = props;
    return createElement(
      "div",
      {
        "data-hosted-phone-settings": "true",
      },
      "Hosted phone settings",
    );
  },
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
  ConnectTelegram(props: {
    authenticated: boolean;
    initialTelegramAccount: { username: string | null } | null;
  }) {
    mocks.connectTelegramProps = props;
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
    requestHostedStarterUsageEnrollment: mocks.requestHostedStarterUsageEnrollment,
    requestHostedBillingCheckout: mocks.requestHostedBillingCheckout,
    requestHostedOnboardingJson: mocks.requestHostedOnboardingJson,
  };
});

vi.mock("@/src/components/hosted-onboarding/invite-status-client", () => ({
  useHostedInviteStatusRefresh: mocks.useHostedInviteStatusRefresh,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.connectTelegramProps = null;
  mocks.hostedEmailAuthProps = null;
  mocks.hostedPhoneAuthProps = null;
  mocks.hostedPhoneSettingsProps = null;
  mocks.useHostedPhoneLinkDiagnostics.mockReturnValue(mocks.reportPhoneDiagnostic);
  mocks.usePrivy.mockReturnValue({
    authenticated: true,
    logout: mocks.privyLogout,
    ready: true,
  });
  mocks.useUser.mockReturnValue({
    refreshUser: vi.fn(),
    user: {
      id: "privy-user-a",
    },
  });
});

test("JoinInviteSignOutButtonIsland preserves the invite URL while switching accounts", async () => {
  mocks.requestHostedOnboardingJson.mockResolvedValueOnce({ ok: true });
  const { button, cleanup } = await renderClientComponent(
    createElement(JoinInviteSignOutButtonIsland),
  );

  expect(button.textContent).toBe("Use this invite instead");

  await act(async () => {
    button.click();
    await Promise.resolve();
  });

  await vi.waitFor(() => {
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });
  expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith(
    expect.objectContaining({
      method: "POST",
      url: "/api/hosted-onboarding/session/logout",
    }),
  );
  expect(mocks.privyLogout).toHaveBeenCalledTimes(1);
  expect(mocks.replace).not.toHaveBeenCalled();
  await cleanup();
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

test("JoinInviteCheckoutPlanButtonIsland sends the Pulse plan to checkout", async () => {
  mocks.requestHostedBillingCheckout.mockResolvedValue({
    alreadyActive: false,
    url: "https://stripe.example.test/trial",
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

  expect(mocks.requestHostedBillingCheckout).toHaveBeenCalledWith({
    billingPlanCode: "launch_monthly",
    inviteCode: "invite-code",
  });
  expect(assign).toHaveBeenCalledWith("https://stripe.example.test/trial");
  await cleanup();
});

test("JoinInviteCheckoutPlanButtonIsland uses the disabled label when checkout is not ready", async () => {
  const { button, cleanup } = await renderClientComponent(
    createElement(JoinInviteCheckoutPlanButtonIsland, {
      billingReady: false,
      disabledLabel: "Checkout unavailable",
      idleLabel: "Get Pulse",
      inviteCode: "invite-code",
      planCode: "launch_monthly",
    }),
  );

  expect((button as HTMLButtonElement).disabled).toBe(true);
  expect(button.textContent).toBe("Checkout unavailable");
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

test("JoinInviteStarterUsageIsland reloads the document after successful enrollment", async () => {
  mocks.requestHostedStarterUsageEnrollment.mockResolvedValue({
    redirectPath: "/home",
    status: "enrolled",
  });

  const { cleanup, replaceLocation } = await renderClientComponent(
    createElement(JoinInviteStarterUsageIsland, {
      inviteCode: "invite-code",
    }),
    { requireButton: false },
  );

  await act(async () => {
    await Promise.resolve();
  });

  expect(mocks.requestHostedStarterUsageEnrollment).toHaveBeenCalledWith({
    inviteCode: "invite-code",
  });
  expect(replaceLocation).toHaveBeenCalledWith("/home");
  expect(mocks.replace).not.toHaveBeenCalled();
  await cleanup();
});

test("JoinInviteStarterUsageIsland preserves the document reload after unmount", async () => {
  let resolveEnrollment!: (value: HostedStarterUsageEnrollmentResponse) => void;
  mocks.requestHostedStarterUsageEnrollment.mockReturnValue(
    new Promise<HostedStarterUsageEnrollmentResponse>((resolve) => {
      resolveEnrollment = resolve;
    }),
  );

  const { cleanup, replaceLocation } = await renderClientComponent(
    createElement(JoinInviteStarterUsageIsland, {
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

  expect(replaceLocation).toHaveBeenCalledWith("/home");
  expect(mocks.replace).not.toHaveBeenCalled();
});

test("JoinInviteStarterUsageIsland renders a distinct retry state after enrollment fails", async () => {
  mocks.requestHostedStarterUsageEnrollment.mockRejectedValue(
    new HostedOnboardingApiError({
      code: "HOSTED_STARTER_USAGE_FINALIZATION_BUSY",
      message: "Murph is still finishing starter setup. Try again.",
      retryable: true,
    }),
  );

  const { container, cleanup } = await renderClientComponent(
    createElement(JoinInviteStarterUsageIsland, {
      inviteCode: "invite-code",
    }),
    { requireButton: false },
  );

  await act(async () => {
    await Promise.resolve();
  });

  expect(container.textContent).toContain("Setup paused");
  expect(container.textContent).toContain("Unable to finish setup");
  expect(container.textContent).toContain(
    "Murph is still finishing starter setup. Try again.",
  );
  expect(container.textContent).toContain("Try again");
  expect(container.textContent).not.toContain("Setting up your Murph");
  expect(container.querySelector("[role='status']")).toBeNull();
  expect(container.querySelector("[role='alert']")).not.toBeNull();
  await cleanup();
});

test("JoinInviteStarterUsageIsland offers paid checkout when starter usage is already owned", async () => {
  mocks.requestHostedStarterUsageEnrollment.mockRejectedValue(
    new HostedOnboardingApiError({
      code: "HOSTED_STARTER_USAGE_ENROLLMENT_BLOCKED",
      message: "This hosted account already has billing history.",
    }),
  );
  mocks.requestHostedBillingCheckout.mockResolvedValue({
    alreadyActive: false,
    url: "https://stripe.example.test/paid-pulse",
  });

  const { assign, cleanup, container, window } = await renderClientComponent(
    createElement(JoinInviteStarterUsageIsland, {
      inviteCode: "invite-code",
    }),
    { requireButton: false },
  );

  await act(async () => {
    await Promise.resolve();
  });

  expect(container.textContent).toContain("Choose your access");
  expect(container.textContent).toContain(
    "This account has prior billing history, so it cannot receive starter usage again.",
  );
  expect(container.textContent).toContain("Continue with Pulse");
  expect(container.textContent).not.toContain("Contact support to restore access");
  expect(container.textContent).not.toContain("Try again");

  await act(async () => {
    findButtonByText(container, /Continue with Pulse/).dispatchEvent(
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

test("JoinInviteStarterUsageIsland refreshes stale messaging-required state into setup", async () => {
  mocks.requestHostedStarterUsageEnrollment.mockRejectedValue(
    new HostedOnboardingApiError({
      code: "HOSTED_MESSAGING_CHANNEL_REQUIRED",
      message: "Verify your phone number or connect Telegram before checkout so Murph can message you.",
    }),
  );

  const { cleanup, container, window } = await renderClientComponent(
    createElement(JoinInviteStarterUsageIsland, {
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
  expect(container.textContent).not.toContain("Continue with Pulse");

  await act(async () => {
    findButtonByText(container, /Continue setup/).dispatchEvent(
      new window.Event("click", { bubbles: true }),
    );
  });

  expect(mocks.refresh).toHaveBeenCalledTimes(1);
  await cleanup();
});

test("JoinInviteStarterUsageIsland shows support for non-checkout account errors", async () => {
  mocks.requestHostedStarterUsageEnrollment.mockRejectedValue(
    new HostedOnboardingApiError({
      code: "HOSTED_MEMBER_SUSPENDED",
      message: "This hosted account is suspended. Contact support to restore access.",
    }),
  );

  const { cleanup, container } = await renderClientComponent(
    createElement(JoinInviteStarterUsageIsland, {
      inviteCode: "invite-code",
    }),
    { requireButton: false },
  );

  await act(async () => {
    await Promise.resolve();
  });

  expect(container.textContent).toContain("Murph setup needs support");
  expect(container.textContent).toContain("Email support");
  expect(container.textContent).not.toContain("Try again");
  expect(container.textContent).not.toContain("Continue with Pulse");
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

test("JoinInviteStatusRefreshIsland rereads a pending Family server projection", async () => {
  const status = createStatus({
    session: {
      authenticated: true,
      expiresAt: null,
      matchesInvite: true,
    },
    stage: "checkout",
  });
  const { cleanup } = await renderClientComponent(
    createElement(JoinInviteStatusRefreshIsland, {
      current: buildJoinInviteStatusRefreshSnapshot(status, "checkout"),
      inviteCode: "invite-code",
      legalGateActive: false,
    }),
    { requireButton: false },
  );

  const refreshOptions = mocks.useHostedInviteStatusRefresh.mock.calls[0]?.[0];

  act(() => {
    refreshOptions.onStatus(status);
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

test("JoinInviteMessagingSetupIsland shows Privy phone linking and Telegram connect together", async () => {
  const { cleanup, container } = await renderClientComponent(
    createElement(JoinInviteMessagingSetupIsland, {
      authenticated: true,
      expectedPrivyUserId: "privy-user-a",
      initialTelegramAccount: null,
      privySessionMatchesAppSession: true,
    }),
    { requireButton: false },
  );

  expect(container.querySelector('[data-hosted-phone-settings="true"]')).toBeTruthy();
  expect(container.querySelector('[data-connect-telegram="true"]')).toBeTruthy();
  expect(container.textContent).toContain("OR");
  expect(mocks.hostedPhoneSettingsProps).toMatchObject({
    diagnosticReporterFactory: mocks.reportPhoneDiagnostic,
    onLinked: expect.any(Function),
  });
  expect(mocks.useHostedPhoneLinkDiagnostics).toHaveBeenCalledWith(
    expect.objectContaining({
      operation: "link",
      showLinkForm: true,
      surface: "join_invite",
    }),
  );
  expect(mocks.hostedPhoneSettingsProps).not.toHaveProperty("authenticated");
  expect(mocks.hostedPhoneSettingsProps).not.toHaveProperty("expectedPrivyUserId");
  expect(mocks.hostedPhoneSettingsProps).not.toHaveProperty(
    "privySessionMatchesAppSession",
  );
  await cleanup();
});

test("JoinInviteMessagingSetupIsland surfaces an existing Telegram seed", async () => {
  const { cleanup, container } = await renderClientComponent(
    createElement(JoinInviteMessagingSetupIsland, {
      authenticated: true,
      expectedPrivyUserId: "privy-user-a",
      initialTelegramAccount: {
        telegramUserId: "telegram-test-user",
        username: "murph_test",
      },
      privySessionMatchesAppSession: true,
    }),
    { requireButton: false },
  );

  expect(container.querySelector('[data-connect-telegram="true"]')).toBeTruthy();
  expect(container.textContent).toContain("murph_test");
  await cleanup();
});

test("JoinInviteMessagingSetupIsland blocks both provider link surfaces on a stale Privy session", async () => {
  mocks.requestHostedOnboardingJson.mockResolvedValueOnce({ ok: true });
  const { cleanup, container } = await renderClientComponent(
    createElement(JoinInviteMessagingSetupIsland, {
      authenticated: true,
      expectedPrivyUserId: "privy-user-a",
      initialTelegramAccount: null,
      privySessionMatchesAppSession: false,
    }),
    { requireButton: false },
  );

  expect(container.querySelector('[data-hosted-phone-settings="true"]')).toBeNull();
  expect(container.querySelector('[data-connect-telegram="true"]')).toBeNull();
  expect(container.textContent).toContain("Your sign-in changed.");

  const signInAgainButton = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.includes("Sign in again"),
  );
  expect(signInAgainButton).toBeTruthy();

  await act(async () => {
    signInAgainButton?.dispatchEvent(new Event("click", { bubbles: true }));
    await Promise.resolve();
  });

  expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith(
    expect.objectContaining({
      method: "POST",
      url: "/api/hosted-onboarding/session/logout",
    }),
  );
  expect(mocks.privyLogout).toHaveBeenCalledTimes(1);
  expect(mocks.refresh).toHaveBeenCalledTimes(1);
  await cleanup();
});

test("JoinInviteMessagingSetupIsland waits for the Privy client before mounting link actions", async () => {
  mocks.usePrivy.mockReturnValue({
    authenticated: false,
    logout: mocks.privyLogout,
    ready: false,
  });

  const { cleanup, container } = await renderClientComponent(
    createElement(JoinInviteMessagingSetupIsland, {
      authenticated: true,
      expectedPrivyUserId: "privy-user-a",
      initialTelegramAccount: null,
      privySessionMatchesAppSession: true,
    }),
    { requireButton: false },
  );

  expect(container.textContent).toContain("Preparing secure account linking");
  expect(container.querySelector('[data-hosted-phone-settings="true"]')).toBeNull();
  expect(container.querySelector('[data-connect-telegram="true"]')).toBeNull();
  await cleanup();
});

test("JoinInviteMessagingSetupIsland keeps warm-session hydration pending until the concrete client identity resolves", async () => {
  mocks.useUser.mockReturnValue({
    refreshUser: vi.fn(),
    user: null,
  });
  const renderIsland = () => createElement(JoinInviteMessagingSetupIsland, {
    authenticated: true,
    expectedPrivyUserId: "privy-user-a",
    initialTelegramAccount: null,
    privySessionMatchesAppSession: true,
  });
  const rendered = await renderClientComponent(renderIsland(), { requireButton: false });

  expect(rendered.container.textContent).toContain("Preparing secure account linking");
  expect(rendered.container.textContent).not.toContain("Sign in again");
  expect(rendered.container.querySelector('[data-hosted-phone-settings="true"]')).toBeNull();
  expect(rendered.container.querySelector('[data-connect-telegram="true"]')).toBeNull();

  mocks.useUser.mockReturnValue({
    refreshUser: vi.fn(),
    user: {
      id: "privy-user-a",
    },
  });
  await rendered.rerender(renderIsland());

  expect(rendered.container.querySelector('[data-hosted-phone-settings="true"]')).toBeTruthy();
  expect(rendered.container.querySelector('[data-connect-telegram="true"]')).toBeTruthy();

  mocks.useUser.mockReturnValue({
    refreshUser: vi.fn(),
    user: {
      id: "privy-user-b",
    },
  });
  await rendered.rerender(renderIsland());

  expect(rendered.container.textContent).toContain("Your sign-in changed.");
  expect(rendered.container.querySelector('[data-hosted-phone-settings="true"]')).toBeNull();
  expect(rendered.container.querySelector('[data-connect-telegram="true"]')).toBeNull();
  await rendered.cleanup();
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
    inline: true,
    lockedEmailAddress: "buddy@example.com",
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

  expect(container.querySelector('input[type="checkbox"]')).toBeNull();
  const continueButton = findButtonByText(container, /^Consent$/);

  await act(async () => {
    continueButton.dispatchEvent(new window.Event("click", { bubbles: true }));
  });

  await vi.waitFor(() => {
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  expect(container.textContent).toContain("Terms");
  expect(container.textContent).toContain("Health data");
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
    telegramStartRequired: false,
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
      consentScope(
        "launch.health-data",
        "Health data notice and processing authorization",
        healthDataDocuments,
        launchHealthDataGranted,
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
