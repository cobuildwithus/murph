import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { cleanupHostedStandardCheckoutLoser } from
  "@/src/lib/hosted-onboarding/stripe-checkout-loser-cleanup";

describe("cleanupHostedStandardCheckoutLoser", () => {
  const invoicePaymentsList = vi.fn();
  const refundsCreate = vi.fn();
  const refundsList = vi.fn();
  const subscriptionCancel = vi.fn();
  const subscriptionRetrieve = vi.fn();
  const stripe = {
    invoicePayments: {
      list: invoicePaymentsList,
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
    refundsList.mockResolvedValue({ data: [] });
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

  it("cancels but requires support when account balance affected the invoice", async () => {
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
