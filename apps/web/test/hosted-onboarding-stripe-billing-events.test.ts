import { HostedBillingStatus } from "@prisma/client";
import type Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HostedMemberBillingSnapshot } from "@/src/lib/hosted-onboarding/hosted-member-store";

const mocks = vi.hoisted(() => ({
  acceptHostedMemberStripeCheckoutCompletionTx: vi.fn(),
  activateHostedMemberForPositiveSourceTx: vi.fn(),
  applyHostedFamilyStripeCheckoutCompletedTx: vi.fn(),
  applyHostedFamilyStripeCheckoutExpiredTx: vi.fn(),
  applyHostedFamilyStripeSubscriptionUpdatedTx: vi.fn(),
  findMemberForStripeCheckoutSession: vi.fn(),
  findMemberForStripeInvoice: vi.fn(),
  findMemberForStripeReversal: vi.fn(),
  findMemberForStripeSubscription: vi.fn(),
  lookupHostedAccountGroupIdByStripeSubscriptionId: vi.fn(),
  prepareHostedMemberStripeBillingWrite: vi.fn(),
  readHostedMemberBillingSnapshot: vi.fn(),
  readHostedMemberCoreState: vi.fn(),
  readHostedMemberFamilyBillingClaim: vi.fn(),
  readHostedMemberStripeBillingLookupState: vi.fn(),
  readHostedLegacyTrialConsumedUsageUsdMicrosTx: vi.fn(),
  reconcileHostedAiUsageGateForBillingModeChangeTx: vi.fn(),
  requireHostedStripeApi: vi.fn(),
  stripeRefundsList: vi.fn(),
  suspendHostedMemberForBillingReversalTx: vi.fn(),
  clearHostedMemberLegacyTrialBillingUnderLockTx: vi.fn(),
  clearHostedMemberStripeCheckoutAttemptForSessionTx: vi.fn(),
  ensureHostedStarterUsageGrantTx: vi.fn(),
  lockHostedMemberRow: vi.fn(),
  upsertPreparedHostedMemberStripeCheckoutEmailIfFreshUnderLockTx: vi.fn(),
  upsertHostedMemberStripeCheckoutEmailIfFreshTx: vi.fn(),
  writeHostedMemberStripeBillingRefIfFreshTx: vi.fn(),
  writeHostedMemberStripeBillingTx: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/member-activation", () => ({
  activateHostedMemberForPositiveSourceTx: mocks.activateHostedMemberForPositiveSourceTx,
}));

vi.mock("@/src/lib/hosted-execution/usage-allowance", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-execution/usage-allowance")
  >("@/src/lib/hosted-execution/usage-allowance");

  return {
    ...actual,
    reconcileHostedAiUsageGateForBillingModeChangeTx:
      mocks.reconcileHostedAiUsageGateForBillingModeChangeTx,
  };
});

vi.mock("@/src/lib/hosted-onboarding/family-plan", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/family-plan")
  >("@/src/lib/hosted-onboarding/family-plan");

  return {
    ...actual,
    applyHostedFamilyStripeCheckoutCompletedTx:
      mocks.applyHostedFamilyStripeCheckoutCompletedTx,
    applyHostedFamilyStripeCheckoutExpiredTx:
      mocks.applyHostedFamilyStripeCheckoutExpiredTx,
    applyHostedFamilyStripeSubscriptionUpdatedTx:
      mocks.applyHostedFamilyStripeSubscriptionUpdatedTx,
    lookupHostedAccountGroupIdByStripeSubscriptionId:
      mocks.lookupHostedAccountGroupIdByStripeSubscriptionId,
    readHostedMemberFamilyBillingClaim:
      mocks.readHostedMemberFamilyBillingClaim,
  };
});

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
    findMemberForStripeReversal: mocks.findMemberForStripeReversal,
    findMemberForStripeSubscription: mocks.findMemberForStripeSubscription,
  };
});

vi.mock("@/src/lib/hosted-onboarding/stripe-billing-policy", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/stripe-billing-policy")
  >("@/src/lib/hosted-onboarding/stripe-billing-policy");

  return {
    ...actual,
    prepareHostedMemberStripeBillingWrite: mocks.prepareHostedMemberStripeBillingWrite,
    suspendHostedMemberForBillingReversalTx: mocks.suspendHostedMemberForBillingReversalTx,
    writeHostedMemberStripeBillingRefIfFreshTx:
      mocks.writeHostedMemberStripeBillingRefIfFreshTx,
    writeHostedMemberStripeBillingTx: mocks.writeHostedMemberStripeBillingTx,
  };
});

vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/hosted-member-store")
  >("@/src/lib/hosted-onboarding/hosted-member-store");

  return {
    ...actual,
    readHostedMemberBillingSnapshot:
      mocks.readHostedMemberBillingSnapshot,
    readHostedMemberCoreState: mocks.readHostedMemberCoreState,
    upsertPreparedHostedMemberStripeCheckoutEmailIfFreshUnderLockTx:
      mocks.upsertPreparedHostedMemberStripeCheckoutEmailIfFreshUnderLockTx,
    upsertHostedMemberStripeCheckoutEmailIfFreshTx:
      mocks.upsertHostedMemberStripeCheckoutEmailIfFreshTx,
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

vi.mock("@/src/lib/hosted-onboarding/shared", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/shared")
  >("@/src/lib/hosted-onboarding/shared");

  return {
    ...actual,
    lockHostedMemberRow: mocks.lockHostedMemberRow,
  };
});

vi.mock("@/src/lib/hosted-onboarding/runtime", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/runtime")
  >("@/src/lib/hosted-onboarding/runtime");

  return {
    ...actual,
    requireHostedStripeApi: mocks.requireHostedStripeApi,
  };
});

import {
  applyStripeCheckoutCompleted,
  applyStripeCheckoutExpired,
  applyStripeDisputeUpdated,
  applyStripeInvoicePaid,
  applyStripeInvoicePaymentFailed,
  applyStripeRefundCreated,
  applyStripeSubscriptionUpdated,
  prepareHostedStripeReversalProviderState,
} from "@/src/lib/hosted-onboarding/stripe-billing-events";
import {
  createHostedStripeCustomerLookupKey,
  createHostedStripeSubscriptionLookupKey,
} from "@/src/lib/hosted-onboarding/contact-privacy";

describe("hosted onboarding stripe billing events", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    const member = makeMemberSnapshot();
    mocks.findMemberForStripeCheckoutSession.mockResolvedValue(member);
    mocks.findMemberForStripeInvoice.mockResolvedValue(member);
    mocks.findMemberForStripeReversal.mockResolvedValue(member);
    mocks.findMemberForStripeSubscription.mockResolvedValue(member);
    mocks.applyHostedFamilyStripeCheckoutExpiredTx.mockResolvedValue(false);
    mocks.lookupHostedAccountGroupIdByStripeSubscriptionId.mockResolvedValue(
      null,
    );
    mocks.readHostedMemberBillingSnapshot.mockResolvedValue(member);
    mocks.readHostedMemberCoreState.mockResolvedValue(member.core);
    mocks.readHostedMemberFamilyBillingClaim.mockResolvedValue(null);
    mocks.readHostedMemberStripeBillingLookupState.mockResolvedValue(null);
    mocks.readHostedLegacyTrialConsumedUsageUsdMicrosTx.mockResolvedValue(0n);
    mocks.ensureHostedStarterUsageGrantTx.mockResolvedValue({
      balanceUsdMicros: 4_500_000n,
      effectiveAt: new Date("2026-04-12T00:00:00.000Z"),
      entryId: "huce_starter",
      granted: true,
      ledgerVersion: 1n,
    });
    mocks.lockHostedMemberRow.mockResolvedValue(undefined);
    mocks.acceptHostedMemberStripeCheckoutCompletionTx.mockResolvedValue({
      billingRef: {},
      kind: "accepted",
    });
    mocks.clearHostedMemberStripeCheckoutAttemptForSessionTx.mockResolvedValue(
      true,
    );
    mocks.prepareHostedMemberStripeBillingWrite.mockResolvedValue({
      canonicalBillingStatus: HostedBillingStatus.active,
      member,
    });
    mocks.writeHostedMemberStripeBillingTx.mockResolvedValue(member);
    mocks.suspendHostedMemberForBillingReversalTx.mockResolvedValue(undefined);
    mocks.upsertPreparedHostedMemberStripeCheckoutEmailIfFreshUnderLockTx
      .mockResolvedValue(undefined);
    mocks.upsertHostedMemberStripeCheckoutEmailIfFreshTx.mockResolvedValue({
      directPublicSender: null,
      memberId: "member_123",
      stripeCheckoutEmail: {
        address: "payer@example.com",
        collectedAt: new Date("2026-04-23T00:00:00.000Z"),
      },
      verifiedEmail: null,
    });
    mocks.writeHostedMemberStripeBillingRefIfFreshTx.mockResolvedValue(member);
    mocks.activateHostedMemberForPositiveSourceTx.mockResolvedValue({
      activated: true,
      hostedExecutionEventId: "wake_123",
      memberId: member.core.id,
    });
    mocks.applyHostedFamilyStripeCheckoutCompletedTx.mockResolvedValue({ groupId: null });
    mocks.applyHostedFamilyStripeSubscriptionUpdatedTx.mockResolvedValue({
      activations: [],
      groupId: null,
      runtimeRecheckMemberIds: [],
    });
    mocks.reconcileHostedAiUsageGateForBillingModeChangeTx.mockResolvedValue(undefined);
    mocks.stripeRefundsList.mockResolvedValue({
      data: [],
      has_more: false,
    });
    mocks.requireHostedStripeApi.mockReturnValue({
      invoicePayments: {
        list: vi.fn(async () => ({ data: [] })),
      },
      refunds: {
        list: mocks.stripeRefundsList,
      },
      subscriptions: {
        retrieve: vi.fn(async () => makeStripeSubscription()),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reports standard checkout completion as a welcome candidate after storing the checkout email", async () => {
    const session = {
      created: 1_714_700_800,
      customer: "cus_123",
      customer_details: {
        email: " payer@example.com ",
      },
      id: "cs_standard_123",
      metadata: {
        checkoutOffer: "standard",
      },
      subscription: "sub_123",
    } as unknown as Stripe.Checkout.Session;

    await expect(
      applyStripeCheckoutCompleted(
        session,
        {} as never,
        undefined,
        undefined,
        makePreparedStandardCheckoutCompletion({
          stripeCheckoutEmail: "payer@example.com",
          stripeCustomerId: "cus_123",
          stripeSubscriptionId: "sub_123",
        }),
      ),
    ).resolves.toEqual({
      activatedMemberId: null,
      hostedExecutionEventId: null,
      welcomeEmailMemberId: "member_123",
    });

    expect(mocks.acceptHostedMemberStripeCheckoutCompletionTx).toHaveBeenCalledWith(expect.objectContaining({
      checkoutAttemptId: null,
      checkoutIntentHash: null,
      checkoutSessionId: "cs_standard_123",
      currentCheckoutOffer: "standard",
      memberId: "member_123",
      preparedCompletion: expect.objectContaining({
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
      }),
    }));
    expect(
      mocks.upsertPreparedHostedMemberStripeCheckoutEmailIfFreshUnderLockTx,
    ).toHaveBeenCalledWith({
      collectedAt: new Date("2024-05-03T01:46:40.000Z"),
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

  it("does not clean up or welcome an accepted terminal subscription replay", async () => {
    mocks.acceptHostedMemberStripeCheckoutCompletionTx.mockResolvedValueOnce({
      kind: "already_accepted",
    });

    await expect(applyStripeCheckoutCompleted({
      created: 1_714_700_800,
      customer: "cus_123",
      id: "cs_accepted_terminal_replay",
      metadata: { checkoutOffer: "standard" },
      subscription: "sub_123",
    } as unknown as Stripe.Checkout.Session, {} as never, undefined, undefined,
    makePreparedStandardCheckoutCompletion({
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
      subscriptionStatus: "canceled",
    }))).resolves.toEqual({
      activatedMemberId: null,
      activatedMembers: [],
      hostedExecutionEventId: null,
      runtimeRecheckMemberIds: [],
      welcomeEmailMemberId: null,
    });

    expect(mocks.acceptHostedMemberStripeCheckoutCompletionTx)
      .toHaveBeenCalledWith(expect.objectContaining({
        billingIdentityDisposition: "terminal",
      }));
    expect(
      mocks.upsertPreparedHostedMemberStripeCheckoutEmailIfFreshUnderLockTx,
    ).not.toHaveBeenCalled();
  });

  it("keeps an unaccepted terminal Checkout owned by standard cleanup", async () => {
    mocks.acceptHostedMemberStripeCheckoutCompletionTx.mockResolvedValueOnce({
      kind: "cleanup_terminal",
    });

    await expect(applyStripeCheckoutCompleted({
      created: 1_714_700_800,
      customer: "cus_123",
      id: "cs_pending_terminal",
      metadata: {
        checkoutAttemptId: "attempt_pending_terminal",
        checkoutIntentHash: "intent_pending_terminal",
        checkoutOffer: "standard",
      },
      subscription: "sub_pending_terminal",
    } as unknown as Stripe.Checkout.Session, {} as never, undefined, undefined,
    makePreparedStandardCheckoutCompletion({
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_pending_terminal",
      subscriptionStatus: "incomplete_expired",
    }))).resolves.toMatchObject({
      cleanupStandardCheckout: {
        checkoutSessionId: "cs_pending_terminal",
        subscriptionId: "sub_pending_terminal",
      },
      welcomeEmailMemberId: null,
    });

    expect(mocks.acceptHostedMemberStripeCheckoutCompletionTx)
      .toHaveBeenCalledWith(expect.objectContaining({
        billingIdentityDisposition: "terminal",
      }));
  });

  it("clears the durable member attempt when its Checkout Session expires", async () => {
    const session = {
      id: "cs_expired_123",
    } as unknown as Stripe.Checkout.Session;

    await expect(
      applyStripeCheckoutExpired(session, {} as never),
    ).resolves.toBeUndefined();

    expect(mocks.findMemberForStripeCheckoutSession).toHaveBeenCalledWith({
      prisma: {},
      session,
    });
    expect(
      mocks.clearHostedMemberStripeCheckoutAttemptForSessionTx,
    ).toHaveBeenCalledWith({
      memberId: "member_123",
      sessionId: "cs_expired_123",
      tx: {},
    });
  });

  it("routes an expired Family Session to the group attempt owner", async () => {
    const session = {
      id: "cs_test_familyexpired",
      metadata: {
        accountGroupId: "hbag_family",
        checkoutAttemptId: "family_attempt_expired",
        kind: "hosted_family_plan",
        ownerMemberId: "member_owner",
      },
    } as unknown as Stripe.Checkout.Session;
    mocks.applyHostedFamilyStripeCheckoutExpiredTx.mockResolvedValueOnce(true);

    await expect(
      applyStripeCheckoutExpired(session, {} as never),
    ).resolves.toBeUndefined();

    expect(mocks.applyHostedFamilyStripeCheckoutExpiredTx).toHaveBeenCalledWith({
      session,
      tx: {},
    });
    expect(mocks.findMemberForStripeCheckoutSession).not.toHaveBeenCalled();
    expect(
      mocks.clearHostedMemberStripeCheckoutAttemptForSessionTx,
    ).not.toHaveBeenCalled();
  });

  it("preserves the first bound subscription and marks a later completion for cleanup", async () => {
    mocks.acceptHostedMemberStripeCheckoutCompletionTx.mockResolvedValueOnce({
      kind: "cleanup_superseded",
    });

    await expect(
      applyStripeCheckoutCompleted({
        created: 1_714_700_800,
        customer: "cus_123",
        id: "cs_loser_123",
        metadata: {
          checkoutAttemptId: "attempt_loser",
          checkoutIntentHash: "intent_loser",
          checkoutOffer: "standard",
        },
        subscription: "sub_loser_123",
      } as unknown as Stripe.Checkout.Session, {} as never, undefined, undefined,
      makePreparedStandardCheckoutCompletion({
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_loser_123",
      })),
    ).resolves.toMatchObject({
      cleanupStandardCheckout: {
        checkoutSessionId: "cs_loser_123",
        subscriptionId: "sub_loser_123",
      },
      welcomeEmailMemberId: null,
    });

    expect(
      mocks.upsertHostedMemberStripeCheckoutEmailIfFreshTx,
    ).not.toHaveBeenCalled();
  });

  it("marks standard checkout for cleanup when Family billing claimed the member first", async () => {
    mocks.readHostedMemberFamilyBillingClaim.mockResolvedValueOnce({
      checkoutAttemptId: "pending_family_checkout",
      groupId: "hbag_family",
      kind: "checkout_attempt",
      ownerMemberId: "member_owner",
    });

    await expect(
      applyStripeCheckoutCompleted({
        created: 1_714_700_800,
        customer: "cus_123",
        id: "cs_family_loser_123",
        metadata: {
          checkoutOffer: "standard",
        },
        subscription: "sub_family_loser_123",
      } as unknown as Stripe.Checkout.Session, {} as never, undefined, undefined,
      makePreparedStandardCheckoutCompletion({
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_family_loser_123",
      })),
    ).resolves.toMatchObject({
      cleanupFamilySponsoredCheckout: {
        checkoutSessionId: "cs_family_loser_123",
        subscriptionId: "sub_family_loser_123",
      },
      welcomeEmailMemberId: null,
    });

    expect(
      mocks.clearHostedMemberStripeCheckoutAttemptForSessionTx,
    ).not.toHaveBeenCalled();
    expect(
      mocks.acceptHostedMemberStripeCheckoutCompletionTx,
    ).not.toHaveBeenCalled();
  });

  it("preserves an accepted direct Checkout owner across a later Family claim", async () => {
    mocks.readHostedMemberStripeBillingLookupState.mockResolvedValueOnce({
      stripeCustomerLookupKey:
        createHostedStripeCustomerLookupKey("cus_123"),
      stripeSubscriptionLookupKey:
        createHostedStripeSubscriptionLookupKey("sub_123"),
    });
    await expect(
      applyStripeCheckoutCompleted({
        created: 1_714_700_800,
        customer: "cus_123",
        id: "cs_accepted_replay_123",
        metadata: {
          checkoutOffer: "standard",
        },
        subscription: "sub_123",
      } as unknown as Stripe.Checkout.Session, {} as never, undefined, undefined,
      makePreparedStandardCheckoutCompletion({
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
      })),
    ).resolves.toEqual({
      activatedMemberId: null,
      hostedExecutionEventId: null,
      welcomeEmailMemberId: "member_123",
    });

    expect(mocks.readHostedMemberFamilyBillingClaim).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: {},
    });
    expect(
      mocks.acceptHostedMemberStripeCheckoutCompletionTx,
    ).toHaveBeenCalledOnce();
  });

  it("routes Family checkout completion to group billing without member activation", async () => {
    mocks.applyHostedFamilyStripeCheckoutCompletedTx.mockResolvedValueOnce({
      groupId: "hbag_family",
    });

    await expect(
      applyStripeCheckoutCompleted({
        created: 1_714_700_800,
        customer: "cus_family",
        id: "cs_family_123",
        metadata: {
          kind: "hosted_family_plan",
        },
        subscription: "sub_family",
      } as unknown as Stripe.Checkout.Session, {} as never),
    ).resolves.toEqual({
      activatedMemberId: null,
      hostedExecutionEventId: null,
      welcomeEmailMemberId: null,
    });

    expect(mocks.findMemberForStripeCheckoutSession).not.toHaveBeenCalled();
    expect(mocks.writeHostedMemberStripeBillingRefIfFreshTx).not.toHaveBeenCalled();
    expect(mocks.activateHostedMemberForPositiveSourceTx).not.toHaveBeenCalled();
  });

  it("normalizes duplicate invoice.paid Stripe events onto the same activation source id", async () => {
    const invoice = makeStripeInvoice({
      id: "in_paid_123",
      subscription: "sub_123",
    });
    const preparedCryptoDomainRoots = new Map([
      ["control", { domain: "control" }],
    ]) as never;

    await expect(
      applyStripeInvoicePaid(
        invoice,
        {
          eventCreatedAt: new Date("2026-04-23T00:00:00.000Z"),
          occurredAt: "2026-04-23T00:00:00.000Z",
          sourceEventId: "evt_paid_123",
          sourceType: "stripe.invoice.paid",
        },
        {} as never,
        HostedBillingStatus.active,
        undefined,
        preparedCryptoDomainRoots,
      ),
    ).resolves.toEqual({
      activatedMemberId: "member_123",
      hostedExecutionEventId: "wake_123",
      hostedExecutionMailboxItemId: null,
      runtimeRecheckMemberIds: [],
      welcomeEmailMemberId: "member_123",
    });

    await expect(
      applyStripeInvoicePaid(
        invoice,
        {
          eventCreatedAt: new Date("2026-04-23T00:00:05.000Z"),
          occurredAt: "2026-04-23T00:00:05.000Z",
          sourceEventId: "evt_paid_456",
          sourceType: "stripe.invoice.paid",
        },
        {} as never,
        HostedBillingStatus.active,
      ),
    ).resolves.toEqual({
      activatedMemberId: "member_123",
      hostedExecutionEventId: "wake_123",
      hostedExecutionMailboxItemId: null,
      runtimeRecheckMemberIds: [],
      welcomeEmailMemberId: "member_123",
    });

    expect(mocks.activateHostedMemberForPositiveSourceTx).toHaveBeenNthCalledWith(1, {
      dispatchContext: {
        eventCreatedAt: new Date("2026-04-23T00:00:00.000Z"),
        occurredAt: "2026-04-23T00:00:00.000Z",
        sourceEventId: "invoice:in_paid_123",
        sourceType: "stripe.invoice.paid",
      },
      memberId: "member_123",
      preparedCryptoDomainRoots,
      prisma: {},
      skipIfBillingAlreadyActive: false,
      skipIfPreviouslyActivated: true,
    });
    expect(mocks.activateHostedMemberForPositiveSourceTx).toHaveBeenNthCalledWith(2, {
      dispatchContext: {
        eventCreatedAt: new Date("2026-04-23T00:00:05.000Z"),
        occurredAt: "2026-04-23T00:00:05.000Z",
        sourceEventId: "invoice:in_paid_123",
        sourceType: "stripe.invoice.paid",
      },
      memberId: "member_123",
      prisma: {},
      skipIfBillingAlreadyActive: false,
      skipIfPreviouslyActivated: true,
    });
  });

  it("does not activate direct billing from an invoice after Family sponsorship", async () => {
    mocks.readHostedMemberFamilyBillingClaim.mockResolvedValueOnce({
      groupId: "hbag_family",
      kind: "active_sponsorship",
      ownerMemberId: "member_owner",
    });
    const invoice = makeStripeInvoice({
      id: "in_paid_123",
      subscription: "sub_superseded",
    });

    await expect(applyStripeInvoicePaid(
      invoice,
      {
        eventCreatedAt: new Date("2026-04-23T00:00:00.000Z"),
        occurredAt: "2026-04-23T00:00:00.000Z",
        sourceEventId: "evt_paid_123",
        sourceType: "stripe.invoice.paid",
      },
      {} as never,
      HostedBillingStatus.active,
      makeStripeSubscription({
        id: "sub_superseded",
        metadata: {
          billingPlanCode: "launch_monthly",
          checkoutOffer: "standard",
          memberId: "member_123",
        },
        status: "active",
      }),
    )).resolves.toMatchObject({
      cleanupFamilySponsoredStripeSubscriptionId: "sub_superseded",
      welcomeEmailMemberId: null,
    });

    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
    expect(mocks.activateHostedMemberForPositiveSourceTx).not.toHaveBeenCalled();
  });

  it.each(["canceled", "incomplete_expired"] as const)(
    "still requests Family refund cleanup for a paid invoice after the direct subscription is %s",
    async (status) => {
      mocks.readHostedMemberFamilyBillingClaim.mockResolvedValueOnce({
        groupId: "hbag_family",
        kind: "active_sponsorship",
        ownerMemberId: "member_owner",
      });
      const invoice = makeStripeInvoice({
        id: "in_paid_after_cleanup",
        subscription: "sub_superseded",
      });

      await expect(applyStripeInvoicePaid(
        invoice,
        {
          eventCreatedAt: new Date("2026-04-23T00:00:05.000Z"),
          occurredAt: "2026-04-23T00:00:05.000Z",
          sourceEventId: "evt_paid_after_cleanup",
          sourceType: "stripe.invoice.paid",
        },
        {} as never,
        HostedBillingStatus.canceled,
        makeStripeSubscription({
          id: "sub_superseded",
          metadata: {
            billingPlanCode: "launch_monthly",
            checkoutOffer: "standard",
            memberId: "member_123",
          },
          status,
        }),
      )).resolves.toMatchObject({
        cleanupFamilySponsoredStripeSubscriptionId: "sub_superseded",
        welcomeEmailMemberId: null,
      });

      expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
      expect(mocks.activateHostedMemberForPositiveSourceTx).not.toHaveBeenCalled();
    },
  );

  it("terminalizes an incomplete-expired direct subscription after Family sponsorship", async () => {
    const member = makeMemberSnapshot({
      billingRef: {
        memberId: "member_123",
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
      },
    });
    mocks.findMemberForStripeSubscription.mockResolvedValueOnce(member);
    mocks.readHostedMemberFamilyBillingClaim.mockResolvedValueOnce({
      groupId: "hbag_family",
      kind: "active_sponsorship",
      ownerMemberId: "member_owner",
    });
    mocks.prepareHostedMemberStripeBillingWrite.mockResolvedValueOnce({
      canonicalBillingStatus: HostedBillingStatus.canceled,
      member,
    });

    await expect(applyStripeSubscriptionUpdated(
      makeStripeSubscription({ status: "incomplete_expired" }),
      {
        eventCreatedAt: new Date("2026-04-23T00:00:00.000Z"),
        occurredAt: "2026-04-23T00:00:00.000Z",
        sourceEventId: "evt_expired_after_family",
        sourceType: "stripe.customer.subscription.updated",
      },
      {} as never,
    )).resolves.toMatchObject({ subscriptionCancellationEmail: null });

    expect(mocks.prepareHostedMemberStripeBillingWrite).toHaveBeenCalledWith({
      canonicalBillingStatus: HostedBillingStatus.canceled,
      dispatchContext: expect.anything(),
      member,
    });
    expect(mocks.writeHostedMemberStripeBillingTx).toHaveBeenCalledOnce();
  });

  it("does not let a terminal Family cleanup replay touch a replacement subscription", async () => {
    mocks.findMemberForStripeSubscription.mockResolvedValueOnce(
      makeMemberSnapshot({
        billingRef: {
          memberId: "member_123",
          stripeCustomerId: "cus_123",
          stripeSubscriptionId: "sub_replacement",
        },
      }),
    );
    mocks.readHostedMemberFamilyBillingClaim.mockResolvedValueOnce({
      groupId: "hbag_family",
      kind: "active_sponsorship",
      ownerMemberId: "member_owner",
    });

    await expect(applyStripeSubscriptionUpdated(
      makeStripeSubscription({
        id: "sub_loser",
        status: "canceled",
      }),
      {
        eventCreatedAt: new Date("2026-04-23T00:00:00.000Z"),
        occurredAt: "2026-04-23T00:00:00.000Z",
        sourceEventId: "evt_loser_terminal_replay",
        sourceType: "stripe.customer.subscription.deleted",
      },
      {} as never,
    )).resolves.toMatchObject({ subscriptionCancellationEmail: null });

    expect(mocks.prepareHostedMemberStripeBillingWrite).not.toHaveBeenCalled();
    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
  });

  it("preserves current direct invoice authority across a later Family claim", async () => {
    mocks.readHostedMemberStripeBillingLookupState.mockResolvedValueOnce({
      stripeCustomerLookupKey:
        createHostedStripeCustomerLookupKey("cus_123"),
      stripeSubscriptionLookupKey:
        createHostedStripeSubscriptionLookupKey("sub_123"),
    });
    await expect(applyStripeInvoicePaid(
      makeStripeInvoice({
        id: "in_current_123",
        subscription: "sub_123",
      }),
      {
        eventCreatedAt: new Date("2026-04-23T00:00:00.000Z"),
        occurredAt: "2026-04-23T00:00:00.000Z",
        sourceEventId: "evt_current_paid_123",
        sourceType: "stripe.invoice.paid",
      },
      {} as never,
      HostedBillingStatus.active,
      makeStripeSubscription({ id: "sub_123" }),
    )).resolves.toEqual(expect.objectContaining({
      welcomeEmailMemberId: expect.anything(),
    }));

    expect(mocks.readHostedMemberFamilyBillingClaim).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: {},
    });
    expect(mocks.writeHostedMemberStripeBillingTx).toHaveBeenCalledOnce();
  });

  it("marks invoice.paid billing writes as positive entitlement freshness", async () => {
    await expect(
      applyStripeInvoicePaid(
        makeStripeInvoice({
          id: "in_paid_freshness",
          subscription: "sub_123",
        }),
        {
          eventCreatedAt: new Date("2026-04-25T05:13:09.000Z"),
          occurredAt: "2026-04-25T05:13:09.000Z",
          sourceEventId: "evt_paid_freshness",
          sourceType: "stripe.invoice.paid",
        },
        {} as never,
        HostedBillingStatus.active,
      ),
    ).resolves.toEqual({
      activatedMemberId: "member_123",
      hostedExecutionEventId: "wake_123",
      hostedExecutionMailboxItemId: null,
      runtimeRecheckMemberIds: [],
      welcomeEmailMemberId: "member_123",
    });

    expect(mocks.writeHostedMemberStripeBillingTx).toHaveBeenCalledWith(expect.objectContaining({
      billingStatus: HostedBillingStatus.active,
      canonicalBillingStatus: HostedBillingStatus.active,
      freshnessPolicy: "positive-invoice-entitlement",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
    }));
  });

  it("does not report activation for later paid invoices when the member is already active", async () => {
    const activeMember = makeMemberSnapshot({
      billingStatus: HostedBillingStatus.active,
    });
    mocks.findMemberForStripeInvoice.mockResolvedValueOnce(activeMember);
    mocks.prepareHostedMemberStripeBillingWrite.mockResolvedValueOnce({
      canonicalBillingStatus: HostedBillingStatus.active,
      member: activeMember,
    });
    mocks.writeHostedMemberStripeBillingTx.mockResolvedValueOnce(activeMember);
    mocks.activateHostedMemberForPositiveSourceTx.mockResolvedValueOnce({
      activated: false,
      hostedExecutionEventId: null,
      memberId: activeMember.core.id,
    });

    await expect(
      applyStripeInvoicePaid(
        makeStripeInvoice({
          id: "in_paid_renewal",
          subscription: "sub_123",
        }),
        {
          eventCreatedAt: new Date("2026-04-25T05:13:09.000Z"),
          occurredAt: "2026-04-25T05:13:09.000Z",
          sourceEventId: "evt_paid_renewal",
          sourceType: "stripe.invoice.paid",
        },
        {} as never,
        HostedBillingStatus.active,
      ),
    ).resolves.toEqual({
      activatedMemberId: null,
      hostedExecutionEventId: null,
      hostedExecutionMailboxItemId: null,
      runtimeRecheckMemberIds: [],
      welcomeEmailMemberId: null,
    });

    expect(mocks.activateHostedMemberForPositiveSourceTx).toHaveBeenCalledWith({
      dispatchContext: {
        eventCreatedAt: new Date("2026-04-25T05:13:09.000Z"),
        occurredAt: "2026-04-25T05:13:09.000Z",
        sourceEventId: "invoice:in_paid_renewal",
        sourceType: "stripe.invoice.paid",
      },
      memberId: "member_123",
      prisma: {},
      skipIfBillingAlreadyActive: true,
      skipIfPreviouslyActivated: true,
    });
  });

  it("does not report activation for payment recovery after prior activation", async () => {
    const recoveringMember = makeMemberSnapshot({
      billingStatus: HostedBillingStatus.past_due,
    });
    const updatedMember = makeMemberSnapshot({
      billingStatus: HostedBillingStatus.active,
    });
    mocks.findMemberForStripeInvoice.mockResolvedValueOnce(recoveringMember);
    mocks.prepareHostedMemberStripeBillingWrite.mockResolvedValueOnce({
      canonicalBillingStatus: HostedBillingStatus.active,
      member: recoveringMember,
    });
    mocks.writeHostedMemberStripeBillingTx.mockResolvedValueOnce(updatedMember);
    mocks.activateHostedMemberForPositiveSourceTx.mockResolvedValueOnce({
      activated: false,
      hostedExecutionEventId: null,
      memberId: updatedMember.core.id,
    });

    await expect(
      applyStripeInvoicePaid(
        makeStripeInvoice({
          id: "in_paid_recovery",
          subscription: "sub_123",
        }),
        {
          eventCreatedAt: new Date("2026-04-26T05:13:09.000Z"),
          occurredAt: "2026-04-26T05:13:09.000Z",
          sourceEventId: "evt_paid_recovery",
          sourceType: "stripe.invoice.paid",
        },
        {} as never,
        HostedBillingStatus.active,
      ),
    ).resolves.toEqual({
      activatedMemberId: null,
      hostedExecutionEventId: null,
      hostedExecutionMailboxItemId: null,
      runtimeRecheckMemberIds: [],
      welcomeEmailMemberId: null,
    });

    expect(mocks.activateHostedMemberForPositiveSourceTx).toHaveBeenCalledWith({
      dispatchContext: {
        eventCreatedAt: new Date("2026-04-26T05:13:09.000Z"),
        occurredAt: "2026-04-26T05:13:09.000Z",
        sourceEventId: "invoice:in_paid_recovery",
        sourceType: "stripe.invoice.paid",
      },
      memberId: "member_123",
      prisma: {},
      skipIfBillingAlreadyActive: false,
      skipIfPreviouslyActivated: true,
    });
  });

  it("returns the exact direct activation target when invoice replay finds a durable wake", async () => {
    const updatedMember = makeMemberSnapshot({
      billingStatus: HostedBillingStatus.active,
    });
    mocks.writeHostedMemberStripeBillingTx.mockResolvedValueOnce(updatedMember);
    mocks.activateHostedMemberForPositiveSourceTx.mockResolvedValueOnce({
      activated: false,
      hostedExecutionEventId: "wake_existing",
      hostedExecutionMailboxItemId: "mailbox_wake_existing",
      memberId: updatedMember.core.id,
    });

    await expect(
      applyStripeInvoicePaid(
        makeStripeInvoice({
          id: "in_paid_retry",
          subscription: "sub_123",
        }),
        {
          eventCreatedAt: new Date("2026-04-26T05:13:09.000Z"),
          occurredAt: "2026-04-26T05:13:09.000Z",
          sourceEventId: "evt_paid_retry",
          sourceType: "stripe.invoice.paid",
        },
        {} as never,
        HostedBillingStatus.active,
      ),
    ).resolves.toEqual({
      activatedMemberId: "member_123",
      hostedExecutionEventId: "wake_existing",
      hostedExecutionMailboxItemId: "mailbox_wake_existing",
      runtimeRecheckMemberIds: [],
      welcomeEmailMemberId: "member_123",
    });
  });

  it("stores the Stripe invoice customer email as an unverified checkout email hint", async () => {
    await expect(
      applyStripeInvoicePaid(
        makeStripeInvoice({
          customerEmail: " payer@example.com ",
          id: "in_paid_email",
          subscription: "sub_123",
        }),
        {
          eventCreatedAt: new Date("2026-04-25T05:13:09.000Z"),
          occurredAt: "2026-04-25T05:13:09.000Z",
          sourceEventId: "evt_paid_email",
          sourceType: "stripe.invoice.paid",
        },
        {} as never,
        HostedBillingStatus.active,
      ),
    ).resolves.toEqual({
      activatedMemberId: "member_123",
      hostedExecutionEventId: "wake_123",
      hostedExecutionMailboxItemId: null,
      runtimeRecheckMemberIds: [],
      welcomeEmailMemberId: "member_123",
    });

    expect(mocks.upsertHostedMemberStripeCheckoutEmailIfFreshTx).toHaveBeenCalledWith({
      address: "payer@example.com",
      collectedAt: new Date("2026-04-25T05:13:09.000Z"),
      memberId: "member_123",
      prisma: {},
    });
  });

  it("skips invoice.paid activation side effects when the billing write is not applied", async () => {
    mocks.writeHostedMemberStripeBillingTx.mockResolvedValueOnce(null);

    await expect(
      applyStripeInvoicePaid(
        makeStripeInvoice({
          customerEmail: "stale-payer@example.com",
          id: "in_paid_stale",
          subscription: "sub_123",
        }),
        {
          eventCreatedAt: new Date("2026-04-23T00:00:00.000Z"),
          occurredAt: "2026-04-23T00:00:00.000Z",
          sourceEventId: "evt_paid_stale",
          sourceType: "stripe.invoice.paid",
        },
        {} as never,
        HostedBillingStatus.active,
      ),
    ).resolves.toEqual({
      activatedMemberId: null,
      activatedMembers: [],
      hostedExecutionEventId: null,
      runtimeRecheckMemberIds: [],
      welcomeEmailMemberId: null,
    });

    expect(mocks.activateHostedMemberForPositiveSourceTx).not.toHaveBeenCalled();
    expect(mocks.upsertHostedMemberStripeCheckoutEmailIfFreshTx).not.toHaveBeenCalled();
  });

  it("infers subscription plan code from the configured base price", async () => {
    vi.stubEnv("HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_MONTHLY", "price_pulse_base");
    vi.stubEnv("HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_EDGE_MONTHLY", "price_edge_base");

    await applyStripeSubscriptionUpdated(
      makeStripeSubscription({
        items: ["price_edge_base"],
      }),
      {
        eventCreatedAt: new Date("2026-04-23T00:00:00.000Z"),
        occurredAt: "2026-04-23T00:00:00.000Z",
        sourceEventId: "evt_sub_updated",
        sourceType: "stripe.customer.subscription.updated",
      },
      {} as never,
    );

    expect(mocks.writeHostedMemberStripeBillingTx).toHaveBeenCalledWith(
      expect.objectContaining({
        currentBillingPlanCode: "launch_edge_monthly",
      }),
    );
  });

  it("routes Family subscription updates to group billing without member billing writes", async () => {
    mocks.applyHostedFamilyStripeSubscriptionUpdatedTx.mockResolvedValueOnce({
      activations: [],
      groupId: "hbag_family",
      runtimeRecheckMemberIds: ["member_owner"],
    });
    const tx = {};
    const preparedFamilyCryptoDomainRoots = new Map([
      ["member_owner", new Map()],
    ]);
    const subscription = makeStripeSubscription({
      metadata: {
        accountGroupId: "hbag_family",
        kind: "hosted_family_plan",
      },
    });

    await applyStripeSubscriptionUpdated(
      subscription,
      {
        eventCreatedAt: new Date("2026-04-23T00:00:00.000Z"),
        occurredAt: "2026-04-23T00:00:00.000Z",
        sourceEventId: "evt_family_sub_updated",
        sourceType: "stripe.customer.subscription.updated",
      },
      tx as never,
      preparedFamilyCryptoDomainRoots,
    );

    expect(mocks.applyHostedFamilyStripeSubscriptionUpdatedTx).toHaveBeenCalledWith(
      expect.objectContaining({
        preparedCryptoDomainRootsByMember: preparedFamilyCryptoDomainRoots,
        subscription,
        tx,
      }),
    );
    expect(mocks.reconcileHostedAiUsageGateForBillingModeChangeTx).toHaveBeenCalledWith({
      memberId: "member_owner",
      now: new Date("2026-04-23T00:00:00.000Z"),
      tx,
    });
    expect(mocks.findMemberForStripeSubscription).not.toHaveBeenCalled();
    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
    expect(mocks.activateHostedMemberForPositiveSourceTx).not.toHaveBeenCalled();
  });

  it("returns exact Family activation targets when subscription replay finds durable wakes", async () => {
    mocks.applyHostedFamilyStripeSubscriptionUpdatedTx.mockResolvedValueOnce({
      activations: [{
        activated: false,
        hostedExecutionEventId: "wake_family_existing",
        hostedExecutionMailboxItemId: "mailbox_family_existing",
        memberId: "member_owner",
      }],
      groupId: "hbag_family",
      runtimeRecheckMemberIds: [],
    });

    await expect(applyStripeSubscriptionUpdated(
      makeStripeSubscription({
        metadata: {
          accountGroupId: "hbag_family",
          kind: "hosted_family_plan",
        },
      }),
      {
        eventCreatedAt: new Date("2026-04-23T00:00:00.000Z"),
        occurredAt: "2026-04-23T00:00:00.000Z",
        sourceEventId: "evt_family_sub_replay",
        sourceType: "stripe.customer.subscription.updated",
      },
      {} as never,
    )).resolves.toEqual({
      activatedMemberId: "member_owner",
      activatedMembers: [{
        activatedMemberId: "member_owner",
        hostedExecutionEventId: "wake_family_existing",
        hostedExecutionMailboxItemId: "mailbox_family_existing",
      }],
      hostedExecutionEventId: "wake_family_existing",
      runtimeRecheckMemberIds: [],
      subscriptionCancellationEmail: null,
      welcomeEmailMemberId: null,
    });
  });

  it("reconciles a direct-to-Family usage handoff from invoice.paid", async () => {
    mocks.applyHostedFamilyStripeSubscriptionUpdatedTx.mockResolvedValueOnce({
      activations: [],
      groupId: "hbag_family",
      runtimeRecheckMemberIds: ["member_owner"],
    });
    const tx = {};
    const preparedFamilyCryptoDomainRoots = new Map([
      ["member_owner", new Map()],
    ]);
    const subscription = makeStripeSubscription({
      id: "sub_family",
      metadata: {
        accountGroupId: "hbag_family",
        kind: "hosted_family_plan",
      },
    });

    await applyStripeInvoicePaid(
      makeStripeInvoice({ subscription: subscription.id }),
      {
        eventCreatedAt: new Date("2026-04-23T00:00:00.000Z"),
        occurredAt: "2026-04-23T00:00:00.000Z",
        sourceEventId: "evt_family_invoice_paid",
        sourceType: "stripe.invoice.paid",
      },
      tx as never,
      HostedBillingStatus.active,
      subscription,
      undefined,
      preparedFamilyCryptoDomainRoots,
    );

    expect(mocks.applyHostedFamilyStripeSubscriptionUpdatedTx).toHaveBeenCalledWith(
      expect.objectContaining({
        preparedCryptoDomainRootsByMember: preparedFamilyCryptoDomainRoots,
        subscription,
        tx,
      }),
    );
    expect(mocks.reconcileHostedAiUsageGateForBillingModeChangeTx).toHaveBeenCalledWith({
      memberId: "member_owner",
      now: new Date("2026-04-23T00:00:00.000Z"),
      tx,
    });
    expect(mocks.findMemberForStripeInvoice).not.toHaveBeenCalled();
    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
  });

  it("reconciles a direct-to-Family usage handoff from invoice.payment_failed", async () => {
    mocks.applyHostedFamilyStripeSubscriptionUpdatedTx.mockResolvedValueOnce({
      activations: [],
      groupId: "hbag_family",
      runtimeRecheckMemberIds: ["member_owner"],
    });
    const tx = {};
    const preparedFamilyCryptoDomainRoots = new Map([
      ["member_owner", new Map()],
    ]);
    const subscription = makeStripeSubscription({
      id: "sub_family",
      metadata: {
        accountGroupId: "hbag_family",
        kind: "hosted_family_plan",
      },
    });

    await applyStripeInvoicePaymentFailed(
      makeStripeInvoice({ subscription: subscription.id }),
      {
        eventCreatedAt: new Date("2026-04-23T00:00:00.000Z"),
        occurredAt: "2026-04-23T00:00:00.000Z",
        sourceEventId: "evt_family_invoice_failed",
        sourceType: "stripe.invoice.payment_failed",
      },
      tx as never,
      HostedBillingStatus.active,
      subscription,
      preparedFamilyCryptoDomainRoots,
    );

    expect(mocks.applyHostedFamilyStripeSubscriptionUpdatedTx).toHaveBeenCalledWith(
      expect.objectContaining({
        preparedCryptoDomainRootsByMember: preparedFamilyCryptoDomainRoots,
        subscription,
        tx,
      }),
    );
    expect(mocks.reconcileHostedAiUsageGateForBillingModeChangeTx).toHaveBeenCalledWith({
      memberId: "member_owner",
      now: new Date("2026-04-23T00:00:00.000Z"),
      tx,
    });
    expect(mocks.findMemberForStripeInvoice).not.toHaveBeenCalled();
    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
  });

  it("prefers configured Pulse prices over stale Edge subscription metadata", async () => {
    vi.stubEnv("HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_MONTHLY", "price_pulse_base");
    vi.stubEnv("HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_EDGE_MONTHLY", "price_edge_base");

    await applyStripeSubscriptionUpdated(
      makeStripeSubscription({
        items: ["price_pulse_base"],
        metadata: {
          billingPlanCode: "launch_edge_monthly",
        },
      }),
      {
        eventCreatedAt: new Date("2026-05-06T12:00:00.000Z"),
        occurredAt: "2026-05-06T12:00:00.000Z",
        sourceEventId: "evt_sub_updated_pulse_prices",
        sourceType: "stripe.customer.subscription.updated",
      },
      {} as never,
    );

    expect(mocks.writeHostedMemberStripeBillingTx).toHaveBeenCalledWith(
      expect.objectContaining({
        currentBillingPlanCode: "launch_monthly",
      }),
    );
  });

  it("returns a cancellation email candidate when a subscription write newly cancels access", async () => {
    const activeMember = makeMemberSnapshot({
      billingStatus: HostedBillingStatus.active,
    });
    const canceledMember = makeMemberSnapshot({
      billingStatus: HostedBillingStatus.canceled,
    });
    mocks.findMemberForStripeSubscription.mockResolvedValueOnce(activeMember);
    mocks.prepareHostedMemberStripeBillingWrite.mockResolvedValueOnce({
      canonicalBillingStatus: HostedBillingStatus.canceled,
      member: activeMember,
    });
    mocks.writeHostedMemberStripeBillingTx.mockResolvedValueOnce(canceledMember);

    await expect(applyStripeSubscriptionUpdated(
      makeStripeSubscription({
        status: "canceled",
      }),
      {
        eventCreatedAt: new Date("2026-06-21T12:00:00.000Z"),
        occurredAt: "2026-06-21T12:00:00.000Z",
        sourceEventId: "evt_sub_deleted",
        sourceType: "stripe.customer.subscription.deleted",
      },
      {} as never,
    )).resolves.toEqual({
      activatedMemberId: null,
      activatedMembers: [],
      hostedExecutionEventId: null,
      runtimeRecheckMemberIds: [],
      subscriptionCancellationEmail: {
        memberId: "member_123",
        stripeSubscriptionId: "sub_123",
      },
      welcomeEmailMemberId: null,
    });

    expect(mocks.prepareHostedMemberStripeBillingWrite).toHaveBeenCalledWith({
      canonicalBillingStatus: HostedBillingStatus.canceled,
      dispatchContext: expect.objectContaining({
        sourceType: "stripe.customer.subscription.deleted",
      }),
      member: activeMember,
    });
  });

  it("returns a cancellation email candidate on repeated canceled writes so Resend owns retry idempotency", async () => {
    const canceledMember = makeMemberSnapshot({
      billingStatus: HostedBillingStatus.canceled,
    });
    mocks.findMemberForStripeSubscription.mockResolvedValueOnce(canceledMember);
    mocks.prepareHostedMemberStripeBillingWrite.mockResolvedValueOnce({
      canonicalBillingStatus: HostedBillingStatus.canceled,
      member: canceledMember,
    });
    mocks.writeHostedMemberStripeBillingTx.mockResolvedValueOnce(canceledMember);

    await expect(applyStripeSubscriptionUpdated(
      makeStripeSubscription({
        status: "canceled",
      }),
      {
        eventCreatedAt: new Date("2026-06-21T12:00:00.000Z"),
        occurredAt: "2026-06-21T12:00:00.000Z",
        sourceEventId: "evt_sub_deleted_repeat",
        sourceType: "stripe.customer.subscription.deleted",
      },
      {} as never,
    )).resolves.toEqual({
      activatedMemberId: null,
      activatedMembers: [],
      hostedExecutionEventId: null,
      runtimeRecheckMemberIds: [],
      subscriptionCancellationEmail: {
        memberId: "member_123",
        stripeSubscriptionId: "sub_123",
      },
      welcomeEmailMemberId: null,
    });

    mocks.findMemberForStripeSubscription.mockResolvedValueOnce(makeMemberSnapshot({
      billingStatus: HostedBillingStatus.active,
    }));
    mocks.prepareHostedMemberStripeBillingWrite.mockResolvedValueOnce({
      canonicalBillingStatus: HostedBillingStatus.canceled,
      member: makeMemberSnapshot({
        billingStatus: HostedBillingStatus.active,
      }),
    });
    mocks.writeHostedMemberStripeBillingTx.mockResolvedValueOnce(null);

    await expect(applyStripeSubscriptionUpdated(
      makeStripeSubscription({
        status: "canceled",
      }),
      {
        eventCreatedAt: new Date("2026-06-21T12:05:00.000Z"),
        occurredAt: "2026-06-21T12:05:00.000Z",
        sourceEventId: "evt_sub_deleted_stale",
        sourceType: "stripe.customer.subscription.deleted",
      },
      {} as never,
    )).resolves.toEqual({
      activatedMemberId: null,
      activatedMembers: [],
      hostedExecutionEventId: null,
      runtimeRecheckMemberIds: [],
      subscriptionCancellationEmail: null,
      welcomeEmailMemberId: null,
    });

    mocks.findMemberForStripeSubscription.mockResolvedValueOnce(canceledMember);
    mocks.prepareHostedMemberStripeBillingWrite.mockResolvedValueOnce({
      canonicalBillingStatus: HostedBillingStatus.canceled,
      member: canceledMember,
    });
    mocks.writeHostedMemberStripeBillingTx.mockResolvedValueOnce(canceledMember);

    await expect(applyStripeSubscriptionUpdated(
      makeStripeSubscription({
        status: "canceled",
      }),
      {
        eventCreatedAt: new Date("2026-06-22T12:05:00.000Z"),
        occurredAt: "2026-06-22T12:05:00.000Z",
        sourceEventId: "evt_sub_updated_after_cancel",
        sourceType: "stripe.customer.subscription.updated",
      },
      {} as never,
    )).resolves.toEqual({
      activatedMemberId: null,
      activatedMembers: [],
      hostedExecutionEventId: null,
      runtimeRecheckMemberIds: [],
      subscriptionCancellationEmail: null,
      welcomeEmailMemberId: null,
    });
  });

  it("stores subscription periods from subscription items when Stripe omits root period fields", async () => {
    await applyStripeSubscriptionUpdated(
      makeStripeSubscription({
        currentPeriodEnd: null,
        currentPeriodStart: null,
        itemCurrentPeriodEnd: 1_747_612_800,
        itemCurrentPeriodStart: 1_745_020_800,
        items: ["price_pulse_base"],
      }),
      {
        eventCreatedAt: new Date("2026-04-23T00:00:00.000Z"),
        occurredAt: "2026-04-23T00:00:00.000Z",
        sourceEventId: "evt_sub_updated_item_period",
        sourceType: "stripe.customer.subscription.updated",
      },
      {} as never,
    );

    expect(mocks.writeHostedMemberStripeBillingTx).toHaveBeenCalledWith(
      expect.objectContaining({
        currentPeriodEnd: new Date("2025-05-19T00:00:00.000Z"),
        currentPeriodStart: new Date("2025-04-19T00:00:00.000Z"),
      }),
    );
  });

  it("keeps subscription.active trial updates in trial phase until the paid conversion invoice arrives", async () => {
    mocks.findMemberForStripeSubscription.mockResolvedValueOnce(makeMemberSnapshot({
      billingRef: {
        currentBillingPhase: "trial",
        currentBillingPlanCode: "launch_monthly",
        currentCheckoutOffer: "pulse_trial_7d",
        memberId: "member_123",
        pulseTrialRedeemedAt: new Date("2026-04-12T00:00:00.000Z"),
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
      },
    }));

    await applyStripeSubscriptionUpdated(
      makeStripeSubscription({
        currentPeriodEnd: 1_745_020_800,
        currentPeriodStart: 1_744_416_000,
        metadata: {
          checkoutOffer: "pulse_trial_7d",
        },
        status: "active",
        trialEnd: 1_745_020_800,
        trialStart: 1_744_416_000,
      }),
      {
        eventCreatedAt: new Date("2026-04-19T00:00:00.000Z"),
        occurredAt: "2026-04-19T00:00:00.000Z",
        sourceEventId: "evt_trial_sub_active",
        sourceType: "stripe.customer.subscription.updated",
      },
      {} as never,
    );

    expect(mocks.writeHostedMemberStripeBillingTx).toHaveBeenCalledWith(
      expect.objectContaining({
        currentBillingPhase: "trial",
        currentCheckoutOffer: "pulse_trial_7d",
      }),
    );
  });

  it("converts a canonical legacy trial_will_end event to Starter without resetting recorded usage", async () => {
    vi.stubEnv(
      "HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_MONTHLY",
      "price_pulse_base",
    );
    const trialStartedAt = new Date("2025-04-12T00:00:00.000Z");
    mocks.findMemberForStripeSubscription.mockResolvedValueOnce(makeMemberSnapshot({
      billingRef: {
        currentBillingPhase: "trial",
        currentBillingPlanCode: "launch_monthly",
        currentCheckoutOffer: "pulse_trial_7d",
        currentTrialStartedAt: trialStartedAt,
        memberId: "member_123",
        pulseTrialRedeemedAt: trialStartedAt,
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
      },
    }));
    mocks.readHostedLegacyTrialConsumedUsageUsdMicrosTx.mockResolvedValueOnce(
      1_250_000n,
    );
    mocks.activateHostedMemberForPositiveSourceTx.mockResolvedValueOnce({
      activated: false,
      hostedExecutionEventId: "wake_trial_conversion_existing",
      hostedExecutionMailboxItemId: "mailbox_trial_conversion_existing",
      memberId: "member_123",
    });

    await expect(applyStripeSubscriptionUpdated(
      makeExactLegacyPulseTrialSubscription({ status: "trialing" }),
      {
        eventCreatedAt: new Date("2026-04-18T00:00:00.000Z"),
        occurredAt: "2026-04-18T00:00:00.000Z",
        sourceEventId: "evt_exact_trial_will_end",
        sourceType: "stripe.customer.subscription.trial_will_end",
      },
      {} as never,
    )).resolves.toMatchObject({
      activatedMemberId: "member_123",
      cleanupPulseTrialStripeSubscriptionId: "sub_123",
      hostedExecutionEventId: "wake_trial_conversion_existing",
      hostedExecutionMailboxItemId: "mailbox_trial_conversion_existing",
      runtimeRecheckMemberIds: ["member_123"],
      subscriptionCancellationEmail: null,
    });

    expect(
      mocks.readHostedLegacyTrialConsumedUsageUsdMicrosTx,
    ).toHaveBeenCalledWith({
      memberId: "member_123",
      trialStartedAt,
      tx: {},
    });
    expect(mocks.ensureHostedStarterUsageGrantTx).toHaveBeenCalledWith({
      effectiveAt: trialStartedAt,
      initialConsumedUsdMicros: 1_250_000n,
      memberId: "member_123",
      source: "legacy_trial_migration",
      tx: {},
    });
    expect(
      mocks.clearHostedMemberLegacyTrialBillingUnderLockTx,
    ).toHaveBeenCalledWith({ memberId: "member_123", tx: {} });
    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
  });

  it("ignores an unknown trial_will_end subscription without mutating billing", async () => {
    vi.stubEnv(
      "HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_MONTHLY",
      "price_pulse_base",
    );

    await expect(
      applyStripeSubscriptionUpdated(
        makeStripeSubscription({
          items: ["price_pulse_base"],
          metadata: {
            checkoutOffer: "pulse_trial_7d",
            memberId: "member_123",
            trialPolicyVersion: "unknown-policy",
          },
          status: "trialing",
        }),
        {
          eventCreatedAt: new Date("2026-04-18T00:00:00.000Z"),
          occurredAt: "2026-04-18T00:00:00.000Z",
          sourceEventId: "evt_unknown_trial_will_end",
          sourceType: "stripe.customer.subscription.trial_will_end",
        },
        {} as never,
      ),
    ).resolves.toEqual({
      activatedMemberId: null,
      activatedMembers: [],
      hostedExecutionEventId: null,
      runtimeRecheckMemberIds: [],
      subscriptionCancellationEmail: null,
      welcomeEmailMemberId: null,
    });

    expect(mocks.prepareHostedMemberStripeBillingWrite).not.toHaveBeenCalled();
    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
  });

  it("keeps an exact active legacy trial identity non-paid until invoice confirmation", async () => {
    vi.stubEnv(
      "HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_MONTHLY",
      "price_pulse_base",
    );
    mocks.findMemberForStripeSubscription.mockResolvedValueOnce(makeMemberSnapshot({
      billingRef: {
        currentBillingPhase: null,
        currentBillingPlanCode: "launch_monthly",
        currentCheckoutOffer: "pulse_trial_7d",
        memberId: "member_123",
        pulseTrialRedeemedAt: new Date("2026-04-12T00:00:00.000Z"),
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
      },
    }));

    await applyStripeSubscriptionUpdated(
      makeExactLegacyPulseTrialSubscription({ status: "active" }),
      {
        eventCreatedAt: new Date("2026-04-19T00:00:00.000Z"),
        occurredAt: "2026-04-19T00:00:00.000Z",
        sourceEventId: "evt_exact_trial_active",
        sourceType: "stripe.customer.subscription.updated",
      },
      {} as never,
    );

    expect(mocks.writeHostedMemberStripeBillingTx).toHaveBeenCalledWith(
      expect.objectContaining({
        currentBillingPhase: "trial",
        currentCheckoutOffer: "pulse_trial_7d",
        stripeSubscriptionId: "sub_123",
      }),
    );
  });

  it("lets an invoice-proven legacy subscription cancellation clear paid access", async () => {
    vi.stubEnv(
      "HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_MONTHLY",
      "price_pulse_base",
    );
    const paidMember = makeMemberSnapshot({
      billingRef: {
        currentBillingPhase: "paid",
        currentBillingPlanCode: "launch_monthly",
        currentCheckoutOffer: "pulse_trial_7d",
        memberId: "member_123",
        pulseTrialRedeemedAt: new Date("2026-04-12T00:00:00.000Z"),
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
      },
    });
    mocks.findMemberForStripeSubscription.mockResolvedValueOnce(paidMember);
    mocks.prepareHostedMemberStripeBillingWrite.mockResolvedValueOnce({
      canonicalBillingStatus: HostedBillingStatus.canceled,
      member: paidMember,
    });

    await applyStripeSubscriptionUpdated(
      makeExactLegacyPulseTrialSubscription({ status: "canceled" }),
      {
        eventCreatedAt: new Date("2026-05-19T00:00:00.000Z"),
        occurredAt: "2026-05-19T00:00:00.000Z",
        sourceEventId: "evt_exact_trial_canceled_after_paid",
        sourceType: "stripe.customer.subscription.deleted",
      },
      {} as never,
    );

    expect(mocks.writeHostedMemberStripeBillingTx).toHaveBeenCalledWith(
      expect.objectContaining({
        canonicalBillingStatus: HostedBillingStatus.canceled,
        currentBillingPhase: null,
        currentCheckoutOffer: "pulse_trial_7d",
        stripeSubscriptionId: "sub_123",
      }),
    );
  });

  it("uses the reset trial-start metadata override on Pulse Trial subscription updates", async () => {
    mocks.findMemberForStripeSubscription.mockResolvedValueOnce(makeMemberSnapshot({
      billingRef: {
        currentBillingPhase: "trial",
        currentBillingPlanCode: "launch_monthly",
        currentCheckoutOffer: "pulse_trial_7d",
        memberId: "member_123",
        pulseTrialRedeemedAt: new Date("2026-06-30T12:00:00.000Z"),
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
      },
    }));

    await applyStripeSubscriptionUpdated(
      makeStripeSubscription({
        currentPeriodEnd: 1_783_684_800,
        currentPeriodStart: 1_744_416_000,
        metadata: {
          checkoutOffer: "pulse_trial_7d",
          trialStartedAtOverride: "2026-06-30T12:00:00.000Z",
        },
        status: "trialing",
        trialEnd: 1_783_684_800,
        trialStart: 1_744_416_000,
      }),
      {
        eventCreatedAt: new Date("2026-06-30T12:00:00.000Z"),
        occurredAt: "2026-06-30T12:00:00.000Z",
        sourceEventId: "evt_trial_reset",
        sourceType: "stripe.customer.subscription.updated",
      },
      {} as never,
    );

    expect(mocks.writeHostedMemberStripeBillingTx).toHaveBeenCalledWith(
      expect.objectContaining({
        currentBillingPhase: "trial",
        currentCheckoutOffer: "pulse_trial_7d",
        currentTrialEndsAt: new Date("2026-07-10T12:00:00.000Z"),
        currentTrialStartedAt: new Date("2026-06-30T12:00:00.000Z"),
      }),
    );
  });

  it("keeps resumed active Pulse Trial subscriptions trial-gated until invoice confirmation", async () => {
    mocks.findMemberForStripeSubscription.mockResolvedValueOnce(makeMemberSnapshot({
      billingStatus: HostedBillingStatus.paused,
      billingRef: {
        currentBillingPhase: "trial",
        currentBillingPlanCode: "launch_monthly",
        currentCheckoutOffer: "pulse_trial_7d",
        memberId: "member_123",
        pulseTrialRedeemedAt: new Date("2026-04-12T00:00:00.000Z"),
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
      },
    }));

    await applyStripeSubscriptionUpdated(
      makeStripeSubscription({
        currentPeriodEnd: 1_745_020_800,
        currentPeriodStart: 1_744_416_000,
        metadata: {
          checkoutOffer: "pulse_trial_7d",
        },
        status: "active",
        trialEnd: 1_745_020_800,
        trialStart: 1_744_416_000,
      }),
      {
        eventCreatedAt: new Date("2026-04-19T00:00:00.000Z"),
        occurredAt: "2026-04-19T00:00:00.000Z",
        sourceEventId: "evt_trial_sub_resumed",
        sourceType: "stripe.customer.subscription.resumed",
      },
      {} as never,
    );

    expect(mocks.writeHostedMemberStripeBillingTx).toHaveBeenCalledWith(
      expect.objectContaining({
        billingStatus: HostedBillingStatus.paused,
        canonicalBillingStatus: HostedBillingStatus.active,
        currentBillingPhase: "trial",
        currentCheckoutOffer: "pulse_trial_7d",
        currentTrialEndsAt: new Date("2025-04-19T00:00:00.000Z"),
        currentTrialStartedAt: new Date("2025-04-12T00:00:00.000Z"),
      }),
    );
  });

  it("does not promote a redeemed Pulse Trial with missing phase on subscription.active before paid invoice", async () => {
    mocks.findMemberForStripeSubscription.mockResolvedValueOnce(makeMemberSnapshot({
      billingStatus: HostedBillingStatus.active,
      billingRef: {
        currentBillingPhase: null,
        currentBillingPlanCode: "launch_monthly",
        currentCheckoutOffer: "pulse_trial_7d",
        memberId: "member_123",
        pulseTrialRedeemedAt: new Date("2026-04-12T00:00:00.000Z"),
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
      },
    }));

    await applyStripeSubscriptionUpdated(
      makeStripeSubscription({
        currentPeriodEnd: 1_745_020_800,
        currentPeriodStart: 1_744_416_000,
        metadata: {
          checkoutOffer: "pulse_trial_7d",
        },
        status: "active",
        trialEnd: 1_745_020_800,
        trialStart: 1_744_416_000,
      }),
      {
        eventCreatedAt: new Date("2026-04-19T00:00:00.000Z"),
        occurredAt: "2026-04-19T00:00:00.000Z",
        sourceEventId: "evt_trial_sub_active_missing_phase",
        sourceType: "stripe.customer.subscription.updated",
      },
      {} as never,
    );

    expect(mocks.writeHostedMemberStripeBillingTx).toHaveBeenCalledWith(
      expect.objectContaining({
        currentBillingPhase: "trial",
        currentCheckoutOffer: "pulse_trial_7d",
      }),
    );
  });

  it("ignores the initial zero-dollar Pulse Trial invoice", async () => {
    mocks.findMemberForStripeInvoice.mockResolvedValueOnce(makeMemberSnapshot({
      billingRef: {
        currentBillingPhase: "trial",
        currentBillingPlanCode: "launch_monthly",
        currentCheckoutOffer: "pulse_trial_7d",
        memberId: "member_123",
        pulseTrialRedeemedAt: new Date("2026-04-12T00:00:00.000Z"),
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
      },
    }));

    await expect(
      applyStripeInvoicePaid(
        makeStripeInvoice({
          billingReason: "subscription_create",
          id: "in_trial_initial",
          subscription: "sub_123",
        }),
        {
          eventCreatedAt: new Date("2026-04-12T00:00:00.000Z"),
          occurredAt: "2026-04-12T00:00:00.000Z",
          sourceEventId: "evt_trial_initial",
          sourceType: "stripe.invoice.paid",
        },
        {} as never,
        HostedBillingStatus.active,
        makeStripeSubscription({
          metadata: {
            checkoutOffer: "pulse_trial_7d",
          },
          status: "trialing",
        }),
      ),
    ).resolves.toEqual({
      activatedMemberId: null,
      hostedExecutionEventId: null,
      welcomeEmailMemberId: null,
    });

    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
  });

  it("promotes a Pulse Trial to paid only on the accepted conversion invoice", async () => {
    const eventCreatedAt = new Date("2026-04-19T00:00:00.000Z");
    mocks.findMemberForStripeInvoice.mockResolvedValueOnce(makeMemberSnapshot({
      billingStatus: HostedBillingStatus.active,
      billingRef: {
        currentBillingPhase: "trial",
        currentBillingPlanCode: "launch_monthly",
        currentCheckoutOffer: "pulse_trial_7d",
        memberId: "member_123",
        pulseTrialRedeemedAt: new Date("2026-04-12T00:00:00.000Z"),
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
      },
    }));
    mocks.writeHostedMemberStripeBillingTx.mockResolvedValueOnce(makeMemberSnapshot({
      billingStatus: HostedBillingStatus.active,
      billingRef: {
        currentBillingPhase: "paid",
        currentBillingPlanCode: "launch_monthly",
        currentCheckoutOffer: "pulse_trial_7d",
        memberId: "member_123",
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
        usagePlanTransitionAt: eventCreatedAt,
        usagePlanTransitionFromCode: "launch_monthly",
        usagePlanTransitionKind: "trial_conversion",
        usagePlanTransitionToCode: "launch_monthly",
      },
    }));

    await expect(applyStripeInvoicePaid(
      makeStripeInvoice({
        billingReason: "subscription_cycle",
        id: "in_trial_conversion",
        subscription: "sub_123",
      }),
      {
        eventCreatedAt,
        occurredAt: "2026-04-19T00:00:00.000Z",
        sourceEventId: "evt_trial_conversion",
        sourceType: "stripe.invoice.paid",
      },
      {} as never,
      HostedBillingStatus.active,
      makeStripeSubscription({
        currentPeriodEnd: 1_747_612_800,
        currentPeriodStart: 1_745_020_800,
        items: ["price_pulse_base"],
        metadata: {
          checkoutOffer: "pulse_trial_7d",
        },
        status: "active",
        trialEnd: 1_745_020_800,
        trialStart: 1_744_416_000,
      }),
    )).resolves.toMatchObject({
      runtimeRecheckMemberIds: ["member_123"],
    });

    expect(mocks.writeHostedMemberStripeBillingTx).toHaveBeenCalledWith(expect.objectContaining({
      currentBillingPhase: "paid",
      currentCheckoutOffer: "pulse_trial_7d",
      freshnessPolicy: "positive-invoice-entitlement",
    }));
    expect(mocks.reconcileHostedAiUsageGateForBillingModeChangeTx)
      .toHaveBeenCalledWith({
        memberId: "member_123",
        now: eventCreatedAt,
        tx: {},
      });
  });

  it("does not accept a legacy conversion invoice for an obsolete Price", async () => {
    mocks.findMemberForStripeInvoice.mockResolvedValueOnce(makeMemberSnapshot({
      billingRef: {
        currentBillingPhase: "trial",
        currentBillingPlanCode: "launch_monthly",
        currentCheckoutOffer: "pulse_trial_7d",
        memberId: "member_123",
        pulseTrialRedeemedAt: new Date("2026-04-12T00:00:00.000Z"),
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
      },
    }));

    await expect(applyStripeInvoicePaid(
      makeStripeInvoice({
        billingReason: "subscription_cycle",
        id: "in_obsolete_trial_price",
        priceId: "price_pulse_obsolete",
        subscription: "sub_123",
      }),
      {
        eventCreatedAt: new Date("2026-04-19T00:00:00.000Z"),
        occurredAt: "2026-04-19T00:00:00.000Z",
        sourceEventId: "evt_obsolete_trial_price",
        sourceType: "stripe.invoice.paid",
      },
      {} as never,
      HostedBillingStatus.active,
      makeStripeSubscription({
        items: ["price_pulse_current"],
        metadata: {
          checkoutOffer: "pulse_trial_7d",
        },
        status: "active",
      }),
    )).resolves.toEqual({
      activatedMemberId: null,
      hostedExecutionEventId: null,
      welcomeEmailMemberId: null,
    });

    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
    expect(mocks.activateHostedMemberForPositiveSourceTx).not.toHaveBeenCalled();
  });

  it.each([
    ["subscription-first", ["subscription", "invoice"]],
    ["invoice-first", ["invoice", "subscription"]],
  ] as const)(
    "wakes a Starter member once when direct paid billing begins %s",
    async (_label, eventOrder) => {
      const starterMember = makeMemberSnapshot({
        billingStatus: HostedBillingStatus.active,
        billingRef: {
          currentBillingPhase: null,
          currentCheckoutOffer: "standard",
          memberId: "member_123",
          stripeCustomerId: "cus_123",
          stripeSubscriptionId: "sub_123",
        },
      });
      const paidMember = makeMemberSnapshot({
        billingStatus: HostedBillingStatus.active,
        billingRef: {
          currentBillingPhase: "paid",
          currentBillingPlanCode: "launch_monthly",
          currentCheckoutOffer: "standard",
          memberId: "member_123",
          stripeCustomerId: "cus_123",
          stripeSubscriptionId: "sub_123",
        },
      });
      let currentMember = starterMember;
      mocks.findMemberForStripeInvoice.mockImplementation(async () => currentMember);
      mocks.findMemberForStripeSubscription.mockImplementation(async () => currentMember);
      mocks.writeHostedMemberStripeBillingTx.mockImplementation(async () => {
        currentMember = paidMember;
        return paidMember;
      });

      const runtimeRechecks: string[][] = [];
      for (const [index, eventType] of eventOrder.entries()) {
        const eventCreatedAt = new Date(`2026-08-09T12:0${index}:00.000Z`);
        const outcome = eventType === "subscription"
          ? await applyStripeSubscriptionUpdated(
              makeStripeSubscription({ status: "active" }),
              {
                eventCreatedAt,
                occurredAt: eventCreatedAt.toISOString(),
                sourceEventId: `evt_starter_paid_subscription_${index}`,
                sourceType: "stripe.customer.subscription.updated",
              },
              {} as never,
            )
          : await applyStripeInvoicePaid(
              makeStripeInvoice({
                billingReason: "subscription_create",
                id: `in_starter_paid_${index}`,
              }),
              {
                eventCreatedAt,
                occurredAt: eventCreatedAt.toISOString(),
                sourceEventId: `evt_starter_paid_invoice_${index}`,
                sourceType: "stripe.invoice.paid",
              },
              {} as never,
              HostedBillingStatus.active,
              makeStripeSubscription({ status: "active" }),
            );
        runtimeRechecks.push(outcome.runtimeRecheckMemberIds ?? []);
      }

      expect(runtimeRechecks).toEqual([["member_123"], []]);
      expect(mocks.reconcileHostedAiUsageGateForBillingModeChangeTx)
        .toHaveBeenCalledOnce();
      expect(mocks.reconcileHostedAiUsageGateForBillingModeChangeTx)
        .toHaveBeenCalledWith({
          memberId: "member_123",
          now: new Date("2026-08-09T12:00:00.000Z"),
          tx: {},
        });
    },
  );

  it("does not replay a trial-conversion wake for a different event timestamp", async () => {
    const eventCreatedAt = new Date("2026-04-19T00:00:00.000Z");
    mocks.findMemberForStripeInvoice.mockResolvedValueOnce(makeMemberSnapshot({
      billingStatus: HostedBillingStatus.active,
      billingRef: {
        currentBillingPhase: "paid",
        currentBillingPlanCode: "launch_monthly",
        currentCheckoutOffer: "pulse_trial_7d",
        memberId: "member_123",
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
      },
    }));
    mocks.writeHostedMemberStripeBillingTx.mockResolvedValueOnce(makeMemberSnapshot({
      billingStatus: HostedBillingStatus.active,
      billingRef: {
        currentBillingPhase: "paid",
        currentBillingPlanCode: "launch_monthly",
        currentCheckoutOffer: "pulse_trial_7d",
        memberId: "member_123",
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
        usagePlanTransitionAt: new Date(eventCreatedAt.getTime() - 1_000),
        usagePlanTransitionFromCode: "launch_monthly",
        usagePlanTransitionKind: "trial_conversion",
        usagePlanTransitionToCode: "launch_monthly",
      },
    }));

    await expect(applyStripeInvoicePaid(
      makeStripeInvoice({
        billingReason: "subscription_cycle",
        id: "in_trial_conversion_replay_mismatch",
        subscription: "sub_123",
      }),
      {
        eventCreatedAt,
        occurredAt: eventCreatedAt.toISOString(),
        sourceEventId: "evt_trial_conversion_replay_mismatch",
        sourceType: "stripe.invoice.paid",
      },
      {} as never,
      HostedBillingStatus.active,
      makeStripeSubscription({
        items: ["price_pulse_base"],
        metadata: {
          checkoutOffer: "pulse_trial_7d",
        },
        status: "active",
        trialEnd: 1_745_020_800,
        trialStart: 1_744_416_000,
      }),
    )).resolves.toMatchObject({ runtimeRecheckMemberIds: [] });

    expect(mocks.reconcileHostedAiUsageGateForBillingModeChangeTx)
      .not.toHaveBeenCalled();
  });

  it("does not promote a Pulse Trial when the paid invoice subscription does not match the canonical subscription", async () => {
    mocks.findMemberForStripeInvoice.mockResolvedValueOnce(makeMemberSnapshot({
      billingRef: {
        currentBillingPhase: "trial",
        currentBillingPlanCode: "launch_monthly",
        currentCheckoutOffer: "pulse_trial_7d",
        memberId: "member_123",
        pulseTrialRedeemedAt: new Date("2026-04-12T00:00:00.000Z"),
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
      },
    }));

    await expect(
      applyStripeInvoicePaid(
        makeStripeInvoice({
          billingReason: "subscription_cycle",
          id: "in_trial_mismatch",
          subscription: "sub_other",
        }),
        {
          eventCreatedAt: new Date("2026-04-19T00:00:00.000Z"),
          occurredAt: "2026-04-19T00:00:00.000Z",
          sourceEventId: "evt_trial_mismatch",
          sourceType: "stripe.invoice.paid",
        },
        {} as never,
        HostedBillingStatus.active,
        makeStripeSubscription({
          id: "sub_123",
          metadata: {
            checkoutOffer: "pulse_trial_7d",
          },
          status: "active",
        }),
      ),
    ).resolves.toEqual({
      activatedMemberId: null,
      hostedExecutionEventId: null,
      welcomeEmailMemberId: null,
    });

    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
    expect(mocks.activateHostedMemberForPositiveSourceTx).not.toHaveBeenCalled();
  });

  it("clears paid allowance phase on trial conversion payment failure", async () => {
    mocks.findMemberForStripeInvoice.mockResolvedValueOnce(makeMemberSnapshot({
      billingRef: {
        currentBillingPhase: "trial",
        currentBillingPlanCode: "launch_monthly",
        currentCheckoutOffer: "pulse_trial_7d",
        memberId: "member_123",
        pulseTrialRedeemedAt: new Date("2026-04-12T00:00:00.000Z"),
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
      },
    }));

    await applyStripeInvoicePaymentFailed(
      makeStripeInvoice({
        billingReason: "subscription_cycle",
        id: "in_trial_failed",
        subscription: "sub_123",
      }),
      {
        eventCreatedAt: new Date("2026-04-19T00:00:00.000Z"),
        occurredAt: "2026-04-19T00:00:00.000Z",
        sourceEventId: "evt_trial_failed",
        sourceType: "stripe.invoice.payment_failed",
      },
      {} as never,
      HostedBillingStatus.past_due,
      makeStripeSubscription({
        id: "sub_123",
        metadata: {
          checkoutOffer: "pulse_trial_7d",
        },
        status: "past_due",
        trialEnd: 1_745_020_800,
        trialStart: 1_744_416_000,
      }),
    );

    expect(mocks.writeHostedMemberStripeBillingTx).toHaveBeenCalledWith(expect.objectContaining({
      billingStatus: HostedBillingStatus.past_due,
      currentBillingPhase: null,
      currentCheckoutOffer: "pulse_trial_7d",
    }));
  });

  it("does not treat a later standard Pulse invoice as a trial invoice just because a trial was redeemed before", async () => {
    mocks.findMemberForStripeInvoice.mockResolvedValueOnce(makeMemberSnapshot({
      billingRef: {
        currentBillingPhase: null,
        currentBillingPlanCode: "launch_monthly",
        currentCheckoutOffer: "standard",
        memberId: "member_123",
        pulseTrialRedeemedAt: new Date("2026-04-12T00:00:00.000Z"),
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_standard_123",
      },
    }));

    await applyStripeInvoicePaid(
      makeStripeInvoice({
        billingReason: "subscription_create",
        id: "in_standard_after_trial",
        subscription: "sub_standard_123",
      }),
      {
        eventCreatedAt: new Date("2026-04-25T00:00:00.000Z"),
        occurredAt: "2026-04-25T00:00:00.000Z",
        sourceEventId: "evt_standard_after_trial",
        sourceType: "stripe.invoice.paid",
      },
      {} as never,
      HostedBillingStatus.active,
      makeStripeSubscription({
        id: "sub_standard_123",
        metadata: {
          checkoutOffer: "standard",
        },
        status: "active",
      }),
    );

    expect(mocks.writeHostedMemberStripeBillingTx).toHaveBeenCalledWith(expect.objectContaining({
      currentBillingPhase: "paid",
      currentCheckoutOffer: "standard",
      stripeSubscriptionId: "sub_standard_123",
    }));
  });

  it("ignores pending refunds before looking up a member", async () => {
    await applyStripeRefundCreated(
      makeStripeRefund({ status: "pending" }),
      {
        eventCreatedAt: new Date("2026-04-25T00:00:00.000Z"),
        sourceEventId: "evt_refund_pending",
        sourceType: "stripe.refund.created",
      },
      {} as never,
      "cus_123",
    );

    expect(mocks.findMemberForStripeReversal).not.toHaveBeenCalled();
    expect(mocks.suspendHostedMemberForBillingReversalTx).not.toHaveBeenCalled();
  });

  it("reconciles a pending refund when refund.updated proves success", async () => {
    const pendingRefund = makeStripeRefund({
      id: "re_pending_then_succeeded",
      status: "pending",
    });
    await applyStripeRefundCreated(
      pendingRefund,
      {
        eventCreatedAt: new Date("2026-04-25T00:00:00.000Z"),
        sourceEventId: "evt_refund_pending_first",
        sourceType: "stripe.refund.created",
      },
      {} as never,
      "cus_123",
    );
    expect(mocks.findMemberForStripeReversal).not.toHaveBeenCalled();

    mocks.requireHostedStripeApi.mockReturnValueOnce({
      invoicePayments: {
        list: vi.fn(async () => ({ data: [] })),
      },
      subscriptions: {
        retrieve: vi.fn(async () => makeStripeSubscription({
          latestInvoice: makeStripeInvoice({
            amountPaid: 5_000,
            charge: null,
            invoicePayments: [makeStripeInvoicePayment({
              amountPaid: 5_000,
              paymentIntent: "pi_123",
            })],
            paymentIntent: null,
          }),
        })),
      },
    });
    const succeededRefund = makeStripeRefund({
      id: pendingRefund.id,
      status: "succeeded",
    });
    const preparedProviderState = await prepareStripeReversalProviderState(
      "refund.updated",
      succeededRefund,
    );

    await applyStripeRefundCreated(
      succeededRefund,
      {
        eventCreatedAt: new Date("2026-04-25T00:01:00.000Z"),
        sourceEventId: "evt_refund_succeeded_update",
        sourceType: "stripe.refund.updated",
      },
      {} as never,
      "cus_123",
      preparedProviderState,
    );

    expect(mocks.suspendHostedMemberForBillingReversalTx).toHaveBeenCalledWith(
      expect.objectContaining({
        freshnessPolicy: "proven-current-refund",
        stripeSubscriptionId: "sub_123",
      }),
    );
  });

  it("accumulates succeeded partial refunds for the exact current payment", async () => {
    const firstPartial = makeStripeRefund({
      amount: 2_500,
      id: "re_partial_first",
      status: "succeeded",
    });
    const secondPartial = makeStripeRefund({
      amount: 2_500,
      id: "re_partial_second",
      status: "succeeded",
    });
    mocks.stripeRefundsList.mockResolvedValueOnce({
      data: [firstPartial],
      has_more: false,
    });
    mocks.requireHostedStripeApi.mockReturnValueOnce({
      invoicePayments: {
        list: vi.fn(async () => ({ data: [] })),
      },
      subscriptions: {
        retrieve: vi.fn(async () => makeStripeSubscription({
          latestInvoice: makeStripeInvoice({
            amountPaid: 5_000,
            charge: null,
            invoicePayments: [makeStripeInvoicePayment({
              amountPaid: 5_000,
              paymentIntent: "pi_123",
            })],
            paymentIntent: null,
          }),
        })),
      },
    });
    const preparedProviderState = await prepareStripeReversalProviderState(
      "refund.updated",
      secondPartial,
    );

    await applyStripeRefundCreated(
      secondPartial,
      {
        eventCreatedAt: new Date("2026-04-25T00:02:00.000Z"),
        sourceEventId: "evt_refund_partial_cumulative",
        sourceType: "stripe.refund.updated",
      },
      {} as never,
      "cus_123",
      preparedProviderState,
    );

    expect(mocks.stripeRefundsList).toHaveBeenCalledWith({
      limit: 100,
      payment_intent: "pi_123",
    });
    expect(mocks.suspendHostedMemberForBillingReversalTx).toHaveBeenCalledOnce();
  });

  it("does not double-count a replayed partial refund", async () => {
    const partial = makeStripeRefund({
      amount: 2_500,
      id: "re_partial_replay",
      status: "succeeded",
    });
    mocks.stripeRefundsList.mockResolvedValueOnce({
      data: [partial],
      has_more: false,
    });
    mocks.requireHostedStripeApi.mockReturnValueOnce({
      invoicePayments: {
        list: vi.fn(async () => ({ data: [] })),
      },
      subscriptions: {
        retrieve: vi.fn(async () => makeStripeSubscription({
          latestInvoice: makeStripeInvoice({
            amountPaid: 5_000,
            charge: null,
            invoicePayments: [makeStripeInvoicePayment({
              amountPaid: 5_000,
              paymentIntent: "pi_123",
            })],
            paymentIntent: null,
          }),
        })),
      },
    });
    const preparedProviderState = await prepareStripeReversalProviderState(
      "refund.updated",
      partial,
    );

    await applyStripeRefundCreated(
      partial,
      {
        eventCreatedAt: new Date("2026-04-25T00:03:00.000Z"),
        sourceEventId: "evt_refund_partial_replay",
        sourceType: "stripe.refund.updated",
      },
      {} as never,
      "cus_123",
      preparedProviderState,
    );

    expect(mocks.suspendHostedMemberForBillingReversalTx).not.toHaveBeenCalled();
  });

  it("ignores partial refunds for the current entitlement invoice", async () => {
    mocks.requireHostedStripeApi.mockReturnValueOnce({
      invoicePayments: {
        list: vi.fn(async () => ({ data: [] })),
      },
      subscriptions: {
        retrieve: vi.fn(async () => makeStripeSubscription({
          latestInvoice: makeStripeInvoice({
            amountPaid: 5_000,
            charge: null,
            invoicePayments: [makeStripeInvoicePayment({
              amountPaid: 5_000,
              paymentIntent: "pi_123",
            })],
            paymentIntent: null,
          }),
        })),
      },
    });

    const refund = makeStripeRefund({
      amount: 2_500,
      charge: "ch_123",
      paymentIntent: "pi_123",
      status: "succeeded",
    });
    const preparedProviderState = await prepareStripeReversalProviderState(
      "refund.created",
      refund,
    );

    await applyStripeRefundCreated(
      refund,
      {
        eventCreatedAt: new Date("2026-04-25T00:00:00.000Z"),
        sourceEventId: "evt_refund_partial",
        sourceType: "stripe.refund.created",
      },
      {} as never,
      "cus_123",
      preparedProviderState,
    );

    expect(mocks.findMemberForStripeReversal).toHaveBeenCalled();
    expect(mocks.suspendHostedMemberForBillingReversalTx).not.toHaveBeenCalled();
  });

  it("suspends members for full succeeded refunds of the current entitlement invoice", async () => {
    mocks.requireHostedStripeApi.mockReturnValueOnce({
      invoicePayments: {
        list: vi.fn(async () => ({ data: [] })),
      },
      subscriptions: {
        retrieve: vi.fn(async () => makeStripeSubscription({
          latestInvoice: makeStripeInvoice({
            amountPaid: 5_000,
            charge: null,
            invoicePayments: [makeStripeInvoicePayment({
              amountPaid: 5_000,
              paymentIntent: "pi_123",
            })],
            paymentIntent: null,
          }),
        })),
      },
    });

    const refund = makeStripeRefund({
      amount: 5_000,
      charge: "ch_123",
      paymentIntent: "pi_123",
      status: "succeeded",
    });
    const preparedProviderState = await prepareStripeReversalProviderState(
      "refund.created",
      refund,
    );

    await applyStripeRefundCreated(
      refund,
      {
        eventCreatedAt: new Date("2026-04-25T00:00:00.000Z"),
        sourceEventId: "evt_refund_full",
        sourceType: "stripe.refund.created",
      },
      {} as never,
      "cus_123",
      preparedProviderState,
    );

    expect(mocks.prepareHostedMemberStripeBillingWrite).toHaveBeenCalledWith({
      canonicalBillingStatus: HostedBillingStatus.active,
      dispatchContext: expect.objectContaining({
        sourceEventId: "evt_refund_full",
        sourceType: "stripe.refund.created",
      }),
      member: expect.anything(),
    });
    expect(mocks.suspendHostedMemberForBillingReversalTx).toHaveBeenCalledWith(expect.objectContaining({
      canonicalBillingStatus: HostedBillingStatus.active,
      dispatchContext: expect.objectContaining({
        eventCreatedAt: new Date("2026-04-25T00:00:00.000Z"),
        sourceType: "stripe.refund.created",
      }),
      stripeCustomerId: "cus_123",
    }));
  });

  it("ignores full refunds that do not match the current entitlement invoice", async () => {
    mocks.requireHostedStripeApi.mockReturnValueOnce({
      invoicePayments: {
        list: vi.fn(async () => ({ data: [] })),
      },
      subscriptions: {
        retrieve: vi.fn(async () => makeStripeSubscription({
          latestInvoice: makeStripeInvoice({
            amountPaid: 5_000,
            charge: null,
            invoicePayments: [makeStripeInvoicePayment({
              amountPaid: 5_000,
              paymentIntent: "pi_current",
            })],
            paymentIntent: null,
          }),
        })),
      },
    });

    const refund = makeStripeRefund({
      amount: 5_000,
      charge: "ch_old",
      paymentIntent: "pi_old",
      status: "succeeded",
    });
    const preparedProviderState = await prepareStripeReversalProviderState(
      "refund.created",
      refund,
    );

    await applyStripeRefundCreated(
      refund,
      {
        eventCreatedAt: new Date("2026-04-25T00:00:00.000Z"),
        sourceEventId: "evt_refund_old_invoice",
        sourceType: "stripe.refund.created",
      },
      {} as never,
      "cus_123",
      preparedProviderState,
    );

    expect(mocks.findMemberForStripeReversal).toHaveBeenCalled();
    expect(mocks.suspendHostedMemberForBillingReversalTx).not.toHaveBeenCalled();
  });

  it("ignores a refund proof when the prepared subscription latest invoice changes", async () => {
    mocks.requireHostedStripeApi.mockReturnValueOnce({
      invoicePayments: {
        list: vi.fn(async () => ({ data: [] })),
      },
      subscriptions: {
        retrieve: vi.fn(async () => makeStripeSubscription({
          latestInvoice: makeStripeInvoice({ id: "in_current" }),
        })),
      },
    });
    const refund = makeStripeRefund({ status: "succeeded" });
    const preparedProviderState = await prepareStripeReversalProviderState(
      "refund.updated",
      refund,
    );
    expect(preparedProviderState?.subscription).not.toBeNull();
    const changedInvoiceState = preparedProviderState?.subscription
      ? {
          ...preparedProviderState,
          subscription: {
            ...preparedProviderState.subscription,
            latest_invoice: "in_new",
          } as Stripe.Subscription,
        }
      : null;

    await applyStripeRefundCreated(
      refund,
      {
        eventCreatedAt: new Date("2026-04-25T00:04:00.000Z"),
        sourceEventId: "evt_refund_changed_invoice",
        sourceType: "stripe.refund.updated",
      },
      {} as never,
      "cus_123",
      changedInvoiceState,
    );

    expect(mocks.suspendHostedMemberForBillingReversalTx).not.toHaveBeenCalled();
  });

  it("ignores a refund proof after the member changes subscriptions", async () => {
    mocks.requireHostedStripeApi.mockReturnValueOnce({
      invoicePayments: {
        list: vi.fn(async () => ({ data: [] })),
      },
      subscriptions: {
        retrieve: vi.fn(async () => makeStripeSubscription({
          latestInvoice: makeStripeInvoice(),
        })),
      },
    });
    const refund = makeStripeRefund({ status: "succeeded" });
    const preparedProviderState = await prepareStripeReversalProviderState(
      "refund.updated",
      refund,
    );
    mocks.findMemberForStripeReversal.mockResolvedValueOnce(makeMemberSnapshot({
      billingRef: {
        memberId: "member_123",
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_replacement",
      },
    }));

    await applyStripeRefundCreated(
      refund,
      {
        eventCreatedAt: new Date("2026-04-25T00:05:00.000Z"),
        sourceEventId: "evt_refund_changed_subscription",
        sourceType: "stripe.refund.updated",
      },
      {} as never,
      "cus_123",
      preparedProviderState,
    );

    expect(mocks.suspendHostedMemberForBillingReversalTx).not.toHaveBeenCalled();
  });

  it("matches full refunds against current invoice payment records", async () => {
    const retrieveInvoice = vi.fn(async () => makeStripeInvoice({
      amountPaid: 5_000,
      charge: null,
      paymentIntent: null,
    }));
    const listInvoicePayments = vi.fn(async () => ({
      data: [makeStripeInvoicePayment({
        amountPaid: 5_000,
        paymentIntent: "pi_123",
      })],
    }));
    mocks.requireHostedStripeApi.mockReturnValue({
      invoicePayments: {
        list: listInvoicePayments,
      },
      invoices: {
        retrieve: retrieveInvoice,
      },
      refunds: {
        list: mocks.stripeRefundsList,
      },
      subscriptions: {
        retrieve: vi.fn(async () => makeStripeSubscription({
          latestInvoice: "in_123",
        })),
      },
    });

    const refund = makeStripeRefund({
      amount: 5_000,
      paymentIntent: "pi_123",
      status: "succeeded",
    });
    const preparedProviderState = await prepareStripeReversalProviderState(
      "refund.created",
      refund,
    );

    await applyStripeRefundCreated(
      refund,
      {
        eventCreatedAt: new Date("2026-04-25T00:00:00.000Z"),
        sourceEventId: "evt_refund_invoice_payment",
        sourceType: "stripe.refund.created",
      },
      {} as never,
      "cus_123",
      preparedProviderState,
    );

    expect(retrieveInvoice).toHaveBeenCalledWith("in_123", {
      expand: [
        "payments.data.payment.charge",
        "payments.data.payment.payment_intent",
      ],
    });
    expect(listInvoicePayments).toHaveBeenCalledWith({
      invoice: "in_123",
      limit: 100,
      status: "paid",
      expand: [
        "data.payment.charge",
        "data.payment.payment_intent",
      ],
    });
    expect(mocks.suspendHostedMemberForBillingReversalTx).toHaveBeenCalled();
  });

  it("ignores non-adverse dispute updates", async () => {
    await applyStripeDisputeUpdated(
      makeStripeDispute({ status: "under_review" }),
      {
        eventCreatedAt: new Date("2026-04-25T00:00:00.000Z"),
        sourceEventId: "evt_dispute_created",
        sourceType: "stripe.charge.dispute.created",
      },
      {} as never,
      "cus_123",
    );

    expect(mocks.findMemberForStripeReversal).not.toHaveBeenCalled();
    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
  });

  it("suspends members for adverse dispute outcomes", async () => {
    await applyStripeDisputeUpdated(
      makeStripeDispute({ status: "under_review" }),
      {
        eventCreatedAt: new Date("2026-04-25T00:00:00.000Z"),
        sourceEventId: "evt_dispute_funds_withdrawn",
        sourceType: "stripe.charge.dispute.funds_withdrawn",
      },
      {} as never,
      "cus_123",
    );

    expect(mocks.suspendHostedMemberForBillingReversalTx).toHaveBeenCalledWith(expect.objectContaining({
      canonicalBillingStatus: HostedBillingStatus.active,
      dispatchContext: expect.objectContaining({
        eventCreatedAt: new Date("2026-04-25T00:00:00.000Z"),
        sourceType: "stripe.charge.dispute.funds_withdrawn",
      }),
    }));
  });

  it("clears dispute suspension when reinstated funds match an active subscription", async () => {
    const member = makeMemberSnapshot({
      billingStatus: HostedBillingStatus.unpaid,
    });
    mocks.findMemberForStripeReversal.mockResolvedValueOnce(member);
    mocks.readHostedMemberBillingSnapshot.mockResolvedValueOnce(member);
    const dispute = makeStripeDispute({ status: "won" });
    const preparedProviderState = await prepareStripeReversalProviderState(
      "charge.dispute.funds_reinstated",
      dispute,
    );

    await applyStripeDisputeUpdated(
      dispute,
      {
        eventCreatedAt: new Date("2026-04-26T00:00:00.000Z"),
        sourceEventId: "evt_dispute_funds_reinstated",
        sourceType: "stripe.charge.dispute.funds_reinstated",
      },
      {} as never,
      "cus_123",
      preparedProviderState,
    );

    expect(mocks.writeHostedMemberStripeBillingTx).toHaveBeenCalledWith(expect.objectContaining({
      billingStatus: HostedBillingStatus.active,
      canonicalBillingStatus: HostedBillingStatus.active,
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
      suspendedAtOverride: null,
    }));
  });

  it("keeps restoration pending when the member has no subscription identity", async () => {
    const member = makeMemberSnapshot({
      billingStatus: HostedBillingStatus.unpaid,
      billingRef: {
        memberId: "member_123",
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: null,
      },
    });
    mocks.findMemberForStripeReversal.mockResolvedValueOnce(member);
    mocks.readHostedMemberBillingSnapshot.mockResolvedValueOnce(member);
    const dispute = makeStripeDispute({ status: "won" });
    const preparedProviderState = await prepareStripeReversalProviderState(
      "charge.dispute.funds_reinstated",
      dispute,
    );

    await expect(applyStripeDisputeUpdated(
      dispute,
      {
        eventCreatedAt: new Date("2026-04-26T00:00:00.000Z"),
        sourceEventId: "evt_dispute_funds_reinstated_without_subscription",
        sourceType: "stripe.charge.dispute.funds_reinstated",
      },
      {} as never,
      "cus_123",
      preparedProviderState,
    )).resolves.toBe("subscription_identity_pending");

    expect(mocks.requireHostedStripeApi).not.toHaveBeenCalled();
    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
  });

  it("does not clear dispute suspension when the canonical subscription is not active", async () => {
    const member = makeMemberSnapshot({
      billingStatus: HostedBillingStatus.unpaid,
    });
    mocks.findMemberForStripeReversal.mockResolvedValueOnce(member);
    mocks.readHostedMemberBillingSnapshot.mockResolvedValueOnce(member);
    mocks.requireHostedStripeApi.mockReturnValueOnce({
      subscriptions: {
        retrieve: vi.fn(async () => makeStripeSubscription({ status: "past_due" })),
      },
    });
    const dispute = makeStripeDispute({ status: "won" });
    const preparedProviderState = await prepareStripeReversalProviderState(
      "charge.dispute.closed",
      dispute,
    );

    await applyStripeDisputeUpdated(
      dispute,
      {
        eventCreatedAt: new Date("2026-04-26T00:00:00.000Z"),
        sourceEventId: "evt_dispute_won_past_due",
        sourceType: "stripe.charge.dispute.closed",
      },
      {} as never,
      "cus_123",
      preparedProviderState,
    );

    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
  });
});

function makePreparedStandardCheckoutCompletion(input: {
  stripeCheckoutEmail?: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  subscriptionStatus?: Stripe.Subscription.Status;
}) {
  return {
    billingCompletion: {
      memberId: "member_123",
      stripeCustomerId: input.stripeCustomerId,
      stripeCustomerIdEncrypted: "encrypted-customer",
      stripeCustomerLookupKey: "customer-lookup",
      stripeSubscriptionId: input.stripeSubscriptionId,
      stripeSubscriptionIdEncrypted: "encrypted-subscription",
      stripeSubscriptionLookupKey: "subscription-lookup",
    },
    canonicalSubscription: {
      customer: input.stripeCustomerId,
      id: input.stripeSubscriptionId,
      status: input.subscriptionStatus ?? "active",
    } as Stripe.Subscription,
    memberId: "member_123",
    stripeCheckoutEmail: input.stripeCheckoutEmail
      ? {
          address: input.stripeCheckoutEmail,
          addressEncrypted: "encrypted-checkout-email",
          memberId: "member_123",
        }
      : null,
  };
}

async function prepareStripeReversalProviderState(
  type: Stripe.Event.Type,
  object: Stripe.Refund | Stripe.Dispute,
) {
  return prepareHostedStripeReversalProviderState({
    event: {
      data: { object },
      type,
    } as Stripe.Event,
    memberId: "member_123",
    prisma: {} as never,
  });
}

function makeMemberSnapshot(input?: {
  billingStatus?: HostedBillingStatus;
  billingRef?: HostedMemberBillingSnapshot["billingRef"];
}): HostedMemberBillingSnapshot {
  return {
    billingRef: input?.billingRef ?? {
      memberId: "member_123",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
    },
    core: {
      billingStatus: input?.billingStatus ?? HostedBillingStatus.incomplete,
      createdAt: new Date("2026-04-23T00:00:00.000Z"),
      id: "member_123",
      suspendedAt: null,
      updatedAt: new Date("2026-04-23T00:00:00.000Z"),
    },
  };
}

function makeStripeInvoice(
  overrides?: Partial<{
    amountPaid: number;
    billingReason: string | null;
    charge: string | null;
    customer: string | null;
    customerEmail: string | null;
    id: string;
    invoicePayments: Stripe.InvoicePayment[];
    paymentIntent: string | null;
    priceId: string;
    subscription: string | null;
  }>,
): Stripe.Invoice {
  // @ts-expect-error - the synthetic fixture is intentionally narrower than Stripe.Invoice.
  return {
    amount_paid: overrides?.amountPaid ?? 5_000,
    billing_reason: overrides?.billingReason ?? null,
    charge: overrides?.charge ?? "ch_123",
    customer: overrides?.customer ?? "cus_123",
    customer_email: overrides?.customerEmail ?? null,
    id: overrides?.id ?? "in_123",
    lines: {
      data: [{
        pricing: {
          price_details: {
            price: overrides?.priceId ?? "price_pulse_base",
            product: "prod_hosted_trial",
          },
          type: "price_details",
          unit_amount_decimal: "800",
        },
      }],
    },
    payment_intent: overrides?.paymentIntent ?? "pi_123",
    payments: {
      data: overrides?.invoicePayments ?? [],
    },
    subscription: overrides?.subscription ?? "sub_123",
  } as Stripe.Invoice;
}

function makeStripeInvoicePayment(overrides?: Partial<{
  amountPaid: number;
  charge: string | null;
  paymentIntent: string | null;
  status: string;
}>): Stripe.InvoicePayment {
  return {
    amount_paid: overrides?.amountPaid ?? 5_000,
    id: "inpay_123",
    object: "invoice_payment",
    payment: {
      ...(overrides?.charge === undefined ? {} : { charge: overrides.charge ?? undefined }),
      ...(overrides?.paymentIntent === undefined ? { payment_intent: "pi_123" } : { payment_intent: overrides.paymentIntent ?? undefined }),
      type: "payment_intent",
    },
    status: overrides?.status ?? "paid",
  } as Stripe.InvoicePayment;
}

function makeStripeRefund(overrides?: Partial<{
  amount: number;
  charge: string | null;
  id: string;
  paymentIntent: string | null;
  status: Stripe.Refund["status"];
}>): Stripe.Refund {
  return {
    amount: overrides?.amount ?? 5_000,
    charge: overrides?.charge ?? "ch_123",
    id: overrides?.id ?? "re_123",
    payment_intent: overrides?.paymentIntent ?? "pi_123",
    status: overrides?.status ?? "succeeded",
  } as Stripe.Refund;
}

function makeStripeDispute(overrides?: Partial<{
  charge: string | null;
  paymentIntent: string | null;
  status: Stripe.Dispute.Status;
}>): Stripe.Dispute {
  return {
    charge: overrides?.charge ?? "ch_123",
    payment_intent: overrides?.paymentIntent ?? "pi_123",
    status: overrides?.status ?? "under_review",
  } as Stripe.Dispute;
}

function makeExactLegacyPulseTrialSubscription(input?: {
  status?: Stripe.Subscription.Status;
}): Stripe.Subscription {
  return {
    customer: "cus_123",
    current_period_end: 1_745_020_800,
    current_period_start: 1_744_416_000,
    id: "sub_123",
    items: {
      data: [{
        id: "si_pulse_123",
        price: {
          id: "price_pulse_base",
          recurring: {
            interval: "month",
            interval_count: 1,
            usage_type: "licensed",
          },
        },
        quantity: 1,
      }],
      has_more: false,
    },
    metadata: {
      billingPlanCode: "launch_monthly",
      checkoutOffer: "pulse_trial_7d",
      memberId: "member_123",
      trialDurationDays: "10",
      trialPolicyVersion: "pulse-trial-2026-06-30-v2",
      trialUsageLimitUsdMicros: "4500000",
    },
    status: input?.status ?? "trialing",
    trial_end: 1_745_020_800,
    trial_start: 1_744_416_000,
  } as unknown as Stripe.Subscription;
}

function makeStripeSubscription(
  overrides?: Partial<{
    customer: string | null;
    currentPeriodEnd: number | null;
    currentPeriodStart: number | null;
    id: string;
    itemCurrentPeriodEnd: number | null;
    itemCurrentPeriodStart: number | null;
    items: string[];
    latestInvoice: Stripe.Invoice | string | null;
    metadata: Record<string, string>;
    status: Stripe.Subscription.Status;
    trialEnd: number | null;
    trialStart: number | null;
}>,
): Stripe.Subscription {
  const currentPeriodEnd = overrides?.currentPeriodEnd === null
    ? undefined
    : overrides?.currentPeriodEnd ?? 1_747_612_800;
  const currentPeriodStart = overrides?.currentPeriodStart === null
    ? undefined
    : overrides?.currentPeriodStart ?? 1_745_020_800;
  const itemCurrentPeriodEnd = overrides?.itemCurrentPeriodEnd === null
    ? undefined
    : overrides?.itemCurrentPeriodEnd;
  const itemCurrentPeriodStart = overrides?.itemCurrentPeriodStart === null
    ? undefined
    : overrides?.itemCurrentPeriodStart;

  return {
    customer: overrides?.customer ?? "cus_123",
    id: overrides?.id ?? "sub_123",
    ...(overrides?.latestInvoice === undefined ? {} : { latest_invoice: overrides.latestInvoice }),
    ...(currentPeriodEnd === undefined ? {} : { current_period_end: currentPeriodEnd }),
    ...(currentPeriodStart === undefined ? {} : { current_period_start: currentPeriodStart }),
    items: {
      data: (overrides?.items ?? []).map((priceId) => ({
        ...(itemCurrentPeriodEnd === undefined ? {} : { current_period_end: itemCurrentPeriodEnd }),
        ...(itemCurrentPeriodStart === undefined ? {} : { current_period_start: itemCurrentPeriodStart }),
        price: {
          id: priceId,
        },
      })),
    },
    metadata: overrides?.metadata ?? {},
    status: overrides?.status ?? "active",
    trial_end: overrides?.trialEnd ?? null,
    trial_start: overrides?.trialStart ?? null,
  } as Stripe.Subscription;
}
