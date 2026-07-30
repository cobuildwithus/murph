import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { cleanupHostedStandardCheckoutLoser } from
  "@/src/lib/hosted-onboarding/stripe-checkout-loser-cleanup";

describe("cleanupHostedStandardCheckoutLoser", () => {
  const invoicePaymentsList = vi.fn();
  const invoicesList = vi.fn();
  const refundsCreate = vi.fn();
  const refundsList = vi.fn();
  const subscriptionCancel = vi.fn();
  const subscriptionRetrieve = vi.fn();
  const stripe = {
    invoicePayments: {
      list: invoicePaymentsList,
    },
    invoices: {
      list: invoicesList,
    },
    refunds: {
      create: refundsCreate,
      list: refundsList,
    },
    subscriptions: {
      cancel: subscriptionCancel,
      retrieve: subscriptionRetrieve,
    },
  } as unknown as Stripe;

  beforeEach(() => {
    vi.clearAllMocks();
    invoicesList.mockResolvedValue({
      data: [makePaidInvoice()],
      has_more: false,
    });
    refundsList.mockResolvedValue({ data: [], has_more: false });
    refundsCreate.mockResolvedValue({
      amount: 2_000,
      status: "succeeded",
    });
    subscriptionCancel.mockResolvedValue({
      id: "sub_loser",
      status: "canceled",
    });
  });

  it("cancels and refunds the exact ordinary one-payment invoice", async () => {
    subscriptionRetrieve.mockResolvedValue(
      makeSubscription(makePaidInvoice()),
    );
    invoicePaymentsList.mockResolvedValue({
      data: [{
        amount_paid: 2_000,
        amount_requested: 2_000,
        payment: {
          payment_intent: {
            amount_received: 2_000,
            id: "pi_loser",
            status: "succeeded",
          },
          type: "payment_intent",
        },
      }],
      has_more: false,
    });

    await expect(cleanupHostedStandardCheckoutLoser({
      stripe,
      stripeSubscriptionId: "sub_loser",
    })).resolves.toBeUndefined();

    expect(subscriptionCancel).toHaveBeenCalledWith(
      "sub_loser",
      {
        invoice_now: false,
        prorate: false,
      },
      {
        idempotencyKey: "hosted-checkout-loser-cancel:sub_loser",
      },
    );
    expect(refundsCreate).toHaveBeenCalledWith(
      {
        amount: 2_000,
        payment_intent: "pi_loser",
        reason: "duplicate",
      },
      {
        idempotencyKey:
          "hosted-checkout-loser-refund:sub_loser:in_loser",
      },
    );
    expect(
      subscriptionCancel.mock.invocationCallOrder[0],
    ).toBeLessThan(refundsCreate.mock.invocationCallOrder[0] ?? 0);
  });

  it("does not issue another refund when an earlier cleanup already refunded the exact payment", async () => {
    subscriptionRetrieve.mockResolvedValue(
      makeSubscription(makePaidInvoice()),
    );
    invoicePaymentsList.mockResolvedValue({
      data: [{
        amount_paid: 2_000,
        amount_requested: 2_000,
        payment: {
          payment_intent: {
            amount_received: 2_000,
            id: "pi_loser",
            status: "succeeded",
          },
          type: "payment_intent",
        },
      }],
      has_more: false,
    });
    refundsList.mockResolvedValue({
      data: [{
        amount: 2_000,
        status: "succeeded",
      }],
      has_more: false,
    });

    await expect(cleanupHostedStandardCheckoutLoser({
      stripe,
      stripeSubscriptionId: "sub_loser",
    })).resolves.toBeUndefined();

    expect(subscriptionCancel).toHaveBeenCalledOnce();
    expect(refundsCreate).not.toHaveBeenCalled();
  });

  it("requires support instead of guessing the remainder after a partial refund", async () => {
    subscriptionRetrieve.mockResolvedValue(
      makeSubscription(makePaidInvoice()),
    );
    invoicePaymentsList.mockResolvedValue({
      data: [{
        amount_paid: 2_000,
        amount_requested: 2_000,
        payment: {
          payment_intent: {
            amount_received: 2_000,
            id: "pi_loser",
            status: "succeeded",
          },
          type: "payment_intent",
        },
      }],
      has_more: false,
    });
    refundsList.mockResolvedValue({
      data: [{
        amount: 500,
        status: "succeeded",
      }],
      has_more: false,
    });

    await expect(cleanupHostedStandardCheckoutLoser({
      stripe,
      stripeSubscriptionId: "sub_loser",
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_CHECKOUT_CLEANUP_REQUIRES_SUPPORT",
      httpStatus: 409,
    });

    expect(subscriptionCancel).toHaveBeenCalledOnce();
    expect(refundsCreate).not.toHaveBeenCalled();
  });

  it("requires support when the refund history is paginated", async () => {
    subscriptionRetrieve.mockResolvedValue(
      makeSubscription(makePaidInvoice()),
    );
    invoicePaymentsList.mockResolvedValue({
      data: [{
        amount_paid: 2_000,
        amount_requested: 2_000,
        payment: {
          payment_intent: {
            amount_received: 2_000,
            id: "pi_loser",
            status: "succeeded",
          },
          type: "payment_intent",
        },
      }],
      has_more: false,
    });
    refundsList.mockResolvedValue({
      data: [],
      has_more: true,
    });

    await expect(cleanupHostedStandardCheckoutLoser({
      stripe,
      stripeSubscriptionId: "sub_loser",
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_CHECKOUT_CLEANUP_REQUIRES_SUPPORT",
      httpStatus: 409,
    });

    expect(subscriptionCancel).toHaveBeenCalledOnce();
    expect(refundsCreate).not.toHaveBeenCalled();
  });

  it("cancels but requires support when account balance affected the invoice", async () => {
    invoicesList.mockResolvedValue({
      data: [makePaidInvoice({
        starting_balance: -500,
      })],
      has_more: false,
    });
    subscriptionRetrieve.mockResolvedValue(
      makeSubscription(makePaidInvoice({
        starting_balance: -500,
      })),
    );

    await expect(cleanupHostedStandardCheckoutLoser({
      stripe,
      stripeSubscriptionId: "sub_loser",
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_CHECKOUT_CLEANUP_REQUIRES_SUPPORT",
      httpStatus: 409,
    });

    expect(subscriptionCancel).toHaveBeenCalledOnce();
    expect(invoicePaymentsList).not.toHaveBeenCalled();
    expect(refundsCreate).not.toHaveBeenCalled();
  });

  it("cancels an unpaid loser without inventing a refund", async () => {
    invoicesList.mockResolvedValue({
      data: [makePaidInvoice({
        amount_paid: 0,
        status: "open",
      })],
      has_more: false,
    });
    subscriptionRetrieve.mockResolvedValue(
      makeSubscription(makePaidInvoice({
        amount_paid: 0,
        status: "open",
      })),
    );

    await expect(cleanupHostedStandardCheckoutLoser({
      stripe,
      stripeSubscriptionId: "sub_loser",
    })).resolves.toBeUndefined();

    expect(subscriptionCancel).toHaveBeenCalledOnce();
    expect(invoicePaymentsList).not.toHaveBeenCalled();
    expect(refundsList).not.toHaveBeenCalled();
    expect(refundsCreate).not.toHaveBeenCalled();
  });

  it("keeps a pending refund retryable and never creates a second refund", async () => {
    subscriptionRetrieve.mockResolvedValue(
      makeSubscription(makePaidInvoice()),
    );
    invoicePaymentsList.mockResolvedValue({
      data: [{
        amount_paid: 2_000,
        amount_requested: 2_000,
        payment: {
          payment_intent: {
            amount_received: 2_000,
            id: "pi_loser",
            status: "succeeded",
          },
          type: "payment_intent",
        },
      }],
      has_more: false,
    });
    refundsList
      .mockResolvedValueOnce({
        data: [],
        has_more: false,
      })
      .mockResolvedValueOnce({
        data: [{
          amount: 2_000,
          status: "succeeded",
        }],
        has_more: false,
      });
    refundsCreate.mockResolvedValueOnce({
      amount: 2_000,
      status: "pending",
    });

    await expect(cleanupHostedStandardCheckoutLoser({
      stripe,
      stripeSubscriptionId: "sub_loser",
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_CHECKOUT_CLEANUP_PENDING",
      retryable: true,
    });
    await expect(cleanupHostedStandardCheckoutLoser({
      stripe,
      stripeSubscriptionId: "sub_loser",
    })).resolves.toBeUndefined();

    expect(refundsCreate).toHaveBeenCalledOnce();
    expect(refundsCreate).toHaveBeenCalledWith(
      expect.anything(),
      {
        idempotencyKey:
          "hosted-checkout-loser-refund:sub_loser:in_loser",
      },
    );
  });

  it("keeps an existing nonterminal refund retryable", async () => {
    subscriptionRetrieve.mockResolvedValue(
      makeSubscription(makePaidInvoice()),
    );
    invoicePaymentsList.mockResolvedValue({
      data: [{
        amount_paid: 2_000,
        amount_requested: 2_000,
        payment: {
          payment_intent: {
            amount_received: 2_000,
            id: "pi_loser",
            status: "succeeded",
          },
          type: "payment_intent",
        },
      }],
      has_more: false,
    });
    refundsList.mockResolvedValue({
      data: [{
        amount: 2_000,
        status: "requires_action",
      }],
      has_more: false,
    });

    await expect(cleanupHostedStandardCheckoutLoser({
      stripe,
      stripeSubscriptionId: "sub_loser",
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_CHECKOUT_CLEANUP_PENDING",
      retryable: true,
    });

    expect(refundsCreate).not.toHaveBeenCalled();
  });

  it("requires support when more than one paid subscription invoice exists", async () => {
    subscriptionRetrieve.mockResolvedValue(
      makeSubscription(makePaidInvoice()),
    );
    invoicesList.mockResolvedValue({
      data: [
        makePaidInvoice({ id: "in_loser_latest" }),
        makePaidInvoice({ id: "in_loser_prior" }),
      ],
      has_more: false,
    });

    await expect(cleanupHostedStandardCheckoutLoser({
      stripe,
      stripeSubscriptionId: "sub_loser",
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_CHECKOUT_CLEANUP_REQUIRES_SUPPORT",
    });

    expect(subscriptionCancel).toHaveBeenCalledOnce();
    expect(invoicePaymentsList).not.toHaveBeenCalled();
    expect(refundsCreate).not.toHaveBeenCalled();
  });

  it("requires support when subscription invoice history is paginated", async () => {
    subscriptionRetrieve.mockResolvedValue(
      makeSubscription(makePaidInvoice()),
    );
    invoicesList.mockResolvedValue({
      data: [makePaidInvoice()],
      has_more: true,
    });

    await expect(cleanupHostedStandardCheckoutLoser({
      stripe,
      stripeSubscriptionId: "sub_loser",
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_CHECKOUT_CLEANUP_REQUIRES_SUPPORT",
    });

    expect(subscriptionCancel).toHaveBeenCalledOnce();
    expect(refundsCreate).not.toHaveBeenCalled();
  });
});

function makeSubscription(
  latestInvoice: Stripe.Invoice,
): Stripe.Subscription {
  return {
    id: "sub_loser",
    latest_invoice: latestInvoice,
    status: "active",
  } as unknown as Stripe.Subscription;
}

function makePaidInvoice(
  overrides: Partial<Stripe.Invoice> = {},
): Stripe.Invoice {
  return {
    amount_due: 2_000,
    amount_paid: 2_000,
    amount_remaining: 0,
    id: "in_loser",
    post_payment_credit_notes_amount: 0,
    pre_payment_credit_notes_amount: 0,
    starting_balance: 0,
    status: "paid",
    ...overrides,
  } as unknown as Stripe.Invoice;
}
