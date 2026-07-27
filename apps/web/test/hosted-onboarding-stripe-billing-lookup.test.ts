import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({
  lookupHostedAccountGroupStripeBillingRefByStripeSubscriptionId: vi.fn(),
  lookupHostedMemberStripeBillingRefByStripeCustomerId: vi.fn(),
  lookupHostedMemberStripeBillingRefByStripeSubscriptionId: vi.fn(),
  readHostedMemberBillingSnapshot: vi.fn(),
  readHostedMemberCoreState: vi.fn(),
  stripeChargesRetrieve: vi.fn(),
  stripeCustomerBalanceTransactionsList: vi.fn(),
  stripeDisputesList: vi.fn(),
  stripeInvoicePaymentsList: vi.fn(),
  stripeInvoiceLineItemsList: vi.fn(),
  stripeInvoicesList: vi.fn(),
  stripeInvoicesRetrieve: vi.fn(),
  stripePaymentIntentsRetrieve: vi.fn(),
  stripeRefundsList: vi.fn(),
  stripeSubscriptionsRetrieve: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/family-plan", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/family-plan")
  >("@/src/lib/hosted-onboarding/family-plan");

  return {
    ...actual,
    lookupHostedAccountGroupStripeBillingRefByStripeSubscriptionId:
      mocks.lookupHostedAccountGroupStripeBillingRefByStripeSubscriptionId,
  };
});

vi.mock("@/src/lib/hosted-onboarding/hosted-member-billing-store", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/hosted-member-billing-store")
  >("@/src/lib/hosted-onboarding/hosted-member-billing-store");

  return {
    ...actual,
    lookupHostedMemberStripeBillingRefByStripeCustomerId:
      mocks.lookupHostedMemberStripeBillingRefByStripeCustomerId,
    lookupHostedMemberStripeBillingRefByStripeSubscriptionId:
      mocks.lookupHostedMemberStripeBillingRefByStripeSubscriptionId,
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
  };
});

vi.mock("@/src/lib/hosted-onboarding/runtime", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/runtime")
  >("@/src/lib/hosted-onboarding/runtime");

  return {
    ...actual,
    requireHostedStripeApi: () => ({
      charges: {
        retrieve: mocks.stripeChargesRetrieve,
      },
      customers: {
        listBalanceTransactions: mocks.stripeCustomerBalanceTransactionsList,
      },
      disputes: {
        list: mocks.stripeDisputesList,
      },
      invoicePayments: {
        list: mocks.stripeInvoicePaymentsList,
      },
      invoices: {
        list: mocks.stripeInvoicesList,
        listLineItems: mocks.stripeInvoiceLineItemsList,
        retrieve: mocks.stripeInvoicesRetrieve,
      },
      paymentIntents: {
        retrieve: mocks.stripePaymentIntentsRetrieve,
      },
      refunds: {
        list: mocks.stripeRefundsList,
      },
      subscriptions: {
        retrieve: mocks.stripeSubscriptionsRetrieve,
      },
    }),
  };
});

import {
  classifyHostedStripeRecurringFinancialHealth,
  findMemberForStripeInvoice,
  findMemberForStripeSubscription,
  HOSTED_STRIPE_RECURRING_FINANCIAL_REQUEST_OPTIONS,
  isHostedStripeUnappliedPendingUpdateInvoice,
  readHostedStripeRecurringFinancialState,
  resolveStripeFinancialContext,
} from "@/src/lib/hosted-onboarding/stripe-billing-lookup";
import { resolveHostedStripeBillingOwner } from "@/src/lib/hosted-onboarding/stripe-billing-owner";

describe("hosted onboarding stripe billing lookup", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.lookupHostedAccountGroupStripeBillingRefByStripeSubscriptionId
      .mockResolvedValue(null);
    mocks.lookupHostedMemberStripeBillingRefByStripeCustomerId.mockResolvedValue(null);
    mocks.lookupHostedMemberStripeBillingRefByStripeSubscriptionId.mockResolvedValue(null);
    mocks.readHostedMemberBillingSnapshot.mockResolvedValue(makeMemberSnapshot());
    mocks.readHostedMemberCoreState.mockResolvedValue(makeHostedMemberCoreState());
    mocks.stripeSubscriptionsRetrieve.mockResolvedValue(
      makeStripeSubscription({
        customer: "cus_live",
        id: "sub_live",
        metadata: {
          memberId: "member_123",
        },
      }),
    );
    mocks.stripeChargesRetrieve.mockResolvedValue(
      makeStripeCharge(),
    );
    mocks.stripeCustomerBalanceTransactionsList.mockResolvedValue({
      data: [],
      has_more: false,
    });
    mocks.stripePaymentIntentsRetrieve.mockResolvedValue(
      makeStripePaymentIntent(),
    );
    mocks.stripeInvoicesRetrieve.mockResolvedValue(
      makeStripeFinancialInvoice(),
    );
    mocks.stripeInvoicesList.mockResolvedValue({
      data: [],
      has_more: false,
    });
    mocks.stripeInvoicePaymentsList.mockImplementation(async (params: {
      invoice?: string;
    }) => ({
      data: [makeStripeInvoicePayment({
        invoice: makeStripeFinancialInvoice({
          id: params.invoice ?? "in_123",
        }),
      })],
      has_more: false,
    }));
    mocks.stripeInvoiceLineItemsList.mockResolvedValue({
      data: [],
      has_more: false,
    });
    mocks.stripeRefundsList.mockResolvedValue({
      data: [],
      has_more: false,
    });
    mocks.stripeDisputesList.mockResolvedValue({
      data: [],
      has_more: false,
    });
  });

  it.each([
    [
      {
        collectionState: {
          invoiceId: "in_123",
          invoicePaymentId: "inpay_123",
          kind: "paid",
          paymentIntentId: "pi_123",
        },
        fullyRefunded: false,
        invoiceId: "in_123",
        outstandingDispute: false,
      },
      { kind: "healthy" },
    ],
    [
      {
        collectionState: { kind: "none" },
        fullyRefunded: false,
        invoiceId: null,
        outstandingDispute: false,
      },
      {
        collectionState: { kind: "none" },
        kind: "blocked",
        reason: "collection_missing",
      },
    ],
    [
      {
        collectionState: {
          invoiceId: "in_123",
          invoicePaymentId: "inpay_123",
          kind: "paid",
          paymentIntentId: "pi_123",
        },
        fullyRefunded: true,
        invoiceId: "in_123",
        outstandingDispute: false,
      },
      expect.objectContaining({
        kind: "blocked",
        reason: "fully_refunded",
      }),
    ],
    [
      {
        collectionState: {
          invoiceId: "in_123",
          invoicePaymentId: "inpay_123",
          kind: "paid",
          paymentIntentId: "pi_123",
        },
        fullyRefunded: false,
        invoiceId: "in_123",
        outstandingDispute: true,
      },
      expect.objectContaining({
        kind: "blocked",
        reason: "outstanding_dispute",
      }),
    ],
  ] as const)(
    "classifies canonical recurring mutation health %#",
    (state, expected) => {
      expect(classifyHostedStripeRecurringFinancialHealth(state)).toEqual(
        expected,
      );
    },
  );

  it("resolves invoice.paid members from the live Stripe subscription when local billing refs have not been written yet", async () => {
    await expect(
      findMemberForStripeInvoice({
        invoice: makeStripeInvoice({
          customer: "cus_invoice",
          id: "in_123",
          subscription: "sub_live",
        }),
        prisma: {} as never,
      }),
    ).resolves.toEqual({
      billingRef: null,
      core: makeHostedMemberCoreState(),
    });

    expect(mocks.lookupHostedMemberStripeBillingRefByStripeSubscriptionId).toHaveBeenCalledWith({
      prisma: {},
      stripeSubscriptionId: "sub_live",
    });
    expect(mocks.lookupHostedMemberStripeBillingRefByStripeCustomerId).toHaveBeenCalledWith({
      prisma: {},
      stripeCustomerId: "cus_invoice",
    });
    expect(mocks.stripeSubscriptionsRetrieve).toHaveBeenCalledWith("sub_live");
    expect(mocks.readHostedMemberBillingSnapshot).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: {},
    });
  });

  it("does not let subscription metadata rebind a member that already has a different subscription", async () => {
    mocks.readHostedMemberBillingSnapshot.mockResolvedValueOnce(makeMemberSnapshot({
      billingRef: makeBillingRef({
        currentBillingPhase: "paid",
        stripeCustomerId: "cus_live",
        stripeSubscriptionId: "sub_paid",
      }),
      core: makeHostedMemberCoreState({
        billingStatus: "active",
      }),
    }));

    await expect(
      findMemberForStripeSubscription({
        prisma: {} as never,
        subscription: makeStripeSubscription({
          customer: "cus_live",
          id: "sub_orphan",
          metadata: {
            memberId: "member_123",
          },
        }),
      }),
    ).resolves.toBeNull();

    expect(mocks.readHostedMemberBillingSnapshot).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: {},
    });
    expect(mocks.lookupHostedMemberStripeBillingRefByStripeSubscriptionId).toHaveBeenCalledWith({
      prisma: {},
      stripeSubscriptionId: "sub_orphan",
    });
    expect(mocks.lookupHostedMemberStripeBillingRefByStripeCustomerId).toHaveBeenCalledWith({
      prisma: {},
      stripeCustomerId: "cus_live",
    });
  });

  it("does not let subscription customer lookup rebind a member that already has a different subscription", async () => {
    const core = makeHostedMemberCoreState({
      billingStatus: "active",
    });
    const billingRef = makeBillingRef({
      currentBillingPhase: "paid",
      stripeCustomerId: "cus_live",
      stripeSubscriptionId: "sub_paid",
    });
    mocks.lookupHostedMemberStripeBillingRefByStripeCustomerId.mockResolvedValueOnce({
      billingRef,
      core,
      matchedBy: "stripeCustomerId",
    });

    await expect(
      findMemberForStripeSubscription({
        prisma: {} as never,
        subscription: makeStripeSubscription({
          customer: "cus_live",
          id: "sub_orphan",
          metadata: {},
        }),
      }),
    ).resolves.toBeNull();

    expect(mocks.readHostedMemberBillingSnapshot).not.toHaveBeenCalled();
    expect(mocks.lookupHostedMemberStripeBillingRefByStripeSubscriptionId).toHaveBeenCalledWith({
      prisma: {},
      stripeSubscriptionId: "sub_orphan",
    });
    expect(mocks.lookupHostedMemberStripeBillingRefByStripeCustomerId).toHaveBeenCalledWith({
      prisma: {},
      stripeCustomerId: "cus_live",
    });
  });

  it("does not let subscription metadata rebind a member with a different existing customer", async () => {
    const core = makeHostedMemberCoreState({
      billingStatus: "incomplete",
    });
    const billingRef = makeBillingRef({
      currentBillingPhase: null,
      stripeCustomerId: "cus_existing",
      stripeSubscriptionId: null,
    });
    mocks.readHostedMemberBillingSnapshot.mockResolvedValueOnce({
      billingRef,
      core,
    });

    await expect(
      findMemberForStripeSubscription({
        prisma: {} as never,
        subscription: makeStripeSubscription({
          customer: "cus_orphan",
          id: "sub_orphan",
          metadata: {
            memberId: "member_123",
          },
        }),
      }),
    ).resolves.toBeNull();

    expect(mocks.readHostedMemberBillingSnapshot).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: {},
    });
    expect(mocks.lookupHostedMemberStripeBillingRefByStripeSubscriptionId).toHaveBeenCalledWith({
      prisma: {},
      stripeSubscriptionId: "sub_orphan",
    });
    expect(mocks.lookupHostedMemberStripeBillingRefByStripeCustomerId).toHaveBeenCalledWith({
      prisma: {},
      stripeCustomerId: "cus_orphan",
    });
  });

  it("allows subscription metadata to bind a new subscription when the existing customer matches", async () => {
    const core = makeHostedMemberCoreState({
      billingStatus: "incomplete",
    });
    const billingRef = makeBillingRef({
      currentBillingPhase: null,
      stripeCustomerId: "cus_live",
      stripeSubscriptionId: null,
    });
    mocks.readHostedMemberBillingSnapshot.mockResolvedValueOnce({
      billingRef,
      core,
    });

    await expect(
      findMemberForStripeSubscription({
        prisma: {} as never,
        subscription: makeStripeSubscription({
          customer: "cus_live",
          id: "sub_new",
          metadata: {
            memberId: "member_123",
          },
        }),
      }),
    ).resolves.toEqual({
      billingRef,
      core,
    });

    expect(mocks.lookupHostedMemberStripeBillingRefByStripeSubscriptionId).not.toHaveBeenCalled();
    expect(mocks.lookupHostedMemberStripeBillingRefByStripeCustomerId).not.toHaveBeenCalled();
  });

  it("does not let invoice customer lookup rebind a member that already has a different subscription", async () => {
    const core = makeHostedMemberCoreState({
      billingStatus: "active",
    });
    const billingRef = makeBillingRef({
      currentBillingPhase: "paid",
      stripeCustomerId: "cus_live",
      stripeSubscriptionId: "sub_paid",
    });
    mocks.lookupHostedMemberStripeBillingRefByStripeCustomerId.mockResolvedValueOnce({
      billingRef,
      core,
      matchedBy: "stripeCustomerId",
    });
    mocks.readHostedMemberBillingSnapshot.mockResolvedValueOnce({
      billingRef,
      core,
    });
    mocks.stripeSubscriptionsRetrieve.mockResolvedValueOnce(
      makeStripeSubscription({
        customer: "cus_live",
        id: "sub_orphan",
        metadata: {
          memberId: "member_123",
        },
      }),
    );

    await expect(
      findMemberForStripeInvoice({
        invoice: makeStripeInvoice({
          customer: "cus_live",
          id: "in_orphan",
          subscription: "sub_orphan",
        }),
        prisma: {} as never,
      }),
    ).resolves.toBeNull();

    expect(mocks.lookupHostedMemberStripeBillingRefByStripeSubscriptionId).toHaveBeenCalledWith({
      prisma: {},
      stripeSubscriptionId: "sub_orphan",
    });
    expect(mocks.lookupHostedMemberStripeBillingRefByStripeCustomerId).toHaveBeenCalledWith({
      prisma: {},
      stripeCustomerId: "cus_live",
    });
    expect(mocks.stripeSubscriptionsRetrieve).toHaveBeenCalledWith("sub_orphan");
    expect(mocks.readHostedMemberBillingSnapshot).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: {},
    });
  });

  it("does not let invoice live subscription metadata rebind a member with a different existing customer", async () => {
    const core = makeHostedMemberCoreState({
      billingStatus: "incomplete",
    });
    const billingRef = makeBillingRef({
      currentBillingPhase: null,
      stripeCustomerId: "cus_existing",
      stripeSubscriptionId: null,
    });
    mocks.readHostedMemberBillingSnapshot.mockResolvedValueOnce({
      billingRef,
      core,
    });
    mocks.stripeSubscriptionsRetrieve.mockResolvedValueOnce(
      makeStripeSubscription({
        customer: "cus_orphan",
        id: "sub_orphan",
        metadata: {
          memberId: "member_123",
        },
      }),
    );

    await expect(
      findMemberForStripeInvoice({
        invoice: makeStripeInvoice({
          customer: "cus_orphan",
          id: "in_orphan",
          subscription: "sub_orphan",
        }),
        prisma: {} as never,
      }),
    ).resolves.toBeNull();

    expect(mocks.lookupHostedMemberStripeBillingRefByStripeSubscriptionId).toHaveBeenCalledWith({
      prisma: {},
      stripeSubscriptionId: "sub_orphan",
    });
    expect(mocks.lookupHostedMemberStripeBillingRefByStripeCustomerId).toHaveBeenCalledWith({
      prisma: {},
      stripeCustomerId: "cus_orphan",
    });
    expect(mocks.stripeSubscriptionsRetrieve).toHaveBeenCalledWith("sub_orphan");
    expect(mocks.readHostedMemberBillingSnapshot).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: {},
    });
  });

  it("surfaces ambiguous local Stripe billing refs instead of falling through to another member candidate", async () => {
    mocks.lookupHostedMemberStripeBillingRefByStripeSubscriptionId.mockRejectedValueOnce(
      hostedOnboardingError({
        code: "STRIPE_BILLING_LOOKUP_AMBIGUOUS",
        httpStatus: 500,
        message: "ambiguous",
        retryable: true,
      }),
    );

    await expect(
      findMemberForStripeInvoice({
        invoice: makeStripeInvoice({
          customer: "cus_invoice",
          id: "in_ambiguous",
          subscription: "sub_live",
        }),
        prisma: {} as never,
      }),
    ).rejects.toMatchObject({
      code: "STRIPE_BILLING_LOOKUP_AMBIGUOUS",
      httpStatus: 500,
      name: "HostedOnboardingError",
      retryable: true,
    });

    expect(mocks.lookupHostedMemberStripeBillingRefByStripeSubscriptionId).toHaveBeenCalledWith({
      prisma: {},
      stripeSubscriptionId: "sub_live",
    });
    expect(mocks.lookupHostedMemberStripeBillingRefByStripeCustomerId).not.toHaveBeenCalled();
    expect(mocks.stripeSubscriptionsRetrieve).not.toHaveBeenCalled();
  });

  it("resolves a recurring financial event through exactly one paid InvoicePayment", async () => {
    await expect(
      resolveStripeFinancialContext({
        chargeId: "ch_123",
        paymentIntentId: "pi_123",
      }),
    ).resolves.toEqual({
      customerId: "cus_123",
      invoiceId: "in_123",
      paymentIntentId: "pi_123",
      subscriptionId: "sub_123",
    });

    expect(mocks.stripeChargesRetrieve).toHaveBeenCalledWith("ch_123");
    expect(mocks.stripePaymentIntentsRetrieve).toHaveBeenCalledWith("pi_123");
    expect(mocks.stripeInvoicePaymentsList).toHaveBeenCalledWith({
      expand: ["data.invoice"],
      limit: 100,
      payment: {
        payment_intent: "pi_123",
        type: "payment_intent",
      },
      status: "paid",
    });
  });

  it.each(["refund", "dispute"] as const)(
    "resolves a legacy Source Charge-only %s through an exact paid InvoicePayment",
    async () => {
      const invoice = makeStripeFinancialInvoice({
        id: "in_legacy",
      });
      const invoicePayment = makeStripeInvoicePayment({
        chargeId: "ch_legacy",
        id: "ipay_legacy",
        invoice,
        kind: "charge",
      });
      invoice.payments = {
        data: [invoicePayment],
        has_more: false,
        object: "list",
        url: "/v1/invoice_payments",
      };
      mocks.stripeChargesRetrieve.mockResolvedValueOnce(
        makeStripeCharge({
          id: "ch_legacy",
          paymentIntentId: null,
        }),
      );
      mocks.stripeInvoicesList.mockResolvedValueOnce({
        data: [invoice],
        has_more: false,
      });

      await expect(
        resolveStripeFinancialContext({
          chargeId: "ch_legacy",
          paymentIntentId: null,
        }),
      ).resolves.toEqual({
        customerId: "cus_123",
        invoiceId: "in_legacy",
        paymentIntentId: null,
        subscriptionId: "sub_123",
      });

      expect(mocks.stripePaymentIntentsRetrieve).not.toHaveBeenCalled();
      expect(mocks.stripeInvoicesList).toHaveBeenCalledWith({
        customer: "cus_123",
        expand: ["data.payments"],
        limit: 100,
        status: "paid",
      });
      expect(mocks.stripeInvoicePaymentsList).not.toHaveBeenCalled();
    },
  );

  it("fails closed when a PaymentIntent does not resolve to a paid invoice", async () => {
    mocks.stripeInvoicePaymentsList.mockResolvedValueOnce({
      data: [],
      has_more: false,
    });

    await expect(
      resolveStripeFinancialContext({
        chargeId: "ch_123",
        paymentIntentId: "pi_123",
      }),
    ).rejects.toThrow(
      "Stripe recurring financial payment did not resolve to a bounded paid invoice set.",
    );
  });

  it("deduplicates multiple paid invoices allocated from one PaymentIntent to one subscription", async () => {
    mocks.stripeInvoicePaymentsList.mockResolvedValueOnce({
      data: [
        makeStripeInvoicePayment({
          invoice: makeStripeFinancialInvoice({ id: "in_1" }),
        }),
        makeStripeInvoicePayment({
          invoice: makeStripeFinancialInvoice({ id: "in_2" }),
        }),
      ],
      has_more: false,
    });

    await expect(
      resolveStripeFinancialContext({
        chargeId: "ch_123",
        paymentIntentId: "pi_123",
      }),
    ).resolves.toMatchObject({
      customerId: "cus_123",
      invoiceId: "in_1",
      paymentIntentId: "pi_123",
      subscriptionId: "sub_123",
    });
  });

  it("rejects one PaymentIntent allocated across multiple subscriptions", async () => {
    mocks.stripeInvoicePaymentsList.mockResolvedValueOnce({
      data: [
        makeStripeInvoicePayment({
          invoice: makeStripeFinancialInvoice({
            id: "in_1",
            subscriptionId: "sub_123",
          }),
        }),
        makeStripeInvoicePayment({
          invoice: makeStripeFinancialInvoice({
            id: "in_2",
            subscriptionId: "sub_other",
          }),
        }),
      ],
      has_more: false,
    });

    await expect(
      resolveStripeFinancialContext({
        chargeId: "ch_123",
        paymentIntentId: "pi_123",
      }),
    ).rejects.toThrow(
      "Stripe recurring financial payment spanned multiple recurring owners.",
    );
  });

  it("resolves exactly one member or Family subscription owner and rejects dual ownership", async () => {
    const memberLookup = {
      billingRef: makeBillingRef({
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
      }),
      core: makeHostedMemberCoreState(),
      matchedBy: "stripeSubscriptionId",
    };
    mocks.lookupHostedMemberStripeBillingRefByStripeSubscriptionId
      .mockResolvedValueOnce(memberLookup);

    await expect(
      resolveHostedStripeBillingOwner({
        prisma: {} as never,
        stripeSubscriptionId: "sub_123",
      }),
    ).resolves.toEqual({
      kind: "member",
      lockMemberId: "member_123",
      memberId: "member_123",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
    });

    const familyLookup = makeFamilyBillingLookup();
    mocks.lookupHostedMemberStripeBillingRefByStripeSubscriptionId
      .mockResolvedValueOnce(memberLookup);
    mocks.lookupHostedAccountGroupStripeBillingRefByStripeSubscriptionId
      .mockResolvedValueOnce(familyLookup);
    await expect(
      resolveHostedStripeBillingOwner({
        prisma: {} as never,
        stripeSubscriptionId: "sub_123",
      }),
    ).rejects.toThrow(
      "Stripe subscription matched both member and Family billing owners.",
    );
  });

  it("reconciles cumulative successful refunds and ignores pending or failed refunds", async () => {
    mocks.stripeRefundsList.mockResolvedValueOnce({
      data: [
        makeStripeRefund({ amount: 400, id: "re_1", status: "succeeded" }),
        makeStripeRefund({ amount: 600, id: "re_2", status: "succeeded" }),
        makeStripeRefund({ amount: 5_000, id: "re_pending", status: "pending" }),
        makeStripeRefund({ amount: 5_000, id: "re_failed", status: "failed" }),
      ],
      has_more: false,
    });

    await expect(
      readHostedStripeRecurringFinancialState(
        makeStripeSubscription({
          latestInvoice: "in_123",
        }),
      ),
    ).resolves.toMatchObject({
      fullyRefunded: true,
      invoiceId: "in_123",
      outstandingDispute: false,
    });
  });

  it("nets all canonical dispute balance transactions before blocking entitlement", async () => {
    mocks.stripeDisputesList.mockResolvedValueOnce({
      data: [
        makeStripeDispute({
          balanceTransactions: [
            makeStripeBalanceTransaction({ amount: -1_000, id: "txn_withdrawn" }),
            makeStripeBalanceTransaction({ amount: 250, id: "txn_partial_return" }),
          ],
        }),
      ],
      has_more: false,
    });

    await expect(
      readHostedStripeRecurringFinancialState(
        makeStripeSubscription({
          latestInvoice: "in_123",
        }),
      ),
    ).resolves.toMatchObject({
      fullyRefunded: false,
      outstandingDispute: true,
    });
  });

  it("uses the newest paid exact-subscription invoice for an exact unapplied pending delta", async () => {
    const failedUpdateInvoice = makeStripeFinancialInvoice({
      amountPaid: 0,
      billingReason: "subscription_update",
      id: "in_failed_update",
      status: "open",
    });
    const paidEntitlementInvoice = makeStripeFinancialInvoice({
      id: "in_current_entitlement",
    });
    mocks.stripeInvoicesRetrieve
      .mockResolvedValueOnce(failedUpdateInvoice)
      .mockResolvedValueOnce(paidEntitlementInvoice);
    mocks.stripeInvoicePaymentsList
      .mockResolvedValueOnce({ data: [], has_more: false })
      .mockResolvedValueOnce({
        data: [makeStripeInvoicePayment({
          chargeId: "ch_current",
          invoice: paidEntitlementInvoice,
          paymentIntentId: "pi_current",
        })],
        has_more: false,
      });
    mocks.stripeInvoicesList.mockResolvedValueOnce({
      data: [paidEntitlementInvoice],
      has_more: false,
    });

    await expect(
      readHostedStripeRecurringFinancialState(
        makeStripeSubscription({
          items: [
            makeStripeSubscriptionItem({
              priceId: "price_launch",
            }),
          ],
          latestInvoice: "in_failed_update",
          pendingUpdate: makeStripePendingUpdate({
            priceId: "price_edge",
          }),
          status: "active",
        }),
      ),
    ).resolves.toMatchObject({
      collectionState: { kind: "paid" },
      invoiceId: "in_current_entitlement",
    });
    expect(mocks.stripeInvoicesList).toHaveBeenCalledWith({
      created: {
        gte: 1_774_395_200,
      },
      limit: 100,
      subscription: "sub_123",
    }, HOSTED_STRIPE_RECURRING_FINANCIAL_REQUEST_OPTIONS);
  });

  it("keeps an unresolved applied subscription update controlling without exact pending-update proof", async () => {
    const unresolvedUpdateInvoice = makeStripeFinancialInvoice({
      amountPaid: 0,
      amountRemaining: 1_000,
      attempted: true,
      billingReason: "subscription_update",
      id: "in_applied_update",
      status: "open",
    });
    const paidEntitlementInvoice = makeStripeFinancialInvoice({
      id: "in_current_entitlement",
    });
    mocks.stripeInvoicesRetrieve
      .mockResolvedValueOnce(unresolvedUpdateInvoice)
      .mockResolvedValueOnce(paidEntitlementInvoice);
    mocks.stripeInvoicePaymentsList
      .mockResolvedValueOnce({ data: [], has_more: false })
      .mockResolvedValueOnce({
        data: [makeStripeInvoicePayment({
          invoice: paidEntitlementInvoice,
        })],
        has_more: false,
      });
    mocks.stripeInvoicesList.mockResolvedValueOnce({
      data: [unresolvedUpdateInvoice, paidEntitlementInvoice],
      has_more: false,
    });

    await expect(
      readHostedStripeRecurringFinancialState(
        makeStripeSubscription({
          items: [
            makeStripeSubscriptionItem({
              priceId: "price_edge",
            }),
          ],
          latestInvoice: unresolvedUpdateInvoice.id,
          pendingUpdate: null,
          status: "active",
        }),
      ),
    ).resolves.toMatchObject({
      collectionState: { kind: "payment_required" },
      invoiceId: unresolvedUpdateInvoice.id,
    });
  });

  it("keeps the paid base controlling after an unapplied pending update expires and its invoice is voided", async () => {
    const expiredUpdateInvoice = makeStripeFinancialInvoice({
      amountPaid: 0,
      amountRemaining: 1_000,
      billingReason: "subscription_update",
      id: "in_expired_update",
      lines: [
        makeStripeInvoiceLine({
          amount: 1_000,
          invoiceId: "in_expired_update",
          periodEnd: 1_778_000_000,
          periodStart: 1_776_000_000,
          priceId: "price_target",
          proration: true,
          quantity: 2,
          subscriptionId: "sub_123",
          subscriptionItemId: "si_123",
        }),
      ],
      status: "void",
    });
    const paidBaseInvoice = makeStripeFinancialInvoice({
      id: "in_paid_base",
      lines: [
        makeStripeInvoiceLine({
          invoiceId: "in_paid_base",
          periodEnd: 1_778_000_000,
          periodStart: 1_775_000_000,
          priceId: "price_current",
          quantity: 1,
          subscriptionId: "sub_123",
          subscriptionItemId: "si_123",
        }),
      ],
    });
    mocks.stripeInvoicesRetrieve
      .mockResolvedValueOnce(expiredUpdateInvoice)
      .mockResolvedValueOnce(paidBaseInvoice);
    mocks.stripeInvoicesList.mockResolvedValueOnce({
      data: [expiredUpdateInvoice, paidBaseInvoice],
      has_more: false,
    });
    mocks.stripeInvoicePaymentsList
      .mockResolvedValueOnce({
        data: [],
        has_more: false,
      })
      .mockResolvedValueOnce({
        data: [makeStripeInvoicePayment({
          invoice: paidBaseInvoice,
        })],
        has_more: false,
      });

    await expect(
      readHostedStripeRecurringFinancialState(
        makeStripeSubscription({
          items: [
            makeStripeSubscriptionItem({
              id: "si_123",
              priceId: "price_current",
              quantity: 1,
            }),
          ],
          latestInvoice: expiredUpdateInvoice.id,
          pendingUpdate: null,
        }),
      ),
    ).resolves.toMatchObject({
      collectionState: { kind: "paid" },
      fullyRefunded: false,
      invoiceId: paidBaseInvoice.id,
    });
  });

  it("recognizes an expired first-time tier item without ignoring a void after that tier applied", () => {
    const expiredUpdateInvoice = makeStripeFinancialInvoice({
      amountPaid: 0,
      amountRemaining: 1_000,
      billingReason: "subscription_update",
      id: "in_expired_edge_add",
      lines: [
        makeStripeInvoiceLine({
          amount: 1_000,
          invoiceId: "in_expired_edge_add",
          periodEnd: 1_778_000_000,
          periodStart: 1_776_000_000,
          priceId: "price_edge",
          proration: true,
          quantity: 1,
          subscriptionId: "sub_123",
          subscriptionItemId: "si_edge_new",
        }),
      ],
      status: "void",
    });
    const pulseOnly = makeStripeSubscription({
      items: [
        makeStripeSubscriptionItem({
          id: "si_pulse",
          priceId: "price_pulse",
          quantity: 2,
        }),
      ],
      latestInvoice: expiredUpdateInvoice.id,
      pendingUpdate: null,
    });
    const edgeApplied = makeStripeSubscription({
      items: [
        makeStripeSubscriptionItem({
          id: "si_pulse",
          priceId: "price_pulse",
          quantity: 1,
        }),
        makeStripeSubscriptionItem({
          id: "si_edge_applied",
          priceId: "price_edge",
          quantity: 1,
        }),
      ],
      latestInvoice: expiredUpdateInvoice.id,
      pendingUpdate: null,
    });

    expect(isHostedStripeUnappliedPendingUpdateInvoice({
      invoice: expiredUpdateInvoice,
      subscription: pulseOnly,
    })).toBe(true);
    expect(isHostedStripeUnappliedPendingUpdateInvoice({
      invoice: expiredUpdateInvoice,
      subscription: edgeApplied,
    })).toBe(false);
  });

  it("fails closed when more than 100 invoices fund one current period", async () => {
    const latestInvoice = makeStripeFinancialInvoice({
      id: "in_current_0",
    });
    const currentInvoices = Array.from({ length: 101 }, (_, index) =>
      makeStripeFinancialInvoice({
        id: `in_current_${index}`,
      })
    );
    mocks.stripeInvoicesRetrieve.mockResolvedValueOnce(latestInvoice);
    mocks.stripeInvoicesList
      .mockResolvedValueOnce({
        data: currentInvoices.slice(0, 100),
        has_more: true,
      })
      .mockResolvedValueOnce({
        data: currentInvoices.slice(100),
        has_more: false,
      });

    await expect(
      readHostedStripeRecurringFinancialState(
        makeStripeSubscription({
          latestInvoice: latestInvoice.id,
        }),
      ),
    ).rejects.toThrow(
      "Stripe exceeded the bounded current-period invoice reconciliation shape.",
    );
  });

  it("counts the separately retrieved latest invoice inside the 100-invoice cap", async () => {
    const latestInvoice = makeStripeFinancialInvoice({
      id: "in_latest_outside_list_window",
    });
    const listedInvoices = Array.from({ length: 100 }, (_, index) =>
      makeStripeFinancialInvoice({
        id: `in_listed_${index}`,
      })
    );
    mocks.stripeInvoicesRetrieve.mockResolvedValueOnce(latestInvoice);
    mocks.stripeInvoicesList.mockResolvedValueOnce({
      data: listedInvoices,
      has_more: false,
    });

    await expect(
      readHostedStripeRecurringFinancialState(
        makeStripeSubscription({
          latestInvoice: latestInvoice.id,
        }),
      ),
    ).rejects.toThrow(
      "Stripe exceeded the bounded current-period invoice reconciliation shape.",
    );
    expect(mocks.stripeRefundsList).not.toHaveBeenCalled();
    expect(mocks.stripeDisputesList).not.toHaveBeenCalled();
  });

  it("reconciles nine paid invoices from one current billing period", async () => {
    const currentInvoices = Array.from({ length: 9 }, (_, index) =>
      makeStripeFinancialInvoice({
        billingReason: index === 0
          ? "subscription_cycle"
          : "subscription_update",
        id: `in_current_${index}`,
      })
    );
    const latestInvoice = currentInvoices.at(-1)!;
    mocks.stripeInvoicesRetrieve.mockImplementation(async (invoiceId: string) => {
      const invoice = currentInvoices.find((candidate) => candidate.id === invoiceId);
      if (!invoice) {
        throw new Error("Unexpected Stripe invoice.");
      }
      return invoice;
    });
    mocks.stripeInvoicesList.mockResolvedValueOnce({
      data: currentInvoices,
      has_more: false,
    });

    await expect(
      readHostedStripeRecurringFinancialState(
        makeStripeSubscription({
          latestInvoice: latestInvoice.id,
        }),
      ),
    ).resolves.toMatchObject({
      collectionState: { kind: "paid" },
      fullyRefunded: false,
      invoiceId: latestInvoice.id,
      outstandingDispute: false,
    });
    expect(mocks.stripeInvoicesList).toHaveBeenCalledWith({
      created: {
        gte: 1_774_395_200,
      },
      limit: 100,
      subscription: "sub_123",
    }, HOSTED_STRIPE_RECURRING_FINANCIAL_REQUEST_OPTIONS);
  });

  it("caps concurrent recurring-financial Stripe reads at four calls", async () => {
    const invoices = Array.from({ length: 9 }, (_, index) =>
      makeStripeFinancialInvoice({
        billingReason: index === 0
          ? "subscription_cycle"
          : "subscription_update",
        id: `in_concurrency_${index}`,
      })
    );
    const latestInvoice = invoices.at(-1)!;
    const tracker = makeConcurrentCallTracker();
    mocks.stripeInvoicesRetrieve.mockImplementation((invoiceId: string) =>
      tracker.run(() => {
        const invoice = invoices.find((candidate) => candidate.id === invoiceId);
        if (!invoice) {
          throw new Error("Unexpected Stripe invoice.");
        }
        return invoice;
      })
    );
    mocks.stripeInvoicePaymentsList.mockImplementation((params: {
      invoice: string;
    }) =>
      tracker.run(() => {
        const invoice = invoices.find(
          (candidate) => candidate.id === params.invoice,
        );
        if (!invoice) {
          throw new Error("Unexpected Stripe invoice payment.");
        }
        return {
          data: [
            makeStripeInvoicePayment({
              chargeId: `ch_${invoice.id}`,
              invoice,
              paymentIntentId: `pi_${invoice.id}`,
            }),
          ],
          has_more: false,
        };
      })
    );
    mocks.stripeInvoicesList.mockImplementation(() =>
      tracker.run(() => ({
        data: invoices,
        has_more: false,
      }))
    );
    mocks.stripeRefundsList.mockImplementation(() =>
      tracker.run(() => ({
        data: [],
        has_more: false,
      }))
    );
    mocks.stripeDisputesList.mockImplementation(() =>
      tracker.run(() => ({
        data: [],
        has_more: false,
      }))
    );

    await expect(
      readHostedStripeRecurringFinancialState(
        makeStripeSubscription({
          latestInvoice: latestInvoice.id,
        }),
      ),
    ).resolves.toMatchObject({
      collectionState: { kind: "paid" },
      fullyRefunded: false,
      outstandingDispute: false,
    });
    expect(tracker.maxConcurrent()).toBe(4);
  });

  it("caps canonical invoice-line reads at four calls", async () => {
    const invoices = Array.from({ length: 8 }, (_, index) => {
      const invoice = makeStripeFinancialInvoice({
        id: `in_line_concurrency_${index}`,
      });
      return {
        ...invoice,
        lines: {
          ...invoice.lines,
          data: [],
          has_more: true,
        },
      };
    });
    const latestInvoice = invoices.at(-1)!;
    const tracker = makeConcurrentCallTracker();
    mocks.stripeInvoicesRetrieve.mockImplementation((invoiceId: string) => {
      const invoice = invoices.find((candidate) => candidate.id === invoiceId);
      if (!invoice) {
        throw new Error("Unexpected Stripe invoice.");
      }
      return Promise.resolve(invoice);
    });
    mocks.stripeInvoicesList.mockResolvedValueOnce({
      data: invoices,
      has_more: false,
    });
    mocks.stripeInvoiceLineItemsList.mockImplementation((invoiceId: string) =>
      tracker.run(() => ({
        data: [
          makeStripeInvoiceLine({
            invoiceId,
            periodEnd: 1_778_000_000,
            periodStart: 1_775_000_000,
            subscriptionId: "sub_123",
          }),
        ],
        has_more: false,
      }))
    );

    await expect(
      readHostedStripeRecurringFinancialState(
        makeStripeSubscription({
          latestInvoice: latestInvoice.id,
        }),
      ),
    ).resolves.toMatchObject({
      collectionState: { kind: "paid" },
    });
    expect(tracker.maxConcurrent()).toBe(4);
  });

  it("fails closed when one period exceeds the bounded payment-allocation shape", async () => {
    const invoice = makeStripeFinancialInvoice();
    mocks.stripeInvoicePaymentsList.mockResolvedValue({
      data: Array.from({ length: 101 }, (_, index) =>
        makeStripeInvoicePayment({
          chargeId: `ch_${index}`,
          id: `ipay_${index}`,
          invoice,
          paymentIntentId: `pi_${index}`,
        })
      ),
      has_more: false,
    });

    await expect(
      readHostedStripeRecurringFinancialState(
        makeStripeSubscription({
          latestInvoice: invoice.id,
        }),
      ),
    ).rejects.toThrow(
      "Stripe exceeded the bounded current-period payment reconciliation shape.",
    );
  });

  it("fails closed instead of paging an unbounded recurring refund history", async () => {
    mocks.stripeRefundsList.mockResolvedValueOnce({
      data: [],
      has_more: true,
    });

    await expect(
      readHostedStripeRecurringFinancialState(
        makeStripeSubscription({
          latestInvoice: "in_123",
        }),
      ),
    ).rejects.toThrow(
      "Stripe exceeded the bounded recurring refund reconciliation shape.",
    );
  });

  it("does not let a full refund of an older invoice block a newer healthy period", async () => {
    await expect(
      readHostedStripeRecurringFinancialState(
        makeStripeSubscription({
          latestInvoice: "in_123",
        }),
      ),
    ).resolves.toMatchObject({
      fullyRefunded: false,
      invoiceId: "in_123",
    });
    expect(mocks.stripeInvoicesRetrieve).toHaveBeenCalledWith(
      "in_123",
      {},
      HOSTED_STRIPE_RECURRING_FINANCIAL_REQUEST_OPTIONS,
    );
    expect(mocks.stripeInvoicePaymentsList).toHaveBeenCalledWith({
      expand: ["data.payment.payment_intent"],
      invoice: "in_123",
      limit: 100,
    }, HOSTED_STRIPE_RECURRING_FINANCIAL_REQUEST_OPTIONS);
    expect(mocks.stripeRefundsList).toHaveBeenCalledWith({
      charge: "ch_123",
      limit: 20,
    }, HOSTED_STRIPE_RECURRING_FINANCIAL_REQUEST_OPTIONS);
  });

  it("revokes the current period when its base renewal is fully refunded despite a later paid delta", async () => {
    const renewalInvoice = makeStripeFinancialInvoice({
      id: "in_renewal",
    });
    const paidUpdateInvoice = makeStripeFinancialInvoice({
      billingReason: "subscription_update",
      id: "in_update",
    });
    mocks.stripeInvoicesRetrieve
      .mockResolvedValueOnce(paidUpdateInvoice)
      .mockResolvedValueOnce(renewalInvoice);
    mocks.stripeInvoicesList.mockResolvedValueOnce({
      data: [paidUpdateInvoice, renewalInvoice],
      has_more: false,
    });
    mocks.stripeInvoicePaymentsList
      .mockResolvedValueOnce({
        data: [makeStripeInvoicePayment({
          chargeId: "ch_update",
          invoice: paidUpdateInvoice,
          paymentIntentId: "pi_update",
        })],
        has_more: false,
      })
      .mockResolvedValueOnce({
        data: [makeStripeInvoicePayment({
          chargeId: "ch_renewal",
          invoice: renewalInvoice,
          paymentIntentId: "pi_renewal",
        })],
        has_more: false,
      });
    mocks.stripeRefundsList.mockImplementation(async (params: {
      charge?: string;
    }) => ({
      data: params.charge === "ch_renewal"
        ? [
            makeStripeRefund({
              amount: 1_000,
              chargeId: "ch_renewal",
              id: "re_renewal",
              paymentIntentId: "pi_renewal",
              status: "succeeded",
            }),
          ]
        : [],
      has_more: false,
    }));

    await expect(
      readHostedStripeRecurringFinancialState(
        makeStripeSubscription({
          latestInvoice: "in_update",
        }),
      ),
    ).resolves.toMatchObject({
      collectionState: { kind: "paid" },
      fullyRefunded: true,
      invoiceId: "in_update",
    });
  });

  it.each([
    ["plan upgrade", "price_edge", 1],
    ["Family seat increase", "price_family_pulse", 3],
  ] as const)(
    "revokes the current period when its paid %s invoice is fully refunded",
    async (_description, priceId, quantity) => {
      const renewalInvoice = makeStripeFinancialInvoice({
        created: 1_775_000_000,
        id: "in_required_renewal",
      });
      const paidUpdateInvoice = makeStripeFinancialInvoice({
        billingReason: "subscription_update",
        created: 1_776_000_000,
        id: "in_required_update",
        lines: [
          makeStripeInvoiceLine({
            amount: 1_000,
            invoiceId: "in_required_update",
            periodEnd: 1_778_000_000,
            periodStart: 1_776_000_000,
            priceId,
            proration: true,
            quantity,
            subscriptionId: "sub_123",
            subscriptionItemId: "si_current",
          }),
        ],
      });
      mocks.stripeInvoicesRetrieve
        .mockResolvedValueOnce(paidUpdateInvoice)
        .mockResolvedValueOnce(renewalInvoice);
      mocks.stripeInvoicesList.mockResolvedValueOnce({
        data: [paidUpdateInvoice, renewalInvoice],
        has_more: false,
      });
      mocks.stripeInvoicePaymentsList
        .mockResolvedValueOnce({
          data: [makeStripeInvoicePayment({
            chargeId: "ch_required_update",
            invoice: paidUpdateInvoice,
            paymentIntentId: "pi_required_update",
          })],
          has_more: false,
        })
        .mockResolvedValueOnce({
          data: [makeStripeInvoicePayment({
            chargeId: "ch_required_renewal",
            invoice: renewalInvoice,
            paymentIntentId: "pi_required_renewal",
          })],
          has_more: false,
        });
      mocks.stripeRefundsList.mockImplementation(async (params: {
        charge?: string;
      }) => ({
        data: params.charge === "ch_required_update"
          ? [
              makeStripeRefund({
                amount: 1_000,
                chargeId: "ch_required_update",
                id: "re_required_update",
                paymentIntentId: "pi_required_update",
                status: "succeeded",
              }),
            ]
          : [],
        has_more: false,
      }));

      await expect(
        readHostedStripeRecurringFinancialState(
          makeStripeSubscription({
            items: [
              makeStripeSubscriptionItem({
                id: "si_current",
                priceId,
                quantity,
              }),
            ],
            latestInvoice: paidUpdateInvoice.id,
          }),
        ),
      ).resolves.toMatchObject({
        collectionState: { kind: "paid" },
        fullyRefunded: true,
        invoiceId: paidUpdateInvoice.id,
      });
    },
  );

  it("does not revoke a paid update for a partial refund", async () => {
    const renewalInvoice = makeStripeFinancialInvoice({
      created: 1_775_000_000,
      id: "in_partial_update_renewal",
    });
    const paidUpdateInvoice = makeStripeFinancialInvoice({
      billingReason: "subscription_update",
      created: 1_776_000_000,
      id: "in_partial_update",
      lines: [
        makeStripeInvoiceLine({
          amount: 1_000,
          invoiceId: "in_partial_update",
          periodEnd: 1_778_000_000,
          periodStart: 1_776_000_000,
          priceId: "price_edge",
          proration: true,
          quantity: 1,
          subscriptionId: "sub_123",
          subscriptionItemId: "si_current",
        }),
      ],
    });
    mocks.stripeInvoicesRetrieve
      .mockResolvedValueOnce(paidUpdateInvoice)
      .mockResolvedValueOnce(renewalInvoice);
    mocks.stripeInvoicesList.mockResolvedValueOnce({
      data: [paidUpdateInvoice, renewalInvoice],
      has_more: false,
    });
    mocks.stripeInvoicePaymentsList
      .mockResolvedValueOnce({
        data: [makeStripeInvoicePayment({
          chargeId: "ch_partial_update",
          invoice: paidUpdateInvoice,
          paymentIntentId: "pi_partial_update",
        })],
        has_more: false,
      })
      .mockResolvedValueOnce({
        data: [makeStripeInvoicePayment({
          chargeId: "ch_partial_update_renewal",
          invoice: renewalInvoice,
          paymentIntentId: "pi_partial_update_renewal",
        })],
        has_more: false,
      });
    mocks.stripeRefundsList.mockImplementation(async (params: {
      charge?: string;
    }) => ({
      data: params.charge === "ch_partial_update"
        ? [
            makeStripeRefund({
              amount: 500,
              chargeId: "ch_partial_update",
              id: "re_partial_update",
              paymentIntentId: "pi_partial_update",
              status: "succeeded",
            }),
          ]
        : [],
      has_more: false,
    }));

    await expect(
      readHostedStripeRecurringFinancialState(
        makeStripeSubscription({
          items: [
            makeStripeSubscriptionItem({
              id: "si_current",
              priceId: "price_edge",
            }),
          ],
          latestInvoice: paidUpdateInvoice.id,
        }),
      ),
    ).resolves.toMatchObject({
      fullyRefunded: false,
    });
  });

  it("keeps every still-represented cumulative seat increase in the required funding set", async () => {
    const renewalInvoice = makeStripeFinancialInvoice({
      created: 1_775_000_000,
      id: "in_cumulative_renewal",
      lines: [
        makeStripeInvoiceLine({
          invoiceId: "in_cumulative_renewal",
          periodEnd: 1_778_000_000,
          periodStart: 1_775_000_000,
          priceId: "price_family_pulse",
          quantity: 1,
          subscriptionId: "sub_123",
          subscriptionItemId: "si_family_pulse",
        }),
      ],
    });
    const firstIncreaseInvoice = makeStripeFinancialInvoice({
      billingReason: "subscription_update",
      created: 1_776_000_000,
      id: "in_cumulative_first",
      lines: [
        makeStripeInvoiceLine({
          amount: -1_000,
          invoiceId: "in_cumulative_first",
          periodEnd: 1_778_000_000,
          periodStart: 1_776_000_000,
          priceId: "price_family_pulse",
          proration: true,
          quantity: 1,
          subscriptionId: "sub_123",
          subscriptionItemId: "si_family_pulse",
        }),
        makeStripeInvoiceLine({
          amount: 2_000,
          invoiceId: "in_cumulative_first",
          periodEnd: 1_778_000_000,
          periodStart: 1_776_000_000,
          priceId: "price_family_pulse",
          proration: true,
          quantity: 2,
          subscriptionId: "sub_123",
          subscriptionItemId: "si_family_pulse",
        }),
      ],
    });
    const secondIncreaseInvoice = makeStripeFinancialInvoice({
      billingReason: "subscription_update",
      created: 1_777_000_000,
      id: "in_cumulative_second",
      lines: [
        makeStripeInvoiceLine({
          amount: -2_000,
          invoiceId: "in_cumulative_second",
          periodEnd: 1_778_000_000,
          periodStart: 1_777_000_000,
          priceId: "price_family_pulse",
          proration: true,
          quantity: 2,
          subscriptionId: "sub_123",
          subscriptionItemId: "si_family_pulse",
        }),
        makeStripeInvoiceLine({
          amount: 3_000,
          invoiceId: "in_cumulative_second",
          periodEnd: 1_778_000_000,
          periodStart: 1_777_000_000,
          priceId: "price_family_pulse",
          proration: true,
          quantity: 3,
          subscriptionId: "sub_123",
          subscriptionItemId: "si_family_pulse",
        }),
      ],
    });
    mocks.stripeInvoicesRetrieve
      .mockResolvedValueOnce(secondIncreaseInvoice)
      .mockResolvedValueOnce(firstIncreaseInvoice)
      .mockResolvedValueOnce(renewalInvoice);
    mocks.stripeInvoicesList.mockResolvedValueOnce({
      data: [secondIncreaseInvoice, firstIncreaseInvoice, renewalInvoice],
      has_more: false,
    });
    mocks.stripeInvoicePaymentsList
      .mockResolvedValueOnce({
        data: [makeStripeInvoicePayment({
          chargeId: "ch_cumulative_second",
          invoice: secondIncreaseInvoice,
          paymentIntentId: "pi_cumulative_second",
        })],
        has_more: false,
      })
      .mockResolvedValueOnce({
        data: [makeStripeInvoicePayment({
          chargeId: "ch_cumulative_first",
          invoice: firstIncreaseInvoice,
          paymentIntentId: "pi_cumulative_first",
        })],
        has_more: false,
      })
      .mockResolvedValueOnce({
        data: [makeStripeInvoicePayment({
          chargeId: "ch_cumulative_renewal",
          invoice: renewalInvoice,
          paymentIntentId: "pi_cumulative_renewal",
        })],
        has_more: false,
      });
    mocks.stripeRefundsList.mockImplementation(async (params: {
      charge?: string;
    }) => ({
      data: params.charge === "ch_cumulative_first"
        ? [
            makeStripeRefund({
              amount: 1_000,
              chargeId: "ch_cumulative_first",
              id: "re_cumulative_first",
              paymentIntentId: "pi_cumulative_first",
              status: "succeeded",
            }),
          ]
        : [],
      has_more: false,
    }));

    await expect(
      readHostedStripeRecurringFinancialState(
        makeStripeSubscription({
          items: [
            makeStripeSubscriptionItem({
              id: "si_family_pulse",
              priceId: "price_family_pulse",
              quantity: 3,
            }),
          ],
          latestInvoice: secondIncreaseInvoice.id,
        }),
      ),
    ).resolves.toMatchObject({
      fullyRefunded: true,
    });
  });

  it("keeps a paid plan transition required after same-price item consolidation", async () => {
    const renewalInvoice = makeStripeFinancialInvoice({
      created: 1_775_000_000,
      id: "in_consolidated_renewal",
      lines: [
        makeStripeInvoiceLine({
          invoiceId: "in_consolidated_renewal",
          periodEnd: 1_778_000_000,
          periodStart: 1_775_000_000,
          priceId: "price_edge",
          quantity: 1,
          subscriptionId: "sub_123",
          subscriptionItemId: "si_retained_edge",
        }),
        makeStripeInvoiceLine({
          invoiceId: "in_consolidated_renewal",
          periodEnd: 1_778_000_000,
          periodStart: 1_775_000_000,
          priceId: "price_pulse",
          quantity: 1,
          subscriptionId: "sub_123",
          subscriptionItemId: "si_converted_pulse",
        }),
      ],
    });
    const transitionInvoice = makeStripeFinancialInvoice({
      billingReason: "subscription_update",
      created: 1_776_000_000,
      id: "in_consolidated_transition",
      lines: [
        makeStripeInvoiceLine({
          amount: -1_000,
          invoiceId: "in_consolidated_transition",
          periodEnd: 1_778_000_000,
          periodStart: 1_776_000_000,
          priceId: "price_pulse",
          proration: true,
          quantity: 1,
          subscriptionId: "sub_123",
          subscriptionItemId: "si_converted_pulse",
        }),
        makeStripeInvoiceLine({
          amount: 2_000,
          invoiceId: "in_consolidated_transition",
          periodEnd: 1_778_000_000,
          periodStart: 1_776_000_000,
          priceId: "price_edge",
          proration: true,
          quantity: 1,
          subscriptionId: "sub_123",
          subscriptionItemId: "si_converted_pulse",
        }),
      ],
    });
    mocks.stripeInvoicesRetrieve
      .mockResolvedValueOnce(transitionInvoice)
      .mockResolvedValueOnce(renewalInvoice);
    mocks.stripeInvoicesList.mockResolvedValueOnce({
      data: [transitionInvoice, renewalInvoice],
      has_more: false,
    });
    mocks.stripeInvoicePaymentsList
      .mockResolvedValueOnce({
        data: [makeStripeInvoicePayment({
          chargeId: "ch_consolidated_transition",
          invoice: transitionInvoice,
          paymentIntentId: "pi_consolidated_transition",
        })],
        has_more: false,
      })
      .mockResolvedValueOnce({
        data: [makeStripeInvoicePayment({
          chargeId: "ch_consolidated_renewal",
          invoice: renewalInvoice,
          paymentIntentId: "pi_consolidated_renewal",
        })],
        has_more: false,
      });
    mocks.stripeRefundsList.mockImplementation(async (params: {
      charge?: string;
    }) => ({
      data: params.charge === "ch_consolidated_transition"
        ? [
            makeStripeRefund({
              amount: 1_000,
              chargeId: "ch_consolidated_transition",
              id: "re_consolidated_transition",
              paymentIntentId: "pi_consolidated_transition",
              status: "succeeded",
            }),
          ]
        : [],
      has_more: false,
    }));

    await expect(
      readHostedStripeRecurringFinancialState(
        makeStripeSubscription({
          items: [
            makeStripeSubscriptionItem({
              id: "si_retained_edge",
              priceId: "price_edge",
              quantity: 2,
            }),
          ],
          latestInvoice: transitionInvoice.id,
        }),
      ),
    ).resolves.toMatchObject({
      fullyRefunded: true,
    });
  });

  it("keeps a refunded paid seat required after an invoiced cross-tier downgrade", async () => {
    const renewalInvoice = makeStripeFinancialInvoice({
      created: 1_775_000_000,
      id: "in_invoiced_downgrade_renewal",
      lines: [
        makeStripeInvoiceLine({
          invoiceId: "in_invoiced_downgrade_renewal",
          periodEnd: 1_778_000_000,
          periodStart: 1_775_000_000,
          priceId: "price_pulse",
          quantity: 1,
          subscriptionId: "sub_123",
          subscriptionItemId: "si_pulse",
        }),
        makeStripeInvoiceLine({
          invoiceId: "in_invoiced_downgrade_renewal",
          periodEnd: 1_778_000_000,
          periodStart: 1_775_000_000,
          priceId: "price_edge",
          quantity: 1,
          subscriptionId: "sub_123",
          subscriptionItemId: "si_edge",
        }),
      ],
    });
    const paidSeatInvoice = makeStripeFinancialInvoice({
      billingReason: "subscription_update",
      created: 1_776_000_000,
      id: "in_invoiced_downgrade_seat",
      lines: [
        makeStripeInvoiceLine({
          amount: -2_000,
          invoiceId: "in_invoiced_downgrade_seat",
          periodEnd: 1_778_000_000,
          periodStart: 1_776_000_000,
          priceId: "price_edge",
          proration: true,
          quantity: 1,
          subscriptionId: "sub_123",
          subscriptionItemId: "si_edge",
        }),
        makeStripeInvoiceLine({
          amount: 4_000,
          invoiceId: "in_invoiced_downgrade_seat",
          periodEnd: 1_778_000_000,
          periodStart: 1_776_000_000,
          priceId: "price_edge",
          proration: true,
          quantity: 2,
          subscriptionId: "sub_123",
          subscriptionItemId: "si_edge",
        }),
      ],
    });
    const downgradeInvoice = makeStripeFinancialInvoice({
      amountPaid: 0,
      billingReason: "subscription_update",
      created: 1_777_000_000,
      id: "in_invoiced_downgrade_credit",
      lines: [
        makeStripeInvoiceLine({
          amount: -4_000,
          invoiceId: "in_invoiced_downgrade_credit",
          periodEnd: 1_778_000_000,
          periodStart: 1_777_000_000,
          priceId: "price_edge",
          proration: true,
          quantity: 2,
          subscriptionId: "sub_123",
          subscriptionItemId: "si_edge",
        }),
        makeStripeInvoiceLine({
          amount: 2_000,
          invoiceId: "in_invoiced_downgrade_credit",
          periodEnd: 1_778_000_000,
          periodStart: 1_777_000_000,
          priceId: "price_edge",
          proration: true,
          quantity: 1,
          subscriptionId: "sub_123",
          subscriptionItemId: "si_edge",
        }),
        makeStripeInvoiceLine({
          amount: -1_000,
          invoiceId: "in_invoiced_downgrade_credit",
          periodEnd: 1_778_000_000,
          periodStart: 1_777_000_000,
          priceId: "price_pulse",
          proration: true,
          quantity: 1,
          subscriptionId: "sub_123",
          subscriptionItemId: "si_pulse",
        }),
        makeStripeInvoiceLine({
          amount: 2_000,
          invoiceId: "in_invoiced_downgrade_credit",
          periodEnd: 1_778_000_000,
          periodStart: 1_777_000_000,
          priceId: "price_pulse",
          proration: true,
          quantity: 2,
          subscriptionId: "sub_123",
          subscriptionItemId: "si_pulse",
        }),
      ],
    });
    mockPaidHostedStripeInvoiceHistory({
      invoices: [downgradeInvoice, paidSeatInvoice, renewalInvoice],
      refundedInvoiceId: paidSeatInvoice.id,
    });

    await expect(
      readHostedStripeRecurringFinancialState(
        makeStripeSubscription({
          items: [
            makeStripeSubscriptionItem({
              id: "si_pulse",
              priceId: "price_pulse",
              quantity: 2,
            }),
            makeStripeSubscriptionItem({
              id: "si_edge",
              priceId: "price_edge",
              quantity: 1,
            }),
          ],
          latestInvoice: downgradeInvoice.id,
        }),
      ),
    ).resolves.toMatchObject({
      collectionState: { kind: "paid" },
      fullyRefunded: true,
    });
  });

  it.each([
    ["conversion refund while the group seat remains", "in_mixed_conversion", 3, true],
    ["seat refund while the group seat remains", "in_mixed_seat", 3, true],
    ["conversion refund after the group is unwound", "in_mixed_conversion", 2, false],
    ["seat refund after the group is unwound", "in_mixed_seat", 2, false],
  ] as const)(
    "classifies a same-created mixed %s",
    async (_description, refundedInvoiceId, currentPulseQuantity, fullyRefunded) => {
      const renewalInvoice = makeStripeFinancialInvoice({
        created: 1_775_000_000,
        id: "in_mixed_renewal",
        lines: [
          makeStripeInvoiceLine({
            invoiceId: "in_mixed_renewal",
            periodEnd: 1_778_000_000,
            periodStart: 1_775_000_000,
            priceId: "price_pulse",
            quantity: 2,
            subscriptionId: "sub_123",
            subscriptionItemId: "si_pulse",
          }),
        ],
      });
      const conversionInvoice = makeStripeFinancialInvoice({
        billingReason: "subscription_update",
        created: 1_776_000_000,
        id: "in_mixed_conversion",
        lines: [
          ...makeStripeQuantityTransitionLines({
            afterQuantity: 1,
            beforeQuantity: 2,
            invoiceId: "in_mixed_conversion",
            periodStart: 1_776_000_000,
            priceId: "price_pulse",
            subscriptionItemId: "si_pulse",
          }),
          ...makeStripeQuantityTransitionLines({
            afterQuantity: 1,
            beforeQuantity: 0,
            invoiceId: "in_mixed_conversion",
            periodStart: 1_776_000_000,
            priceId: "price_edge",
            subscriptionItemId: "si_edge",
          }),
        ],
      });
      const seatInvoice = makeStripeFinancialInvoice({
        billingReason: "subscription_update",
        created: 1_776_000_000,
        id: "in_mixed_seat",
        lines: makeStripeQuantityTransitionLines({
          afterQuantity: 2,
          beforeQuantity: 1,
          invoiceId: "in_mixed_seat",
          periodStart: 1_776_000_000,
          priceId: "price_pulse",
          subscriptionItemId: "si_pulse",
        }),
      });
      const downgradeInvoice = makeStripeFinancialInvoice({
        amountPaid: 0,
        billingReason: "subscription_update",
        created: 1_777_000_000,
        id: "in_mixed_downgrade",
        lines: [
          ...makeStripeQuantityTransitionLines({
            afterQuantity: 3,
            beforeQuantity: 2,
            invoiceId: "in_mixed_downgrade",
            periodStart: 1_777_000_000,
            priceId: "price_pulse",
            subscriptionItemId: "si_pulse",
          }),
          ...makeStripeQuantityTransitionLines({
            afterQuantity: 0,
            beforeQuantity: 1,
            invoiceId: "in_mixed_downgrade",
            periodStart: 1_777_000_000,
            priceId: "price_edge",
            subscriptionItemId: "si_edge",
          }),
        ],
      });
      const reductionInvoice = makeStripeFinancialInvoice({
        amountPaid: 0,
        billingReason: "subscription_update",
        created: 1_777_500_000,
        id: "in_mixed_reduction",
        lines: makeStripeQuantityTransitionLines({
          afterQuantity: 2,
          beforeQuantity: 3,
          invoiceId: "in_mixed_reduction",
          periodStart: 1_777_500_000,
          priceId: "price_pulse",
          subscriptionItemId: "si_pulse",
        }),
      });
      const invoices = currentPulseQuantity === 3
        ? [
            downgradeInvoice,
            seatInvoice,
            conversionInvoice,
            renewalInvoice,
          ]
        : [
            reductionInvoice,
            downgradeInvoice,
            seatInvoice,
            conversionInvoice,
            renewalInvoice,
          ];
      mockPaidHostedStripeInvoiceHistory({
        invoices,
        refundedInvoiceId,
      });

      await expect(
        readHostedStripeRecurringFinancialState(
          makeStripeSubscription({
            items: [
              makeStripeSubscriptionItem({
                id: "si_pulse",
                priceId: "price_pulse",
                quantity: currentPulseQuantity,
              }),
            ],
            latestInvoice: invoices[0]!.id,
          }),
        ),
      ).resolves.toMatchObject({
        collectionState: { kind: "paid" },
        fullyRefunded,
      });
    },
  );

  it.each([
    ["later conversion", "in_tier_second", false],
    ["still-represented earlier conversion", "in_tier_first", true],
  ] as const)(
    "attributes a full refund of the %s after consolidation and a later downgrade",
    async (_description, refundedInvoiceId, fullyRefunded) => {
      const renewalInvoice = makeStripeFinancialInvoice({
        created: 1_775_000_000,
        id: "in_tier_renewal",
        lines: [
          makeStripeInvoiceLine({
            invoiceId: "in_tier_renewal",
            periodEnd: 1_778_000_000,
            periodStart: 1_775_000_000,
            priceId: "price_pulse",
            quantity: 2,
            subscriptionId: "sub_123",
            subscriptionItemId: "si_pulse",
          }),
          makeStripeInvoiceLine({
            invoiceId: "in_tier_renewal",
            periodEnd: 1_778_000_000,
            periodStart: 1_775_000_000,
            priceId: "price_edge",
            quantity: 1,
            subscriptionId: "sub_123",
            subscriptionItemId: "si_edge",
          }),
        ],
      });
      const firstConversionInvoice = makeStripeFinancialInvoice({
        billingReason: "subscription_update",
        created: 1_776_000_000,
        id: "in_tier_first",
        lines: [
          makeStripeInvoiceLine({
            amount: -2_000,
            invoiceId: "in_tier_first",
            periodEnd: 1_778_000_000,
            periodStart: 1_776_000_000,
            priceId: "price_pulse",
            proration: true,
            quantity: 2,
            subscriptionId: "sub_123",
            subscriptionItemId: "si_pulse",
          }),
          makeStripeInvoiceLine({
            amount: 1_000,
            invoiceId: "in_tier_first",
            periodEnd: 1_778_000_000,
            periodStart: 1_776_000_000,
            priceId: "price_pulse",
            proration: true,
            quantity: 1,
            subscriptionId: "sub_123",
            subscriptionItemId: "si_pulse",
          }),
          makeStripeInvoiceLine({
            amount: -1_000,
            invoiceId: "in_tier_first",
            periodEnd: 1_778_000_000,
            periodStart: 1_776_000_000,
            priceId: "price_edge",
            proration: true,
            quantity: 1,
            subscriptionId: "sub_123",
            subscriptionItemId: "si_edge",
          }),
          makeStripeInvoiceLine({
            amount: 2_000,
            invoiceId: "in_tier_first",
            periodEnd: 1_778_000_000,
            periodStart: 1_776_000_000,
            priceId: "price_edge",
            proration: true,
            quantity: 2,
            subscriptionId: "sub_123",
            subscriptionItemId: "si_edge",
          }),
        ],
      });
      const secondConversionInvoice = makeStripeFinancialInvoice({
        billingReason: "subscription_update",
        created: 1_777_000_000,
        id: "in_tier_second",
        lines: [
          makeStripeInvoiceLine({
            amount: -1_000,
            invoiceId: "in_tier_second",
            periodEnd: 1_778_000_000,
            periodStart: 1_777_000_000,
            priceId: "price_pulse",
            proration: true,
            quantity: 1,
            subscriptionId: "sub_123",
            subscriptionItemId: "si_pulse",
          }),
          makeStripeInvoiceLine({
            amount: 2_000,
            invoiceId: "in_tier_second",
            periodEnd: 1_778_000_000,
            periodStart: 1_777_000_000,
            priceId: "price_edge",
            proration: true,
            quantity: 1,
            subscriptionId: "sub_123",
            subscriptionItemId: "si_pulse",
          }),
        ],
      });
      mockPaidHostedStripeInvoiceHistory({
        invoices: [
          secondConversionInvoice,
          firstConversionInvoice,
          renewalInvoice,
        ],
        refundedInvoiceId,
      });

      await expect(
        readHostedStripeRecurringFinancialState(
          makeStripeSubscription({
            items: [
              makeStripeSubscriptionItem({
                id: "si_edge",
                priceId: "price_edge",
                quantity: 2,
              }),
              makeStripeSubscriptionItem({
                id: "si_restored_pulse",
                priceId: "price_pulse",
                quantity: 1,
              }),
            ],
            latestInvoice: secondConversionInvoice.id,
          }),
        ),
      ).resolves.toMatchObject({
        fullyRefunded,
      });
    },
  );

  it.each([
    [
      "first increase while the group remains partially represented",
      "in_z_equal_first",
      3,
      true,
    ],
    [
      "second increase while the group remains partially represented",
      "in_a_equal_second",
      3,
      true,
    ],
    [
      "first increase after the group is fully unwound",
      "in_z_equal_first",
      2,
      false,
    ],
    [
      "second increase after the group is fully unwound",
      "in_a_equal_second",
      2,
      false,
    ],
  ] as const)(
    "classifies an equal-created cumulative %s",
    async (_description, refundedInvoiceId, currentQuantity, fullyRefunded) => {
      const renewalInvoice = makeStripeFinancialInvoice({
        created: 1_775_000_000,
        id: "in_equal_renewal",
        lines: [
          makeStripeInvoiceLine({
            invoiceId: "in_equal_renewal",
            periodEnd: 1_778_000_000,
            periodStart: 1_775_000_000,
            priceId: "price_family_pulse",
            quantity: 2,
            subscriptionId: "sub_123",
            subscriptionItemId: "si_family_pulse",
          }),
        ],
      });
      const firstIncreaseInvoice = makeStripeFinancialInvoice({
        billingReason: "subscription_update",
        created: 1_776_000_000,
        id: "in_z_equal_first",
        lines: [
          makeStripeInvoiceLine({
            amount: -2_000,
            invoiceId: "in_z_equal_first",
            periodEnd: 1_778_000_000,
            periodStart: 1_776_000_000,
            priceId: "price_family_pulse",
            proration: true,
            quantity: 2,
            subscriptionId: "sub_123",
            subscriptionItemId: "si_family_pulse",
          }),
          makeStripeInvoiceLine({
            amount: 3_000,
            invoiceId: "in_z_equal_first",
            periodEnd: 1_778_000_000,
            periodStart: 1_776_000_000,
            priceId: "price_family_pulse",
            proration: true,
            quantity: 3,
            subscriptionId: "sub_123",
            subscriptionItemId: "si_family_pulse",
          }),
        ],
      });
      const secondIncreaseInvoice = makeStripeFinancialInvoice({
        billingReason: "subscription_update",
        created: 1_776_000_000,
        id: "in_a_equal_second",
        lines: [
          makeStripeInvoiceLine({
            amount: -3_000,
            invoiceId: "in_a_equal_second",
            periodEnd: 1_778_000_000,
            periodStart: 1_776_000_000,
            priceId: "price_family_pulse",
            proration: true,
            quantity: 3,
            subscriptionId: "sub_123",
            subscriptionItemId: "si_family_pulse",
          }),
          makeStripeInvoiceLine({
            amount: 4_000,
            invoiceId: "in_a_equal_second",
            periodEnd: 1_778_000_000,
            periodStart: 1_776_000_000,
            priceId: "price_family_pulse",
            proration: true,
            quantity: 4,
            subscriptionId: "sub_123",
            subscriptionItemId: "si_family_pulse",
          }),
        ],
      });
      mockPaidHostedStripeInvoiceHistory({
        invoices: [
          secondIncreaseInvoice,
          firstIncreaseInvoice,
          renewalInvoice,
        ],
        refundedInvoiceId,
      });

      await expect(
        readHostedStripeRecurringFinancialState(
          makeStripeSubscription({
            items: [
              makeStripeSubscriptionItem({
                id: "si_family_pulse",
                priceId: "price_family_pulse",
                quantity: currentQuantity,
              }),
            ],
            latestInvoice: secondIncreaseInvoice.id,
          }),
        ),
      ).resolves.toMatchObject({
        fullyRefunded,
      });
    },
  );

  it("discards an earlier increase only after an unwind and paid re-establishment", async () => {
    const renewalInvoice = makeStripeFinancialInvoice({
      created: 1_775_000_000,
      id: "in_superseded_update_renewal",
      lines: [
        makeStripeInvoiceLine({
          invoiceId: "in_superseded_update_renewal",
          periodEnd: 1_778_000_000,
          periodStart: 1_775_000_000,
          priceId: "price_edge",
          quantity: 1,
          subscriptionId: "sub_123",
          subscriptionItemId: "si_current",
        }),
      ],
    });
    const refundedUpdateInvoice = makeStripeFinancialInvoice({
      billingReason: "subscription_update",
      created: 1_776_000_000,
      id: "in_superseded_update",
      lines: [
        makeStripeInvoiceLine({
          amount: -1_000,
          invoiceId: "in_superseded_update",
          periodEnd: 1_778_000_000,
          periodStart: 1_776_000_000,
          priceId: "price_edge",
          proration: true,
          quantity: 1,
          subscriptionId: "sub_123",
          subscriptionItemId: "si_current",
        }),
        makeStripeInvoiceLine({
          amount: 2_000,
          invoiceId: "in_superseded_update",
          periodEnd: 1_778_000_000,
          periodStart: 1_776_000_000,
          priceId: "price_edge",
          proration: true,
          quantity: 2,
          subscriptionId: "sub_123",
          subscriptionItemId: "si_current",
        }),
      ],
    });
    const unwindInvoice = makeStripeFinancialInvoice({
      amountPaid: 0,
      billingReason: "subscription_update",
      created: 1_776_500_000,
      id: "in_superseded_unwind",
      lines: [
        makeStripeInvoiceLine({
          amount: -2_000,
          invoiceId: "in_superseded_unwind",
          periodEnd: 1_778_000_000,
          periodStart: 1_776_500_000,
          priceId: "price_edge",
          proration: true,
          quantity: 2,
          subscriptionId: "sub_123",
          subscriptionItemId: "si_current",
        }),
        makeStripeInvoiceLine({
          amount: 1_000,
          invoiceId: "in_superseded_unwind",
          periodEnd: 1_778_000_000,
          periodStart: 1_776_500_000,
          priceId: "price_edge",
          proration: true,
          quantity: 1,
          subscriptionId: "sub_123",
          subscriptionItemId: "si_current",
        }),
      ],
    });
    const latestUpdateInvoice = makeStripeFinancialInvoice({
      billingReason: "subscription_update",
      created: 1_777_000_000,
      id: "in_latest_update",
      lines: [
        makeStripeInvoiceLine({
          amount: -1_000,
          invoiceId: "in_latest_update",
          periodEnd: 1_778_000_000,
          periodStart: 1_777_000_000,
          priceId: "price_edge",
          proration: true,
          quantity: 1,
          subscriptionId: "sub_123",
          subscriptionItemId: "si_current",
        }),
        makeStripeInvoiceLine({
          amount: 2_000,
          invoiceId: "in_latest_update",
          periodEnd: 1_778_000_000,
          periodStart: 1_777_000_000,
          priceId: "price_edge",
          proration: true,
          quantity: 2,
          subscriptionId: "sub_123",
          subscriptionItemId: "si_current",
        }),
      ],
    });
    mocks.stripeInvoicesRetrieve
      .mockResolvedValueOnce(latestUpdateInvoice)
      .mockResolvedValueOnce(unwindInvoice)
      .mockResolvedValueOnce(refundedUpdateInvoice)
      .mockResolvedValueOnce(renewalInvoice);
    mocks.stripeInvoicesList.mockResolvedValueOnce({
      data: [
        latestUpdateInvoice,
        unwindInvoice,
        refundedUpdateInvoice,
        renewalInvoice,
      ],
      has_more: false,
    });
    mocks.stripeInvoicePaymentsList
      .mockResolvedValueOnce({
        data: [makeStripeInvoicePayment({
          chargeId: "ch_latest_update",
          invoice: latestUpdateInvoice,
          paymentIntentId: "pi_latest_update",
        })],
        has_more: false,
      })
      .mockResolvedValueOnce({
        data: [],
        has_more: false,
      })
      .mockResolvedValueOnce({
        data: [makeStripeInvoicePayment({
          chargeId: "ch_superseded_update",
          invoice: refundedUpdateInvoice,
          paymentIntentId: "pi_superseded_update",
        })],
        has_more: false,
      })
      .mockResolvedValueOnce({
        data: [makeStripeInvoicePayment({
          chargeId: "ch_superseded_update_renewal",
          invoice: renewalInvoice,
          paymentIntentId: "pi_superseded_update_renewal",
        })],
        has_more: false,
      });
    mocks.stripeRefundsList.mockImplementation(async (params: {
      charge?: string;
    }) => ({
      data: params.charge === "ch_superseded_update"
        ? [
            makeStripeRefund({
              amount: 1_000,
              chargeId: "ch_superseded_update",
              id: "re_superseded_update",
              paymentIntentId: "pi_superseded_update",
              status: "succeeded",
            }),
          ]
        : [],
      has_more: false,
    }));

    await expect(
      readHostedStripeRecurringFinancialState(
        makeStripeSubscription({
          items: [
            makeStripeSubscriptionItem({
              id: "si_current",
              priceId: "price_edge",
              quantity: 2,
            }),
          ],
          latestInvoice: latestUpdateInvoice.id,
        }),
      ),
    ).resolves.toMatchObject({
      fullyRefunded: false,
    });
  });

  it.each([
    ["partially refunded", 2_000, 0, false, false],
    ["fully refunded", 4_000, 0, false, true],
    ["fully refunded after the balance application is reversed", 4_000, 1_000, true, false],
  ] as const)(
    "treats a reduction-credit source that is %s as refund-safe",
    async (
      _description,
      sourceRefundAmount,
      latestPaymentAmount,
      reverseBalanceApplication,
      fullyRefunded,
    ) => {
    const renewalInvoice = makeStripeFinancialInvoice({
      created: 1_775_000_000,
      id: "in_invoiced_reduction_renewal",
      lines: [
        makeStripeInvoiceLine({
          invoiceId: "in_invoiced_reduction_renewal",
          periodEnd: 1_778_000_000,
          periodStart: 1_775_000_000,
          priceId: "price_family_pulse",
          quantity: 2,
          subscriptionId: "sub_123",
          subscriptionItemId: "si_family_pulse",
        }),
      ],
    });
    const growthInvoice = makeStripeFinancialInvoice({
      amountPaid: 4_000,
      billingReason: "subscription_update",
      created: 1_776_000_000,
      id: "in_invoiced_reduction_growth",
      lines: [
        makeStripeInvoiceLine({
          amount: -2_000,
          invoiceId: "in_invoiced_reduction_growth",
          periodEnd: 1_778_000_000,
          periodStart: 1_776_000_000,
          priceId: "price_family_pulse",
          proration: true,
          quantity: 2,
          subscriptionId: "sub_123",
          subscriptionItemId: "si_family_pulse",
        }),
        makeStripeInvoiceLine({
          amount: 6_000,
          invoiceId: "in_invoiced_reduction_growth",
          periodEnd: 1_778_000_000,
          periodStart: 1_776_000_000,
          priceId: "price_family_pulse",
          proration: true,
          quantity: 6,
          subscriptionId: "sub_123",
          subscriptionItemId: "si_family_pulse",
        }),
      ],
    });
    const reductionInvoice = makeStripeFinancialInvoice({
      amountPaid: 0,
      billingReason: "subscription_update",
      created: 1_776_500_000,
      id: "in_invoiced_reduction_credit",
      lines: [
        makeStripeInvoiceLine({
          amount: -6_000,
          creditedInvoiceId: "in_invoiced_reduction_growth",
          invoiceId: "in_invoiced_reduction_credit",
          periodEnd: 1_778_000_000,
          periodStart: 1_776_500_000,
          priceId: "price_family_pulse",
          proration: true,
          quantity: 6,
          subscriptionId: "sub_123",
          subscriptionItemId: "si_family_pulse",
        }),
        makeStripeInvoiceLine({
          amount: 2_000,
          invoiceId: "in_invoiced_reduction_credit",
          periodEnd: 1_778_000_000,
          periodStart: 1_776_500_000,
          priceId: "price_family_pulse",
          proration: true,
          quantity: 2,
          subscriptionId: "sub_123",
          subscriptionItemId: "si_family_pulse",
        }),
      ],
    });
    const latestSeatInvoice = makeStripeFinancialInvoice({
      amountPaid: latestPaymentAmount,
      billingReason: "subscription_update",
      created: 1_777_000_000,
      id: "in_invoiced_reduction_latest",
      lines: [
        makeStripeInvoiceLine({
          amount: -2_000,
          invoiceId: "in_invoiced_reduction_latest",
          periodEnd: 1_778_000_000,
          periodStart: 1_777_000_000,
          priceId: "price_family_pulse",
          proration: true,
          quantity: 2,
          subscriptionId: "sub_123",
          subscriptionItemId: "si_family_pulse",
        }),
        makeStripeInvoiceLine({
          amount: 3_000,
          invoiceId: "in_invoiced_reduction_latest",
          periodEnd: 1_778_000_000,
          periodStart: 1_777_000_000,
          priceId: "price_family_pulse",
          proration: true,
          quantity: 3,
          subscriptionId: "sub_123",
          subscriptionItemId: "si_family_pulse",
        }),
      ],
    });
    const invoices = [
      latestSeatInvoice,
      reductionInvoice,
      growthInvoice,
      renewalInvoice,
    ];
    for (const invoice of invoices) {
      mocks.stripeInvoicesRetrieve.mockResolvedValueOnce(invoice);
    }
    mocks.stripeInvoicesList.mockResolvedValueOnce({
      data: invoices,
      has_more: false,
    });
    mocks.stripeInvoicePaymentsList
      .mockResolvedValueOnce({
        data: [makeStripeInvoicePayment({
          amountPaid: latestPaymentAmount,
          invoice: latestSeatInvoice,
        })],
        has_more: false,
      })
      .mockResolvedValueOnce({
        data: [makeStripeInvoicePayment({
          amountPaid: 0,
          invoice: reductionInvoice,
        })],
        has_more: false,
      })
      .mockResolvedValueOnce({
        data: [makeStripeInvoicePayment({
          amountPaid: 4_000,
          chargeId: `ch_${growthInvoice.id}`,
          invoice: growthInvoice,
          paymentIntentId: `pi_${growthInvoice.id}`,
        })],
        has_more: false,
      })
      .mockResolvedValueOnce({
        data: [makeStripeInvoicePayment({
          chargeId: `ch_${renewalInvoice.id}`,
          invoice: renewalInvoice,
          paymentIntentId: `pi_${renewalInvoice.id}`,
        })],
        has_more: false,
      });
    mocks.stripeRefundsList.mockImplementation(async (params: {
      charge?: string;
    }) => ({
      data: params.charge === `ch_${growthInvoice.id}`
        ? [
            makeStripeRefund({
              amount: sourceRefundAmount,
              chargeId: `ch_${growthInvoice.id}`,
              id: `re_${growthInvoice.id}`,
              paymentIntentId: `pi_${growthInvoice.id}`,
              status: "succeeded",
            }),
          ]
        : [],
      has_more: false,
    }));
    mocks.stripeCustomerBalanceTransactionsList.mockResolvedValueOnce({
      data: [
        ...(reverseBalanceApplication
          ? [
              makeStripeCustomerBalanceTransaction({
                amount: -1_000,
                created: 1_777_500_000,
                endingBalance: -4_000,
                id: "cbtxn_reestablished_seat_reversed",
                invoiceId: latestSeatInvoice.id,
                type: "unapplied_from_invoice",
              }),
            ]
          : []),
        makeStripeCustomerBalanceTransaction({
          amount: 1_000,
          created: 1_777_000_000,
          endingBalance: -3_000,
          id: "cbtxn_reestablished_seat",
          invoiceId: latestSeatInvoice.id,
          type: "applied_to_invoice",
        }),
        makeStripeCustomerBalanceTransaction({
          amount: -4_000,
          created: 1_776_500_000,
          endingBalance: -4_000,
          id: "cbtxn_reduction_credit",
          invoiceId: reductionInvoice.id,
          type: "applied_to_invoice",
        }),
      ],
      has_more: false,
    });

    await expect(
      readHostedStripeRecurringFinancialState(
        makeStripeSubscription({
          items: [
            makeStripeSubscriptionItem({
              id: "si_family_pulse",
              priceId: "price_family_pulse",
              quantity: 3,
            }),
          ],
          latestInvoice: latestSeatInvoice.id,
        }),
      ),
    ).resolves.toMatchObject({
      collectionState: { kind: "paid" },
      fullyRefunded,
    });
    if (sourceRefundAmount === 4_000) {
      expect(
        mocks.stripeCustomerBalanceTransactionsList,
      ).toHaveBeenCalledWith(
        "cus_123",
        expect.objectContaining({
          created: { gte: 1_775_000_000 },
          limit: 100,
        }),
        HOSTED_STRIPE_RECURRING_FINANCIAL_REQUEST_OPTIONS,
      );
    } else {
      expect(
        mocks.stripeCustomerBalanceTransactionsList,
      ).not.toHaveBeenCalled();
    }
  });

  it.each([
    ["a partial refund", 500, false],
    ["a full aggregate refund", 1_000, true],
  ] as const)(
    "reconciles %s once across two current-period invoices paid by one PaymentIntent",
    async (_description, refundAmount, fullyRefunded) => {
      const renewalInvoice = makeStripeFinancialInvoice({
        amountPaid: 500,
        id: "in_shared_renewal",
      });
      const deltaInvoice = makeStripeFinancialInvoice({
        amountPaid: 500,
        billingReason: "subscription_update",
        id: "in_shared_delta",
      });
      mocks.stripeInvoicesRetrieve
        .mockResolvedValueOnce(deltaInvoice)
        .mockResolvedValueOnce(renewalInvoice);
      mocks.stripeInvoicesList.mockResolvedValueOnce({
        data: [deltaInvoice, renewalInvoice],
        has_more: false,
      });
      mocks.stripeInvoicePaymentsList
        .mockResolvedValueOnce({
          data: [makeStripeInvoicePayment({
            amountPaid: 500,
            chargeId: "ch_shared",
            id: "ipay_shared_delta",
            invoice: deltaInvoice,
            paymentIntentId: "pi_shared",
          })],
          has_more: false,
        })
        .mockResolvedValueOnce({
          data: [makeStripeInvoicePayment({
            amountPaid: 500,
            chargeId: "ch_shared",
            id: "ipay_shared_renewal",
            invoice: renewalInvoice,
            paymentIntentId: "pi_shared",
          })],
          has_more: false,
        });
      mocks.stripeRefundsList.mockResolvedValueOnce({
        data: [
          makeStripeRefund({
            amount: refundAmount,
            chargeId: "ch_shared",
            id: "re_shared",
            paymentIntentId: "pi_shared",
            status: "succeeded",
          }),
        ],
        has_more: false,
      });

      await expect(
        readHostedStripeRecurringFinancialState(
          makeStripeSubscription({
            latestInvoice: deltaInvoice.id,
          }),
        ),
      ).resolves.toMatchObject({
        fullyRefunded,
      });
      expect(mocks.stripeRefundsList).toHaveBeenCalledOnce();
      expect(mocks.stripeDisputesList).toHaveBeenCalledOnce();
    },
  );

  it("deduplicates mixed InvoicePayment forms before refund and dispute reads", async () => {
    const renewalInvoice = makeStripeFinancialInvoice({
      id: "in_mixed_renewal",
    });
    const deltaInvoice = makeStripeFinancialInvoice({
      billingReason: "subscription_update",
      id: "in_mixed_delta",
    });
    mocks.stripeInvoicesRetrieve
      .mockResolvedValueOnce(deltaInvoice)
      .mockResolvedValueOnce(renewalInvoice);
    mocks.stripeInvoicesList.mockResolvedValueOnce({
      data: [deltaInvoice, renewalInvoice],
      has_more: false,
    });
    mocks.stripeInvoicePaymentsList
      .mockResolvedValueOnce({
        data: [makeStripeInvoicePayment({
          chargeId: "ch_mixed",
          invoice: deltaInvoice,
          paymentIntentId: "pi_mixed",
        })],
        has_more: false,
      })
      .mockResolvedValueOnce({
        data: [makeStripeInvoicePayment({
          chargeId: "ch_mixed",
          invoice: renewalInvoice,
          kind: "charge",
        })],
        has_more: false,
      });

    await expect(
      readHostedStripeRecurringFinancialState(
        makeStripeSubscription({
          latestInvoice: deltaInvoice.id,
        }),
      ),
    ).resolves.toMatchObject({
      fullyRefunded: false,
      outstandingDispute: false,
    });
    expect(mocks.stripeRefundsList).toHaveBeenCalledOnce();
    expect(mocks.stripeDisputesList).toHaveBeenCalledOnce();
  });

  it("excludes paid invoices whose subscription lines fund only a prior period", async () => {
    const currentInvoice = makeStripeFinancialInvoice({
      id: "in_current",
    });
    const priorInvoice = makeStripeFinancialInvoice({
      id: "in_prior",
      linePeriodEnd: 1_775_000_000,
      linePeriodStart: 1_772_000_000,
    });
    mocks.stripeInvoicesRetrieve.mockResolvedValueOnce(currentInvoice);
    mocks.stripeInvoicesList.mockResolvedValueOnce({
      data: [currentInvoice, priorInvoice],
      has_more: false,
    });

    await expect(
      readHostedStripeRecurringFinancialState(
        makeStripeSubscription({
          latestInvoice: "in_current",
        }),
      ),
    ).resolves.toMatchObject({
      fullyRefunded: false,
      invoiceId: "in_current",
    });
    expect(mocks.stripeInvoicesRetrieve).toHaveBeenCalledTimes(1);
    expect(mocks.stripeRefundsList).toHaveBeenCalledTimes(1);
  });

  it("fails closed instead of paging beyond the bounded current-period invoice window", async () => {
    const currentInvoice = makeStripeFinancialInvoice({
      id: "in_current",
    });
    mocks.stripeInvoicesRetrieve.mockResolvedValueOnce(currentInvoice);
    mocks.stripeInvoicesList.mockResolvedValueOnce({
      data: [currentInvoice],
      has_more: true,
    });

    await expect(
      readHostedStripeRecurringFinancialState(
        makeStripeSubscription({
          latestInvoice: "in_current",
        }),
      ),
    ).rejects.toThrow(
      "Stripe exceeded the bounded current-period invoice reconciliation shape.",
    );
    expect(mocks.stripeInvoicesList).toHaveBeenCalledOnce();
  });

  it("keeps an unpaid current-period base invoice controlling after a later paid delta", async () => {
    const paidDelta = makeStripeFinancialInvoice({
      billingReason: "subscription_update",
      id: "in_paid_delta",
    });
    const unpaidBase = makeStripeFinancialInvoice({
      amountPaid: 0,
      amountRemaining: 1_000,
      attempted: true,
      billingReason: "subscription_cycle",
      id: "in_unpaid_base",
      status: "open",
    });
    mocks.stripeInvoicesRetrieve
      .mockResolvedValueOnce(paidDelta)
      .mockResolvedValueOnce(unpaidBase);
    mocks.stripeInvoicesList.mockResolvedValueOnce({
      data: [paidDelta, unpaidBase],
      has_more: false,
    });
    mocks.stripeInvoicePaymentsList
      .mockResolvedValueOnce({
        data: [makeStripeInvoicePayment({
          chargeId: "ch_delta",
          invoice: paidDelta,
          paymentIntentId: "pi_delta",
        })],
        has_more: false,
      })
      .mockResolvedValueOnce({
        data: [],
        has_more: false,
      });

    await expect(
      readHostedStripeRecurringFinancialState(
        makeStripeSubscription({
          latestInvoice: "in_paid_delta",
        }),
      ),
    ).resolves.toMatchObject({
      collectionState: {
        kind: "payment_required",
      },
      fullyRefunded: false,
      invoiceId: "in_unpaid_base",
    });
  });

  it("rejects a listed refund that does not match the canonical invoice payment", async () => {
    mocks.stripeRefundsList.mockResolvedValueOnce({
      data: [
        makeStripeRefund({
          amount: 1_000,
          chargeId: "ch_wrong",
          id: "re_wrong",
          paymentIntentId: "pi_wrong",
          status: "succeeded",
        }),
      ],
      has_more: false,
    });

    await expect(
      readHostedStripeRecurringFinancialState(
        makeStripeSubscription({
          latestInvoice: "in_123",
        }),
      ),
    ).rejects.toThrow(
      "Stripe returned a Refund for the wrong current-entitlement Charge.",
    );
  });

  it("rejects a listed dispute that does not match the canonical invoice payment", async () => {
    mocks.stripeDisputesList.mockResolvedValueOnce({
      data: [
        makeStripeDispute({
          balanceTransactions: [
            makeStripeBalanceTransaction({ amount: -1_000, id: "txn_wrong" }),
          ],
          chargeId: "ch_wrong",
          paymentIntentId: "pi_wrong",
        }),
      ],
      has_more: false,
    });

    await expect(
      readHostedStripeRecurringFinancialState(
        makeStripeSubscription({
          latestInvoice: "in_123",
        }),
      ),
    ).rejects.toThrow(
      "Stripe returned a Dispute for the wrong current-entitlement Charge.",
    );
  });
});

function makeMemberSnapshot(overrides?: {
  billingRef?: ReturnType<typeof makeBillingRef> | null;
  core?: ReturnType<typeof makeHostedMemberCoreState>;
}) {
  return {
    billingRef: overrides?.billingRef ?? null,
    core: overrides?.core ?? makeHostedMemberCoreState(),
  };
}

function makeBillingRef(
  overrides?: Partial<{
    currentBillingPhase: string | null;
    memberId: string;
    stripeCustomerId: string | null;
    stripeSubscriptionId: string | null;
  }>,
) {
  return {
    currentBillingPhase: overrides && "currentBillingPhase" in overrides
      ? overrides.currentBillingPhase
      : undefined,
    memberId: overrides?.memberId ?? "member_123",
    stripeCustomerId: overrides && "stripeCustomerId" in overrides
      ? overrides.stripeCustomerId
      : "cus_123",
    stripeSubscriptionId: overrides && "stripeSubscriptionId" in overrides
      ? overrides.stripeSubscriptionId
      : "sub_123",
  };
}

function makeHostedMemberCoreState(overrides?: Partial<{
  billingStatus: "active" | "incomplete";
  id: string;
}>) {
  return {
    billingStatus: overrides?.billingStatus ?? "incomplete" as const,
    createdAt: new Date("2026-04-23T00:00:00.000Z"),
    id: overrides?.id ?? "member_123",
    suspendedAt: null,
    updatedAt: new Date("2026-04-23T00:00:00.000Z"),
  };
}

function makeStripeInvoice(
  overrides?: Partial<{
    customer: string | null;
    id: string;
    subscription: string | null;
  }>,
): Stripe.Invoice {
  // @ts-expect-error - the synthetic fixture is intentionally narrower than Stripe.Invoice.
  return {
    customer: overrides?.customer ?? "cus_123",
    id: overrides?.id ?? "in_123",
    subscription: overrides?.subscription ?? "sub_123",
  } as Stripe.Invoice;
}

function makeStripeSubscription(
  overrides?: Partial<{
    currentPeriodEnd: number;
    currentPeriodStart: number;
    customer: string;
    id: string;
    items: Stripe.SubscriptionItem[];
    latestInvoice: string | null;
    metadata: Record<string, string>;
    pendingUpdate: Stripe.Subscription.PendingUpdate | null;
    status: Stripe.Subscription.Status;
  }>,
): Stripe.Subscription {
  const currentPeriodEnd = overrides?.currentPeriodEnd ?? 1_778_000_000;
  const currentPeriodStart = overrides?.currentPeriodStart ?? 1_775_000_000;
  const latestInvoice = overrides?.latestInvoice;
  const subscription: Stripe.Subscription & {
    current_period_end: number;
    current_period_start: number;
  } = {
    application: null,
    application_fee_percent: null,
    automatic_tax: {
      disabled_reason: null,
      enabled: false,
      liability: null,
    },
    billing_cycle_anchor: currentPeriodStart,
    billing_cycle_anchor_config: null,
    billing_mode: {
      flexible: null,
      type: "classic",
    },
    billing_thresholds: null,
    cancel_at: null,
    cancel_at_period_end: false,
    canceled_at: null,
    cancellation_details: null,
    collection_method: "charge_automatically",
    created: currentPeriodStart,
    currency: "usd",
    current_period_end: currentPeriodEnd,
    current_period_start: currentPeriodStart,
    customer: overrides?.customer ?? "cus_123",
    customer_account: null,
    days_until_due: null,
    default_payment_method: null,
    default_source: null,
    description: null,
    discounts: [],
    ended_at: null,
    id: overrides?.id ?? "sub_123",
    invoice_settings: {
      account_tax_ids: null,
      issuer: { type: "self" },
    },
    items: {
      data: overrides?.items ?? [],
      has_more: false,
      object: "list",
      url: "/v1/subscription_items",
    },
    latest_invoice: latestInvoice ?? null,
    livemode: false,
    managed_payments: null,
    metadata: overrides?.metadata ?? {},
    next_pending_invoice_item_invoice: null,
    object: "subscription",
    on_behalf_of: null,
    pause_collection: null,
    payment_settings: null,
    pending_invoice_item_interval: null,
    pending_setup_intent: null,
    pending_update:
      overrides && "pendingUpdate" in overrides
        ? overrides.pendingUpdate ?? null
        : null,
    schedule: null,
    start_date: currentPeriodStart,
    status: overrides?.status ?? "active",
    test_clock: null,
    transfer_data: null,
    trial_end: null,
    trial_settings: null,
    trial_start: null,
  };
  return subscription;
}

function makeStripeSubscriptionItem(input: {
  id?: string;
  priceId: string;
  quantity?: number;
}): Stripe.SubscriptionItem {
  const plan: Partial<Stripe.Plan> = {
    id: input.priceId,
    object: "plan",
  };
  const price: Partial<Stripe.Price> = {
    id: input.priceId,
    object: "price",
  };
  const item: Partial<Stripe.SubscriptionItem> = {
    billing_thresholds: null,
    created: 1_775_000_000,
    current_period_end: 1_778_000_000,
    current_period_start: 1_775_000_000,
    discounts: [],
    id: input.id ?? "si_123",
    metadata: {},
    object: "subscription_item" as const,
    plan: plan as Stripe.Plan,
    price: price as Stripe.Price,
    quantity: input.quantity ?? 1,
    subscription: "sub_123",
    tax_rates: null,
  };
  return item as Stripe.SubscriptionItem;
}

function makeStripePendingUpdate(input: {
  itemId?: string;
  priceId: string;
  quantity?: number;
}): Stripe.Subscription.PendingUpdate {
  return {
    billing_cycle_anchor: null,
    expires_at: 1_777_000_000,
    subscription_items: [
      makeStripeSubscriptionItem({
        id: input.itemId,
        priceId: input.priceId,
        quantity: input.quantity,
      }),
    ],
    trial_end: null,
    trial_from_plan: false,
  };
}

function makeStripeCharge(overrides?: {
  customerId?: string;
  id?: string;
  paymentIntentId?: string | null;
}): Stripe.Charge {
  const charge: Partial<Stripe.Charge> = {
    customer: overrides?.customerId ?? "cus_123",
    id: overrides?.id ?? "ch_123",
    object: "charge",
    payment_intent:
      overrides && "paymentIntentId" in overrides
        ? overrides.paymentIntentId
        : "pi_123",
  };
  return charge as Stripe.Charge;
}

function makeStripePaymentIntent(overrides?: {
  chargeId?: string;
  id?: string;
}): Stripe.PaymentIntent {
  const paymentIntent: Partial<Stripe.PaymentIntent> = {
    customer: "cus_123",
    id: overrides?.id ?? "pi_123",
    latest_charge: overrides?.chargeId ?? "ch_123",
    object: "payment_intent",
    status: "succeeded",
  };
  return paymentIntent as Stripe.PaymentIntent;
}

function makeStripeFinancialInvoice(overrides?: {
  amountPaid?: number;
  amountRemaining?: number;
  attempted?: boolean;
  billingReason?: Stripe.Invoice["billing_reason"];
  created?: number;
  id?: string;
  linePeriodEnd?: number;
  linePeriodStart?: number;
  lines?: Stripe.InvoiceLineItem[];
  status?: Stripe.Invoice["status"];
  subscriptionId?: string;
}): Stripe.Invoice {
  const invoice: Partial<Stripe.Invoice> & { subscription: string } = {
    amount_paid: overrides?.amountPaid ?? 1_000,
    amount_remaining: overrides?.amountRemaining ?? 0,
    attempted: overrides?.attempted ?? true,
    billing_reason: overrides?.billingReason ?? "subscription_cycle",
    created: overrides?.created ?? 1_775_000_000,
    customer: "cus_123",
    id: overrides?.id ?? "in_123",
    lines: {
      data: [
        ...(overrides?.lines ?? [
          makeStripeInvoiceLine({
            invoiceId: overrides?.id ?? "in_123",
            periodEnd: overrides?.linePeriodEnd ?? 1_778_000_000,
            periodStart: overrides?.linePeriodStart ?? 1_775_000_000,
            subscriptionId: overrides?.subscriptionId ?? "sub_123",
          }),
        ]),
      ],
      has_more: false,
      object: "list",
      url: `/v1/invoices/${overrides?.id ?? "in_123"}/lines`,
    },
    object: "invoice",
    status: overrides?.status ?? "paid",
    subscription: overrides?.subscriptionId ?? "sub_123",
  };
  return invoice as Stripe.Invoice;
}

function makeStripeInvoiceLine(input: {
  amount?: number;
  creditedInvoiceId?: string;
  invoiceId: string;
  periodEnd: number;
  periodStart: number;
  priceId?: string;
  proration?: boolean;
  quantity?: number;
  subscriptionId: string;
  subscriptionItemId?: string;
}): Stripe.InvoiceLineItem {
  const line: Partial<Stripe.InvoiceLineItem> = {
    amount: input.amount ?? 1_000,
    id: `il_${input.invoiceId}`,
    invoice: input.invoiceId,
    object: "line_item",
    parent: {
      invoice_item_details: null,
      subscription_item_details: {
        invoice_item: null,
        proration: input.proration ?? false,
        proration_details: input.creditedInvoiceId
          ? {
              credited_items: {
                invoice: input.creditedInvoiceId,
                invoice_line_items: [`il_${input.creditedInvoiceId}`],
              },
            }
          : null,
        subscription: input.subscriptionId,
        subscription_item: input.subscriptionItemId ?? "si_123",
      },
      type: "subscription_item_details",
    },
    period: {
      end: input.periodEnd,
      start: input.periodStart,
    },
    pricing: {
      price_details: {
        price: input.priceId ?? "price_123",
        product: "prod_123",
      },
      type: "price_details",
      unit_amount_decimal: null,
    },
    quantity: input.quantity ?? 1,
    subscription: input.subscriptionId,
  };
  return line as Stripe.InvoiceLineItem;
}

function makeStripeQuantityTransitionLines(input: {
  afterQuantity: number;
  beforeQuantity: number;
  invoiceId: string;
  periodStart: number;
  priceId: string;
  subscriptionItemId: string;
}): Stripe.InvoiceLineItem[] {
  const shared = {
    invoiceId: input.invoiceId,
    periodEnd: 1_778_000_000,
    periodStart: input.periodStart,
    priceId: input.priceId,
    proration: true,
    subscriptionId: "sub_123",
    subscriptionItemId: input.subscriptionItemId,
  };
  return [
    ...(input.beforeQuantity > 0
      ? [
          makeStripeInvoiceLine({
            ...shared,
            amount: -input.beforeQuantity * 1_000,
            quantity: input.beforeQuantity,
          }),
        ]
      : []),
    ...(input.afterQuantity > 0
      ? [
          makeStripeInvoiceLine({
            ...shared,
            amount: input.afterQuantity * 1_000,
            quantity: input.afterQuantity,
          }),
        ]
      : []),
  ];
}

function makeStripeCustomerBalanceTransaction(input: {
  amount: number;
  created: number;
  endingBalance: number;
  id: string;
  invoiceId: string;
  type: Stripe.CustomerBalanceTransaction.Type;
}): Stripe.CustomerBalanceTransaction {
  const transaction: Partial<Stripe.CustomerBalanceTransaction> = {
    amount: input.amount,
    checkout_session: null,
    created: input.created,
    credit_note: null,
    currency: "usd",
    customer: "cus_123",
    customer_account: null,
    description: null,
    ending_balance: input.endingBalance,
    id: input.id,
    invoice: input.invoiceId,
    livemode: false,
    metadata: {},
    object: "customer_balance_transaction",
    type: input.type,
  };
  return transaction as Stripe.CustomerBalanceTransaction;
}

function makeStripeInvoicePayment(overrides?: {
  amountPaid?: number;
  chargeId?: string;
  id?: string;
  invoice?: Stripe.Invoice;
  kind?: "charge" | "payment_intent";
  paymentIntentId?: string;
}): Stripe.InvoicePayment {
  const chargeId = overrides?.chargeId ?? "ch_123";
  const paymentIntentId = overrides?.paymentIntentId ?? "pi_123";
  const invoice = overrides?.invoice ?? makeStripeFinancialInvoice();
  const invoicePayment: Partial<Stripe.InvoicePayment> = {
    amount_paid: overrides?.amountPaid ??
      (typeof invoice.amount_paid === "number" ? invoice.amount_paid : 1_000),
    id: overrides?.id ?? `ipay_${invoice.id}`,
    invoice,
    is_default: true,
    object: "invoice_payment",
    payment: overrides?.kind === "charge"
      ? {
          charge: makeStripeCharge({
            id: chargeId,
            paymentIntentId: null,
          }),
          type: "charge",
        }
      : {
          charge: chargeId,
          payment_intent: makeStripePaymentIntent({
            chargeId,
            id: paymentIntentId,
          }),
          type: "payment_intent",
        },
    status: "paid",
  };
  return invoicePayment as Stripe.InvoicePayment;
}

function makeStripeRefund(input: {
  amount: number;
  chargeId?: string;
  id: string;
  paymentIntentId?: string;
  status: Stripe.Refund["status"];
}): Stripe.Refund {
  const refund: Partial<Stripe.Refund> = {
    amount: input.amount,
    charge: input.chargeId ?? "ch_123",
    id: input.id,
    object: "refund",
    payment_intent: input.paymentIntentId ?? "pi_123",
    status: input.status,
  };
  return refund as Stripe.Refund;
}

function mockPaidHostedStripeInvoiceHistory(input: {
  invoices: Stripe.Invoice[];
  refundedInvoiceId: string;
}): void {
  for (const invoice of input.invoices) {
    mocks.stripeInvoicesRetrieve.mockResolvedValueOnce(invoice);
  }
  mocks.stripeInvoicesList.mockResolvedValueOnce({
    data: input.invoices,
    has_more: false,
  });
  for (const invoice of input.invoices) {
    mocks.stripeInvoicePaymentsList.mockResolvedValueOnce({
      data: [
        makeStripeInvoicePayment({
          chargeId: `ch_${invoice.id}`,
          invoice,
          paymentIntentId: `pi_${invoice.id}`,
        }),
      ],
      has_more: false,
    });
  }
  mocks.stripeRefundsList.mockImplementation(async (params: {
    charge?: string;
  }) => ({
    data: params.charge === `ch_${input.refundedInvoiceId}`
      ? [
          makeStripeRefund({
            amount: 1_000,
            chargeId: `ch_${input.refundedInvoiceId}`,
            id: `re_${input.refundedInvoiceId}`,
            paymentIntentId: `pi_${input.refundedInvoiceId}`,
            status: "succeeded",
          }),
        ]
      : [],
    has_more: false,
  }));
}

function makeStripeBalanceTransaction(input: {
  amount: number;
  id: string;
}): Stripe.BalanceTransaction {
  const transaction: Partial<Stripe.BalanceTransaction> = {
    amount: input.amount,
    currency: "usd",
    id: input.id,
    object: "balance_transaction",
  };
  return transaction as Stripe.BalanceTransaction;
}

function makeStripeDispute(input: {
  balanceTransactions: Stripe.BalanceTransaction[];
  chargeId?: string;
  paymentIntentId?: string;
}): Stripe.Dispute {
  const dispute: Partial<Stripe.Dispute> = {
    balance_transactions: input.balanceTransactions,
    charge: input.chargeId ?? "ch_123",
    id: "dp_123",
    object: "dispute",
    payment_intent: input.paymentIntentId ?? "pi_123",
  };
  return dispute as Stripe.Dispute;
}

function makeConcurrentCallTracker() {
  let active = 0;
  let maximum = 0;

  return {
    maxConcurrent: () => maximum,
    run: async <T>(read: () => T): Promise<T> => {
      active += 1;
      maximum = Math.max(maximum, active);
      try {
        await Promise.resolve();
        return read();
      } finally {
        active -= 1;
      }
    },
  };
}

function makeFamilyBillingLookup() {
  return {
    billingRef: {
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
    },
    group: {
      id: "group_123",
      ownerMemberId: "owner_123",
    },
    matchedBy: "stripeSubscriptionId",
  };
}
