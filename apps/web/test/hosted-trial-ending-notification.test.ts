import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendHostedMailboxEnvelopeTx: vi.fn(),
  hasActiveHostedCryptoDomainRootsForUserTx: vi.fn(),
  hasConfirmedHostedGroupMembership: vi.fn(),
  resolveHostedAssistantNotificationDestination: vi.fn(),
}));

vi.mock("@/src/lib/hosted-mailbox/store", () => ({
  appendHostedMailboxEnvelopeTx: mocks.appendHostedMailboxEnvelopeTx,
}));

vi.mock("@/src/lib/hosted-crypto/domain-root-store", () => ({
  hasActiveHostedCryptoDomainRootsForUserTx:
    mocks.hasActiveHostedCryptoDomainRootsForUserTx,
}));

vi.mock(
  "@/src/lib/hosted-routing/assistant-notification-destination",
  () => ({
    resolveHostedAssistantNotificationDestination:
      mocks.resolveHostedAssistantNotificationDestination,
  }),
);

vi.mock(
  "@/src/lib/hosted-onboarding/billing-plan-eligibility",
  async () => {
    const actual = await vi.importActual<
      typeof import("@/src/lib/hosted-onboarding/billing-plan-eligibility")
    >("@/src/lib/hosted-onboarding/billing-plan-eligibility");

    return {
      ...actual,
      hasConfirmedHostedGroupMembership:
        mocks.hasConfirmedHostedGroupMembership,
    };
  },
);

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  getHostedOnboardingEnvironment: () => ({
    stripePriceIdsByPlan: {
      launch_edge_monthly: "price_edge",
      launch_group_monthly: "price_group",
      launch_monthly: "price_pulse",
    },
  }),
}));

import {
  appendHostedTrialEndingNotificationTx,
  buildHostedTrialEndingNotificationText,
} from "@/src/lib/hosted-onboarding/billing-trial-ending-notification";

describe("hosted trial-ending notification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appendHostedMailboxEnvelopeTx.mockResolvedValue({
      item: {
        id: "mailbox_trial_ending",
        userId: "member_123",
      },
    });
    mocks.hasActiveHostedCryptoDomainRootsForUserTx.mockResolvedValue(true);
    mocks.hasConfirmedHostedGroupMembership.mockResolvedValue(true);
    mocks.resolveHostedAssistantNotificationDestination.mockResolvedValue({
      conversationShape: "direct-member",
      externalThreadRouteAuthority: null,
      route: {
        channel: "linq",
        delivery: {
          kind: "thread",
          target: "private_chat_123",
        },
        threadIsDirect: true,
      },
    });
  });

  it("appends an eligible member's exact private offer with semantic dedupe", async () => {
    const tx = buildTx();
    const trialEnd = Math.floor(
      Date.parse("2026-08-27T04:00:00.000Z") / 1_000,
    );

    await expect(appendHostedTrialEndingNotificationTx({
      memberId: "member_123",
      occurredAt: new Date("2026-08-20T12:00:00.000Z"),
      subscription: buildTrialSubscription(trialEnd, { withTender: true }),
      tx,
    })).resolves.toEqual({
      mailboxItemId: "mailbox_trial_ending",
      memberId: "member_123",
    });

    const notificationKey = `trial-ending:sub_trial:${trialEnd}`;
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        eventId: `assistant.notification.requested:${notificationKey}`,
        notification: expect.objectContaining({
          deliveryDedupeToken: notificationKey,
          deliveryDispatchMode: "queue-only",
          deliveryIdempotencyKey: notificationKey,
          responsePolicy: {
            kind: "require_send_exact_text",
            text: expect.stringMatching(
              /set to renew as Pulse for \$8\/month.*switch to Group for \$3\.50\/month/su,
            ),
          },
          route: expect.objectContaining({
            threadIsDirect: true,
          }),
        }),
      }),
      tx,
    });
  });

  it("offers only Pulse to a member without current confirmed membership", async () => {
    mocks.hasConfirmedHostedGroupMembership.mockResolvedValue(false);

    await appendHostedTrialEndingNotificationTx({
      memberId: "member_123",
      occurredAt: new Date("2026-08-20T12:00:00.000Z"),
      subscription: buildTrialSubscription(1_777_264_000, {
        withTender: true,
      }),
      tx: buildTx(),
    });

    const text = mocks.appendHostedMailboxEnvelopeTx.mock.calls[0]?.[0]
      ?.envelope.notification.responsePolicy.text as string;
    expect(text).toContain("set to renew for $8/month");
    expect(text).not.toContain("Group");
    expect(text).not.toContain("$3.50");
  });

  it("does not claim an automatic renewal for a trial without payment evidence", async () => {
    await appendHostedTrialEndingNotificationTx({
      memberId: "member_123",
      occurredAt: new Date("2026-08-20T12:00:00.000Z"),
      subscription: buildTrialSubscription(1_777_264_000),
      tx: buildTx(),
    });

    const text = mocks.appendHostedMailboxEnvelopeTx.mock.calls[0]?.[0]
      ?.envelope.notification.responsePolicy.text as string;
    expect(text).toContain("Since you're already part of a Murph group");
    expect(text).toContain("continue with Group for $3.50/month");
    expect(text).not.toContain("set to renew");
  });

  it("never falls back to a group destination when the private route is unavailable", async () => {
    mocks.resolveHostedAssistantNotificationDestination.mockResolvedValue({
      conversationShape: "thread-container",
      externalThreadRouteAuthority: {
        channel: "linq",
      },
      route: {
        channel: "linq",
        delivery: {
          kind: "thread",
          target: "group_chat_123",
        },
        threadIsDirect: false,
      },
    });

    await expect(appendHostedTrialEndingNotificationTx({
      memberId: "member_123",
      occurredAt: new Date("2026-08-20T12:00:00.000Z"),
      subscription: buildTrialSubscription(1_777_264_000),
      tx: buildTx(),
    })).resolves.toBeNull();
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
  });

  it("skips stale notices after the subscription is no longer trialing", async () => {
    await expect(appendHostedTrialEndingNotificationTx({
      memberId: "member_123",
      occurredAt: new Date("2026-08-20T12:00:00.000Z"),
      subscription: {
        ...buildTrialSubscription(1_777_264_000),
        status: "active",
      },
      tx: buildTx(),
    })).resolves.toBeNull();
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
  });

  it("uses the changed trial timestamp as a distinct dedupe fact", async () => {
    const tx = buildTx();
    await appendHostedTrialEndingNotificationTx({
      memberId: "member_123",
      occurredAt: new Date("2026-08-20T12:00:00.000Z"),
      subscription: buildTrialSubscription(1_777_264_000),
      tx,
    });
    await appendHostedTrialEndingNotificationTx({
      memberId: "member_123",
      occurredAt: new Date("2026-08-21T12:00:00.000Z"),
      subscription: buildTrialSubscription(1_777_350_400),
      tx,
    });

    const eventIds = mocks.appendHostedMailboxEnvelopeTx.mock.calls.map(
      ([input]) => input.envelope.eventId,
    );
    expect(new Set(eventIds).size).toBe(2);
  });

  it("discloses an already-selected Group continuation", () => {
    const text = buildHostedTrialEndingNotificationText({
      availablePlanCodes: ["launch_group_monthly", "launch_monthly"],
      renewalPlanCode: "launch_group_monthly",
      trialEndsAt: new Date("2026-08-27T04:00:00.000Z"),
    });

    expect(text).toContain("set to continue as Group for $3.50/month");
    expect(text).toContain("You can keep Group or choose Pulse");
  });
});

function buildTx() {
  return {
    hostedMemberBillingRef: {
      findUnique: vi.fn(async () => ({
        currentBillingPhase: "trial",
        currentBillingPlanCode: "launch_monthly",
        currentCheckoutOffer: "pulse_trial_7d",
        scheduledBillingPlanCode: null,
      })),
    },
  } as never;
}

function buildTrialSubscription(
  trialEnd: number,
  options: { withTender?: boolean } = {},
): Pick<
  Stripe.Subscription,
  | "customer"
  | "default_payment_method"
  | "default_source"
  | "id"
  | "status"
  | "trial_end"
> {
  return {
    customer: "cus_trial",
    default_payment_method: options.withTender ? "pm_trial" : null,
    default_source: null,
    id: "sub_trial",
    status: "trialing",
    trial_end: trialEnd,
  };
}
