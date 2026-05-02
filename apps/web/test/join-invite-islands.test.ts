import { act, createElement } from "react";
import { beforeEach, expect, test, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

import {
  JoinInviteCheckoutPlanButtonIsland,
  JoinInviteMessagingSetupIsland,
  JoinInviteStatusRefreshIsland,
} from "@/src/components/hosted-onboarding/join-invite-islands";
import {
  getHostedDefaultBillingPlanCode,
  listHostedBillingPlanPresentations,
} from "@/src/lib/hosted-onboarding/billing-plans";
import type { HostedInviteStatusPayload } from "@/src/lib/hosted-onboarding/types";
import { buildJoinInviteStatusRefreshSnapshot } from "@/src/components/hosted-onboarding/join-invite-state";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  requestHostedBillingCheckout: vi.fn(),
  hostedPhoneAuthProps: null as Record<string, unknown> | null,
  useHostedInviteStatusRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: mocks.refresh,
  }),
}));

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({
    logout: vi.fn(),
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
    requestHostedBillingCheckout: mocks.requestHostedBillingCheckout,
  };
});

vi.mock("@/src/components/hosted-onboarding/invite-status-client", () => ({
  useHostedInviteStatusRefresh: mocks.useHostedInviteStatusRefresh,
}));

beforeEach(() => {
  vi.clearAllMocks();
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
