import { HostedBillingStatus } from "@prisma/client";
import type Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HostedMemberBillingSnapshot } from "@/src/lib/hosted-onboarding/hosted-member-store";

const mocks = vi.hoisted(() => ({
  activateHostedMemberForPositiveSourceTx: vi.fn(),
  acceptHostedMemberStripeCheckoutCompletionTx: vi.fn(),
  applyHostedFamilyStripeCheckoutCompletedTx: vi.fn(),
  applyHostedFamilyStripeSubscriptionUpdatedTx: vi.fn(),
  clearHostedFamilyCheckoutAttemptForSession: vi.fn(),
  clearHostedMemberStripeCheckoutAttemptForSessionTx: vi.fn(),
  findHostedAccountGroupForStripeCheckoutSession: vi.fn(),
  findMemberForStripeCheckoutSession: vi.fn(),
  findMemberForStripeInvoice: vi.fn(),
  findMemberForStripeSubscription: vi.fn(),
  listHostedStripeCheckoutSessionMemberIds: vi.fn(),
  lookupHostedAccountGroupStripeBillingRefByStripeSubscriptionId: vi.fn(),
  prepareHostedMemberStripeBillingWrite: vi.fn(),
  readActiveHostedFamilySponsorship: vi.fn(),
  readHostedMemberFamilyBillingClaim: vi.fn(),
  readHostedStripeRecurringFinancialState: vi.fn(),
  reconcileHostedAiUsageGateForBillingModeChangeTx: vi.fn(),
  requireHostedStripeApi: vi.fn(),
  stripeInvoicePaymentsList: vi.fn(),
  stripeInvoicesRetrieve: vi.fn(),
  stripeSubscriptionsRetrieve: vi.fn(),
  upsertHostedMemberStripeCheckoutEmailIfFreshTx: vi.fn(),
  setHostedFamilyStripeBillingReversalStateTx: vi.fn(),
  writeHostedMemberStripeBillingRefIfFreshTx: vi.fn(),
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
    acceptHostedMemberStripeCheckoutCompletionTx:
      mocks.acceptHostedMemberStripeCheckoutCompletionTx,
    clearHostedMemberStripeCheckoutAttemptForSessionTx:
      mocks.clearHostedMemberStripeCheckoutAttemptForSessionTx,
  };
});

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
    applyHostedFamilyStripeSubscriptionUpdatedTx:
      mocks.applyHostedFamilyStripeSubscriptionUpdatedTx,
    clearHostedFamilyCheckoutAttemptForSession:
      mocks.clearHostedFamilyCheckoutAttemptForSession,
    findHostedAccountGroupForStripeCheckoutSession:
      mocks.findHostedAccountGroupForStripeCheckoutSession,
    lookupHostedAccountGroupStripeBillingRefByStripeSubscriptionId:
      mocks.lookupHostedAccountGroupStripeBillingRefByStripeSubscriptionId,
    readHostedMemberFamilyBillingClaim:
      mocks.readHostedMemberFamilyBillingClaim,
    setHostedFamilyStripeBillingReversalStateTx:
      mocks.setHostedFamilyStripeBillingReversalStateTx,
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
    listHostedStripeCheckoutSessionMemberIds:
      mocks.listHostedStripeCheckoutSessionMemberIds,
    readHostedStripeRecurringFinancialState:
      mocks.readHostedStripeRecurringFinancialState,
  };
});

vi.mock("@/src/lib/hosted-onboarding/stripe-billing-policy", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/stripe-billing-policy")
  >("@/src/lib/hosted-onboarding/stripe-billing-policy");

  return {
    ...actual,
    prepareHostedMemberStripeBillingWrite: mocks.prepareHostedMemberStripeBillingWrite,
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
    upsertHostedMemberStripeCheckoutEmailIfFreshTx:
      mocks.upsertHostedMemberStripeCheckoutEmailIfFreshTx,
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
  applyStripeInvoicePaid,
  applyStripeInvoiceCollectionStateChanged,
  applyStripeRecurringFinancialState,
  applyStripeSubscriptionUpdated,
} from "@/src/lib/hosted-onboarding/stripe-billing-events";
import type {
  HostedStripeRecurringFinancialState,
} from "@/src/lib/hosted-onboarding/stripe-billing-lookup";
import type { HostedStripeBillingOwner } from "@/src/lib/hosted-onboarding/stripe-billing-owner";

describe("hosted onboarding stripe billing events", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    const member = makeMemberSnapshot();
    mocks.findHostedAccountGroupForStripeCheckoutSession.mockResolvedValue(null);
    mocks.findMemberForStripeCheckoutSession.mockResolvedValue(member);
    mocks.findMemberForStripeInvoice.mockResolvedValue(member);
    mocks.findMemberForStripeSubscription.mockResolvedValue(member);
    mocks.listHostedStripeCheckoutSessionMemberIds.mockResolvedValue([
      member.core.id,
    ]);
    mocks.lookupHostedAccountGroupStripeBillingRefByStripeSubscriptionId
      .mockResolvedValue(null);
    mocks.acceptHostedMemberStripeCheckoutCompletionTx.mockResolvedValue({
      billingRef: {
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
      },
      kind: "accepted",
    });
    mocks.clearHostedMemberStripeCheckoutAttemptForSessionTx.mockResolvedValue(true);
    mocks.readActiveHostedFamilySponsorship.mockResolvedValue(false);
    mocks.readHostedStripeRecurringFinancialState.mockResolvedValue(
      makeRecurringFinancialState(),
    );
    mocks.readHostedMemberFamilyBillingClaim.mockResolvedValue(null);
    mocks.prepareHostedMemberStripeBillingWrite.mockResolvedValue({
      canonicalBillingStatus: HostedBillingStatus.active,
      member,
    });
    mocks.writeHostedMemberStripeBillingTx.mockResolvedValue(member);
    mocks.setHostedFamilyStripeBillingReversalStateTx.mockResolvedValue(true);
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
      billingModeChangedMemberIds: [],
      groupId: null,
    });
    mocks.reconcileHostedAiUsageGateForBillingModeChangeTx.mockResolvedValue(undefined);
    mocks.requireHostedStripeApi.mockReturnValue({
      invoicePayments: {
        list: mocks.stripeInvoicePaymentsList,
      },
      invoices: {
        retrieve: mocks.stripeInvoicesRetrieve,
      },
      subscriptions: {
        retrieve: mocks.stripeSubscriptionsRetrieve,
      },
    });
    mocks.stripeInvoicePaymentsList.mockResolvedValue({
      data: [],
      has_more: false,
    });
    mocks.stripeInvoicesRetrieve.mockResolvedValue(
      makeStripeInvoice({
        status: "paid",
      }),
    );
    mocks.stripeSubscriptionsRetrieve.mockImplementation(
      async (subscriptionId: string) => makeStripeSubscription({
        id: subscriptionId,
        latestInvoice: makeStripeInvoice({
          id: `in_${subscriptionId}`,
          status: "paid",
          subscription: subscriptionId,
        }),
        metadata: {
          billingPlanCode: "launch_monthly",
          checkoutOffer: "standard",
          memberId: "member_123",
        },
        status: "active",
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reports standard checkout completion as a welcome candidate after storing the checkout email", async () => {
    const sessionExpiresAt = 1_714_787_200;
    const standardSession = makeStandardCheckoutSession({
      attemptId: null,
      intentHash: null,
      subscriptionId: "sub_123",
    });
    const session: Stripe.Checkout.Session = {
      ...standardSession,
      customer_details: {
        ...standardSession.customer_details!,
        email: " payer@example.com ",
      },
      expires_at: sessionExpiresAt,
      id: "cs_standard_123",
      metadata: {
        checkoutOffer: "standard",
      },
    };

    await expect(
      applyStripeCheckoutCompleted(
        session,
        {} as never,
        undefined,
        new Date((sessionExpiresAt + 3 * 24 * 60 * 60) * 1_000),
      ),
    ).resolves.toEqual({
      activatedMemberId: "member_123",
      hostedExecutionEventId: "wake_123",
      welcomeEmailMemberId: "member_123",
    });

    expect(mocks.acceptHostedMemberStripeCheckoutCompletionTx).toHaveBeenCalledWith(expect.objectContaining({
      allowLegacyCompletion: true,
      checkoutAttemptId: null,
      checkoutIntentHash: null,
      checkoutSessionId: "cs_standard_123",
      currentCheckoutOffer: "standard",
      memberId: "member_123",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
    }));
    expect(mocks.upsertHostedMemberStripeCheckoutEmailIfFreshTx).toHaveBeenCalledWith({
      address: "payer@example.com",
      collectedAt: new Date("2024-05-03T01:46:40.000Z"),
      memberId: "member_123",
      prisma: {},
    });
  });

  it("returns a legacy completion after its webhook horizon for loser cleanup", async () => {
    const sessionExpiresAt = 1_714_787_200;
    const session: Stripe.Checkout.Session = {
      ...makeStandardCheckoutSession({
        attemptId: null,
        intentHash: null,
        subscriptionId: "sub_legacy_expired",
      }),
      expires_at: sessionExpiresAt,
      id: "cs_legacy_expired",
    };
    mocks.acceptHostedMemberStripeCheckoutCompletionTx.mockResolvedValueOnce({
      kind: "cleanup_superseded",
    });

    await expect(applyStripeCheckoutCompleted(
      session,
      {} as never,
      undefined,
      new Date((sessionExpiresAt + 3 * 24 * 60 * 60) * 1_000 + 1),
    )).resolves.toMatchObject({
      cleanupCheckoutSubscription: {
        checkoutSessionId: "cs_legacy_expired",
        memberId: "member_123",
        reason: "superseded",
        stripeSubscriptionId: "sub_legacy_expired",
      },
      welcomeEmailMemberId: null,
    });

    expect(mocks.acceptHostedMemberStripeCheckoutCompletionTx).toHaveBeenCalledWith(
      expect.objectContaining({
        allowLegacyCompletion: false,
        checkoutAttemptId: null,
        checkoutIntentHash: null,
      }),
    );
    expect(mocks.stripeSubscriptionsRetrieve).not.toHaveBeenCalled();
  });

  it.each([
    ["client_reference_id", "member_from_client_reference"],
    ["exact customer/subscription binding", "member_from_exact_binding"],
  ] as const)(
    "fails closed when standard Checkout metadata conflicts with the %s owner",
    async (_conflictSource, conflictingMemberId) => {
      const session = makeStandardCheckoutSession({
        attemptId: null,
        intentHash: null,
        subscriptionId: "sub_conflicting",
      });
      if (conflictingMemberId === "member_from_client_reference") {
        session.client_reference_id = conflictingMemberId;
      }
      mocks.listHostedStripeCheckoutSessionMemberIds.mockResolvedValueOnce([
        "member_123",
        conflictingMemberId,
      ]);

      await expect(
        applyStripeCheckoutCompleted(session, {} as never),
      ).rejects.toThrow(
        "Completed standard Checkout Session resolved to conflicting member owners.",
      );

      expect(mocks.readHostedMemberFamilyBillingClaim).not.toHaveBeenCalled();
      expect(mocks.acceptHostedMemberStripeCheckoutCompletionTx).not.toHaveBeenCalled();
    },
  );

  it("fails closed without cleanup when a standard Session names a Family-owned subscription", async () => {
    const session = makeStandardCheckoutSession({
      attemptId: "attempt_direct_123",
      intentHash: "intent_direct_123",
      subscriptionId: "sub_family_owned",
    });
    mocks.lookupHostedAccountGroupStripeBillingRefByStripeSubscriptionId
      .mockResolvedValueOnce({
        billingRef: {
          stripeCustomerId: "cus_123",
          stripeSubscriptionId: "sub_family_owned",
        },
        group: {
          id: "group_123",
          ownerMemberId: "member_123",
        },
      });

    await expect(
      applyStripeCheckoutCompleted(session, {} as never),
    ).rejects.toThrow(
      "Completed standard Checkout subscription already belongs to a Family billing owner.",
    );

    expect(mocks.acceptHostedMemberStripeCheckoutCompletionTx).not.toHaveBeenCalled();
    expect(mocks.readHostedStripeRecurringFinancialState).not.toHaveBeenCalled();
    expect(mocks.activateHostedMemberForPositiveSourceTx).not.toHaveBeenCalled();
  });

  it("returns exact loser cleanup for a legacy standard Checkout whose member was deleted", async () => {
    mocks.findMemberForStripeCheckoutSession.mockResolvedValueOnce(null);
    const session = makeStandardCheckoutSession({
      attemptId: null,
      intentHash: null,
      subscriptionId: "sub_deleted_member",
    });

    await expect(
      applyStripeCheckoutCompleted(session, {} as never),
    ).resolves.toMatchObject({
      cleanupCheckoutSubscription: {
        checkoutAttemptId: null,
        checkoutIntentHash: null,
        checkoutSessionId: session.id,
        memberId: "member_123",
        reason: "superseded",
        stripeSubscriptionId: "sub_deleted_member",
      },
      welcomeEmailMemberId: null,
    });

    expect(mocks.acceptHostedMemberStripeCheckoutCompletionTx).not.toHaveBeenCalled();
    expect(mocks.readHostedStripeRecurringFinancialState).not.toHaveBeenCalled();
    expect(mocks.activateHostedMemberForPositiveSourceTx).not.toHaveBeenCalled();
  });

  it("returns exact loser cleanup for a legacy standard Checkout completed after suspension", async () => {
    mocks.findMemberForStripeCheckoutSession.mockResolvedValueOnce(
      makeMemberSnapshot({
        suspendedAt: new Date("2026-04-24T00:00:00.000Z"),
      }),
    );
    const session = makeStandardCheckoutSession({
      attemptId: null,
      intentHash: null,
      subscriptionId: "sub_post_suspension",
    });

    await expect(
      applyStripeCheckoutCompleted(session, {} as never),
    ).resolves.toMatchObject({
      cleanupCheckoutSubscription: {
        checkoutAttemptId: null,
        checkoutIntentHash: null,
        memberId: "member_123",
        reason: "superseded",
        stripeSubscriptionId: "sub_post_suspension",
      },
    });
    expect(mocks.acceptHostedMemberStripeCheckoutCompletionTx).not.toHaveBeenCalled();
  });

  it("clears only the standard checkout attempt whose stored Session exactly expired", async () => {
    let storedSessionId: string | null = "cs_current";
    mocks.clearHostedMemberStripeCheckoutAttemptForSessionTx
      .mockImplementation(async ({ sessionId }: { sessionId: string }) => {
        if (sessionId !== storedSessionId) {
          return false;
        }
        storedSessionId = null;
        return true;
      });
    const staleSession = makeStandardCheckoutSession({
      attemptId: "attempt_old",
      intentHash: "intent_old",
      subscriptionId: "sub_old",
    });
    staleSession.id = "cs_old";
    const currentSession = makeStandardCheckoutSession({
      attemptId: "attempt_current",
      intentHash: "intent_current",
      subscriptionId: "sub_current",
    });
    currentSession.id = "cs_current";

    await applyStripeCheckoutExpired(staleSession, {} as never);
    expect(storedSessionId).toBe("cs_current");

    await applyStripeCheckoutExpired(currentSession, {} as never);
    expect(storedSessionId).toBeNull();
    expect(
      mocks.clearHostedMemberStripeCheckoutAttemptForSessionTx,
    ).toHaveBeenNthCalledWith(2, {
      memberId: "member_123",
      sessionId: "cs_current",
      tx: {},
    });
  });

  it("clears the exact Family checkout attempt when its Session expires", async () => {
    const session = makeFamilyCheckoutSession();
    const tx = {};
    mocks.findHostedAccountGroupForStripeCheckoutSession.mockResolvedValueOnce({
      id: "family_123",
    });
    mocks.clearHostedFamilyCheckoutAttemptForSession.mockResolvedValueOnce(true);

    await applyStripeCheckoutExpired(session, tx as never);

    expect(mocks.clearHostedFamilyCheckoutAttemptForSession).toHaveBeenCalledWith({
      groupId: "family_123",
      prisma: tx,
      sessionId: "cs_family_123",
    });
    expect(
      mocks.clearHostedMemberStripeCheckoutAttemptForSessionTx,
    ).not.toHaveBeenCalled();
  });

  it("canonically projects Family checkout completion after an earlier subscription event no-ops", async () => {
    const subscription = makeStripeSubscription({
      customer: "cus_family",
      id: "sub_family",
      status: "active",
    });
    const dispatchContext = {
      eventCreatedAt: new Date("2026-04-23T00:00:00.000Z"),
      occurredAt: "2026-04-23T00:00:00.000Z",
      sourceEventId: "evt_family_checkout",
      sourceType: "stripe.checkout.session.completed",
    } as const;
    mocks.findMemberForStripeSubscription.mockResolvedValueOnce(null);
    mocks.applyHostedFamilyStripeSubscriptionUpdatedTx
      .mockResolvedValueOnce({
        activations: [],
        groupId: null,
      })
      .mockResolvedValueOnce({
        activations: [],
        groupId: "hbag_family",
      });

    await expect(applyStripeSubscriptionUpdated(
      subscription,
      {
        ...dispatchContext,
        sourceEventId: "evt_family_subscription_first",
        sourceType: "stripe.customer.subscription.created",
      },
      {} as never,
    )).resolves.toMatchObject({
      activatedMemberId: null,
    });

    mocks.applyHostedFamilyStripeCheckoutCompletedTx.mockResolvedValueOnce({
      groupId: "hbag_family",
    });
    mocks.lookupHostedAccountGroupStripeBillingRefByStripeSubscriptionId
      .mockResolvedValueOnce({
        billingRef: {
          stripeCustomerId: "cus_family",
          stripeSubscriptionId: "sub_family",
        },
        group: {
          id: "hbag_family",
          ownerMemberId: "member_owner",
        },
      });
    mocks.stripeSubscriptionsRetrieve.mockResolvedValueOnce(subscription);

    await expect(
      applyStripeCheckoutCompleted(
        makeFamilyCheckoutSession(),
        {} as never,
        dispatchContext,
      ),
    ).resolves.toMatchObject({
      activatedMemberId: null,
      hostedExecutionEventId: null,
      welcomeEmailMemberId: null,
    });

    expect(mocks.stripeSubscriptionsRetrieve).toHaveBeenCalledWith(
      "sub_family",
      {
        expand: [
          "customer",
          "items.data.price",
          "latest_invoice",
        ],
      },
    );
    expect(mocks.readHostedStripeRecurringFinancialState).toHaveBeenCalledWith(
      subscription,
    );
    expect(mocks.applyHostedFamilyStripeSubscriptionUpdatedTx)
      .toHaveBeenLastCalledWith({
        dispatchContext,
        subscription,
        tx: {},
      });
    expect(mocks.findMemberForStripeCheckoutSession).not.toHaveBeenCalled();
    expect(mocks.writeHostedMemberStripeBillingRefIfFreshTx).not.toHaveBeenCalled();
    expect(mocks.activateHostedMemberForPositiveSourceTx).not.toHaveBeenCalled();
  });

  it("keeps an accepted Family checkout unpaid when canonical current-period funding is blocked", async () => {
    const subscription = makeStripeSubscription({
      customer: "cus_family",
      id: "sub_family",
      status: "active",
    });
    mocks.applyHostedFamilyStripeCheckoutCompletedTx.mockResolvedValueOnce({
      groupId: "hbag_family",
    });
    mocks.lookupHostedAccountGroupStripeBillingRefByStripeSubscriptionId
      .mockResolvedValueOnce({
        billingRef: {
          stripeCustomerId: "cus_family",
          stripeSubscriptionId: "sub_family",
        },
        group: {
          id: "hbag_family",
          ownerMemberId: "member_owner",
        },
      });
    mocks.stripeSubscriptionsRetrieve.mockResolvedValueOnce(subscription);
    mocks.readHostedStripeRecurringFinancialState.mockResolvedValueOnce(
      makeRecurringFinancialState({
        outstandingDispute: true,
      }),
    );

    await expect(
      applyStripeCheckoutCompleted(
        makeFamilyCheckoutSession(),
        {} as never,
      ),
    ).resolves.toMatchObject({
      activatedMemberId: null,
      hostedExecutionEventId: null,
      welcomeEmailMemberId: null,
    });

    expect(mocks.setHostedFamilyStripeBillingReversalStateTx)
      .toHaveBeenCalledWith({
        billingStatus: HostedBillingStatus.unpaid,
        groupId: "hbag_family",
        subscription,
        tx: {},
        verifiedOwnerMemberId: "member_owner",
      });
    expect(mocks.applyHostedFamilyStripeSubscriptionUpdatedTx)
      .not.toHaveBeenCalled();
  });

  it("treats an open Family billing claim as authoritative before direct Checkout acceptance", async () => {
    const familyBillingClaim = {
      checkoutAttemptId: "family_attempt_123",
      groupId: "family_123",
      kind: "checkout_attempt" as const,
      ownerMemberId: "owner_123",
    };
    mocks.readHostedMemberFamilyBillingClaim.mockResolvedValueOnce(
      familyBillingClaim,
    );

    await expect(applyStripeCheckoutCompleted(
      makeStandardCheckoutSession({
        attemptId: "attempt_direct_123",
        intentHash: "intent_direct_123",
        subscriptionId: "sub_direct_123",
      }),
      {} as never,
    )).resolves.toMatchObject({
      cleanupCheckoutSubscription: {
        familyBillingClaim,
        memberId: "member_123",
        reason: "family_sponsored",
        stripeSubscriptionId: "sub_direct_123",
      },
      welcomeEmailMemberId: null,
    });

    expect(mocks.acceptHostedMemberStripeCheckoutCompletionTx).not.toHaveBeenCalled();
  });

  it("keeps stale standard subscription and invoice events from beating the current Checkout attempt", async () => {
    const pendingWinner = makeMemberSnapshot({
      billingRef: {
        checkoutAttemptId: "attempt_b",
        checkoutIntentHash: "intent_b",
        memberId: "member_123",
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: null,
      },
    });
    const staleSubscription = makeStripeSubscription({
      id: "sub_a",
      metadata: {
        billingPlanCode: "launch_monthly",
        checkoutAttemptId: "attempt_a",
        checkoutIntentHash: "intent_a",
        checkoutOffer: "standard",
        memberId: "member_123",
      },
      status: "active",
    });
    const staleLegacySubscription = makeStripeSubscription({
      id: "sub_legacy_a",
      metadata: {
        billingPlanCode: "launch_monthly",
        checkoutOffer: "standard",
        memberId: "member_123",
      },
      status: "active",
    });
    const dispatchContext = {
      eventCreatedAt: new Date("2026-04-23T00:00:00.000Z"),
      occurredAt: "2026-04-23T00:00:00.000Z",
      sourceEventId: "evt_stale_a",
      sourceType: "stripe.customer.subscription.created",
    };
    mocks.findMemberForStripeSubscription.mockResolvedValue(pendingWinner);
    mocks.findMemberForStripeInvoice.mockResolvedValue(pendingWinner);
    mocks.findMemberForStripeCheckoutSession.mockResolvedValue(pendingWinner);
    mocks.acceptHostedMemberStripeCheckoutCompletionTx.mockResolvedValueOnce({
      billingRef: {
        memberId: "member_123",
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_b",
      },
      kind: "accepted",
    });

    await expect(applyStripeSubscriptionUpdated(
      staleSubscription,
      dispatchContext,
      {} as never,
    )).resolves.toMatchObject({
      activatedMemberId: null,
      welcomeEmailMemberId: null,
    });
    await expect(applyStripeInvoicePaid(
      makeStripeInvoice({
        id: "in_stale_a",
        subscription: "sub_a",
      }),
      {
        ...dispatchContext,
        sourceEventId: "evt_stale_a_paid",
        sourceType: "stripe.invoice.paid",
      },
      {} as never,
      HostedBillingStatus.active,
      staleSubscription,
    )).resolves.toMatchObject({
      activatedMemberId: null,
      welcomeEmailMemberId: null,
    });
    await expect(applyStripeSubscriptionUpdated(
      staleLegacySubscription,
      {
        ...dispatchContext,
        sourceEventId: "evt_stale_legacy_a",
      },
      {} as never,
    )).resolves.toMatchObject({
      activatedMemberId: null,
      welcomeEmailMemberId: null,
    });
    await expect(applyStripeInvoicePaid(
      makeStripeInvoice({
        id: "in_stale_legacy_a",
        subscription: "sub_legacy_a",
      }),
      {
        ...dispatchContext,
        sourceEventId: "evt_stale_legacy_a_paid",
        sourceType: "stripe.invoice.paid",
      },
      {} as never,
      HostedBillingStatus.active,
      staleLegacySubscription,
    )).resolves.toMatchObject({
      activatedMemberId: null,
      welcomeEmailMemberId: null,
    });

    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
    expect(mocks.acceptHostedMemberStripeCheckoutCompletionTx).not.toHaveBeenCalled();

    const acceptedWinner = makeMemberSnapshot({
      billingRef: {
        checkoutAttemptId: null,
        checkoutIntentHash: null,
        memberId: "member_123",
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_b",
      },
    });
    mocks.findMemberForStripeInvoice.mockResolvedValue(acceptedWinner);
    mocks.prepareHostedMemberStripeBillingWrite.mockResolvedValue({
      canonicalBillingStatus: HostedBillingStatus.active,
      member: acceptedWinner,
    });
    await expect(applyStripeCheckoutCompleted(
      makeStandardCheckoutSession({
        attemptId: "attempt_b",
        intentHash: "intent_b",
        subscriptionId: "sub_b",
      }),
      {} as never,
    )).resolves.toMatchObject({
      activatedMemberId: "member_123",
      welcomeEmailMemberId: "member_123",
    });

    expect(mocks.acceptHostedMemberStripeCheckoutCompletionTx).toHaveBeenCalledOnce();
    expect(mocks.acceptHostedMemberStripeCheckoutCompletionTx).toHaveBeenCalledWith(
      expect.objectContaining({
        checkoutAttemptId: "attempt_b",
        checkoutIntentHash: "intent_b",
        checkoutSessionId: "cs_b",
        memberId: "member_123",
        stripeSubscriptionId: "sub_b",
      }),
    );
  });

  it("continues projecting generic events after the exact standard Checkout subscription is accepted", async () => {
    const acceptedMember = makeMemberSnapshot({
      billingRef: {
        checkoutAttemptId: null,
        checkoutIntentHash: null,
        memberId: "member_123",
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_a",
      },
    });
    mocks.findMemberForStripeSubscription.mockResolvedValueOnce(acceptedMember);
    mocks.prepareHostedMemberStripeBillingWrite.mockResolvedValueOnce({
      canonicalBillingStatus: HostedBillingStatus.active,
      member: acceptedMember,
    });

    await applyStripeSubscriptionUpdated(
      makeStripeSubscription({
        id: "sub_a",
        metadata: {
          billingPlanCode: "launch_monthly",
          checkoutAttemptId: "attempt_a",
          checkoutIntentHash: "intent_a",
          checkoutOffer: "standard",
          memberId: "member_123",
        },
        status: "active",
      }),
      {
        eventCreatedAt: new Date("2026-04-23T00:00:00.000Z"),
        occurredAt: "2026-04-23T00:00:00.000Z",
        sourceEventId: "evt_accepted_a",
        sourceType: "stripe.customer.subscription.updated",
      },
      {} as never,
    );

    expect(mocks.writeHostedMemberStripeBillingTx).toHaveBeenCalledWith(
      expect.objectContaining({
        stripeSubscriptionId: "sub_a",
      }),
    );
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
    mocks.findMemberForStripeInvoice.mockResolvedValueOnce(
      makeMemberSnapshot({
        billingRef: {
          memberId: "member_123",
          stripeCustomerId: "cus_123",
          stripeSubscriptionId: "sub_superseded",
        },
      }),
    );
    mocks.readActiveHostedFamilySponsorship.mockResolvedValueOnce(true);
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
      welcomeEmailMemberId: null,
    });

    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
    expect(mocks.activateHostedMemberForPositiveSourceTx).not.toHaveBeenCalled();
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

  it("keeps a welcome candidate when invoice activation already has a durable wake", async () => {
    const updatedMember = makeMemberSnapshot({
      billingStatus: HostedBillingStatus.active,
    });
    mocks.writeHostedMemberStripeBillingTx.mockResolvedValueOnce(updatedMember);
    mocks.activateHostedMemberForPositiveSourceTx.mockResolvedValueOnce({
      activated: false,
      hostedExecutionEventId: "wake_existing",
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
      activatedMemberId: null,
      hostedExecutionEventId: "wake_existing",
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
      hostedExecutionEventId: null,
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
      billingModeChangedMemberIds: ["member_owner"],
      groupId: "hbag_family",
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

  it("reconciles a direct-to-Family usage handoff from invoice.paid", async () => {
    mocks.applyHostedFamilyStripeSubscriptionUpdatedTx.mockResolvedValueOnce({
      activations: [],
      billingModeChangedMemberIds: ["member_owner"],
      groupId: "hbag_family",
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

    await applyStripeInvoicePaid(
      makeStripeInvoice({
        billingReason: "subscription_cycle",
        id: "in_trial_conversion",
        subscription: "sub_123",
      }),
      {
        eventCreatedAt: new Date("2026-04-19T00:00:00.000Z"),
        occurredAt: "2026-04-19T00:00:00.000Z",
        sourceEventId: "evt_trial_conversion",
        sourceType: "stripe.invoice.paid",
      },
      {} as never,
      HostedBillingStatus.active,
      makeStripeSubscription({
        currentPeriodEnd: 1_747_612_800,
        currentPeriodStart: 1_745_020_800,
        metadata: {
          checkoutOffer: "pulse_trial_7d",
        },
        status: "active",
        trialEnd: 1_745_020_800,
        trialStart: 1_744_416_000,
      }),
    );

    expect(mocks.writeHostedMemberStripeBillingTx).toHaveBeenCalledWith(expect.objectContaining({
      currentBillingPhase: "paid",
      currentCheckoutOffer: "pulse_trial_7d",
      freshnessPolicy: "positive-invoice-entitlement",
    }));
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

  it.each([
    ["a cumulative full refund", {
      fullyRefunded: true,
      outstandingDispute: false,
    }],
    ["an outstanding dispute", {
      fullyRefunded: false,
      outstandingDispute: true,
    }],
  ])("blocks member billing when the canonical recurring state has %s", async (
    _description,
    blockers,
  ) => {
    const subscription = makeStripeSubscription({ status: "active" });
    const tx = { id: "tx" };
    mocks.readHostedStripeRecurringFinancialState.mockResolvedValueOnce(
      makeRecurringFinancialState(blockers),
    );

    await expect(applyStripeRecurringFinancialState({
      dispatchContext: {
        eventCreatedAt: new Date("2026-04-25T00:00:00.000Z"),
        sourceEventId: "evt_financial_blocked",
        sourceType: "stripe.charge.dispute.updated",
      },
      owner: makeMemberBillingOwner(),
      restoreWhenHealthy: true,
      subscription,
      tx: tx as never,
    })).resolves.toEqual({
      blockActiveProjection: true,
      state: "blocked",
    });

    expect(mocks.readHostedStripeRecurringFinancialState).toHaveBeenCalledWith(
      subscription,
    );
    expect(mocks.writeHostedMemberStripeBillingTx).toHaveBeenCalledWith(
      expect.objectContaining({
        billingStatus: HostedBillingStatus.unpaid,
        canonicalBillingStatus: null,
        dispatchContext: expect.objectContaining({
          sourceEventId: "evt_financial_blocked",
          sourceType: "stripe.billing.financial_state",
        }),
        freshnessPolicy: "canonical-financial-state",
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
        tx,
      }),
    );
    const billingWrite = mocks.writeHostedMemberStripeBillingTx.mock.calls.at(-1)?.[0];
    expect(billingWrite).not.toHaveProperty("suspendedAtOverride");
  });

  it("restores the exact member owner only from a paid blocker-free canonical state", async () => {
    const member = makeMemberSnapshot({
      billingStatus: HostedBillingStatus.unpaid,
    });
    const subscription = makeStripeSubscription({ status: "active" });
    mocks.findMemberForStripeSubscription.mockResolvedValueOnce(member);
    mocks.readHostedStripeRecurringFinancialState.mockResolvedValueOnce(
      makeRecurringFinancialState(),
    );

    await expect(applyStripeRecurringFinancialState({
      dispatchContext: {
        eventCreatedAt: new Date("2026-04-26T00:00:00.000Z"),
        sourceEventId: "evt_dispute_funds_reinstated",
        sourceType: "stripe.charge.dispute.funds_reinstated",
      },
      owner: makeMemberBillingOwner(),
      restoreWhenHealthy: true,
      subscription,
      tx: {} as never,
    })).resolves.toEqual({
      blockActiveProjection: false,
      state: "healthy",
    });

    expect(mocks.writeHostedMemberStripeBillingTx).toHaveBeenCalledWith(
      expect.objectContaining({
        billingStatus: HostedBillingStatus.active,
        canonicalBillingStatus: null,
        freshnessPolicy: "canonical-financial-state",
        member,
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
      }),
    );
    const billingWrite = mocks.writeHostedMemberStripeBillingTx.mock.calls.at(-1)?.[0];
    expect(billingWrite).not.toHaveProperty("suspendedAtOverride");
  });

  it("does not restore a healthy owner when the trigger only guards a positive projection", async () => {
    await expect(applyStripeRecurringFinancialState({
      dispatchContext: {
        eventCreatedAt: new Date("2026-04-26T00:00:00.000Z"),
        sourceEventId: "evt_invoice_paid",
        sourceType: "stripe.invoice.paid",
      },
      owner: makeMemberBillingOwner(),
      restoreWhenHealthy: false,
      subscription: makeStripeSubscription({ status: "active" }),
      tx: {} as never,
    })).resolves.toEqual({
      blockActiveProjection: false,
      state: "healthy",
    });

    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
  });

  it("suppresses a positive projection but preserves existing entitlement while collection is processing", async () => {
    mocks.readHostedStripeRecurringFinancialState.mockResolvedValueOnce({
      collectionState: {
        advancingEvent: "invoice.paid",
        deadlineUnixSeconds: 1_778_000_000,
        invoiceId: "in_123",
        invoicePaymentId: "inpay_123",
        kind: "processing",
        paymentIntentId: "pi_123",
      },
      fullyRefunded: false,
      invoiceId: "in_123",
      outstandingDispute: false,
    });

    await expect(applyStripeRecurringFinancialState({
      dispatchContext: {
        eventCreatedAt: new Date("2026-04-26T00:00:00.000Z"),
        sourceEventId: "evt_processing",
        sourceType: "stripe.invoice.payment_failed",
      },
      owner: makeMemberBillingOwner(),
      restoreWhenHealthy: false,
      subscription: makeStripeSubscription({ status: "active" }),
      tx: {} as never,
    })).resolves.toEqual({
      blockActiveProjection: true,
      state: "unsettled",
    });

    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
    expect(mocks.setHostedFamilyStripeBillingReversalStateTx).not.toHaveBeenCalled();
  });

  const paymentRequiredCollectionState = {
    advancingEvent: "invoice.paid" as const,
    deadlineUnixSeconds: 1_778_000_000,
    invoiceId: "in_123",
    invoicePaymentId: "inpay_123",
    kind: "payment_required" as const,
    paymentIntentId: "pi_123",
    paymentUrl: "https://example.com/invoice",
  };
  const voidedCollectionState = {
    invoiceId: "in_123",
    invoicePaymentId: "inpay_123",
    kind: "voided" as const,
    paymentIntentId: "pi_123",
  };
  it.each([
    ["member", makeMemberBillingOwner(), "payment required", paymentRequiredCollectionState],
    ["member", makeMemberBillingOwner(), "terminal", voidedCollectionState],
    ["Family", makeFamilyBillingOwner(), "payment required", paymentRequiredCollectionState],
    ["Family", makeFamilyBillingOwner(), "terminal", voidedCollectionState],
  ] as const)(
    "blocks existing %s entitlement while canonical collection is %s",
    async (_ownerDescription, owner, _collectionDescription, collectionState) => {
      mocks.readHostedStripeRecurringFinancialState.mockResolvedValueOnce({
        collectionState,
        fullyRefunded: false,
        invoiceId: "in_123",
        outstandingDispute: false,
      });

      await expect(applyStripeRecurringFinancialState({
        dispatchContext: {
          eventCreatedAt: new Date("2026-04-26T00:00:00.000Z"),
          sourceEventId: "evt_stale_positive",
          sourceType: "stripe.invoice.paid",
        },
        owner,
        restoreWhenHealthy: false,
        subscription: makeStripeSubscription({ status: "active" }),
        tx: {} as never,
      })).resolves.toEqual({
        blockActiveProjection: true,
        state: "blocked",
      });

      if (owner.kind === "member") {
        expect(mocks.writeHostedMemberStripeBillingTx).toHaveBeenCalledWith(
          expect.objectContaining({
            billingStatus: HostedBillingStatus.unpaid,
          }),
        );
      } else {
        expect(mocks.setHostedFamilyStripeBillingReversalStateTx)
          .toHaveBeenCalledWith(expect.objectContaining({
            billingStatus: HostedBillingStatus.unpaid,
            groupId: owner.groupId,
          }));
      }
    },
  );

  it("projects canonical financial blockers to the exact Family owner", async () => {
    const tx = { id: "family-tx" };
    mocks.readHostedStripeRecurringFinancialState.mockResolvedValueOnce(
      makeRecurringFinancialState({
        fullyRefunded: false,
        outstandingDispute: true,
      }),
    );

    await expect(applyStripeRecurringFinancialState({
      dispatchContext: {
        eventCreatedAt: new Date("2026-04-25T00:00:00.000Z"),
        sourceEventId: "evt_family_dispute",
        sourceType: "stripe.charge.dispute.updated",
      },
      owner: makeFamilyBillingOwner(),
      restoreWhenHealthy: true,
      subscription: makeStripeSubscription({ status: "active" }),
      tx: tx as never,
    })).resolves.toEqual({
      blockActiveProjection: true,
      state: "blocked",
    });

    expect(mocks.setHostedFamilyStripeBillingReversalStateTx).toHaveBeenCalledWith({
      billingStatus: HostedBillingStatus.unpaid,
      groupId: "family_123",
      subscription: expect.objectContaining({ id: "sub_123" }),
      tx,
      verifiedOwnerMemberId: "owner_123",
    });
    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
  });

  it("keeps the exact Family owner active after same-created increases are fully unwound", async () => {
    const owner = makeFamilyBillingOwner();
    const subscription = makeStripeSubscription({ status: "active" });
    const tx = { id: "family-refund-recovery-tx" };
    mocks.readHostedStripeRecurringFinancialState.mockResolvedValueOnce(
      makeRecurringFinancialState({
        fullyRefunded: false,
        outstandingDispute: false,
      }),
    );

    await expect(applyStripeRecurringFinancialState({
      dispatchContext: {
        eventCreatedAt: new Date("2026-04-25T00:00:00.000Z"),
        sourceEventId: "evt_family_refund_reconciled",
        sourceType: "stripe.refund.updated",
      },
      owner,
      restoreWhenHealthy: true,
      subscription,
      tx: tx as never,
    })).resolves.toEqual({
      blockActiveProjection: false,
      state: "healthy",
    });

    expect(mocks.setHostedFamilyStripeBillingReversalStateTx).toHaveBeenCalledWith({
      billingStatus: HostedBillingStatus.active,
      groupId: owner.groupId,
      subscription,
      tx,
      verifiedOwnerMemberId: owner.lockMemberId,
    });
    expect(mocks.readHostedStripeRecurringFinancialState).toHaveBeenCalledWith(
      subscription,
    );
    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
  });

  it("blocks the exact Family owner when a refunded same-created contribution remains", async () => {
    const owner = makeFamilyBillingOwner();
    const subscription = makeStripeSubscription({ status: "active" });
    const tx = { id: "family-retained-refund-tx" };
    mocks.readHostedStripeRecurringFinancialState.mockResolvedValueOnce(
      makeRecurringFinancialState({
        fullyRefunded: true,
        outstandingDispute: false,
      }),
    );

    await expect(applyStripeRecurringFinancialState({
      dispatchContext: {
        eventCreatedAt: new Date("2026-04-25T00:00:00.000Z"),
        sourceEventId: "evt_family_retained_refund",
        sourceType: "stripe.refund.updated",
      },
      owner,
      restoreWhenHealthy: true,
      subscription,
      tx: tx as never,
    })).resolves.toEqual({
      blockActiveProjection: true,
      state: "blocked",
    });

    expect(mocks.setHostedFamilyStripeBillingReversalStateTx).toHaveBeenCalledWith({
      billingStatus: HostedBillingStatus.unpaid,
      groupId: owner.groupId,
      subscription,
      tx,
      verifiedOwnerMemberId: owner.lockMemberId,
    });
    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
  });

  it("fails closed when the exact Family owner changes before projection", async () => {
    mocks.readHostedStripeRecurringFinancialState.mockResolvedValueOnce(
      makeRecurringFinancialState({
        fullyRefunded: true,
      }),
    );
    mocks.setHostedFamilyStripeBillingReversalStateTx.mockResolvedValueOnce(false);

    await expect(applyStripeRecurringFinancialState({
      dispatchContext: {
        eventCreatedAt: new Date("2026-04-25T00:00:00.000Z"),
        sourceEventId: "evt_family_refund",
        sourceType: "stripe.refund.updated",
      },
      owner: makeFamilyBillingOwner(),
      restoreWhenHealthy: true,
      subscription: makeStripeSubscription({ status: "active" }),
      tx: {} as never,
    })).rejects.toThrow(
      "Exact Family billing owner disappeared during financial reconciliation.",
    );

    expect(mocks.setHostedFamilyStripeBillingReversalStateTx).toHaveBeenCalled();
  });

  it.each([
    ["stripe.invoice.payment_action_required", makeMemberBillingOwner()],
    ["stripe.invoice.voided", makeFamilyBillingOwner()],
    ["stripe.invoice.payment_failed", makeMemberBillingOwner()],
    ["stripe.invoice.payment_failed", makeFamilyBillingOwner()],
  ] as const)(
    "ignores delayed %s after the canonical invoice has been paid",
    async (sourceType, owner) => {
      const canonicalSubscription = makeStripeSubscription({
        latestInvoice: "in_123",
      });
      mocks.stripeInvoicesRetrieve.mockResolvedValueOnce(
        makeStripeInvoice({
          id: "in_123",
          status: "paid",
          subscription: canonicalSubscription.id,
        }),
      );

      await applyStripeInvoiceCollectionStateChanged(
        {
          eventCreatedAt: new Date("2026-04-25T00:00:00.000Z"),
          occurredAt: "2026-04-25T00:00:00.000Z",
          sourceEventId: "evt_delayed_collection",
          sourceType,
        },
        {} as never,
        canonicalSubscription,
        owner,
      );

      expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
      expect(mocks.setHostedFamilyStripeBillingReversalStateTx).not.toHaveBeenCalled();
    },
  );

  it("blocks an active owner from an unpaid current-period base even after a later paid delta", async () => {
    const canonicalSubscription = makeStripeSubscription({
      latestInvoice: "in_paid_delta",
    });
    mocks.readHostedStripeRecurringFinancialState.mockResolvedValueOnce({
      collectionState: {
        advancingEvent: "invoice.paid",
        deadlineUnixSeconds: 1_778_000_000,
        invoiceId: "in_unpaid_base",
        invoicePaymentId: "inpay_base",
        kind: "payment_required",
        paymentIntentId: "pi_base",
        paymentUrl: "https://example.com/invoice",
      },
      fullyRefunded: false,
      invoiceId: "in_unpaid_base",
      outstandingDispute: false,
    });

    await applyStripeInvoiceCollectionStateChanged(
      {
        eventCreatedAt: new Date("2026-04-25T00:00:00.000Z"),
        occurredAt: "2026-04-25T00:00:00.000Z",
        sourceEventId: "evt_delayed_base_failure",
        sourceType: "stripe.invoice.payment_failed",
      },
      {} as never,
      canonicalSubscription,
      makeMemberBillingOwner(),
    );

    expect(mocks.writeHostedMemberStripeBillingTx).toHaveBeenCalledWith(
      expect.objectContaining({
        billingStatus: HostedBillingStatus.unpaid,
        stripeSubscriptionId: canonicalSubscription.id,
      }),
    );
  });
});

function makeMemberSnapshot(input?: {
  billingStatus?: HostedBillingStatus;
  billingRef?: HostedMemberBillingSnapshot["billingRef"];
  suspendedAt?: Date | null;
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
      suspendedAt: input?.suspendedAt ?? null,
      updatedAt: new Date("2026-04-23T00:00:00.000Z"),
    },
  };
}

function makeMemberBillingOwner(): Extract<
  HostedStripeBillingOwner,
  { kind: "member" }
> {
  return {
    kind: "member",
    lockMemberId: "member_123",
    memberId: "member_123",
    stripeCustomerId: "cus_123",
    stripeSubscriptionId: "sub_123",
  };
}

function makeFamilyBillingOwner(): Extract<
  HostedStripeBillingOwner,
  { kind: "family" }
> {
  return {
    groupId: "family_123",
    kind: "family",
    lockMemberId: "owner_123",
    stripeCustomerId: "cus_123",
    stripeSubscriptionId: "sub_123",
  };
}

function makeRecurringFinancialState(
  overrides?: Partial<
    Pick<
      HostedStripeRecurringFinancialState,
      "fullyRefunded" | "outstandingDispute"
    >
  >,
): HostedStripeRecurringFinancialState {
  return {
    collectionState: {
      invoiceId: "in_123",
      invoicePaymentId: "inpay_123",
      kind: "paid",
      paymentIntentId: "pi_123",
    },
    fullyRefunded: overrides?.fullyRefunded ?? false,
    invoiceId: "in_123",
    outstandingDispute: overrides?.outstandingDispute ?? false,
  };
}

function makeStripeInvoice(
  overrides?: Partial<{
    amountPaid: number;
    amountRemaining: number;
    attempted: boolean;
    billingReason: string | null;
    charge: string | null;
    customer: string | null;
    customerEmail: string | null;
    id: string;
    invoicePayments: Stripe.InvoicePayment[];
    paymentIntent: string | null;
    subscription: string | null;
    status: Stripe.Invoice["status"];
  }>,
): Stripe.Invoice {
  // @ts-expect-error - the synthetic fixture is intentionally narrower than Stripe.Invoice.
  return {
    amount_paid: overrides?.amountPaid ?? 5_000,
    ...(overrides?.amountRemaining === undefined
      ? {}
      : { amount_remaining: overrides.amountRemaining }),
    ...(overrides?.attempted === undefined
      ? {}
      : { attempted: overrides.attempted }),
    billing_reason: overrides?.billingReason ?? null,
    charge: overrides?.charge ?? "ch_123",
    customer: overrides?.customer ?? "cus_123",
    customer_email: overrides?.customerEmail ?? null,
    id: overrides?.id ?? "in_123",
    payment_intent: overrides?.paymentIntent ?? "pi_123",
    payments: {
      data: overrides?.invoicePayments ?? [],
    },
    subscription: overrides?.subscription ?? "sub_123",
    ...(overrides?.status === undefined ? {} : { status: overrides.status }),
  } as Stripe.Invoice;
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
    pendingUpdate: Stripe.Subscription.PendingUpdate | null;
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
      data: (overrides?.items ?? []).map((priceId, index) => ({
        id: `si_${index}`,
        ...(itemCurrentPeriodEnd === undefined ? {} : { current_period_end: itemCurrentPeriodEnd }),
        ...(itemCurrentPeriodStart === undefined ? {} : { current_period_start: itemCurrentPeriodStart }),
        price: {
          id: priceId,
        },
      })),
    },
    metadata: overrides?.metadata ?? {},
    pending_update:
      overrides && "pendingUpdate" in overrides
        ? overrides.pendingUpdate ?? null
        : null,
    status: overrides?.status ?? "active",
    trial_end: overrides?.trialEnd ?? null,
    trial_start: overrides?.trialStart ?? null,
  } as Stripe.Subscription;
}

function makeFamilyCheckoutSession(): Stripe.Checkout.Session {
  const session: Partial<Stripe.Checkout.Session> = {
    created: 1_714_700_800,
    customer: "cus_family",
    id: "cs_family_123",
    metadata: {
      kind: "hosted_family_plan",
    },
    subscription: "sub_family",
  };
  return session as Stripe.Checkout.Session;
}

function makeStandardCheckoutSession(input: {
  attemptId: string | null;
  intentHash: string | null;
  subscriptionId: string;
}): Stripe.Checkout.Session {
  const session: Partial<Stripe.Checkout.Session> = {
    created: 1_714_700_800,
    customer: "cus_123",
    customer_details: {
      address: null,
      business_name: null,
      email: "payer@example.com",
      individual_name: null,
      name: null,
      phone: null,
      tax_exempt: "none",
      tax_ids: [],
    },
    id: "cs_b",
    client_reference_id: "member_123",
    metadata: {
      billingPlanCode: "launch_monthly",
      ...(input.attemptId ? { checkoutAttemptId: input.attemptId } : {}),
      ...(input.intentHash ? { checkoutIntentHash: input.intentHash } : {}),
      checkoutOffer: "standard",
      memberId: "member_123",
    },
    subscription: input.subscriptionId,
  };
  return session as Stripe.Checkout.Session;
}
