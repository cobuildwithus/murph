import { HostedBillingStatus } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HostedMemberBillingSnapshot } from "@/src/lib/hosted-onboarding/hosted-member-store";

const mocks = vi.hoisted(() => ({
  activateHostedMemberForPositiveSourceTx: vi.fn(),
  findMemberForStripeCheckoutSession: vi.fn(),
  findMemberForStripeSubscription: vi.fn(),
  listHostedStripeCheckoutSessionMemberIds: vi.fn(),
  lockHostedMemberRow: vi.fn(),
  readActiveHostedFamilySponsorship: vi.fn(),
  readHostedMemberBillingSnapshot: vi.fn(),
  requireHostedStripeApi: vi.fn(),
  cancelStripeSubscription: vi.fn(),
  retrieveStripeSubscription: vi.fn(),
  upsertHostedMemberStripeCheckoutEmailIfFreshTx: vi.fn(),
  writeHostedMemberStripeBillingRef: vi.fn(),
  writeHostedMemberStripeBillingTx: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/member-access", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/member-access")
  >("@/src/lib/hosted-onboarding/member-access");

  return {
    ...actual,
    readActiveHostedFamilySponsorship: mocks.readActiveHostedFamilySponsorship,
  };
});

vi.mock("@/src/lib/hosted-onboarding/member-activation", () => ({
  activateHostedMemberForPositiveSourceTx: mocks.activateHostedMemberForPositiveSourceTx,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-billing-store", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/hosted-member-billing-store")
  >("@/src/lib/hosted-onboarding/hosted-member-billing-store");

  return {
    ...actual,
    writeHostedMemberStripeBillingRefTx: mocks.writeHostedMemberStripeBillingRef,
  };
});

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
    findMemberForStripeSubscription: mocks.findMemberForStripeSubscription,
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
  requireHostedStripeBillingPlanConfig: () => ({
    billingPlanCode: "launch_monthly",
    priceId: "price_pulse_monthly_123",
    stripe: mocks.requireHostedStripeApi(),
  }),
  requireHostedStripeApi: mocks.requireHostedStripeApi,
}));

import {
  applyStripeCheckoutCompleted,
  applyStripeSubscriptionUpdated,
  cancelHostedFamilySponsoredCheckoutSubscription,
  cancelHostedPulseTrialCheckoutLoserSubscription,
} from "@/src/lib/hosted-onboarding/stripe-billing-events";

describe("applyStripeCheckoutCompleted", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.retrieveStripeSubscription.mockReset();
    vi.setSystemTime(new Date("2025-04-12T00:00:00.000Z"));
    vi.stubEnv(
      "HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_MONTHLY",
      "price_pulse_monthly_123",
    );
    mocks.lockHostedMemberRow.mockResolvedValue(undefined);
    mocks.findMemberForStripeCheckoutSession.mockResolvedValue(makeMemberSnapshot());
    mocks.findMemberForStripeSubscription.mockResolvedValue(null);
    mocks.listHostedStripeCheckoutSessionMemberIds.mockResolvedValue(["member_123"]);
    mocks.readHostedMemberBillingSnapshot.mockResolvedValue(makeMemberSnapshot());
    mocks.readActiveHostedFamilySponsorship.mockResolvedValue(false);
    mocks.requireHostedStripeApi.mockReturnValue({
      subscriptions: {
        cancel: mocks.cancelStripeSubscription,
        retrieve: mocks.retrieveStripeSubscription,
      },
    });
    mocks.cancelStripeSubscription.mockResolvedValue({
      id: "sub_delayed_checkout",
      status: "canceled",
    });
    mocks.retrieveStripeSubscription.mockImplementation(async (subscriptionId: string) => ({
      ...makePulseTrialSubscription(),
      id: subscriptionId,
    }));
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

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
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

  it("cancels rather than binds a direct checkout completed after Family sponsorship", async () => {
    mocks.readActiveHostedFamilySponsorship.mockResolvedValueOnce(true);

    await expect(applyStripeCheckoutCompleted({
      created: 1_744_416_000,
      customer: "cus_123",
      id: "cs_123",
      metadata: {
        billingPlanCode: "launch_monthly",
        checkoutOffer: "standard",
        memberId: "member_123",
      },
      subscription: "sub_superseded",
    } as never, {} as never)).resolves.toMatchObject({
      cleanupFamilySponsoredStripeSubscriptionId: "sub_superseded",
      welcomeEmailMemberId: null,
    });

    expect(mocks.writeHostedMemberStripeBillingRef).not.toHaveBeenCalled();
    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
  });

  it("cancels a direct subscription event received after Family sponsorship", async () => {
    mocks.readActiveHostedFamilySponsorship.mockResolvedValueOnce(true);
    const subscription = {
      ...makePulseTrialSubscription(),
      id: "sub_superseded",
      metadata: {
        billingPlanCode: "launch_monthly",
        checkoutOffer: "standard",
        memberId: "member_123",
      },
      status: "active",
    };

    await expect(applyStripeSubscriptionUpdated(
      subscription as never,
      {
        eventCreatedAt: new Date("2025-04-12T00:00:01.000Z"),
        occurredAt: "2025-04-12T00:00:01.000Z",
        sourceEventId: "evt_subscription_created_123",
        sourceType: "stripe.customer.subscription.created",
      },
      {} as never,
    )).resolves.toMatchObject({
      cleanupFamilySponsoredStripeSubscriptionId: "sub_superseded",
      subscriptionCancellationEmail: null,
    });

    expect(mocks.findMemberForStripeSubscription).not.toHaveBeenCalled();
    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
  });

  it("treats an already-absent sponsored checkout subscription as cleaned up", async () => {
    mocks.cancelStripeSubscription.mockRejectedValueOnce({ code: "resource_missing" });

    await expect(cancelHostedFamilySponsoredCheckoutSubscription({
      stripe: {
        subscriptions: {
          cancel: mocks.cancelStripeSubscription,
        },
      } as never,
      subscriptionId: "sub_superseded",
    })).resolves.toBeUndefined();
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
      preparedCryptoDomainRoots: new Map(),
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

  it("retrieves current Pulse Trial authority before checkout activation", async () => {
    mocks.retrieveStripeSubscription.mockResolvedValueOnce(makePulseTrialSubscription());
    await expect(
      applyStripeCheckoutCompleted(
        {
          ...makePulseTrialCheckoutSession(),
          subscription: "sub_123",
        } as never,
        {} as never,
      ),
    ).resolves.toEqual({
      activatedMemberId: "member_123",
      hostedExecutionEventId: "wake_123",
      welcomeEmailMemberId: "member_123",
    });

    expect(mocks.retrieveStripeSubscription).toHaveBeenCalledWith("sub_123");
    expect(mocks.writeHostedMemberStripeBillingTx).toHaveBeenCalledWith(expect.objectContaining({
      currentBillingPhase: "trial",
      stripeSubscriptionId: "sub_123",
    }));
  });

  it.each([
    ["canceled", { status: "canceled" }],
    ["paused", { status: "paused" }],
    ["expired", { trial_end: 1_744_415_999 }],
  ])("rejects current %s authority even when Checkout embeds a stale trialing subscription", async (
    _label,
    currentOverrides,
  ) => {
    mocks.retrieveStripeSubscription.mockResolvedValueOnce({
      ...makePulseTrialSubscription(),
      ...currentOverrides,
    });

    await expect(applyStripeCheckoutCompleted(
      makePulseTrialCheckoutSession() as never,
      {} as never,
    )).resolves.toEqual({
      activatedMemberId: null,
      hostedExecutionEventId: null,
      welcomeEmailMemberId: null,
    });

    expect(mocks.retrieveStripeSubscription).toHaveBeenCalledWith("sub_123");
    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
    expect(mocks.activateHostedMemberForPositiveSourceTx).not.toHaveBeenCalled();
  });

  it("rejects a trial that expires while Checkout waits for locked authority", async () => {
    mocks.retrieveStripeSubscription.mockImplementationOnce(async () => {
      vi.setSystemTime(new Date("2025-04-20T00:00:00.000Z"));
      return makePulseTrialSubscription();
    });

    await expect(applyStripeCheckoutCompleted(
      makePulseTrialCheckoutSession() as never,
      {} as never,
    )).resolves.toEqual({
      activatedMemberId: null,
      hostedExecutionEventId: null,
      welcomeEmailMemberId: null,
    });

    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
    expect(mocks.activateHostedMemberForPositiveSourceTx).not.toHaveBeenCalled();
  });

  it("activates Pulse Trial checkout when Stripe omits subscription current-period fields", async () => {
    const subscriptionWithoutPeriod = makePulseTrialSubscription();
    delete subscriptionWithoutPeriod.current_period_end;
    delete subscriptionWithoutPeriod.current_period_start;
    mocks.retrieveStripeSubscription.mockResolvedValueOnce(subscriptionWithoutPeriod);

    await expect(
      applyStripeCheckoutCompleted(
        {
          ...makePulseTrialCheckoutSession(),
          subscription: "sub_123",
        } as never,
        {} as never,
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
      preparedCryptoDomainRoots: new Map(),
      prisma: {},
      skipIfBillingAlreadyActive: false,
    });
  });

  it("activates Pulse Trial checkout when Stripe current-period metadata is inconsistent", async () => {
    const subscriptionWithInconsistentPeriod = makePulseTrialSubscription();
    subscriptionWithInconsistentPeriod.current_period_start = 1_744_502_400;
    subscriptionWithInconsistentPeriod.current_period_end = 1_745_020_800;
    mocks.retrieveStripeSubscription.mockResolvedValueOnce(
      subscriptionWithInconsistentPeriod,
    );

    await expect(
      applyStripeCheckoutCompleted(
        {
          ...makePulseTrialCheckoutSession(),
          subscription: "sub_123",
        } as never,
        {} as never,
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
      preparedCryptoDomainRoots: new Map(),
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
    const checkoutSession = {
      ...makePulseTrialCheckoutSession(),
      ...overrides,
    } as never;
    if (typeof Reflect.get(checkoutSession, "subscription") === "object") {
      mocks.retrieveStripeSubscription.mockResolvedValueOnce(
        Reflect.get(checkoutSession, "subscription"),
      );
    }

    await expect(
      applyStripeCheckoutCompleted(
        checkoutSession,
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

  it("returns a valid delayed Pulse Trial checkout subscription for loser cleanup", async () => {
    mocks.findMemberForStripeCheckoutSession.mockResolvedValueOnce(makeMemberSnapshot({
      billingRef: {
        memberId: "member_123",
        pulseTrialRedeemedAt: new Date("2025-04-12T00:00:00.000Z"),
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_auto_trial",
      },
    }));
    const session = {
      ...makePulseTrialCheckoutSession(),
      subscription: "sub_delayed_checkout",
    };
    const subscription = {
      ...makePulseTrialSubscription(),
      id: "sub_delayed_checkout",
    };
    mocks.retrieveStripeSubscription.mockResolvedValueOnce(subscription);

    await expect(
      applyStripeCheckoutCompleted(
        session as never,
        {} as never,
      ),
    ).resolves.toEqual({
      activatedMemberId: null,
      cleanupPulseTrialStripeSubscriptionId: "sub_delayed_checkout",
      hostedExecutionEventId: null,
      welcomeEmailMemberId: null,
    });

    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
    expect(mocks.activateHostedMemberForPositiveSourceTx).not.toHaveBeenCalled();
  });

  it("returns an exact Pulse Trial checkout for cleanup when active non-trial access has no subscription", async () => {
    mocks.findMemberForStripeCheckoutSession.mockResolvedValueOnce(makeMemberSnapshot({
      billingRef: {
        currentBillingPhase: null,
        memberId: "member_123",
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: null,
      },
      billingStatus: HostedBillingStatus.active,
    }));
    const session = {
      ...makePulseTrialCheckoutSession(),
      subscription: "sub_delayed_checkout",
    };
    const subscription = {
      ...makePulseTrialSubscription(),
      id: "sub_delayed_checkout",
    };
    mocks.retrieveStripeSubscription.mockResolvedValueOnce(subscription);

    await expect(applyStripeCheckoutCompleted(
      session as never,
      {} as never,
    )).resolves.toMatchObject({
      cleanupPulseTrialStripeSubscriptionId: "sub_delayed_checkout",
    });

    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
  });

  it("allows an incomplete member to replace a stale incomplete subscription with a new Pulse Trial", async () => {
    mocks.findMemberForStripeCheckoutSession.mockResolvedValueOnce(makeMemberSnapshot({
      billingRef: {
        currentBillingPhase: null,
        memberId: "member_123",
        pulseTrialRedeemedAt: null,
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_incomplete_old",
      },
      billingStatus: HostedBillingStatus.incomplete,
    }));
    const session = {
      ...makePulseTrialCheckoutSession(),
      subscription: "sub_trial_replacement",
    };
    const subscription = {
      ...makePulseTrialSubscription(),
      id: "sub_trial_replacement",
    };
    mocks.retrieveStripeSubscription.mockResolvedValueOnce(subscription);

    const outcome = await applyStripeCheckoutCompleted(
      session as never,
      {} as never,
    );

    expect(outcome).not.toHaveProperty("cleanupPulseTrialStripeSubscriptionId");
    expect(mocks.writeHostedMemberStripeBillingTx).toHaveBeenCalledWith(
      expect.objectContaining({
        stripeSubscriptionId: "sub_trial_replacement",
      }),
    );
  });

  it("ignores and returns a subscription-created Pulse Trial loser for cleanup", async () => {
    mocks.findMemberForStripeSubscription.mockResolvedValueOnce(makeMemberSnapshot({
      billingRef: {
        currentBillingPhase: null,
        memberId: "member_123",
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: null,
      },
      billingStatus: HostedBillingStatus.active,
    }));
    const subscription = {
      ...makePulseTrialSubscription(),
    };

    await expect(applyStripeSubscriptionUpdated(
      subscription as never,
      {
        eventCreatedAt: new Date("2025-04-12T00:00:01.000Z"),
        occurredAt: "2025-04-12T00:00:01.000Z",
        sourceEventId: "evt_subscription_created_123",
        sourceType: "stripe.customer.subscription.created",
      },
      {} as never,
    )).resolves.toMatchObject({
      cleanupPulseTrialStripeSubscriptionId: "sub_123",
    });

    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
  });

  it("treats an already-absent delayed Pulse Trial subscription as cleaned up", async () => {
    mocks.readHostedMemberBillingSnapshot.mockResolvedValueOnce(makeMemberSnapshot({
      billingRef: {
        currentBillingPhase: "paid",
        memberId: "member_123",
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_paid_123",
      },
      billingStatus: HostedBillingStatus.active,
    }));
    mocks.cancelStripeSubscription.mockRejectedValueOnce({
      code: "resource_missing",
    });

    await expect(cancelHostedPulseTrialCheckoutLoserSubscription({
      memberId: "member_123",
      prisma: {
        $transaction: async (run: (tx: object) => Promise<unknown>) => run({}),
      } as never,
      subscriptionId: "sub_delayed_checkout",
    })).resolves.toBeUndefined();
  });

  it.each([
    ["the cleanup target is now current", "sub_delayed_checkout"],
    ["there is no durable current subscription", null],
  ])("refuses delayed cleanup when %s", async (_case, stripeSubscriptionId) => {
    mocks.readHostedMemberBillingSnapshot.mockResolvedValueOnce(makeMemberSnapshot({
      billingRef: {
        memberId: "member_123",
        stripeCustomerId: "cus_123",
        stripeSubscriptionId,
      },
    }));

    await expect(cancelHostedPulseTrialCheckoutLoserSubscription({
      memberId: "member_123",
      prisma: {
        $transaction: async (run: (tx: object) => Promise<unknown>) => run({}),
      } as never,
      subscriptionId: "sub_delayed_checkout",
    })).rejects.toMatchObject({
      code: "HOSTED_PULSE_TRIAL_CLEANUP_OWNER_CHANGED",
      retryable: true,
    });

    expect(mocks.cancelStripeSubscription).not.toHaveBeenCalled();
  });

  it("cancels a loser when the locked reread confirms active non-trial access without a subscription", async () => {
    mocks.readHostedMemberBillingSnapshot.mockResolvedValueOnce(makeMemberSnapshot({
      billingRef: {
        currentBillingPhase: null,
        memberId: "member_123",
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: null,
      },
      billingStatus: HostedBillingStatus.active,
    }));

    await expect(cancelHostedPulseTrialCheckoutLoserSubscription({
      memberId: "member_123",
      prisma: {
        $transaction: async (run: (tx: object) => Promise<unknown>) => run({}),
      } as never,
      subscriptionId: "sub_delayed_checkout",
    })).resolves.toBeUndefined();

    expect(mocks.cancelStripeSubscription).toHaveBeenCalledWith("sub_delayed_checkout");
  });

  it.each([
    [
      "the base quantity changes",
      () => {
        const subscription = makePulseTrialSubscription();
        return {
          ...subscription,
          items: {
            data: [{
              ...(subscription.items as { data: Array<Record<string, unknown>> }).data[0],
              quantity: 2,
            }],
            has_more: false,
          },
        };
      },
    ],
    [
      "the base billing interval changes",
      () => {
        const subscription = makePulseTrialSubscription();
        const baseItem = (subscription.items as {
          data: Array<Record<string, unknown>>;
        }).data[0]!;
        return {
          ...subscription,
          items: {
            data: [{
              ...baseItem,
              price: {
                ...(baseItem.price as Record<string, unknown>),
                recurring: {
                  interval: "month",
                  interval_count: 12,
                  usage_type: "licensed",
                },
              },
            }],
            has_more: false,
          },
        };
      },
    ],
    [
      "an unrelated recurring item is added",
      () => {
        const subscription = makePulseTrialSubscription();
        return {
          ...subscription,
          items: {
            data: [
              ...(subscription.items as { data: Array<Record<string, unknown>> }).data,
              {
                id: "si_unrelated_123",
                price: {
                  id: "price_unrelated_123",
                  recurring: {
                    interval: "month",
                    usage_type: "licensed",
                  },
                },
                quantity: 1,
              },
            ],
            has_more: false,
          },
        };
      },
    ],
    [
      "the provider item list is incomplete",
      () => {
        const subscription = makePulseTrialSubscription();
        return {
          ...subscription,
          items: {
            ...(subscription.items as Record<string, unknown>),
            has_more: true,
          },
        };
      },
    ],
  ])("refuses cleanup when %s before the final provider reread", async (_case, mutate) => {
    mocks.readHostedMemberBillingSnapshot.mockResolvedValueOnce(makeMemberSnapshot({
      billingRef: {
        currentBillingPhase: null,
        memberId: "member_123",
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: null,
      },
      billingStatus: HostedBillingStatus.active,
    }));
    mocks.retrieveStripeSubscription.mockResolvedValueOnce({
      ...mutate(),
      id: "sub_delayed_checkout",
    });

    await expect(cancelHostedPulseTrialCheckoutLoserSubscription({
      memberId: "member_123",
      prisma: {
        $transaction: async (run: (tx: object) => Promise<unknown>) => run({}),
      } as never,
      subscriptionId: "sub_delayed_checkout",
    })).rejects.toMatchObject({
      code: "HOSTED_PULSE_TRIAL_CLEANUP_TARGET_CHANGED",
      retryable: true,
    });

    expect(mocks.cancelStripeSubscription).not.toHaveBeenCalled();
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
      billingStatus: HostedBillingStatus.active,
    }));
    mocks.writeHostedMemberStripeBillingTx.mockResolvedValueOnce(null);
    const session = {
      ...makePulseTrialCheckoutSession(),
      subscription: "sub_delayed_checkout",
    };
    const subscription = {
      ...makePulseTrialSubscription(),
      id: "sub_delayed_checkout",
    };
    mocks.retrieveStripeSubscription.mockResolvedValueOnce(subscription);

    await expect(
      applyStripeCheckoutCompleted(
        session as never,
        {} as never,
      ),
    ).resolves.toEqual({
      activatedMemberId: null,
      cleanupPulseTrialStripeSubscriptionId: "sub_delayed_checkout",
      hostedExecutionEventId: null,
      welcomeEmailMemberId: null,
    });

    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
    expect(mocks.activateHostedMemberForPositiveSourceTx).not.toHaveBeenCalled();
  });
});

function makePulseTrialCheckoutSession(): Record<string, unknown> {
  const metadata = makePulseTrialMetadata();
  return {
    client_reference_id: "member_123",
    created: 1_744_416_000,
    customer: "cus_123",
    customer_details: {
      email: " payer@example.com ",
    },
    id: "cs_trial_123",
    metadata,
    mode: "subscription",
    status: "complete",
    subscription: makePulseTrialSubscription(),
  };
}

function makePulseTrialSubscription(): Record<string, unknown> {
  return {
    id: "sub_123",
    items: {
      data: [{
        id: "si_pulse_123",
        price: {
          id: "price_pulse_monthly_123",
          recurring: {
            interval: "month",
            usage_type: "licensed",
          },
        },
        quantity: 1,
      }],
      has_more: false,
    },
    metadata: makePulseTrialMetadata(),
    customer: "cus_123",
    current_period_end: 1_745_020_800,
    current_period_start: 1_744_416_000,
    status: "trialing",
    trial_end: 1_745_020_800,
    trial_start: 1_744_416_000,
  };
}

function makePulseTrialMetadata(): Record<string, string> {
  return {
    billingPlanCode: "launch_monthly",
    checkoutOffer: "pulse_trial_7d",
    memberId: "member_123",
    trialDurationDays: "10",
    trialPolicyVersion: "pulse-trial-2026-06-30-v2",
    trialUsageLimitUsdMicros: "4500000",
  };
}

function makeMemberSnapshot(overrides?: {
  billingRef?: HostedMemberBillingSnapshot["billingRef"];
  billingStatus?: HostedBillingStatus;
}): HostedMemberBillingSnapshot {
  return {
    billingRef: overrides?.billingRef ?? {
      memberId: "member_123",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
    },
    core: {
      billingStatus: overrides?.billingStatus ?? HostedBillingStatus.not_started,
      createdAt: new Date("2025-04-12T00:00:00.000Z"),
      id: "member_123",
      suspendedAt: null,
      updatedAt: new Date("2025-04-12T00:00:00.000Z"),
    },
  };
}
