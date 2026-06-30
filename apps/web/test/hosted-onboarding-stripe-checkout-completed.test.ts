import { HostedBillingStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { HostedMemberBillingSnapshot } from "@/src/lib/hosted-onboarding/hosted-member-store";

const mocks = vi.hoisted(() => ({
  activateHostedMemberForPositiveSourceTx: vi.fn(),
  findMemberForStripeCheckoutSession: vi.fn(),
  listHostedStripeCheckoutSessionMemberIds: vi.fn(),
  lockHostedMemberRow: vi.fn(),
  readHostedMemberBillingSnapshot: vi.fn(),
  requireHostedStripeApi: vi.fn(),
  retrieveStripeSubscription: vi.fn(),
  upsertHostedMemberStripeCheckoutEmailIfFreshTx: vi.fn(),
  writeHostedMemberStripeBillingRef: vi.fn(),
  writeHostedMemberStripeBillingTx: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/member-activation", () => ({
  activateHostedMemberForPositiveSourceTx: mocks.activateHostedMemberForPositiveSourceTx,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-billing-store", () => ({
  writeHostedMemberStripeBillingRefTx: mocks.writeHostedMemberStripeBillingRef,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/hosted-member-store")
  >("@/src/lib/hosted-onboarding/hosted-member-store");

  return {
    ...actual,
    readHostedMemberBillingSnapshot: mocks.readHostedMemberBillingSnapshot,
    upsertHostedMemberStripeCheckoutEmailIfFreshTx:
      mocks.upsertHostedMemberStripeCheckoutEmailIfFreshTx,
  };
});

vi.mock("@/src/lib/hosted-onboarding/shared", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/shared")
  >("@/src/lib/hosted-onboarding/shared");

  return {
    ...actual,
    lockHostedMemberRow: mocks.lockHostedMemberRow,
  };
});

vi.mock("@/src/lib/hosted-onboarding/stripe-billing-lookup", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/stripe-billing-lookup")
  >("@/src/lib/hosted-onboarding/stripe-billing-lookup");

  return {
    ...actual,
    findMemberForStripeCheckoutSession: mocks.findMemberForStripeCheckoutSession,
    listHostedStripeCheckoutSessionMemberIds: mocks.listHostedStripeCheckoutSessionMemberIds,
  };
});

vi.mock("@/src/lib/hosted-onboarding/stripe-billing-policy", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/stripe-billing-policy")
  >("@/src/lib/hosted-onboarding/stripe-billing-policy");

  return {
    ...actual,
    writeHostedMemberStripeBillingTx: mocks.writeHostedMemberStripeBillingTx,
  };
});

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  requireHostedStripeApi: mocks.requireHostedStripeApi,
}));

import { applyStripeCheckoutCompleted } from "@/src/lib/hosted-onboarding/stripe-billing-events";

describe("applyStripeCheckoutCompleted", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.lockHostedMemberRow.mockResolvedValue(undefined);
    mocks.findMemberForStripeCheckoutSession.mockResolvedValue(makeMemberSnapshot());
    mocks.listHostedStripeCheckoutSessionMemberIds.mockResolvedValue(["member_123"]);
    mocks.readHostedMemberBillingSnapshot.mockResolvedValue(makeMemberSnapshot());
    mocks.requireHostedStripeApi.mockReturnValue({
      subscriptions: {
        retrieve: mocks.retrieveStripeSubscription,
      },
    });
    mocks.retrieveStripeSubscription.mockResolvedValue(makePulseTrialSubscription());
    mocks.writeHostedMemberStripeBillingRef.mockResolvedValue({
      lastStripeEventCreatedAt: new Date("2025-04-12T00:00:00.000Z"),
      memberId: "member_123",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
    });
    mocks.upsertHostedMemberStripeCheckoutEmailIfFreshTx.mockResolvedValue({
      directPublicSender: null,
      memberId: "member_123",
      stripeCheckoutEmail: {
        address: "payer@example.com",
        collectedAt: new Date(1_744_416_000 * 1000),
      },
      verifiedEmail: null,
    });
    mocks.writeHostedMemberStripeBillingTx.mockResolvedValue(makeMemberSnapshot({
      billingRef: {
        currentBillingPhase: "trial",
        currentBillingPlanCode: "launch_monthly",
        currentCheckoutOffer: "pulse_trial_7d",
        currentPeriodEnd: new Date("2025-04-19T00:00:00.000Z"),
        currentPeriodStart: new Date("2025-04-12T00:00:00.000Z"),
        currentTrialEndsAt: new Date("2025-04-19T00:00:00.000Z"),
        currentTrialStartedAt: new Date("2025-04-12T00:00:00.000Z"),
        memberId: "member_123",
        pulseTrialPolicyVersion: "pulse-trial-2026-06-30-v2",
        pulseTrialRedeemedAt: new Date("2025-04-12T00:00:00.000Z"),
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
      },
    }));
    mocks.activateHostedMemberForPositiveSourceTx.mockResolvedValue({
      activated: true,
      hostedExecutionEventId: "wake_123",
      memberId: "member_123",
    });
  });

  it("writes checkout-session refs with a session-derived freshness watermark", async () => {
    await expect(
      applyStripeCheckoutCompleted(
        {
          created: 1_744_416_000,
          customer: "cus_123",
          customer_details: {
            email: " payer@example.com ",
          },
          id: "cs_123",
          subscription: "sub_123",
        } as never,
        {} as never,
      ),
    ).resolves.toEqual({
      activatedMemberId: null,
      hostedExecutionEventId: null,
      welcomeEmailMemberId: "member_123",
    });

    expect(mocks.writeHostedMemberStripeBillingRef).toHaveBeenCalledWith(expect.objectContaining({
      currentCheckoutOffer: "standard",
      memberId: "member_123",
      stripeCustomerId: "cus_123",
      stripeEventCreatedAt: new Date(1_744_416_000 * 1000),
      stripeSubscriptionId: "sub_123",
      tx: {},
    }));
    expect(mocks.upsertHostedMemberStripeCheckoutEmailIfFreshTx).toHaveBeenCalledWith({
      address: "payer@example.com",
      collectedAt: new Date(1_744_416_000 * 1000),
      memberId: "member_123",
      prisma: {},
    });
  });

  it("ignores stale checkout billing refs without dropping the email hint", async () => {
    mocks.readHostedMemberBillingSnapshot.mockResolvedValue(makeMemberSnapshot({
      billingRef: {
        lastStripeEventCreatedAt: new Date("2026-04-12T02:00:00.000Z"),
        memberId: "member_123",
        stripeCustomerId: "cus_current",
        stripeSubscriptionId: "sub_current",
      },
    }));

    await expect(
      applyStripeCheckoutCompleted(
        {
          created: 1_744_412_400,
          customer: "cus_old",
          customer_email: "old-payer@example.com",
          id: "cs_old",
          subscription: "sub_old",
        } as never,
        {} as never,
      ),
    ).resolves.toEqual({
      activatedMemberId: null,
      hostedExecutionEventId: null,
      welcomeEmailMemberId: "member_123",
    });

    expect(mocks.writeHostedMemberStripeBillingRef).not.toHaveBeenCalled();
    expect(mocks.upsertHostedMemberStripeCheckoutEmailIfFreshTx).toHaveBeenCalledWith({
      address: "old-payer@example.com",
      collectedAt: new Date(1_744_412_400 * 1000),
      memberId: "member_123",
      prisma: {},
    });
  });

  it("activates a metadata-gated Pulse Trial checkout when the expanded subscription is trialing", async () => {
    await expect(
      applyStripeCheckoutCompleted(
        makePulseTrialCheckoutSession() as never,
        {} as never,
      ),
    ).resolves.toEqual({
      activatedMemberId: "member_123",
      hostedExecutionEventId: "wake_123",
      welcomeEmailMemberId: "member_123",
    });

    expect(mocks.writeHostedMemberStripeBillingTx).toHaveBeenCalledWith(expect.objectContaining({
      billingStatus: HostedBillingStatus.active,
      canonicalBillingStatus: HostedBillingStatus.active,
      currentBillingPhase: "trial",
      currentBillingPlanCode: "launch_monthly",
      currentCheckoutOffer: "pulse_trial_7d",
      currentTrialEndsAt: new Date("2025-04-19T00:00:00.000Z"),
      currentTrialStartedAt: new Date("2025-04-12T00:00:00.000Z"),
      freshnessPolicy: "trial-checkout-entitlement",
      pulseTrialPolicyVersion: "pulse-trial-2026-06-30-v2",
      pulseTrialRedeemedAt: new Date("2025-04-12T00:00:00.000Z"),
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
    }));
    expect(mocks.activateHostedMemberForPositiveSourceTx).toHaveBeenCalledWith({
      dispatchContext: expect.objectContaining({
        sourceEventId: "checkout.session:cs_trial_123",
        sourceType: "stripe.checkout.session.completed",
      }),
      memberId: "member_123",
      prisma: {},
      skipIfBillingAlreadyActive: false,
    });
  });

  it("accepts legacy seven-day Pulse Trial checkout metadata for in-flight sessions", async () => {
    await expect(
      applyStripeCheckoutCompleted(
        {
          ...makePulseTrialCheckoutSession(),
          metadata: {
            billingPlanCode: "launch_monthly",
            checkoutOffer: "pulse_trial_7d",
            memberId: "member_123",
            trialDurationDays: "7",
            trialPolicyVersion: "pulse-trial-2026-05-05-v1",
            trialUsageLimitUsdMicros: "4500000",
          },
        } as never,
        {} as never,
      ),
    ).resolves.toEqual({
      activatedMemberId: "member_123",
      hostedExecutionEventId: "wake_123",
      welcomeEmailMemberId: "member_123",
    });

    expect(mocks.writeHostedMemberStripeBillingTx).toHaveBeenCalledWith(expect.objectContaining({
      currentBillingPhase: "trial",
      pulseTrialPolicyVersion: "pulse-trial-2026-05-05-v1",
      stripeSubscriptionId: "sub_123",
    }));
  });

  it("activates Pulse Trial checkout with the pre-resolved subscription from event processing", async () => {
    await expect(
      applyStripeCheckoutCompleted(
        {
          ...makePulseTrialCheckoutSession(),
          subscription: "sub_123",
        } as never,
        {} as never,
        undefined,
        makePulseTrialSubscription() as never,
      ),
    ).resolves.toEqual({
      activatedMemberId: "member_123",
      hostedExecutionEventId: "wake_123",
      welcomeEmailMemberId: "member_123",
    });

    expect(mocks.requireHostedStripeApi).not.toHaveBeenCalled();
    expect(mocks.writeHostedMemberStripeBillingTx).toHaveBeenCalledWith(expect.objectContaining({
      currentBillingPhase: "trial",
      stripeSubscriptionId: "sub_123",
    }));
  });

  it("activates Pulse Trial checkout when Stripe omits subscription current-period fields", async () => {
    const subscriptionWithoutPeriod = makePulseTrialSubscription();
    delete subscriptionWithoutPeriod.current_period_end;
    delete subscriptionWithoutPeriod.current_period_start;

    await expect(
      applyStripeCheckoutCompleted(
        {
          ...makePulseTrialCheckoutSession(),
          subscription: "sub_123",
        } as never,
        {} as never,
        undefined,
        subscriptionWithoutPeriod as never,
      ),
    ).resolves.toEqual({
      activatedMemberId: "member_123",
      hostedExecutionEventId: "wake_123",
      welcomeEmailMemberId: "member_123",
    });

    const [writeInput] = mocks.writeHostedMemberStripeBillingTx.mock.calls[0] ?? [];
    expect(writeInput).toEqual(expect.objectContaining({
      currentBillingPhase: "trial",
      currentCheckoutOffer: "pulse_trial_7d",
      currentPeriodEnd: null,
      currentPeriodStart: null,
      currentTrialEndsAt: new Date("2025-04-19T00:00:00.000Z"),
      currentTrialStartedAt: new Date("2025-04-12T00:00:00.000Z"),
      stripeSubscriptionId: "sub_123",
    }));
    expect(mocks.activateHostedMemberForPositiveSourceTx).toHaveBeenCalledWith({
      dispatchContext: expect.objectContaining({
        sourceEventId: "checkout.session:cs_trial_123",
      }),
      memberId: "member_123",
      prisma: {},
      skipIfBillingAlreadyActive: false,
    });
  });

  it("activates Pulse Trial checkout when Stripe current-period metadata is inconsistent", async () => {
    const subscriptionWithInconsistentPeriod = makePulseTrialSubscription();
    subscriptionWithInconsistentPeriod.current_period_start = 1_744_502_400;
    subscriptionWithInconsistentPeriod.current_period_end = 1_745_020_800;

    await expect(
      applyStripeCheckoutCompleted(
        {
          ...makePulseTrialCheckoutSession(),
          subscription: "sub_123",
        } as never,
        {} as never,
        undefined,
        subscriptionWithInconsistentPeriod as never,
      ),
    ).resolves.toEqual({
      activatedMemberId: "member_123",
      hostedExecutionEventId: "wake_123",
      welcomeEmailMemberId: "member_123",
    });

    const [writeInput] = mocks.writeHostedMemberStripeBillingTx.mock.calls[0] ?? [];
    expect(writeInput).toEqual(expect.objectContaining({
      currentBillingPhase: "trial",
      currentCheckoutOffer: "pulse_trial_7d",
      currentPeriodEnd: null,
      currentPeriodStart: null,
      currentTrialEndsAt: new Date("2025-04-19T00:00:00.000Z"),
      currentTrialStartedAt: new Date("2025-04-12T00:00:00.000Z"),
      stripeSubscriptionId: "sub_123",
    }));
    expect(mocks.activateHostedMemberForPositiveSourceTx).toHaveBeenCalledWith({
      dispatchContext: expect.objectContaining({
        sourceEventId: "checkout.session:cs_trial_123",
      }),
      memberId: "member_123",
      prisma: {},
      skipIfBillingAlreadyActive: false,
    });
  });

  it.each([
    [
      "wrong trial policy",
      {
        metadata: {
          billingPlanCode: "launch_monthly",
          checkoutOffer: "pulse_trial_7d",
          memberId: "member_123",
          trialDurationDays: "10",
          trialPolicyVersion: "old-policy",
          trialUsageLimitUsdMicros: "4500000",
        },
      },
    ],
    [
      "wrong member metadata",
      {
        client_reference_id: "member_123",
        metadata: {
          billingPlanCode: "launch_monthly",
          checkoutOffer: "pulse_trial_7d",
          memberId: "member_456",
          trialDurationDays: "10",
          trialPolicyVersion: "pulse-trial-2026-06-30-v2",
          trialUsageLimitUsdMicros: "4500000",
        },
      },
    ],
    [
      "expired trial subscription",
      {
        subscription: {
          ...makePulseTrialSubscription(),
          trial_end: 1_744_415_999,
        },
      },
    ],
    [
      "customer mismatch",
      {
        subscription: {
          ...makePulseTrialSubscription(),
          customer: "cus_other",
        },
      },
    ],
    [
      "missing session customer",
      {
        customer: null,
      },
    ],
    [
      "missing subscription customer",
      {
        subscription: {
          ...makePulseTrialSubscription(),
          customer: null,
        },
      },
    ],
  ])("does not activate Pulse Trial checkout for %s", async (_name, overrides) => {
    await expect(
      applyStripeCheckoutCompleted(
        {
          ...makePulseTrialCheckoutSession(),
          ...overrides,
        } as never,
        {} as never,
      ),
    ).resolves.toEqual({
      activatedMemberId: null,
      hostedExecutionEventId: null,
      welcomeEmailMemberId: null,
    });

    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
    expect(mocks.activateHostedMemberForPositiveSourceTx).not.toHaveBeenCalled();
  });

  it("does not activate Pulse Trial checkout when Stripe ownership resolves ambiguously", async () => {
    mocks.listHostedStripeCheckoutSessionMemberIds.mockResolvedValueOnce([
      "member_123",
      "member_456",
    ]);

    await expect(
      applyStripeCheckoutCompleted(
        makePulseTrialCheckoutSession() as never,
        {} as never,
      ),
    ).resolves.toEqual({
      activatedMemberId: null,
      hostedExecutionEventId: null,
      welcomeEmailMemberId: null,
    });

    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
    expect(mocks.activateHostedMemberForPositiveSourceTx).not.toHaveBeenCalled();
  });

  it("does not activate Pulse Trial checkout after a trial has already been redeemed", async () => {
    mocks.findMemberForStripeCheckoutSession.mockResolvedValueOnce(makeMemberSnapshot({
      billingRef: {
        memberId: "member_123",
        pulseTrialRedeemedAt: new Date("2025-04-12T00:00:00.000Z"),
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
      },
    }));

    await expect(
      applyStripeCheckoutCompleted(
        makePulseTrialCheckoutSession() as never,
        {} as never,
      ),
    ).resolves.toEqual({
      activatedMemberId: null,
      hostedExecutionEventId: null,
      welcomeEmailMemberId: "member_123",
    });

    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
    expect(mocks.activateHostedMemberForPositiveSourceTx).not.toHaveBeenCalled();
  });

  it("does not let a stale trial checkout overwrite an already paid billing phase", async () => {
    mocks.findMemberForStripeCheckoutSession.mockResolvedValueOnce(makeMemberSnapshot({
      billingRef: {
        currentBillingPhase: "paid",
        currentBillingPlanCode: "launch_monthly",
        currentCheckoutOffer: "standard",
        memberId: "member_123",
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_paid_123",
      },
    }));
    mocks.writeHostedMemberStripeBillingTx.mockResolvedValueOnce(null);

    await expect(
      applyStripeCheckoutCompleted(
        makePulseTrialCheckoutSession() as never,
        {} as never,
      ),
    ).resolves.toEqual({
      activatedMemberId: null,
      hostedExecutionEventId: null,
      welcomeEmailMemberId: null,
    });

    expect(mocks.activateHostedMemberForPositiveSourceTx).not.toHaveBeenCalled();
  });
});

function makePulseTrialCheckoutSession(): Record<string, unknown> {
  return {
    client_reference_id: "member_123",
    created: 1_744_416_000,
    customer: "cus_123",
    customer_details: {
      email: " payer@example.com ",
    },
    id: "cs_trial_123",
    metadata: {
      billingPlanCode: "launch_monthly",
      checkoutOffer: "pulse_trial_7d",
      memberId: "member_123",
      trialDurationDays: "10",
      trialPolicyVersion: "pulse-trial-2026-06-30-v2",
      trialUsageLimitUsdMicros: "4500000",
    },
    mode: "subscription",
    status: "complete",
    subscription: {
      id: "sub_123",
      customer: "cus_123",
      current_period_end: 1_745_020_800,
      current_period_start: 1_744_416_000,
      status: "trialing",
      trial_end: 1_745_020_800,
      trial_start: 1_744_416_000,
    },
  };
}

function makePulseTrialSubscription(): Record<string, unknown> {
  return {
    id: "sub_123",
    customer: "cus_123",
    current_period_end: 1_745_020_800,
    current_period_start: 1_744_416_000,
    status: "trialing",
    trial_end: 1_745_020_800,
    trial_start: 1_744_416_000,
  };
}

function makeMemberSnapshot(overrides?: {
  billingRef?: HostedMemberBillingSnapshot["billingRef"];
}): HostedMemberBillingSnapshot {
  return {
    billingRef: overrides?.billingRef ?? {
      memberId: "member_123",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
    },
    core: {
      billingStatus: HostedBillingStatus.not_started,
      createdAt: new Date("2025-04-12T00:00:00.000Z"),
      id: "member_123",
      suspendedAt: null,
      updatedAt: new Date("2025-04-12T00:00:00.000Z"),
    },
  };
}
