import { HostedBillingStatus } from "@prisma/client";
import type Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HostedMemberBillingSnapshot } from "@/src/lib/hosted-onboarding/hosted-member-store";

const mocks = vi.hoisted(() => ({
  acceptHostedMemberStripeCheckoutCompletionTx: vi.fn(),
  activateHostedMemberForPositiveSourceTx: vi.fn(),
  clearHostedMemberLegacyTrialBillingUnderLockTx: vi.fn(),
  clearHostedMemberStripeCheckoutAttemptForSessionTx: vi.fn(),
  cleanupHostedStandardCheckoutLoser: vi.fn(),
  ensureHostedStarterUsageGrantTx: vi.fn(),
  findMemberForStripeCheckoutSession: vi.fn(),
  findMemberForStripeInvoice: vi.fn(),
  findMemberForStripeSubscription: vi.fn(),
  listHostedStripeCheckoutSessionMemberIds: vi.fn(),
  lockHostedMemberRow: vi.fn(),
  lookupHostedAccountGroupIdByStripeSubscriptionId: vi.fn(),
  readHostedAccountGroupStripeBillingRef: vi.fn(),
  readHostedMemberFamilyBillingClaim: vi.fn(),
  readHostedMemberBillingSnapshot: vi.fn(),
  readHostedMemberCoreState: vi.fn(),
  readHostedMemberPulseTrialBillingDecisionSnapshot: vi.fn(),
  readHostedLegacyTrialConsumedUsageUsdMicrosTx: vi.fn(),
  readHostedMemberStripeBillingLookupState: vi.fn(),
  readHostedMemberStripeBillingRef: vi.fn(),
  requireHostedStripeApi: vi.fn(),
  cancelStripeSubscription: vi.fn(),
  retrieveStripeSubscription: vi.fn(),
  terminalizeHostedFamilySponsoredDirectBillingTx: vi.fn(),
  upsertPreparedHostedMemberStripeCheckoutEmailIfFreshUnderLockTx: vi.fn(),
  upsertHostedMemberStripeCheckoutEmailIfFreshTx: vi.fn(),
  updateHostedMemberCoreState: vi.fn(),
  writeHostedMemberStripeBillingRef: vi.fn(),
  writeHostedMemberStripeBillingTx: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/family-plan", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/family-plan")
  >("@/src/lib/hosted-onboarding/family-plan");

  return {
    ...actual,
    lookupHostedAccountGroupIdByStripeSubscriptionId:
      mocks.lookupHostedAccountGroupIdByStripeSubscriptionId,
    readHostedAccountGroupStripeBillingRef:
      mocks.readHostedAccountGroupStripeBillingRef,
    readHostedMemberFamilyBillingClaim:
      mocks.readHostedMemberFamilyBillingClaim,
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
    acceptHostedMemberStripeCheckoutCompletionTx:
      mocks.acceptHostedMemberStripeCheckoutCompletionTx,
    clearHostedMemberLegacyTrialBillingUnderLockTx:
      mocks.clearHostedMemberLegacyTrialBillingUnderLockTx,
    clearHostedMemberStripeCheckoutAttemptForSessionTx:
      mocks.clearHostedMemberStripeCheckoutAttemptForSessionTx,
    readHostedMemberStripeBillingLookupState:
      mocks.readHostedMemberStripeBillingLookupState,
    readHostedMemberStripeBillingRef:
      mocks.readHostedMemberStripeBillingRef,
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
    readHostedMemberCoreState: mocks.readHostedMemberCoreState,
    readHostedMemberPulseTrialBillingDecisionSnapshot:
      mocks.readHostedMemberPulseTrialBillingDecisionSnapshot,
    updateHostedMemberCoreState: mocks.updateHostedMemberCoreState,
    upsertPreparedHostedMemberStripeCheckoutEmailIfFreshUnderLockTx:
      mocks.upsertPreparedHostedMemberStripeCheckoutEmailIfFreshUnderLockTx,
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
    findMemberForStripeInvoice: mocks.findMemberForStripeInvoice,
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
    terminalizeHostedFamilySponsoredDirectBillingTx:
      mocks.terminalizeHostedFamilySponsoredDirectBillingTx,
    writeHostedMemberStripeBillingTx: mocks.writeHostedMemberStripeBillingTx,
  };
});

vi.mock("@/src/lib/hosted-onboarding/starter-usage-grant", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/starter-usage-grant")
  >("@/src/lib/hosted-onboarding/starter-usage-grant");

  return {
    ...actual,
    ensureHostedStarterUsageGrantTx:
      mocks.ensureHostedStarterUsageGrantTx,
    readHostedLegacyTrialConsumedUsageUsdMicrosTx:
      mocks.readHostedLegacyTrialConsumedUsageUsdMicrosTx,
  };
});

vi.mock("@/src/lib/hosted-onboarding/stripe-checkout-loser-cleanup", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/stripe-checkout-loser-cleanup")
  >("@/src/lib/hosted-onboarding/stripe-checkout-loser-cleanup");

  return {
    ...actual,
    cleanupHostedStandardCheckoutLoser:
      mocks.cleanupHostedStandardCheckoutLoser,
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
  applyStripeCheckoutCompleted as applyStripeCheckoutCompletedImpl,
  applyStripeInvoicePaid,
  applyStripeSubscriptionUpdated,
  cleanupHostedFamilySponsoredDirectSubscription,
  cancelHostedPulseTrialCheckoutLoserSubscription,
  HostedStripeFamilySponsoredCleanupPendingError,
} from "@/src/lib/hosted-onboarding/stripe-billing-events";
import {
  createHostedStripeCustomerLookupKey,
  createHostedStripeSubscriptionLookupKey,
} from "@/src/lib/hosted-onboarding/contact-privacy";

async function applyStripeCheckoutCompleted(
  ...args: Parameters<typeof applyStripeCheckoutCompletedImpl>
): ReturnType<typeof applyStripeCheckoutCompletedImpl> {
  const session = args[0];
  const stripeCustomerId =
    typeof session.customer === "string" ? session.customer : session.customer?.id;
  const stripeSubscriptionId =
    typeof session.subscription === "string"
      ? session.subscription
      : session.subscription?.id;
  const isDirectCheckout =
    session.metadata?.kind !== "hosted_family_plan";
  const isPulseTrialCheckout =
    session.metadata?.checkoutOffer === "pulse_trial_7d";
  const stripeCheckoutEmail = (
    session.customer_details?.email ?? session.customer_email
  )?.trim().toLowerCase() ?? null;
  const canonicalSubscription =
    isDirectCheckout && stripeSubscriptionId
      ? (
          !isPulseTrialCheckout
          && typeof session.subscription === "object"
            ? session.subscription
            : await mocks.retrieveStripeSubscription(stripeSubscriptionId)
        )
      : null;
  const preparedCheckoutCompletion =
    args[4]
    ?? (
      isDirectCheckout
        ? {
            billingCompletion:
              stripeCustomerId && stripeSubscriptionId
                ? {
                    memberId: "member_123",
                    stripeCustomerId,
                    stripeCustomerIdEncrypted: "encrypted-customer",
                    stripeCustomerLookupKey: "customer-lookup",
                    stripeSubscriptionId,
                    stripeSubscriptionIdEncrypted: "encrypted-subscription",
                    stripeSubscriptionLookupKey: "subscription-lookup",
                  }
                : null,
            canonicalSubscription,
            memberId: "member_123",
            stripeCheckoutEmail: stripeCheckoutEmail
              ? {
                  address: stripeCheckoutEmail,
                  addressEncrypted: "encrypted-checkout-email",
                  memberId: "member_123",
                }
              : null,
          }
        : undefined
    );
  return applyStripeCheckoutCompletedImpl(
    session,
    args[1],
    args[2],
    args[3],
    preparedCheckoutCompletion,
  );
}

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
    mocks.findMemberForStripeInvoice.mockResolvedValue(makeMemberSnapshot());
    mocks.findMemberForStripeSubscription.mockResolvedValue(null);
    mocks.listHostedStripeCheckoutSessionMemberIds.mockResolvedValue(["member_123"]);
    mocks.lookupHostedAccountGroupIdByStripeSubscriptionId.mockResolvedValue(
      null,
    );
    mocks.readHostedMemberBillingSnapshot.mockResolvedValue(makeMemberSnapshot());
    mocks.readHostedMemberCoreState.mockResolvedValue(
      makeMemberSnapshot().core,
    );
    mocks.readHostedMemberPulseTrialBillingDecisionSnapshot.mockResolvedValue(
      makePulseTrialDecisionSnapshot(),
    );
    mocks.readHostedLegacyTrialConsumedUsageUsdMicrosTx.mockResolvedValue(0n);
    mocks.readHostedMemberFamilyBillingClaim.mockResolvedValue(null);
    mocks.readHostedAccountGroupStripeBillingRef.mockResolvedValue({
      currentBillingPhase: "paid",
      currentBillingPlanCode: "launch_family_monthly",
      stripeCustomerId: "cus_family",
      stripeSubscriptionId: "sub_family",
    });
    mocks.readHostedMemberStripeBillingRef.mockResolvedValue({
      memberId: "member_123",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_superseded",
    });
    mocks.readHostedMemberStripeBillingLookupState.mockResolvedValue({
      stripeCustomerLookupKey:
        createHostedStripeCustomerLookupKey("cus_123"),
      stripeSubscriptionLookupKey:
        createHostedStripeSubscriptionLookupKey("sub_123"),
    });
    mocks.acceptHostedMemberStripeCheckoutCompletionTx.mockResolvedValue({
      billingRef: {},
      kind: "accepted",
    });
    mocks.clearHostedMemberStripeCheckoutAttemptForSessionTx.mockResolvedValue(
      true,
    );
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
    mocks.cleanupHostedStandardCheckoutLoser.mockResolvedValue(undefined);
    mocks.retrieveStripeSubscription.mockImplementation(
      async (subscriptionId: string) =>
        subscriptionId === "sub_family"
          ? makeActiveFamilySubscription()
          : {
              ...makePulseTrialSubscription(),
              id: subscriptionId,
            },
    );
    mocks.writeHostedMemberStripeBillingRef.mockResolvedValue({
      lastStripeEventCreatedAt: new Date("2025-04-12T00:00:00.000Z"),
      memberId: "member_123",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
    });
    mocks.upsertPreparedHostedMemberStripeCheckoutEmailIfFreshUnderLockTx
      .mockResolvedValue(undefined);
    mocks.upsertHostedMemberStripeCheckoutEmailIfFreshTx.mockResolvedValue({
      directPublicSender: null,
      memberId: "member_123",
      stripeCheckoutEmail: {
        address: "payer@example.com",
        collectedAt: new Date(1_744_416_000 * 1000),
      },
      verifiedEmail: null,
    });
    mocks.updateHostedMemberCoreState.mockResolvedValue(
      makeMemberSnapshot({
        billingStatus: HostedBillingStatus.active,
      }).core,
    );
    mocks.clearHostedMemberLegacyTrialBillingUnderLockTx.mockResolvedValue(
      undefined,
    );
    mocks.ensureHostedStarterUsageGrantTx.mockResolvedValue({
      balanceUsdMicros: 4_500_000n,
      effectiveAt: new Date("2025-04-12T00:00:00.000Z"),
      entryId: "huce_starter",
      granted: true,
      ledgerVersion: 1n,
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

    expect(mocks.acceptHostedMemberStripeCheckoutCompletionTx).toHaveBeenCalledWith(expect.objectContaining({
      checkoutAttemptId: null,
      checkoutIntentHash: null,
      checkoutSessionId: "cs_123",
      currentCheckoutOffer: "standard",
      memberId: "member_123",
      eventCreatedAt: new Date(1_744_416_000 * 1000),
      preparedCompletion: expect.objectContaining({
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
      }),
      tx: {},
    }));
    expect(
      mocks.upsertPreparedHostedMemberStripeCheckoutEmailIfFreshUnderLockTx,
    ).toHaveBeenCalledWith({
      collectedAt: new Date(1_744_416_000 * 1000),
      memberId: "member_123",
      preparedEmail: {
        address: "payer@example.com",
        addressEncrypted: "encrypted-checkout-email",
        memberId: "member_123",
      },
      tx: {},
    });
    expect(
      mocks.upsertHostedMemberStripeCheckoutEmailIfFreshTx,
    ).not.toHaveBeenCalled();
  });

  it("cancels rather than binds a direct checkout completed after Family sponsorship", async () => {
    mocks.readHostedMemberFamilyBillingClaim.mockResolvedValueOnce({
      groupId: "hbag_family",
      kind: "active_sponsorship",
      ownerMemberId: "member_owner",
    });

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
      cleanupFamilySponsoredCheckout: {
        checkoutSessionId: "cs_123",
        subscriptionId: "sub_superseded",
      },
      welcomeEmailMemberId: null,
    });

    expect(
      mocks.acceptHostedMemberStripeCheckoutCompletionTx,
    ).not.toHaveBeenCalled();
    expect(
      mocks.clearHostedMemberStripeCheckoutAttemptForSessionTx,
    ).not.toHaveBeenCalled();
    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
  });

  it("preserves the Checkout attempt so replay can bind it after sponsorship ends", async () => {
    mocks.readHostedMemberFamilyBillingClaim
      .mockResolvedValueOnce({
        groupId: "hbag_family",
        kind: "active_sponsorship",
        ownerMemberId: "member_owner",
      })
      .mockResolvedValueOnce(null);
    const session = {
      created: 1_744_416_000,
      customer: "cus_123",
      id: "cs_replay_123",
      metadata: {
        billingPlanCode: "launch_monthly",
        checkoutAttemptId: "hbca_123",
        checkoutIntentHash: "intent_123",
        checkoutOffer: "standard",
        memberId: "member_123",
      },
      subscription: "sub_replay_123",
    } as never;

    await expect(applyStripeCheckoutCompleted(
      session,
      {} as never,
    )).resolves.toMatchObject({
      cleanupFamilySponsoredCheckout: {
        checkoutSessionId: "cs_replay_123",
        subscriptionId: "sub_replay_123",
      },
    });
    expect(mocks.clearHostedMemberStripeCheckoutAttemptForSessionTx)
      .not.toHaveBeenCalled();

    await expect(applyStripeCheckoutCompleted(
      session,
      {} as never,
    )).resolves.toMatchObject({
      welcomeEmailMemberId: "member_123",
    });
    expect(mocks.acceptHostedMemberStripeCheckoutCompletionTx)
      .toHaveBeenCalledWith(expect.objectContaining({
        checkoutAttemptId: "hbca_123",
        checkoutIntentHash: "intent_123",
        checkoutSessionId: "cs_replay_123",
        preparedCompletion: expect.objectContaining({
          stripeSubscriptionId: "sub_replay_123",
        }),
      }));
  });

  it("cancels a direct subscription event received after Family sponsorship", async () => {
    mocks.findMemberForStripeSubscription.mockResolvedValueOnce(
      makeMemberSnapshot(),
    );
    mocks.readHostedMemberFamilyBillingClaim.mockResolvedValueOnce({
      groupId: "hbag_family",
      kind: "active_sponsorship",
      ownerMemberId: "member_owner",
    });
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

    expect(mocks.findMemberForStripeSubscription).toHaveBeenCalledWith({
      prisma: {},
      subscription,
    });
    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
  });

  it("preserves the accepted direct subscription across a later Family claim", async () => {
    mocks.findMemberForStripeSubscription.mockResolvedValueOnce(
      makeMemberSnapshot(),
    );
    const subscription = {
      ...makePulseTrialSubscription(),
      id: "sub_123",
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
        sourceEventId: "evt_subscription_updated_123",
        sourceType: "stripe.customer.subscription.updated",
      },
      {} as never,
    )).resolves.toMatchObject({
      subscriptionCancellationEmail: null,
    });

    expect(mocks.readHostedMemberFamilyBillingClaim).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: {},
    });
    expect(mocks.writeHostedMemberStripeBillingTx).toHaveBeenCalledOnce();
  });

  it("preserves a direct subscription handed to Family across browser and webhook replay", async () => {
    const clearedDirectProjection = {
      ...makeMemberSnapshot(),
      billingRef: null,
    };
    mocks.findMemberForStripeCheckoutSession.mockResolvedValue(
      clearedDirectProjection,
    );
    mocks.readHostedMemberBillingSnapshot.mockResolvedValue(
      clearedDirectProjection,
    );
    mocks.readHostedMemberFamilyBillingClaim.mockResolvedValue({
      groupId: "hbag_family",
      kind: "active_sponsorship",
      ownerMemberId: "member_123",
    });
    mocks.lookupHostedAccountGroupIdByStripeSubscriptionId.mockResolvedValue(
      "hbag_family",
    );
    mocks.readHostedMemberStripeBillingLookupState.mockResolvedValue(null);
    const session = {
      created: 1_744_416_000,
      customer: "cus_123",
      id: "cs_accepted_before_family",
      metadata: {
        billingPlanCode: "launch_monthly",
        checkoutOffer: "standard",
        memberId: "member_123",
      },
      subscription: "sub_123",
    };

    for (const sourceEventId of [
      "checkout-success:cs_accepted_before_family",
      "evt_checkout_redelivery",
    ]) {
      await expect(applyStripeCheckoutCompleted(
        session as never,
        {} as never,
        {
          eventCreatedAt: new Date("2025-04-12T00:00:00.000Z"),
          occurredAt: "2025-04-12T00:00:00.000Z",
          sourceEventId,
          sourceType: "stripe.checkout.session.completed",
        },
      )).resolves.toEqual({
        activatedMemberId: null,
        activatedMembers: [],
        hostedExecutionEventId: null,
        runtimeRecheckMemberIds: [],
        welcomeEmailMemberId: null,
      });
    }

    expect(mocks.clearHostedMemberStripeCheckoutAttemptForSessionTx)
      .toHaveBeenCalledTimes(2);
    expect(mocks.acceptHostedMemberStripeCheckoutCompletionTx).not.toHaveBeenCalled();
    expect(mocks.cancelStripeSubscription).not.toHaveBeenCalled();
    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
  });

  it.each(["canceled", "incomplete_expired"] as const)(
    "preserves a terminal Family handoff after %s across browser and webhook replay",
    async (terminalStatus) => {
      const clearedDirectProjection = makeMemberSnapshot({
        billingRef: {
          checkoutAttemptId: null,
          checkoutCreatedAt: null,
          checkoutIntentHash: null,
          currentCheckoutOffer: null,
          lastStripeEventCreatedAt: new Date("2025-04-12T00:30:00.000Z"),
          memberId: "member_123",
          stripeCheckoutSessionId: null,
          stripeCustomerId: null,
          stripeSubscriptionId: null,
        },
      });
      const canonicalFamilySubscription = {
        customer: "cus_123",
        id: "sub_123",
        metadata: {
          accountGroupId: "hbag_family",
          billingPlanCode: "launch_family_monthly",
          kind: "hosted_family_plan",
          ownerMemberId: "member_123",
        },
        status: terminalStatus,
      };
      const tx = {
        hostedAccountGroup: {
          findUnique: vi.fn().mockResolvedValue({ ownerMemberId: "member_123" }),
        },
      };
      mocks.findMemberForStripeCheckoutSession.mockResolvedValue(
        clearedDirectProjection,
      );
      mocks.readHostedMemberBillingSnapshot.mockResolvedValue(
        clearedDirectProjection,
      );
      mocks.readHostedMemberFamilyBillingClaim.mockResolvedValue({
        groupId: "hbag_family",
        kind: "bound_subscription",
        ownerMemberId: "member_123",
      });
      mocks.readHostedMemberStripeBillingLookupState.mockResolvedValue(null);

      for (const source of ["browser", "webhook"] as const) {
        if (source === "webhook") {
          mocks.retrieveStripeSubscription.mockResolvedValueOnce(
            canonicalFamilySubscription,
          );
        }
        const session = {
          created: 1_744_416_000,
          customer: "cus_123",
          id: "cs_accepted_before_family",
          metadata: {
            billingPlanCode: "launch_monthly",
            checkoutAttemptId: "attempt_accepted_before_family",
            checkoutIntentHash: "intent_accepted_before_family",
            checkoutOffer: "standard",
            memberId: "member_123",
          },
          subscription:
            source === "browser" ? canonicalFamilySubscription : "sub_123",
        };

        const outcome = await applyStripeCheckoutCompleted(
          session as never,
          tx as never,
          {
            eventCreatedAt: new Date("2025-04-12T00:00:00.000Z"),
            occurredAt: "2025-04-12T00:00:00.000Z",
            sourceEventId:
              source === "browser"
                ? "checkout-success:cs_accepted_before_family"
                : "evt_checkout_redelivery",
            sourceType: "stripe.checkout.session.completed",
          },
          undefined,
        );
        expect(outcome).toEqual({
          activatedMemberId: null,
          activatedMembers: [],
          hostedExecutionEventId: null,
          runtimeRecheckMemberIds: [],
          welcomeEmailMemberId: null,
        });
        // The reconciliation owner only starts loser cancel/refund cleanup when
        // this identifier is returned.
        expect(outcome).not.toHaveProperty(
          "cleanupStandardCheckout",
        );
      }

      expect(tx.hostedAccountGroup.findUnique).toHaveBeenCalledTimes(2);
      expect(mocks.retrieveStripeSubscription).toHaveBeenCalledOnce();
      expect(mocks.retrieveStripeSubscription).toHaveBeenCalledWith("sub_123");
      expect(mocks.readHostedMemberFamilyBillingClaim).not.toHaveBeenCalled();
      expect(mocks.clearHostedMemberStripeCheckoutAttemptForSessionTx)
        .toHaveBeenCalledTimes(2);
      expect(mocks.acceptHostedMemberStripeCheckoutCompletionTx).not.toHaveBeenCalled();
      expect(mocks.cancelStripeSubscription).not.toHaveBeenCalled();
      expect(mocks.writeHostedMemberStripeBillingRef).not.toHaveBeenCalled();
      expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
      expect(mocks.upsertHostedMemberStripeCheckoutEmailIfFreshTx)
        .not.toHaveBeenCalled();
      expect(mocks.activateHostedMemberForPositiveSourceTx).not.toHaveBeenCalled();
    },
  );

  it("keeps a different terminal Family replay on the existing loser-cleanup path", async () => {
    const clearedDirectProjection = makeMemberSnapshot({
      billingRef: {
        checkoutAttemptId: "attempt_new_retry",
        currentCheckoutOffer: null,
        lastStripeEventCreatedAt: new Date("2025-04-12T00:30:00.000Z"),
        memberId: "member_123",
        stripeCheckoutSessionId: "cs_new_retry",
        stripeCustomerId: null,
        stripeSubscriptionId: null,
      },
    });
    mocks.findMemberForStripeCheckoutSession.mockResolvedValue(
      clearedDirectProjection,
    );
    mocks.readHostedMemberBillingSnapshot.mockResolvedValue(
      clearedDirectProjection,
    );
    mocks.acceptHostedMemberStripeCheckoutCompletionTx.mockResolvedValueOnce({
      kind: "cleanup_superseded",
    });
    mocks.retrieveStripeSubscription.mockResolvedValueOnce({
      customer: "cus_123",
      id: "sub_different",
      metadata: {
        billingPlanCode: "launch_monthly",
        checkoutOffer: "standard",
        memberId: "member_123",
      },
      status: "active",
    });
    await expect(applyStripeCheckoutCompleted(
      {
        created: 1_744_416_000,
        customer: "cus_123",
        id: "cs_different_after_family",
        metadata: {
          billingPlanCode: "launch_monthly",
          checkoutAttemptId: "attempt_different_after_family",
          checkoutIntentHash: "intent_different_after_family",
          checkoutOffer: "standard",
          memberId: "member_123",
        },
        subscription: "sub_different",
      } as never,
      {} as never,
    )).resolves.toMatchObject({
      cleanupStandardCheckout: {
        checkoutSessionId: "cs_different_after_family",
        subscriptionId: "sub_different",
      },
      welcomeEmailMemberId: null,
    });

    expect(mocks.acceptHostedMemberStripeCheckoutCompletionTx).toHaveBeenCalledOnce();
    expect(mocks.clearHostedMemberStripeCheckoutAttemptForSessionTx).not.toHaveBeenCalled();
    expect(mocks.retrieveStripeSubscription).toHaveBeenCalledWith("sub_different");
    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
  });

  it.each(["canceled", "incomplete_expired"] as const)(
    "keeps an exact %s direct Checkout on loser cleanup until its attempt can be retired",
    async (status) => {
      mocks.acceptHostedMemberStripeCheckoutCompletionTx.mockResolvedValueOnce({
        kind: "cleanup_terminal",
      });
      mocks.retrieveStripeSubscription.mockResolvedValueOnce({
        customer: "cus_terminal",
        id: "sub_terminal",
        metadata: {
          billingPlanCode: "launch_monthly",
          checkoutOffer: "standard",
          memberId: "member_123",
        },
        status,
      });

      await expect(applyStripeCheckoutCompleted(
        {
          created: 1_744_416_000,
          customer: "cus_terminal",
          id: "cs_terminal",
          metadata: {
            billingPlanCode: "launch_monthly",
            checkoutAttemptId: "attempt_terminal",
            checkoutIntentHash: "intent_terminal",
            checkoutOffer: "standard",
            memberId: "member_123",
          },
          subscription: "sub_terminal",
        } as never,
        {} as never,
      )).resolves.toMatchObject({
        cleanupStandardCheckout: {
          checkoutSessionId: "cs_terminal",
          subscriptionId: "sub_terminal",
        },
        welcomeEmailMemberId: null,
      });

      expect(mocks.acceptHostedMemberStripeCheckoutCompletionTx)
        .toHaveBeenCalledWith(expect.objectContaining({
          billingIdentityDisposition: "terminal",
          checkoutAttemptId: "attempt_terminal",
          checkoutIntentHash: "intent_terminal",
          checkoutSessionId: "cs_terminal",
        }));
      expect(mocks.clearHostedMemberStripeCheckoutAttemptForSessionTx).not.toHaveBeenCalled();
    },
  );

  it("terminalizes the exact direct projection when the sponsored checkout subscription is already absent", async () => {
    mocks.retrieveStripeSubscription.mockRejectedValueOnce({ code: "resource_missing" });
    mocks.readHostedMemberFamilyBillingClaim.mockResolvedValue({
      groupId: "hbag_family",
      kind: "active_sponsorship",
      ownerMemberId: "member_owner",
    });
    mocks.terminalizeHostedFamilySponsoredDirectBillingTx.mockResolvedValueOnce(true);
    const tx = { __tag: "tx" };
    const prisma = {
      $transaction: vi.fn(async (
        run: (transaction: typeof tx) => Promise<unknown>,
      ) => run(tx)),
    };

    await expect(cleanupHostedFamilySponsoredDirectSubscription({
      checkoutSessionId: "cs_123",
      memberId: "member_123",
      prisma: prisma as never,
      sourceEventId: "evt_cleanup_123",
      stripe: {
        subscriptions: {
          cancel: mocks.cancelStripeSubscription,
          retrieve: mocks.retrieveStripeSubscription,
        },
      } as never,
      subscriptionId: "sub_superseded",
    })).resolves.toBeUndefined();

    expect(mocks.terminalizeHostedFamilySponsoredDirectBillingTx)
      .toHaveBeenCalledWith({
        dispatchContext: expect.objectContaining({
          sourceEventId: "evt_cleanup_123",
          sourceType: "stripe.customer.subscription.deleted",
        }),
        memberId: "member_123",
        stripeSubscriptionId: "sub_superseded",
        tx,
      });
    expect(mocks.lockHostedMemberRow).toHaveBeenNthCalledWith(
      1,
      tx,
      "member_owner",
    );
    expect(mocks.lockHostedMemberRow).toHaveBeenNthCalledWith(
      2,
      tx,
      "member_123",
    );
  });

  it("holds Family authority through Checkout cancellation and refund cleanup", async () => {
    const familyClaim = {
      groupId: "hbag_family",
      kind: "active_sponsorship" as const,
      ownerMemberId: "member_owner",
    };
    mocks.readHostedMemberFamilyBillingClaim.mockResolvedValue(familyClaim);
    mocks.terminalizeHostedFamilySponsoredDirectBillingTx.mockResolvedValueOnce(true);
    const subscription = {
      ...makePulseTrialSubscription(),
      id: "sub_superseded",
      status: "active",
    };
    mocks.retrieveStripeSubscription.mockResolvedValueOnce(subscription);
    const tx = { __tag: "tx" };
    const prisma = {
      $transaction: vi.fn(async (
        run: (transaction: typeof tx) => Promise<unknown>,
      ) => run(tx)),
    };
    const stripe = {
      subscriptions: {
        cancel: mocks.cancelStripeSubscription,
        retrieve: mocks.retrieveStripeSubscription,
      },
    };

    await expect(cleanupHostedFamilySponsoredDirectSubscription({
      checkoutSessionId: "cs_123",
      memberId: "member_123",
      prisma: prisma as never,
      sourceEventId: "evt_checkout_cleanup_123",
      stripe: stripe as never,
      subscriptionId: "sub_superseded",
    })).resolves.toBeUndefined();

    expect(mocks.retrieveStripeSubscription).toHaveBeenNthCalledWith(
      1,
      "sub_superseded",
    );
    expect(mocks.retrieveStripeSubscription).toHaveBeenNthCalledWith(
      2,
      "sub_family",
    );
    expect(mocks.cleanupHostedStandardCheckoutLoser).toHaveBeenCalledWith({
      stripe,
      stripeSubscriptionId: "sub_superseded",
      subscription,
    });
    expect(mocks.clearHostedMemberStripeCheckoutAttemptForSessionTx)
      .toHaveBeenCalledWith({
        memberId: "member_123",
        sessionId: "cs_123",
        tx,
      });
    expect(mocks.terminalizeHostedFamilySponsoredDirectBillingTx)
      .toHaveBeenCalledOnce();
  });

  it("refunds on the first Family loser cleanup before sponsorship can disappear", async () => {
    const familyClaim = {
      groupId: "hbag_family",
      kind: "active_sponsorship" as const,
      ownerMemberId: "member_owner",
    };
    const member = makeMemberSnapshot({
      billingRef: {
        memberId: "member_123",
        stripeCustomerId: "cus_direct",
        stripeSubscriptionId: "sub_superseded",
      },
      billingStatus: HostedBillingStatus.active,
    });
    const paidInvoice = {
      amount_due: 2_000,
      amount_paid: 2_000,
      amount_remaining: 0,
      customer: "cus_direct",
      id: "in_late_paid",
      post_payment_credit_notes_amount: 0,
      pre_payment_credit_notes_amount: 0,
      starting_balance: 0,
      status: "paid",
      subscription: "sub_superseded",
    } as unknown as Stripe.Invoice;
    const directSubscription = {
      ...makePulseTrialSubscription(),
      customer: "cus_direct",
      id: "sub_superseded",
      latest_invoice: paidInvoice,
      metadata: {
        billingPlanCode: "launch_monthly",
        checkoutOffer: "standard",
        memberId: "member_123",
      },
      status: "active",
    } as unknown as Stripe.Subscription;
    const familySubscription = makeActiveFamilySubscription() as unknown as Stripe.Subscription;
    let refundCreated = false;
    const refundsCreate = vi.fn(async () => {
      refundCreated = true;
      return { amount: 2_000, status: "succeeded" };
    });
    const stripe = {
      invoicePayments: {
        list: vi.fn(async () => ({
          data: [{
            amount_paid: 2_000,
            amount_requested: 2_000,
            payment: {
              payment_intent: {
                amount_received: 2_000,
                id: "pi_late_paid",
                status: "succeeded",
              },
              type: "payment_intent",
            },
          }],
          has_more: false,
        })),
      },
      invoices: {
        list: vi.fn(async () => ({ data: [paidInvoice], has_more: false })),
      },
      refunds: {
        create: refundsCreate,
        list: vi.fn(async () => ({
          data: refundCreated
            ? [{ amount: 2_000, status: "succeeded" }]
            : [],
          has_more: false,
        })),
      },
      subscriptions: {
        cancel: vi.fn(async () => {
          directSubscription.status = "canceled";
          return directSubscription;
        }),
        retrieve: vi.fn(async (subscriptionId: string) =>
          subscriptionId === familySubscription.id
            ? familySubscription
            : directSubscription),
      },
    } as unknown as Stripe;
    const prisma = {
      $transaction: vi.fn(async (
        run: (transaction: Record<string, never>) => Promise<unknown>,
      ) => run({})),
    };
    const subscriptionContext = {
      eventCreatedAt: new Date("2026-08-10T00:00:00.000Z"),
      occurredAt: "2026-08-10T00:00:00.000Z",
      sourceEventId: "evt_subscription_first",
      sourceType: "stripe.customer.subscription.updated" as const,
    };
    const invoiceContext = {
      eventCreatedAt: new Date("2026-08-10T00:00:05.000Z"),
      occurredAt: "2026-08-10T00:00:05.000Z",
      sourceEventId: "evt_invoice_late",
      sourceType: "stripe.invoice.paid" as const,
    };
    const { cleanupHostedStandardCheckoutLoser: realCleanup } =
      await vi.importActual<
        typeof import("@/src/lib/hosted-onboarding/stripe-checkout-loser-cleanup")
      >("@/src/lib/hosted-onboarding/stripe-checkout-loser-cleanup");

    mocks.findMemberForStripeInvoice.mockResolvedValue(member);
    mocks.findMemberForStripeSubscription.mockResolvedValue(member);
    mocks.readHostedMemberFamilyBillingClaim.mockResolvedValue(familyClaim);
    mocks.cleanupHostedStandardCheckoutLoser.mockImplementation(realCleanup);
    mocks.terminalizeHostedFamilySponsoredDirectBillingTx.mockResolvedValue(true);

    const subscriptionOutcome = await applyStripeSubscriptionUpdated(
      directSubscription,
      subscriptionContext,
      {} as never,
    );
    expect(subscriptionOutcome.cleanupFamilySponsoredStripeSubscriptionId)
      .toBe("sub_superseded");

    await cleanupHostedFamilySponsoredDirectSubscription({
      memberId: "member_123",
      prisma: prisma as never,
      sourceEventId: "evt_subscription_first:family-sponsored-cleanup",
      stripe,
      subscriptionId: "sub_superseded",
    });
    expect(directSubscription.status).toBe("canceled");
    expect(refundsCreate).toHaveBeenCalledOnce();

    // Membership removal can commit after the first cleanup releases its locks.
    // A delayed invoice event must not own the refund that is already complete.
    mocks.readHostedMemberFamilyBillingClaim.mockResolvedValue(null);

    const lateInvoiceOutcome = await applyStripeInvoicePaid(
      paidInvoice,
      invoiceContext,
      {} as never,
      HostedBillingStatus.canceled,
      directSubscription,
    );
    expect(lateInvoiceOutcome.cleanupFamilySponsoredStripeSubscriptionId)
      .toBeUndefined();

    const replayOutcome = await applyStripeInvoicePaid(
      paidInvoice,
      invoiceContext,
      {} as never,
      HostedBillingStatus.canceled,
      directSubscription,
    );

    expect(replayOutcome.cleanupFamilySponsoredStripeSubscriptionId)
      .toBeUndefined();
    expect(refundsCreate).toHaveBeenCalledOnce();
  });

  it.each([
    ["ended", makeActiveFamilySubscription({ status: "canceled" })],
    ["unpaid", makeActiveFamilySubscription({ status: "unpaid" })],
    ["replaced", makeActiveFamilySubscription({ id: "sub_family_replacement" })],
    ["owned by another customer", makeActiveFamilySubscription({
      customer: "cus_other",
    })],
    ["not a Family subscription", makeActiveFamilySubscription({
      metadata: { kind: "hosted_member_plan" },
    })],
    ["on another billing plan", makeActiveFamilySubscription({
      metadata: { billingPlanCode: "launch_monthly" },
    })],
    ["bound to another group", makeActiveFamilySubscription({
      metadata: { accountGroupId: "hbag_other" },
    })],
    ["bound to another owner", makeActiveFamilySubscription({
      metadata: { ownerMemberId: "member_other" },
    })],
  ])("keeps direct paid billing when Stripe Family authority is %s", async (
    _case,
    familySubscription,
  ) => {
    const familyClaim = {
      groupId: "hbag_family",
      kind: "active_sponsorship" as const,
      ownerMemberId: "member_owner",
    };
    mocks.readHostedMemberFamilyBillingClaim.mockResolvedValue(familyClaim);
    const directSubscription = {
      ...makePulseTrialSubscription(),
      id: "sub_superseded",
      status: "active",
    };
    mocks.retrieveStripeSubscription
      .mockResolvedValueOnce(directSubscription)
      .mockResolvedValueOnce(familySubscription);
    const tx = { __tag: "tx" };
    const prisma = {
      $transaction: vi.fn(async (
        run: (transaction: typeof tx) => Promise<unknown>,
      ) => run(tx)),
    };
    const stripe = {
      subscriptions: {
        cancel: mocks.cancelStripeSubscription,
        retrieve: mocks.retrieveStripeSubscription,
      },
    };

    await expect(cleanupHostedFamilySponsoredDirectSubscription({
      checkoutSessionId: "cs_123",
      memberId: "member_123",
      prisma: prisma as never,
      sourceEventId: "evt_checkout_cleanup_after_family_end",
      stripe: stripe as never,
      subscriptionId: "sub_superseded",
    })).rejects.toBeInstanceOf(
      HostedStripeFamilySponsoredCleanupPendingError,
    );

    expect(mocks.retrieveStripeSubscription).toHaveBeenNthCalledWith(
      1,
      "sub_superseded",
    );
    expect(mocks.retrieveStripeSubscription).toHaveBeenNthCalledWith(
      2,
      "sub_family",
    );
    expect(mocks.cleanupHostedStandardCheckoutLoser).not.toHaveBeenCalled();
    expect(mocks.cancelStripeSubscription).not.toHaveBeenCalled();
    expect(mocks.clearHostedMemberStripeCheckoutAttemptForSessionTx)
      .not.toHaveBeenCalled();
    expect(mocks.terminalizeHostedFamilySponsoredDirectBillingTx)
      .not.toHaveBeenCalled();
  });

  it("keeps direct paid billing when the current Family subscription is missing at Stripe", async () => {
    mocks.readHostedMemberFamilyBillingClaim.mockResolvedValue({
      groupId: "hbag_family",
      kind: "active_sponsorship",
      ownerMemberId: "member_owner",
    });
    mocks.retrieveStripeSubscription
      .mockResolvedValueOnce({
        ...makePulseTrialSubscription(),
        id: "sub_superseded",
        status: "active",
      })
      .mockRejectedValueOnce({ code: "resource_missing" });
    const tx = { __tag: "tx" };
    const prisma = {
      $transaction: vi.fn(async (
        run: (transaction: typeof tx) => Promise<unknown>,
      ) => run(tx)),
    };

    await expect(cleanupHostedFamilySponsoredDirectSubscription({
      checkoutSessionId: "cs_123",
      memberId: "member_123",
      prisma: prisma as never,
      sourceEventId: "evt_checkout_cleanup_missing_family_authority",
      stripe: {
        subscriptions: {
          cancel: mocks.cancelStripeSubscription,
          retrieve: mocks.retrieveStripeSubscription,
        },
      } as never,
      subscriptionId: "sub_superseded",
    })).rejects.toBeInstanceOf(
      HostedStripeFamilySponsoredCleanupPendingError,
    );

    expect(mocks.retrieveStripeSubscription).toHaveBeenNthCalledWith(
      1,
      "sub_superseded",
    );
    expect(mocks.retrieveStripeSubscription).toHaveBeenNthCalledWith(
      2,
      "sub_family",
    );
    expect(mocks.cleanupHostedStandardCheckoutLoser).not.toHaveBeenCalled();
    expect(mocks.cancelStripeSubscription).not.toHaveBeenCalled();
    expect(mocks.clearHostedMemberStripeCheckoutAttemptForSessionTx)
      .not.toHaveBeenCalled();
    expect(mocks.terminalizeHostedFamilySponsoredDirectBillingTx)
      .not.toHaveBeenCalled();
  });

  it("keeps direct paid billing when Family sponsorship ended before cleanup started", async () => {
    mocks.readHostedMemberFamilyBillingClaim.mockResolvedValueOnce(null);
    const tx = { __tag: "tx" };
    const prisma = {
      $transaction: vi.fn(async (
        run: (transaction: typeof tx) => Promise<unknown>,
      ) => run(tx)),
    };

    await expect(cleanupHostedFamilySponsoredDirectSubscription({
      memberId: "member_123",
      prisma: prisma as never,
      sourceEventId: "evt_cleanup_without_sponsor",
      stripe: {
        subscriptions: {
          cancel: mocks.cancelStripeSubscription,
          retrieve: mocks.retrieveStripeSubscription,
        },
      } as never,
      subscriptionId: "sub_paid_current",
    })).rejects.toBeInstanceOf(
      HostedStripeFamilySponsoredCleanupPendingError,
    );

    expect(mocks.cancelStripeSubscription).not.toHaveBeenCalled();
    expect(mocks.terminalizeHostedFamilySponsoredDirectBillingTx)
      .not.toHaveBeenCalled();
  });

  it("requests event replay when Family sponsorship ends before the owner lock", async () => {
    mocks.readHostedMemberFamilyBillingClaim
      .mockResolvedValueOnce({
        groupId: "hbag_family",
        kind: "active_sponsorship",
        ownerMemberId: "member_owner",
      })
      .mockResolvedValueOnce(null);
    const tx = { __tag: "tx" };
    const prisma = {
      $transaction: vi.fn(async (
        run: (transaction: typeof tx) => Promise<unknown>,
      ) => run(tx)),
    };

    await expect(cleanupHostedFamilySponsoredDirectSubscription({
      memberId: "member_123",
      prisma: prisma as never,
      sourceEventId: "evt_cleanup_changed_sponsor",
      stripe: {
        subscriptions: {
          cancel: mocks.cancelStripeSubscription,
          retrieve: mocks.retrieveStripeSubscription,
        },
      } as never,
      subscriptionId: "sub_paid_current",
    })).rejects.toBeInstanceOf(
      HostedStripeFamilySponsoredCleanupPendingError,
    );

    expect(mocks.retrieveStripeSubscription).not.toHaveBeenCalled();
    expect(mocks.cancelStripeSubscription).not.toHaveBeenCalled();
    expect(mocks.terminalizeHostedFamilySponsoredDirectBillingTx)
      .not.toHaveBeenCalled();
  });

  it("keeps stale checkout refs from replacing the winner or storing a loser email", async () => {
    mocks.acceptHostedMemberStripeCheckoutCompletionTx.mockResolvedValueOnce({
      kind: "cleanup_superseded",
    });
    mocks.readHostedMemberBillingSnapshot.mockResolvedValue(makeMemberSnapshot({
      billingRef: {
        lastStripeEventCreatedAt: new Date("2026-04-12T02:00:00.000Z"),
        memberId: "member_123",
        stripeCustomerId: "cus_current",
        stripeSubscriptionId: "sub_current",
      },
    }));
    mocks.retrieveStripeSubscription.mockResolvedValueOnce({
      customer: "cus_old",
      id: "sub_old",
      metadata: {
        billingPlanCode: "launch_monthly",
        checkoutOffer: "standard",
        memberId: "member_123",
      },
      status: "active",
    });

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
    ).resolves.toMatchObject({
      activatedMemberId: null,
      cleanupStandardCheckout: {
        checkoutSessionId: "cs_old",
        subscriptionId: "sub_old",
      },
      hostedExecutionEventId: null,
      welcomeEmailMemberId: null,
    });

    expect(mocks.writeHostedMemberStripeBillingRef).not.toHaveBeenCalled();
    expect(
      mocks.upsertHostedMemberStripeCheckoutEmailIfFreshTx,
    ).not.toHaveBeenCalled();
  });

  it("converts an exact legacy trial checkout into Starter usage and retires its subscription", async () => {
    const preparedCryptoDomainRoots = new Map([
      ["control", { domain: "control" }],
    ]) as never;

    await expect(
      applyStripeCheckoutCompleted(
        makePulseTrialCheckoutSession() as never,
        {} as never,
        undefined,
        preparedCryptoDomainRoots,
      ),
    ).resolves.toEqual({
      activatedMemberId: "member_123",
      cleanupPulseTrialStripeSubscriptionId: "sub_123",
      hostedExecutionEventId: "wake_123",
      hostedExecutionMailboxItemId: null,
      runtimeRecheckMemberIds: ["member_123"],
      welcomeEmailMemberId: "member_123",
    });

    expect(
      mocks.readHostedLegacyTrialConsumedUsageUsdMicrosTx,
    ).toHaveBeenCalledWith({
      memberId: "member_123",
      trialStartedAt: new Date("2025-04-12T00:00:00.000Z"),
      tx: {},
    });
    expect(mocks.ensureHostedStarterUsageGrantTx).toHaveBeenCalledWith({
      effectiveAt: new Date("2025-04-12T00:00:00.000Z"),
      initialConsumedUsdMicros: 0n,
      memberId: "member_123",
      source: "legacy_trial_migration",
      tx: {},
    });
    expect(
      mocks.clearHostedMemberLegacyTrialBillingUnderLockTx,
    ).toHaveBeenCalledWith({
      memberId: "member_123",
      tx: {},
    });
    expect(mocks.activateHostedMemberForPositiveSourceTx).toHaveBeenCalledWith({
      dispatchContext: expect.objectContaining({
        sourceEventId: "checkout.session:cs_trial_123",
        sourceType: "hosted.legacy_trial.converted_to_starter",
      }),
      memberId: "member_123",
      preparedCryptoDomainRoots,
      prisma: {},
      skipIfPreviouslyActivated: true,
    });
    expect(
      mocks.acceptHostedMemberStripeCheckoutCompletionTx,
    ).not.toHaveBeenCalled();
    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
  });

  it.each([
    [
      "suspended",
      HostedBillingStatus.active,
      new Date("2025-04-11T00:00:00.000Z"),
    ],
    ["canceled", HostedBillingStatus.canceled, null],
    ["unpaid", HostedBillingStatus.unpaid, null],
  ] as const)(
    "retires a legacy trial for a %s member without granting or reactivating access",
    async (
      _label: string,
      billingStatus: HostedBillingStatus,
      suspendedAt: Date | null,
    ) => {
      mocks.readHostedMemberPulseTrialBillingDecisionSnapshot.mockResolvedValueOnce(
        makePulseTrialDecisionSnapshot({
          billingStatus,
          suspendedAt,
        }),
      );

      await expect(
        applyStripeCheckoutCompleted(
          makePulseTrialCheckoutSession() as never,
          {} as never,
        ),
      ).resolves.toEqual({
        activatedMemberId: null,
        activatedMembers: [],
        cleanupPulseTrialStripeSubscriptionId: "sub_123",
        hostedExecutionEventId: null,
        runtimeRecheckMemberIds: [],
        welcomeEmailMemberId: null,
      });

      expect(mocks.ensureHostedStarterUsageGrantTx).not.toHaveBeenCalled();
      expect(mocks.activateHostedMemberForPositiveSourceTx).not.toHaveBeenCalled();
      expect(
        mocks.clearHostedMemberLegacyTrialBillingUnderLockTx,
      ).toHaveBeenCalledWith({
        billingStatusAfterClear: billingStatus,
        memberId: "member_123",
        tx: {},
      });
    },
  );

  it("binds an exact active legacy Checkout for invoice-owned paid reconciliation", async () => {
    mocks.retrieveStripeSubscription.mockResolvedValueOnce({
      ...makePulseTrialSubscription(),
      status: "active",
    });

    await expect(
      applyStripeCheckoutCompleted(
        makePulseTrialCheckoutSession() as never,
        {} as never,
      ),
    ).resolves.toEqual({
      activatedMemberId: null,
      activatedMembers: [],
      hostedExecutionEventId: null,
      runtimeRecheckMemberIds: [],
      welcomeEmailMemberId: null,
    });

    expect(
      mocks.acceptHostedMemberStripeCheckoutCompletionTx,
    ).toHaveBeenCalledWith(expect.objectContaining({
      billingIdentityDisposition: "bind",
      currentCheckoutOffer: "pulse_trial_7d",
      memberId: "member_123",
      preparedCompletion: expect.objectContaining({
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
      }),
    }));
    expect(mocks.ensureHostedStarterUsageGrantTx).not.toHaveBeenCalled();
    expect(
      mocks.clearHostedMemberLegacyTrialBillingUnderLockTx,
    ).not.toHaveBeenCalled();
    expect(mocks.activateHostedMemberForPositiveSourceTx).not.toHaveBeenCalled();
  });

  it("fails closed instead of canceling a second active legacy subscription", async () => {
    mocks.readHostedMemberPulseTrialBillingDecisionSnapshot.mockResolvedValueOnce(
      makePulseTrialDecisionSnapshot({
        billingStatus: HostedBillingStatus.active,
        stripeSubscriptionId: "sub_existing",
      }),
    );
    mocks.retrieveStripeSubscription.mockResolvedValueOnce({
      ...makePulseTrialSubscription(),
      status: "active",
    });

    await expect(
      applyStripeCheckoutCompleted(
        makePulseTrialCheckoutSession() as never,
        {} as never,
      ),
    ).rejects.toMatchObject({
      code: "HOSTED_BILLING_SUBSCRIPTION_ALREADY_EXISTS",
      httpStatus: 409,
    });

    expect(mocks.ensureHostedStarterUsageGrantTx).not.toHaveBeenCalled();
    expect(
      mocks.clearHostedMemberLegacyTrialBillingUnderLockTx,
    ).not.toHaveBeenCalled();
    expect(
      mocks.acceptHostedMemberStripeCheckoutCompletionTx,
    ).not.toHaveBeenCalled();
  });

  it.each([
    [
      "wrong trial policy",
      {
        metadata: {
          ...makePulseTrialMetadata(),
          trialPolicyVersion: "unknown-policy",
        },
      },
      null,
    ],
    [
      "wrong member metadata",
      {
        metadata: {
          ...makePulseTrialMetadata(),
          memberId: "member_other",
        },
      },
      null,
    ],
    [
      "customer mismatch",
      {},
      {
        ...makePulseTrialSubscription(),
        customer: "cus_other",
      },
    ],
    [
      "wrong subscription policy metadata",
      {},
      {
        ...makePulseTrialSubscription(),
        metadata: {
          ...makePulseTrialMetadata(),
          trialUsageLimitUsdMicros: "1",
        },
      },
    ],
    [
      "wrong recurring price",
      {},
      {
        ...makePulseTrialSubscription(),
        items: {
          data: [{
            id: "si_wrong",
            price: {
              id: "price_other",
              recurring: {
                interval: "month",
                usage_type: "licensed",
              },
            },
            quantity: 1,
          }],
          has_more: false,
        },
      },
    ],
  ] as const)(
    "does not grant Starter usage for %s",
    async (
      _label: string,
      sessionOverrides: Partial<ReturnType<typeof makePulseTrialCheckoutSession>>,
      subscriptionOverride: ReturnType<typeof makePulseTrialSubscription> | null,
    ) => {
      if (subscriptionOverride) {
        mocks.retrieveStripeSubscription.mockResolvedValueOnce(
          subscriptionOverride,
        );
      }
      const session = {
        ...makePulseTrialCheckoutSession(),
        ...sessionOverrides,
      };

      await expect(
        applyStripeCheckoutCompleted(session as never, {} as never),
      ).resolves.toEqual({
        activatedMemberId: null,
        activatedMembers: [],
        hostedExecutionEventId: null,
        runtimeRecheckMemberIds: [],
        welcomeEmailMemberId: null,
      });

      expect(mocks.ensureHostedStarterUsageGrantTx).not.toHaveBeenCalled();
      expect(
        mocks.clearHostedMemberLegacyTrialBillingUnderLockTx,
      ).not.toHaveBeenCalled();
      expect(mocks.activateHostedMemberForPositiveSourceTx).not.toHaveBeenCalled();
    },
  );

  it("does not reinterpret an already-paid legacy subscription as Starter", async () => {
    mocks.readHostedMemberPulseTrialBillingDecisionSnapshot.mockResolvedValueOnce(
      makePulseTrialDecisionSnapshot({
        billingStatus: HostedBillingStatus.active,
        currentBillingPhase: "paid",
      }),
    );

    await expect(
      applyStripeCheckoutCompleted(
        makePulseTrialCheckoutSession() as never,
        {} as never,
      ),
    ).resolves.toEqual({
      activatedMemberId: null,
      activatedMembers: [],
      hostedExecutionEventId: null,
      runtimeRecheckMemberIds: [],
      welcomeEmailMemberId: null,
    });

    expect(mocks.ensureHostedStarterUsageGrantTx).not.toHaveBeenCalled();
    expect(
      mocks.clearHostedMemberLegacyTrialBillingUnderLockTx,
    ).not.toHaveBeenCalled();
    expect(mocks.activateHostedMemberForPositiveSourceTx).not.toHaveBeenCalled();
  });

  it("fails closed when legacy trial checkout ownership is ambiguous", async () => {
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
      activatedMembers: [],
      hostedExecutionEventId: null,
      runtimeRecheckMemberIds: [],
      welcomeEmailMemberId: null,
    });

    expect(mocks.ensureHostedStarterUsageGrantTx).not.toHaveBeenCalled();
    expect(
      mocks.clearHostedMemberLegacyTrialBillingUnderLockTx,
    ).not.toHaveBeenCalled();
  });

  it("revalidates a core-only Pulse lookup against the redeemed billing identity under lock", async () => {
    mocks.findMemberForStripeCheckoutSession.mockResolvedValueOnce(
      makeMemberSnapshot({
        billingRef: null,
        billingStatus: HostedBillingStatus.incomplete,
      }),
    );
    mocks.readHostedMemberPulseTrialBillingDecisionSnapshot
      .mockResolvedValueOnce(
        makePulseTrialDecisionSnapshot({
          billingStatus: HostedBillingStatus.incomplete,
          pulseTrialRedeemedAt:
            new Date("2025-04-12T00:00:00.000Z"),
          stripeSubscriptionId: "sub_auto_trial",
        }),
      );

    await expect(
      applyStripeCheckoutCompleted(
        {
          ...makePulseTrialCheckoutSession(),
          subscription: "sub_delayed_checkout",
        } as never,
        {} as never,
      ),
    ).resolves.toEqual({
      activatedMemberId: null,
      activatedMembers: [],
      cleanupPulseTrialStripeSubscriptionId: "sub_delayed_checkout",
      hostedExecutionEventId: null,
      runtimeRecheckMemberIds: [],
      welcomeEmailMemberId: null,
    });

    expect(mocks.lockHostedMemberRow).toHaveBeenCalledWith({}, "member_123");
    expect(mocks.lockHostedMemberRow.mock.invocationCallOrder[0])
      .toBeLessThan(
        mocks.readHostedMemberPulseTrialBillingDecisionSnapshot
          .mock.invocationCallOrder[0] ?? 0,
      );
    expect(
      mocks.acceptHostedMemberStripeCheckoutCompletionTx,
    ).not.toHaveBeenCalled();
    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
    expect(mocks.activateHostedMemberForPositiveSourceTx).not.toHaveBeenCalled();
  });

  it("returns a valid delayed Pulse Trial checkout subscription for loser cleanup", async () => {
    mocks.readHostedMemberPulseTrialBillingDecisionSnapshot
      .mockResolvedValueOnce(
        makePulseTrialDecisionSnapshot({
          pulseTrialRedeemedAt:
            new Date("2025-04-12T00:00:00.000Z"),
          stripeSubscriptionId: "sub_auto_trial",
        }),
      );
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
      activatedMembers: [],
      cleanupPulseTrialStripeSubscriptionId: "sub_delayed_checkout",
      hostedExecutionEventId: null,
      runtimeRecheckMemberIds: [],
      welcomeEmailMemberId: null,
    });

    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
    expect(mocks.activateHostedMemberForPositiveSourceTx).not.toHaveBeenCalled();
  });

  it("returns an exact Pulse Trial checkout for cleanup when active non-trial access has no subscription", async () => {
    mocks.readHostedMemberPulseTrialBillingDecisionSnapshot
      .mockResolvedValueOnce(
        makePulseTrialDecisionSnapshot({
          billingStatus: HostedBillingStatus.active,
          stripeSubscriptionId: null,
        }),
      );
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

  it("retires a delayed second trial instead of replacing the existing billing identity", async () => {
    mocks.readHostedMemberPulseTrialBillingDecisionSnapshot
      .mockResolvedValueOnce(
        makePulseTrialDecisionSnapshot({
          billingStatus: HostedBillingStatus.incomplete,
          stripeSubscriptionId: "sub_incomplete_old",
        }),
      );
    const session = {
      ...makePulseTrialCheckoutSession(),
      subscription: "sub_trial_replacement",
    };
    const subscription = {
      ...makePulseTrialSubscription(),
      id: "sub_trial_replacement",
    };
    mocks.retrieveStripeSubscription.mockResolvedValueOnce(subscription);

    await expect(
      applyStripeCheckoutCompleted(session as never, {} as never),
    ).resolves.toMatchObject({
      cleanupPulseTrialStripeSubscriptionId: "sub_trial_replacement",
    });

    expect(mocks.ensureHostedStarterUsageGrantTx).not.toHaveBeenCalled();
    expect(
      mocks.clearHostedMemberLegacyTrialBillingUnderLockTx,
    ).not.toHaveBeenCalled();
    expect(
      mocks.acceptHostedMemberStripeCheckoutCompletionTx,
    ).not.toHaveBeenCalled();
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

  it("validates and cancels a loser outside the short owner-revalidation transaction", async () => {
    let transactionActive = false;
    const prisma = {
      $transaction: async (run: (tx: object) => Promise<unknown>) => {
        transactionActive = true;
        try {
          return await run({});
        } finally {
          transactionActive = false;
        }
      },
    };
    mocks.retrieveStripeSubscription.mockImplementationOnce(async () => {
      expect(transactionActive).toBe(false);
      return {
        ...makePulseTrialSubscription(),
        id: "sub_delayed_checkout",
      };
    });
    mocks.readHostedMemberBillingSnapshot.mockImplementationOnce(async () => {
      expect(transactionActive).toBe(true);
      return makeMemberSnapshot({
        billingRef: {
          currentBillingPhase: null,
          memberId: "member_123",
          stripeCustomerId: "cus_123",
          stripeSubscriptionId: null,
        },
        billingStatus: HostedBillingStatus.active,
      });
    });
    mocks.cancelStripeSubscription.mockImplementationOnce(async () => {
      expect(transactionActive).toBe(false);
      return {
        id: "sub_delayed_checkout",
        status: "canceled",
      };
    });

    await expect(cancelHostedPulseTrialCheckoutLoserSubscription({
      memberId: "member_123",
      prisma: prisma as never,
      subscriptionId: "sub_delayed_checkout",
    })).resolves.toBeUndefined();

    expect(
      mocks.retrieveStripeSubscription.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.readHostedMemberBillingSnapshot.mock.invocationCallOrder[0] ?? 0,
    );
    expect(
      mocks.readHostedMemberBillingSnapshot.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.cancelStripeSubscription.mock.invocationCallOrder[0] ?? 0,
    );
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
    mocks.readHostedMemberPulseTrialBillingDecisionSnapshot
      .mockResolvedValueOnce(
        makePulseTrialDecisionSnapshot({
          billingStatus: HostedBillingStatus.active,
          currentBillingPhase: "paid",
          stripeSubscriptionId: "sub_paid_123",
        }),
      );
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
      activatedMembers: [],
      cleanupPulseTrialStripeSubscriptionId: "sub_delayed_checkout",
      hostedExecutionEventId: null,
      runtimeRecheckMemberIds: [],
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

function makeActiveFamilySubscription(overrides: {
  customer?: string;
  id?: string;
  metadata?: Partial<Record<
    "accountGroupId" | "billingPlanCode" | "kind" | "ownerMemberId",
    string
  >>;
  status?: string;
} = {}): Record<string, unknown> {
  return {
    customer: overrides.customer ?? "cus_family",
    id: overrides.id ?? "sub_family",
    metadata: {
      accountGroupId: "hbag_family",
      billingPlanCode: "launch_family_monthly",
      kind: "hosted_family_plan",
      ownerMemberId: "member_owner",
      ...overrides.metadata,
    },
    status: overrides.status ?? "active",
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
    pulseTrialStartSource: "web_onboarding",
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

function makePulseTrialDecisionSnapshot(input?: {
  billingStatus?: HostedBillingStatus;
  currentBillingPhase?: string | null;
  currentTrialStartedAt?: Date | null;
  pulseTrialRedeemedAt?: Date | null;
  stripeSubscriptionId?: string | null;
  suspendedAt?: Date | null;
}) {
  const stripeSubscriptionId =
    input && "stripeSubscriptionId" in input
      ? input.stripeSubscriptionId
      : "sub_123";
  return {
    core: {
      ...makeMemberSnapshot({
        ...(input?.billingStatus
          ? { billingStatus: input.billingStatus }
          : {}),
      }).core,
      suspendedAt: input?.suspendedAt ?? null,
    },
    currentBillingPhase: input?.currentBillingPhase ?? null,
    currentTrialStartedAt:
      input && "currentTrialStartedAt" in input
        ? input.currentTrialStartedAt ?? null
        : new Date("2025-04-12T00:00:00.000Z"),
    pulseTrialRedeemedAt: input?.pulseTrialRedeemedAt ?? null,
    stripeSubscriptionLookupKey:
      createHostedStripeSubscriptionLookupKey(stripeSubscriptionId),
  };
}
