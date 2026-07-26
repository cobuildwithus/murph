import { describe, expect, it, vi } from "vitest";

const familyMocks = vi.hoisted(() => ({
  readHostedMemberFamilyBillingClaim: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/family-plan", () => ({
  readHostedMemberFamilyBillingClaim:
    familyMocks.readHostedMemberFamilyBillingClaim,
}));

import { createHostedStripeSubscriptionLookupKey } from "@/src/lib/hosted-onboarding/contact-privacy";
import {
  buildHostedCheckoutSubscriptionCleanupCandidate,
  executeHostedCheckoutSubscriptionCleanup,
} from "@/src/lib/hosted-onboarding/stripe-checkout-subscription-cleanup";

describe("hosted Checkout subscription cleanup", () => {
  it("cancels and refunds an exact loser after the member and billing ref are gone", async () => {
    const harness = createCleanupHarness({
      memberBillingRefMissing: true,
    });

    await executeHostedCheckoutSubscriptionCleanup({
      candidate: harness.candidate,
      prisma: harness.prisma,
      stripe: harness.stripeClient,
    });

    expect(harness.billingRefFindUnique).toHaveBeenCalledOnce();
    expect(await harness.billingRefFindUnique.mock.results[0]?.value).toBeNull();
    expect(harness.stripe.subscriptions.cancel).toHaveBeenCalledWith(
      "sub_loser",
      {},
      expect.objectContaining({
        maxNetworkRetries: 0,
        timeout: 5_000,
      }),
    );
    expect(harness.stripe.refunds.create).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 800,
        payment_intent: "pi_checkout",
      }),
      expect.any(Object),
    );
  });

  it("checks superseded ownership through the narrow subscription blind index", async () => {
    const harness = createCleanupHarness();

    await executeHostedCheckoutSubscriptionCleanup({
      candidate: harness.candidate,
      prisma: harness.prisma,
      stripe: harness.stripeClient,
    });

    expect(harness.billingRefFindUnique).toHaveBeenCalledWith({
      select: {
        stripeSubscriptionLookupKey: true,
      },
      where: {
        memberId: "member_123",
      },
    });
    expect(harness.stripe.subscriptions.cancel).toHaveBeenCalledWith(
      "sub_loser",
      {},
      expect.objectContaining({
        maxNetworkRetries: 0,
        timeout: 5_000,
      }),
    );
    expect(harness.stripe.invoices.retrieve).toHaveBeenCalledWith(
      "in_checkout",
      {},
      expect.any(Object),
    );
    expect(harness.stripe.refunds.create).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 800,
        payment_intent: "pi_checkout",
      }),
      expect.objectContaining({
        idempotencyKey: expect.stringContaining(
          "hosted-checkout-cleanup-refund:cs_checkout:in_checkout:pi_checkout:",
        ),
      }),
    );
  });

  it("never cancels a candidate that became the member's authoritative subscription", async () => {
    const harness = createCleanupHarness({
      stripeSubscriptionLookupKey:
        createHostedStripeSubscriptionLookupKey("sub_loser"),
    });

    await expect(executeHostedCheckoutSubscriptionCleanup({
      candidate: harness.candidate,
      prisma: harness.prisma,
      stripe: harness.stripeClient,
    })).rejects.toMatchObject({
      code: "HOSTED_CHECKOUT_CLEANUP_OWNERSHIP_CHANGED",
      retryable: true,
    });

    expect(harness.stripe.checkout.sessions.retrieve).not.toHaveBeenCalled();
    expect(harness.stripe.subscriptions.cancel).not.toHaveBeenCalled();
    expect(harness.stripe.refunds.create).not.toHaveBeenCalled();
  });

  it.each([
    {
      familySubscriptionOwnerGroupIds: [],
      label: "another member",
      memberSubscriptionOwnerIds: ["member_other"],
    },
    {
      familySubscriptionOwnerGroupIds: ["family_other"],
      label: "a Family group",
      memberSubscriptionOwnerIds: [],
    },
    {
      familySubscriptionOwnerGroupIds: ["family_other"],
      label: "ambiguous member and Family owners",
      memberSubscriptionOwnerIds: ["member_other"],
    },
  ])("never mutates a loser subscription owned by $label", async ({
    familySubscriptionOwnerGroupIds,
    memberSubscriptionOwnerIds,
  }) => {
    const harness = createCleanupHarness({
      familySubscriptionOwnerGroupIds,
      memberSubscriptionOwnerIds,
    });

    await expect(executeHostedCheckoutSubscriptionCleanup({
      candidate: harness.candidate,
      prisma: harness.prisma,
      stripe: harness.stripeClient,
    })).rejects.toMatchObject({
      code: "HOSTED_CHECKOUT_CLEANUP_OWNERSHIP_CHANGED",
      retryable: true,
    });

    expect(harness.stripe.checkout.sessions.retrieve).not.toHaveBeenCalled();
    expect(harness.stripe.subscriptions.cancel).not.toHaveBeenCalled();
    expect(harness.stripe.refunds.create).not.toHaveBeenCalled();
    expect(harness.stripe.customers.del).not.toHaveBeenCalled();
  });

  it("fails retryably without provider mutation when orphan cleanup is already running", async () => {
    const harness = createCleanupHarness({
      advisoryLockAcquired: false,
    });

    await expect(executeHostedCheckoutSubscriptionCleanup({
      candidate: harness.candidate,
      prisma: harness.prisma,
      stripe: harness.stripeClient,
    })).rejects.toMatchObject({
      code: "HOSTED_CHECKOUT_CLEANUP_OWNER_BUSY",
      retryable: true,
    });

    expect(harness.stripe.checkout.sessions.retrieve).not.toHaveBeenCalled();
    expect(harness.stripe.subscriptions.cancel).not.toHaveBeenCalled();
    expect(harness.stripe.refunds.create).not.toHaveBeenCalled();
  });

  it("deletes a distinct unowned Customer after canceling and refunding a first-time loser", async () => {
    const harness = createCleanupHarness({
      stripeSubscriptionLookupKey:
        createHostedStripeSubscriptionLookupKey("sub_winner"),
    });

    await executeHostedCheckoutSubscriptionCleanup({
      candidate: harness.candidate,
      prisma: harness.prisma,
      stripe: harness.stripeClient,
    });

    expect(harness.stripe.customers.del).toHaveBeenCalledWith(
      "cus_loser",
      {},
      expect.objectContaining({
        maxNetworkRetries: 0,
        timeout: 5_000,
      }),
    );
  });

  it("preserves a Checkout Customer that another local billing owner references", async () => {
    const harness = createCleanupHarness({
      memberCustomerOwner: true,
    });

    await executeHostedCheckoutSubscriptionCleanup({
      candidate: harness.candidate,
      prisma: harness.prisma,
      stripe: harness.stripeClient,
    });

    expect(harness.stripe.customers.del).not.toHaveBeenCalled();
    expect(harness.stripe.subscriptions.list).not.toHaveBeenCalled();
  });

  it("rotates the refund retry key only after terminal failed-refund proof", async () => {
    const failedRefund = {
      amount: 800,
      charge: "ch_checkout",
      id: "re_failed",
      payment_intent: "pi_checkout",
      status: "failed",
    };
    const harness = createCleanupHarness();
    harness.stripe.subscriptions.retrieve
      .mockResolvedValueOnce(makeSubscription("active"))
      .mockResolvedValueOnce(makeSubscription("canceled"));
    harness.stripe.refunds.list
      .mockResolvedValueOnce({
        data: [],
        has_more: false,
      })
      .mockResolvedValueOnce({
        data: [failedRefund],
        has_more: false,
      });
    harness.stripe.refunds.create
      .mockResolvedValueOnce(failedRefund)
      .mockResolvedValueOnce({
        ...failedRefund,
        id: "re_succeeded",
        status: "succeeded",
      });

    await expect(executeHostedCheckoutSubscriptionCleanup({
      candidate: harness.candidate,
      prisma: harness.prisma,
      stripe: harness.stripeClient,
    })).rejects.toMatchObject({
      code: "HOSTED_CHECKOUT_CLEANUP_REFUND_FAILED",
    });
    await expect(executeHostedCheckoutSubscriptionCleanup({
      candidate: harness.candidate,
      prisma: harness.prisma,
      stripe: harness.stripeClient,
    })).resolves.toBeUndefined();

    const firstOptions = harness.stripe.refunds.create.mock.calls[0]?.[1];
    const secondOptions = harness.stripe.refunds.create.mock.calls[1]?.[1];
    expect(firstOptions?.idempotencyKey).toEqual(expect.any(String));
    expect(secondOptions?.idempotencyKey).toEqual(expect.any(String));
    expect(secondOptions?.idempotencyKey).not.toBe(firstOptions?.idempotencyKey);
  });

  it("rotates the refund key and amount when canonical succeeded refunds advance", async () => {
    const harness = createCleanupHarness();
    harness.stripe.subscriptions.retrieve
      .mockResolvedValueOnce(makeSubscription("active"))
      .mockResolvedValueOnce(makeSubscription("canceled"));
    harness.stripe.refunds.list
      .mockResolvedValueOnce({
        data: [],
        has_more: false,
      })
      .mockResolvedValueOnce({
        data: [{
          amount: 300,
          id: "re_operator_partial",
          payment_intent: "pi_checkout",
          status: "succeeded",
        }],
        has_more: false,
      });
    harness.stripe.refunds.create
      .mockRejectedValueOnce({
        message: "connection lost before Stripe confirmed the refund",
        type: "StripeConnectionError",
      })
      .mockResolvedValueOnce({
        amount: 500,
        id: "re_cleanup_remainder",
        payment_intent: "pi_checkout",
        status: "succeeded",
      });

    await expect(executeHostedCheckoutSubscriptionCleanup({
      candidate: harness.candidate,
      prisma: harness.prisma,
      stripe: harness.stripeClient,
    })).rejects.toMatchObject({
      code: "HOSTED_CHECKOUT_CLEANUP_PROVIDER_UNAVAILABLE",
      retryable: true,
    });
    await expect(executeHostedCheckoutSubscriptionCleanup({
      candidate: harness.candidate,
      prisma: harness.prisma,
      stripe: harness.stripeClient,
    })).resolves.toBeUndefined();

    expect(harness.stripe.refunds.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        amount: 800,
      }),
      expect.any(Object),
    );
    expect(harness.stripe.refunds.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        amount: 500,
      }),
      expect.any(Object),
    );
    const firstOptions = harness.stripe.refunds.create.mock.calls[0]?.[1];
    const secondOptions = harness.stripe.refunds.create.mock.calls[1]?.[1];
    expect(secondOptions?.idempotencyKey).not.toBe(firstOptions?.idempotencyKey);
  });

  it("fails closed instead of partially reconciling paginated refunds", async () => {
    const harness = createCleanupHarness();
    harness.stripe.refunds.list.mockResolvedValueOnce({
      data: [],
      has_more: true,
    });

    await expect(executeHostedCheckoutSubscriptionCleanup({
      candidate: harness.candidate,
      prisma: harness.prisma,
      stripe: harness.stripeClient,
    })).rejects.toMatchObject({
      code: "HOSTED_CHECKOUT_CLEANUP_INVARIANT_FAILED",
    });

    expect(harness.stripe.refunds.create).not.toHaveBeenCalled();
  });

  it("validates and refunds every paid invoice allocation before retaining cancellation", async () => {
    const harness = createCleanupHarness();
    const invoicePayments = [
      {
          amount_paid: 300,
          id: "ip_checkout_a",
          invoice: "in_checkout",
          payment: {
            payment_intent: "pi_checkout_a",
            type: "payment_intent",
          },
          status: "paid",
      },
      {
          amount_paid: 500,
          id: "ip_checkout_b",
          invoice: "in_checkout",
          payment: {
            payment_intent: "pi_checkout_b",
            type: "payment_intent",
          },
          status: "paid",
      },
    ];
    harness.stripe.invoicePayments.list.mockImplementation(
      async (params: {
        payment?: {
          payment_intent?: string;
        };
      }) => ({
        data: params.payment
          ? invoicePayments.filter((invoicePayment) =>
              invoicePayment.payment.payment_intent
                === params.payment?.payment_intent
            )
          : invoicePayments,
        has_more: false,
      }),
    );
    harness.stripe.refunds.list
      .mockResolvedValueOnce({ data: [], has_more: false })
      .mockResolvedValueOnce({ data: [], has_more: false });
    harness.stripe.refunds.create.mockImplementation(async (params: {
      amount: number;
      payment_intent?: string;
    }) => ({
      amount: params.amount,
      id: `re_${String(params.payment_intent)}`,
      payment_intent: params.payment_intent,
      status: "succeeded",
    }));

    await executeHostedCheckoutSubscriptionCleanup({
      candidate: harness.candidate,
      prisma: harness.prisma,
      stripe: harness.stripeClient,
    });

    expect(harness.stripe.refunds.create).toHaveBeenCalledTimes(2);
    expect(harness.stripe.refunds.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        amount: 300,
        payment_intent: "pi_checkout_a",
      }),
      expect.any(Object),
    );
    expect(harness.stripe.refunds.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        amount: 500,
        payment_intent: "pi_checkout_b",
      }),
      expect.any(Object),
    );
    expect(
      harness.stripe.refunds.list.mock.invocationCallOrder[1],
    ).toBeLessThan(
      harness.stripe.subscriptions.cancel.mock.invocationCallOrder[0]!,
    );
  });

  it("fails closed before cancellation when the Checkout PaymentIntent is attached to another invoice", async () => {
    const harness = createCleanupHarness();
    const checkoutAllocation = {
      amount_paid: 800,
      id: "ip_checkout",
      invoice: "in_checkout",
      payment: {
        payment_intent: "pi_checkout",
        type: "payment_intent",
      },
      status: "paid",
    };
    harness.stripe.invoicePayments.list.mockImplementation(
      async (params: {
        payment?: {
          payment_intent?: string;
        };
      }) => ({
        data: params.payment
          ? [
              checkoutAllocation,
              {
                amount_paid: 200,
                id: "ip_other_invoice",
                invoice: "in_other",
                payment: {
                  payment_intent: "pi_checkout",
                  type: "payment_intent",
                },
                status: "paid",
              },
            ]
          : [checkoutAllocation],
        has_more: false,
      }),
    );

    await expect(executeHostedCheckoutSubscriptionCleanup({
      candidate: harness.candidate,
      prisma: harness.prisma,
      stripe: harness.stripeClient,
    })).rejects.toMatchObject({
      code: "HOSTED_CHECKOUT_CLEANUP_INVARIANT_FAILED",
    });

    expect(harness.stripe.invoicePayments.list).toHaveBeenCalledWith(
      {
        limit: 100,
        payment: {
          payment_intent: "pi_checkout",
          type: "payment_intent",
        },
      },
      expect.any(Object),
    );
    expect(harness.stripe.subscriptions.cancel).not.toHaveBeenCalled();
    expect(harness.stripe.refunds.list).not.toHaveBeenCalled();
    expect(harness.stripe.refunds.create).not.toHaveBeenCalled();
  });

  it("restores only the credit consumed by the invoice when the Customer had a larger prior credit balance", async () => {
    const harness = createCleanupHarness();
    const appliedCredit = makeCustomerBalanceTransaction({
      amount: 800,
      checkoutSessionId: "cs_checkout",
      endingBalance: -200,
      id: "cbtxn_checkout_credit",
      invoiceId: "in_checkout",
      type: "checkout_session_subscription_payment",
    });
    harness.stripe.invoices.retrieve.mockResolvedValue({
      amount_due: 0,
      amount_overpaid: 0,
      amount_paid: 0,
      amount_remaining: 0,
      currency: "usd",
      customer: "cus_loser",
      ending_balance: -200,
      id: "in_checkout",
      post_payment_credit_notes_amount: 0,
      pre_payment_credit_notes_amount: 0,
      starting_balance: -1_000,
      status: "paid",
      subscription: "sub_loser",
      total: 800,
    });
    harness.stripe.invoicePayments.list.mockResolvedValueOnce({
      data: [],
      has_more: false,
    });
    harness.stripe.customers.listBalanceTransactions.mockResolvedValue({
      data: [appliedCredit],
      has_more: false,
    });
    harness.stripe.customers.retrieve.mockResolvedValueOnce({
      balance: -1_000,
      cash_balance: null,
      id: "cus_loser",
      invoice_credit_balance: {
        usd: 1_000,
      },
    });

    await executeHostedCheckoutSubscriptionCleanup({
      candidate: harness.candidate,
      prisma: harness.prisma,
      stripe: harness.stripeClient,
    });

    expect(harness.stripe.creditNotes.create).toHaveBeenCalledOnce();
    expect(harness.stripe.creditNotes.create).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 800,
        credit_amount: 800,
        email_type: "none",
        invoice: "in_checkout",
        metadata: expect.objectContaining({
          checkoutSessionId: "cs_checkout",
          operation: "checkout_loser_credit_restore_v1",
        }),
      }),
      expect.objectContaining({
        idempotencyKey: expect.stringContaining(
          "hosted-checkout-credit-restore:cs_checkout:in_checkout:",
        ),
      }),
    );
    expect(harness.stripe.refunds.create).not.toHaveBeenCalled();
    expect(harness.stripe.customers.del).not.toHaveBeenCalled();
  });

  it("refunds the card allocation and separately restores credit for a mixed Checkout invoice", async () => {
    const harness = createCleanupHarness();
    const appliedCredit = makeCustomerBalanceTransaction({
      amount: 200,
      checkoutSessionId: "cs_checkout",
      endingBalance: 0,
      id: "cbtxn_checkout_credit",
      invoiceId: "in_checkout",
      type: "checkout_session_subscription_payment",
    });
    harness.stripe.invoices.retrieve.mockResolvedValue({
      amount_due: 800,
      amount_overpaid: 0,
      amount_paid: 800,
      amount_remaining: 0,
      currency: "usd",
      customer: "cus_loser",
      ending_balance: 0,
      id: "in_checkout",
      post_payment_credit_notes_amount: 0,
      pre_payment_credit_notes_amount: 0,
      starting_balance: -200,
      status: "paid",
      subscription: "sub_loser",
      total: 1_000,
    });
    harness.stripe.customers.listBalanceTransactions.mockResolvedValue({
      data: [appliedCredit],
      has_more: false,
    });
    harness.stripe.customers.retrieve.mockResolvedValueOnce({
      balance: -200,
      cash_balance: null,
      id: "cus_loser",
      invoice_credit_balance: {
        usd: 200,
      },
    });

    await executeHostedCheckoutSubscriptionCleanup({
      candidate: harness.candidate,
      prisma: harness.prisma,
      stripe: harness.stripeClient,
    });

    expect(harness.stripe.refunds.create).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 800,
        payment_intent: "pi_checkout",
      }),
      expect.any(Object),
    );
    expect(harness.stripe.creditNotes.create).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 200,
        credit_amount: 200,
        invoice: "in_checkout",
      }),
      expect.any(Object),
    );
    expect(harness.stripe.customers.del).not.toHaveBeenCalled();
  });

  it("excludes a preexisting positive debit from the loser cash refund", async () => {
    const harness = createCleanupHarness();
    const appliedDebit = makeCustomerBalanceTransaction({
      amount: -200,
      endingBalance: 0,
      id: "cbtxn_checkout_debit",
      invoiceId: "in_checkout",
      type: "applied_to_invoice",
    });
    harness.stripe.invoices.retrieve.mockResolvedValueOnce({
      amount_due: 1_000,
      amount_overpaid: 0,
      amount_paid: 1_000,
      amount_remaining: 0,
      currency: "usd",
      customer: "cus_loser",
      ending_balance: 0,
      id: "in_checkout",
      post_payment_credit_notes_amount: 0,
      pre_payment_credit_notes_amount: 0,
      starting_balance: 200,
      status: "paid",
      subscription: "sub_loser",
      total: 800,
    });
    const invoicePayment = {
        amount_paid: 1_000,
        id: "ip_checkout",
        invoice: "in_checkout",
        payment: {
          payment_intent: "pi_checkout",
          type: "payment_intent",
        },
        status: "paid",
    };
    harness.stripe.invoicePayments.list.mockResolvedValue({
      data: [invoicePayment],
      has_more: false,
    });
    harness.stripe.customers.listBalanceTransactions.mockImplementation(
      async (
        _customerId: string,
        params: {
          invoice?: string;
        },
      ) => ({
        data: params.invoice ? [appliedDebit] : [],
        has_more: false,
      }),
    );

    await executeHostedCheckoutSubscriptionCleanup({
      candidate: harness.candidate,
      prisma: harness.prisma,
      stripe: harness.stripeClient,
    });

    expect(harness.stripe.refunds.create).toHaveBeenCalledOnce();
    expect(harness.stripe.refunds.create).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 800,
        payment_intent: "pi_checkout",
      }),
      expect.any(Object),
    );
    expect(harness.stripe.creditNotes.create).not.toHaveBeenCalled();
    expect(harness.stripe.customers.del).toHaveBeenCalledOnce();
  });

  it("recovers an ambiguous credit restoration from the exact invoice Credit Note without creating it twice", async () => {
    const harness = createCleanupHarness();
    const appliedCredit = makeCustomerBalanceTransaction({
      amount: 800,
      checkoutSessionId: "cs_checkout",
      endingBalance: 0,
      id: "cbtxn_checkout_credit",
      invoiceId: "in_checkout",
      type: "checkout_session_subscription_payment",
    });
    const creditNotes = Array<ReturnType<typeof makeCustomerCreditNote>>();
    const invoice = {
      amount_due: 0,
      amount_overpaid: 0,
      amount_paid: 0,
      amount_remaining: 0,
      currency: "usd",
      customer: "cus_loser",
      ending_balance: 0,
      id: "in_checkout",
      post_payment_credit_notes_amount: 0,
      pre_payment_credit_notes_amount: 0,
      starting_balance: -800,
      status: "paid",
      subscription: "sub_loser",
      total: 800,
    };
    harness.stripe.invoices.retrieve.mockImplementation(async () => ({
      ...invoice,
      post_payment_credit_notes_amount:
        creditNotes.reduce((sum, creditNote) => sum + creditNote.amount, 0),
    }));
    harness.stripe.invoicePayments.list.mockResolvedValue({
      data: [],
      has_more: false,
    });
    harness.stripe.customers.listBalanceTransactions.mockImplementation(
      async (
        _customerId: string,
        params: {
          invoice?: string;
        },
      ) => ({
        data: params.invoice ? [appliedCredit] : [appliedCredit],
        has_more: false,
      }),
    );
    harness.stripe.creditNotes.list.mockImplementation(async () => ({
      data: creditNotes,
      has_more: false,
    }));
    harness.stripe.creditNotes.create.mockImplementationOnce(
      async (
        params: {
          amount: number;
          credit_amount: number;
          invoice: string;
          metadata: Record<string, string>;
        },
      ) => {
        creditNotes.push(makeCustomerCreditNote({
          amount: params.credit_amount,
          id: "cn_restore",
          invoiceId: params.invoice,
          // Metadata is mutable and deliberately absent from retry proof.
          metadata: {},
        }));
        throw {
          message: "connection lost after Stripe committed",
          type: "StripeConnectionError",
        };
      },
    );
    harness.stripe.customers.retrieve.mockResolvedValueOnce({
      balance: -800,
      cash_balance: null,
      id: "cus_loser",
      invoice_credit_balance: {
        usd: 800,
      },
    });
    harness.stripe.subscriptions.retrieve
      .mockResolvedValueOnce(makeSubscription("active"))
      .mockResolvedValueOnce(makeSubscription("canceled"));

    await expect(executeHostedCheckoutSubscriptionCleanup({
      candidate: harness.candidate,
      prisma: harness.prisma,
      stripe: harness.stripeClient,
    })).rejects.toMatchObject({
      code: "HOSTED_CHECKOUT_CLEANUP_PROVIDER_UNAVAILABLE",
      retryable: true,
    });
    expect(harness.stripe.customers.del).not.toHaveBeenCalled();

    await expect(executeHostedCheckoutSubscriptionCleanup({
      candidate: harness.candidate,
      prisma: harness.prisma,
      stripe: harness.stripeClient,
    })).resolves.toBeUndefined();

    expect(harness.stripe.creditNotes.create).toHaveBeenCalledOnce();
    expect(harness.stripe.customers.del).not.toHaveBeenCalled();
  });

  it("creates only the remaining credit deficit after an exact operator-issued invoice credit", async () => {
    const harness = createCleanupHarness();
    const appliedCredit = makeCustomerBalanceTransaction({
      amount: 800,
      checkoutSessionId: "cs_checkout",
      endingBalance: 0,
      id: "cbtxn_checkout_credit",
      invoiceId: "in_checkout",
      type: "checkout_session_subscription_payment",
    });
    const existingCreditNote = makeCustomerCreditNote({
      amount: 300,
      id: "cn_operator_credit",
    });
    harness.stripe.invoices.retrieve.mockResolvedValue({
      amount_due: 0,
      amount_overpaid: 0,
      amount_paid: 0,
      amount_remaining: 0,
      currency: "usd",
      customer: "cus_loser",
      ending_balance: 0,
      id: "in_checkout",
      post_payment_credit_notes_amount: 300,
      pre_payment_credit_notes_amount: 0,
      starting_balance: -800,
      status: "paid",
      subscription: "sub_loser",
      total: 800,
    });
    harness.stripe.invoicePayments.list.mockResolvedValue({
      data: [],
      has_more: false,
    });
    harness.stripe.creditNotes.list.mockResolvedValue({
      data: [existingCreditNote],
      has_more: false,
    });
    harness.stripe.customers.listBalanceTransactions.mockImplementation(
      async (
        _customerId: string,
        params: {
          invoice?: string;
        },
      ) => ({
        data: params.invoice
          ? [
              appliedCredit,
              existingCreditNote.customer_balance_transaction,
            ]
          : [appliedCredit],
        has_more: false,
      }),
    );
    harness.stripe.customers.retrieve.mockResolvedValueOnce({
      balance: -800,
      cash_balance: null,
      id: "cus_loser",
      invoice_credit_balance: {
        usd: 800,
      },
    });

    await executeHostedCheckoutSubscriptionCleanup({
      candidate: harness.candidate,
      prisma: harness.prisma,
      stripe: harness.stripeClient,
    });

    expect(harness.stripe.creditNotes.create).toHaveBeenCalledOnce();
    expect(harness.stripe.creditNotes.create).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 500,
        credit_amount: 500,
        invoice: "in_checkout",
      }),
      expect.any(Object),
    );
  });

  it("fails closed when the bounded customer balance scan cannot prove completeness", async () => {
    const harness = createCleanupHarness();
    let page = 0;
    harness.stripe.customers.listBalanceTransactions.mockImplementation(
      async () => {
        page += 1;
        return {
          data: [{
            id: `cbtxn_page_${page}`,
          }],
          has_more: true,
        };
      },
    );

    await expect(executeHostedCheckoutSubscriptionCleanup({
      candidate: harness.candidate,
      prisma: harness.prisma,
      stripe: harness.stripeClient,
    })).rejects.toMatchObject({
      code: "HOSTED_CHECKOUT_CLEANUP_INVARIANT_FAILED",
    });

    expect(harness.stripe.subscriptions.cancel).not.toHaveBeenCalled();
    expect(harness.stripe.refunds.create).not.toHaveBeenCalled();
    expect(harness.stripe.creditNotes.create).not.toHaveBeenCalled();
    expect(harness.stripe.customers.del).not.toHaveBeenCalled();
  });

  it.each([
    "pre_payment_credit_notes_amount",
    "post_payment_credit_notes_amount",
  ] as const)(
    "fails closed when %s makes the invoice allocation ambiguous",
    async (creditNoteField) => {
      const harness = createCleanupHarness();
      harness.stripe.invoices.retrieve.mockResolvedValueOnce({
        amount_due: 800,
        amount_overpaid: 0,
        amount_paid: 800,
        amount_remaining: 0,
        currency: "usd",
        customer: "cus_loser",
        ending_balance: 0,
        id: "in_checkout",
        post_payment_credit_notes_amount: 0,
        pre_payment_credit_notes_amount: 0,
        starting_balance: 0,
        status: "paid",
        subscription: "sub_loser",
        total: 800,
        [creditNoteField]: 50,
      });

      await expect(executeHostedCheckoutSubscriptionCleanup({
        candidate: harness.candidate,
        prisma: harness.prisma,
        stripe: harness.stripeClient,
      })).rejects.toMatchObject({
        code: "HOSTED_CHECKOUT_CLEANUP_INVARIANT_FAILED",
      });

      expect(harness.stripe.subscriptions.cancel).not.toHaveBeenCalled();
      expect(harness.stripe.refunds.create).not.toHaveBeenCalled();
      expect(harness.stripe.creditNotes.create).not.toHaveBeenCalled();
      expect(harness.stripe.customers.del).not.toHaveBeenCalled();
    },
  );

  it("does not delete an unowned Customer while any canonical invoice balance remains", async () => {
    const harness = createCleanupHarness();
    harness.stripe.customers.retrieve.mockResolvedValueOnce({
      balance: -50,
      cash_balance: null,
      id: "cus_loser",
      invoice_credit_balance: {
        usd: 50,
      },
    });

    await executeHostedCheckoutSubscriptionCleanup({
      candidate: harness.candidate,
      prisma: harness.prisma,
      stripe: harness.stripeClient,
    });

    expect(harness.stripe.customers.retrieve).toHaveBeenCalledOnce();
    expect(harness.stripe.customers.del).not.toHaveBeenCalled();
  });

  it("rechecks an orphan Customer balance immediately before deletion", async () => {
    const harness = createCleanupHarness();
    harness.stripe.customers.retrieve
      .mockResolvedValueOnce({
        balance: 0,
        cash_balance: null,
        id: "cus_loser",
        invoice_credit_balance: {},
      })
      .mockResolvedValueOnce({
        balance: -50,
        cash_balance: null,
        id: "cus_loser",
        invoice_credit_balance: {
          usd: 50,
        },
      });

    await executeHostedCheckoutSubscriptionCleanup({
      candidate: harness.candidate,
      prisma: harness.prisma,
      stripe: harness.stripeClient,
    });

    expect(harness.stripe.customers.retrieve).toHaveBeenCalledTimes(2);
    expect(harness.stripe.subscriptions.list).toHaveBeenCalledOnce();
    expect(harness.stripe.customers.del).not.toHaveBeenCalled();
  });

  it("rechecks local Customer ownership immediately before deletion", async () => {
    const harness = createCleanupHarness();
    harness.memberCustomerOwnerFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        memberId: "member_winner",
      });

    await executeHostedCheckoutSubscriptionCleanup({
      candidate: harness.candidate,
      prisma: harness.prisma,
      stripe: harness.stripeClient,
    });

    expect(harness.memberCustomerOwnerFindFirst).toHaveBeenCalledTimes(2);
    expect(harness.stripe.customers.del).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "legacy Charge",
      payment: {
        charge: "ch_checkout",
        type: "charge",
      },
    },
    {
      label: "PaymentRecord",
      payment: {
        payment_record: "pyr_checkout",
        type: "payment_record",
      },
    },
  ])("fails before cancellation for an unsupported $label allocation", async ({
    payment,
  }) => {
    const harness = createCleanupHarness();
    harness.stripe.invoicePayments.list.mockResolvedValueOnce({
      data: [{
        amount_paid: 800,
        id: "ip_checkout_unsupported",
        invoice: "in_checkout",
        payment,
        status: "paid",
      }],
      has_more: false,
    });

    await expect(executeHostedCheckoutSubscriptionCleanup({
      candidate: harness.candidate,
      prisma: harness.prisma,
      stripe: harness.stripeClient,
    })).rejects.toMatchObject({
      code: "HOSTED_CHECKOUT_CLEANUP_INVARIANT_FAILED",
    });

    expect(harness.stripe.subscriptions.cancel).not.toHaveBeenCalled();
    expect(harness.stripe.refunds.create).not.toHaveBeenCalled();
  });

  it("fails before cancellation when paid allocations exceed the owner-lock budget", async () => {
    const harness = createCleanupHarness();
    harness.stripe.invoicePayments.list.mockResolvedValueOnce({
      data: Array.from({ length: 5 }, (_, index) => ({
        amount_paid: 160,
        id: `ip_checkout_${index}`,
        invoice: "in_checkout",
        payment: {
          payment_intent: `pi_checkout_${index}`,
          type: "payment_intent",
        },
        status: "paid",
      })),
      has_more: false,
    });

    await expect(executeHostedCheckoutSubscriptionCleanup({
      candidate: harness.candidate,
      prisma: harness.prisma,
      stripe: harness.stripeClient,
    })).rejects.toMatchObject({
      code: "HOSTED_CHECKOUT_CLEANUP_INVARIANT_FAILED",
    });

    expect(harness.stripe.refunds.list).not.toHaveBeenCalled();
    expect(harness.stripe.subscriptions.cancel).not.toHaveBeenCalled();
    expect(harness.stripe.refunds.create).not.toHaveBeenCalled();
  });

  it("locks the Family owner before the sponsored member and rechecks the exact sponsorship", async () => {
    const harness = createCleanupHarness({
      reason: "family_sponsored",
    });

    await executeHostedCheckoutSubscriptionCleanup({
      candidate: harness.candidate,
      prisma: harness.prisma,
      stripe: harness.stripeClient,
    });

    const lockedMemberIds = harness.queryRaw.mock.calls
      .filter(([strings]) => Array.from(strings).join("?").includes('from "hosted_member"'))
      .map((call) => call[1]);
    expect(lockedMemberIds).toEqual(["owner_123", "member_123"]);
    expect(familyMocks.readHostedMemberFamilyBillingClaim).toHaveBeenCalledOnce();
    expect(harness.billingRefFindUnique).not.toHaveBeenCalled();
  });

  it("does not cancel direct Checkout when the exact Family claim disappears", async () => {
    const harness = createCleanupHarness({
      reason: "family_sponsored",
    });
    familyMocks.readHostedMemberFamilyBillingClaim.mockResolvedValueOnce(null);

    await expect(executeHostedCheckoutSubscriptionCleanup({
      candidate: harness.candidate,
      prisma: harness.prisma,
      stripe: harness.stripeClient,
    })).rejects.toMatchObject({
      code: "HOSTED_CHECKOUT_CLEANUP_OWNERSHIP_CHANGED",
      retryable: true,
    });

    expect(harness.stripe.checkout.sessions.retrieve).not.toHaveBeenCalled();
    expect(harness.stripe.subscriptions.cancel).not.toHaveBeenCalled();
  });
});

function createCleanupHarness(input: {
  advisoryLockAcquired?: boolean;
  familySubscriptionOwnerGroupIds?: readonly string[];
  memberBillingRefMissing?: boolean;
  memberCustomerOwner?: boolean;
  memberSubscriptionOwnerIds?: readonly string[];
  reason?: "family_sponsored" | "superseded";
  stripeSubscriptionLookupKey?: string | null;
} = {}) {
  const familyBillingClaim = input.reason === "family_sponsored"
    ? {
        checkoutAttemptId: "family_attempt_123",
        groupId: "family_123",
        kind: "checkout_attempt" as const,
        ownerMemberId: "owner_123",
      }
    : null;
  familyMocks.readHostedMemberFamilyBillingClaim.mockReset();
  familyMocks.readHostedMemberFamilyBillingClaim.mockResolvedValue(
    familyBillingClaim,
  );
  const queryRaw = vi.fn().mockImplementation(
    async (strings: TemplateStringsArray) =>
      Array.from(strings).join("?").includes("pg_try_advisory_xact_lock")
        ? [{ acquired: input.advisoryLockAcquired ?? true }]
        : [],
  );
  const billingRefFindUnique = vi.fn().mockResolvedValue(
    input.memberBillingRefMissing
      ? null
      : {
          stripeSubscriptionLookupKey:
            input.stripeSubscriptionLookupKey ?? null,
        },
  );
  const memberCustomerOwnerFindFirst = vi.fn().mockResolvedValue(
    input.memberCustomerOwner
      ? { memberId: "member_winner" }
      : null,
  );
  const familyCustomerOwnerFindFirst = vi.fn().mockResolvedValue(null);
  const tx = {
    $queryRaw: queryRaw,
    hostedAccountGroupBillingRef: {
      findFirst: familyCustomerOwnerFindFirst,
      findMany: vi.fn().mockResolvedValue(
        (input.familySubscriptionOwnerGroupIds ?? []).map((groupId) => ({
          groupId,
        })),
      ),
    },
    hostedMemberBillingRef: {
      findFirst: memberCustomerOwnerFindFirst,
      findMany: vi.fn().mockResolvedValue(
        (input.memberSubscriptionOwnerIds ?? []).map((memberId) => ({
          memberId,
        })),
      ),
      findUnique: billingRefFindUnique,
    },
  };
  const prisma = {
    $transaction: vi.fn(async (
      run: (innerTx: typeof tx) => Promise<unknown>,
    ) => run(tx)),
  };
  const session = {
    client_reference_id: "member_123",
    created: 1_700_000_000,
    customer: "cus_loser",
    id: "cs_checkout",
    invoice: "in_checkout",
    metadata: {
      checkoutAttemptId: "attempt_123",
      checkoutIntentHash: "intent_123",
      memberId: "member_123",
    },
    mode: "subscription",
    payment_status: "paid",
    status: "complete",
    subscription: "sub_loser",
  };
  const defaultInvoicePayment = {
    amount_paid: 800,
    id: "ip_checkout",
    invoice: "in_checkout",
    payment: {
      payment_intent: "pi_checkout",
      type: "payment_intent",
    },
    status: "paid",
  };
  const stripe = {
    checkout: {
      sessions: {
        retrieve: vi.fn().mockResolvedValue(session),
      },
    },
    creditNotes: {
      create: vi.fn().mockImplementation(
        async (params: {
          amount: number;
          credit_amount: number;
          invoice: string;
          metadata?: Record<string, string>;
        }) => makeCustomerCreditNote({
          amount: params.credit_amount,
          id: "cn_restore",
          invoiceId: params.invoice,
          metadata: params.metadata,
        }),
      ),
      list: vi.fn().mockResolvedValue({
        data: [],
        has_more: false,
      }),
    },
    invoicePayments: {
      list: vi.fn().mockImplementation(
        async (params: {
          payment?: {
            payment_intent?: string;
          };
        }) => ({
          data:
            !params.payment
              || params.payment.payment_intent === "pi_checkout"
              ? [defaultInvoicePayment]
              : [],
          has_more: false,
        }),
      ),
    },
    customers: {
      del: vi.fn().mockResolvedValue({
        deleted: true,
        id: "cus_loser",
      }),
      listBalanceTransactions: vi.fn().mockResolvedValue({
        data: [],
        has_more: false,
      }),
      retrieve: vi.fn().mockResolvedValue({
        balance: 0,
        cash_balance: null,
        id: "cus_loser",
        invoice_credit_balance: {},
      }),
    },
    invoices: {
      retrieve: vi.fn().mockResolvedValue({
        amount_due: 800,
        amount_overpaid: 0,
        amount_paid: 800,
        amount_remaining: 0,
        currency: "usd",
        customer: "cus_loser",
        ending_balance: 0,
        id: "in_checkout",
        post_payment_credit_notes_amount: 0,
        pre_payment_credit_notes_amount: 0,
        starting_balance: 0,
        status: "paid",
        subscription: "sub_loser",
        total: 800,
      }),
    },
    refunds: {
      create: vi.fn().mockResolvedValue({
        amount: 800,
        charge: "ch_checkout",
        id: "re_checkout",
        payment_intent: "pi_checkout",
        status: "succeeded",
      }),
      list: vi.fn().mockResolvedValue({
        data: [],
        has_more: false,
      }),
    },
    subscriptions: {
      cancel: vi.fn().mockResolvedValue(makeSubscription("canceled")),
      list: vi.fn().mockResolvedValue({
        data: [makeSubscription("canceled")],
        has_more: false,
      }),
      retrieve: vi.fn().mockResolvedValue(makeSubscription("active")),
    },
  };
  const candidate = buildHostedCheckoutSubscriptionCleanupCandidate({
    familyBillingClaim,
    memberId: "member_123",
    reason: input.reason ?? "superseded",
    session: session as never,
    stripeSubscriptionId: "sub_loser",
  });

  return {
    billingRefFindUnique,
    candidate,
    memberCustomerOwnerFindFirst,
    prisma: prisma as never,
    queryRaw,
    stripe,
    stripeClient: stripe as never,
  };
}

function makeSubscription(status: "active" | "canceled") {
  return {
    id: "sub_loser",
    metadata: {
      checkoutAttemptId: "attempt_123",
      checkoutIntentHash: "intent_123",
      memberId: "member_123",
    },
    status,
  };
}

function makeCustomerBalanceTransaction(input: {
  amount: number;
  checkoutSessionId?: string;
  creditNoteId?: string;
  endingBalance: number;
  id: string;
  invoiceId?: string;
  metadata?: Record<string, string>;
  type:
    | "adjustment"
    | "applied_to_invoice"
    | "checkout_session_subscription_payment"
    | "checkout_session_subscription_payment_canceled"
    | "credit_note"
    | "unapplied_from_invoice";
}) {
  return {
    amount: input.amount,
    checkout_session: input.checkoutSessionId ?? null,
    credit_note: input.creditNoteId ?? null,
    currency: "usd",
    customer: "cus_loser",
    ending_balance: input.endingBalance,
    id: input.id,
    invoice: input.invoiceId ?? null,
    metadata: input.metadata ?? {},
    type: input.type,
  };
}

function makeCustomerCreditNote(input: {
  amount: number;
  id: string;
  invoiceId?: string;
  metadata?: Record<string, string>;
  status?: "issued" | "void";
}) {
  const status = input.status ?? "issued";
  return {
    amount: input.amount,
    currency: "usd",
    customer: "cus_loser",
    customer_balance_transaction: makeCustomerBalanceTransaction({
      amount: -input.amount,
      creditNoteId: input.id,
      endingBalance: -input.amount,
      id: `cbtxn_${input.id}`,
      invoiceId: input.invoiceId ?? "in_checkout",
      type: "credit_note",
    }),
    id: input.id,
    invoice: input.invoiceId ?? "in_checkout",
    metadata: input.metadata ?? {},
    out_of_band_amount: null,
    post_payment_amount: status === "issued" ? input.amount : 0,
    pre_payment_amount: 0,
    refunds: [],
    status,
    type: "post_payment",
  };
}
