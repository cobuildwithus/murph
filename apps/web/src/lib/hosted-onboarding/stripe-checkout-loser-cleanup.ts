import type Stripe from "stripe";

import {
  HostedOnboardingError,
  hostedOnboardingError,
} from "./errors";
import { requireHostedStripeApi } from "./runtime";
import { withHostedStripeFailureLog } from "./stripe-error-log";

type RefundTarget =
  | {
      charge: string;
      paymentIntent?: never;
    }
  | {
      charge?: never;
      paymentIntent: string;
    };

export class HostedStripeCheckoutLoserCleanupPendingError
  extends HostedOnboardingError {
  constructor() {
    super({
      code: "HOSTED_BILLING_CHECKOUT_CLEANUP_PENDING",
      httpStatus: 409,
      message:
        "A superseded Stripe subscription was canceled, but its refund is still pending. Try again after Stripe finishes processing it.",
      retryable: true,
    });
    this.name = "HostedStripeCheckoutLoserCleanupPendingError";
  }
}

/**
 * Stops a superseded standard Checkout subscription and refunds only the
 * ordinary one-invoice/one-payment case. Anything involving balance credit,
 * credit notes, partial refunds, or multiple payment allocations stays
 * visible as a support-required Stripe event instead of guessing at financial
 * ownership.
 */
export async function cleanupHostedStandardCheckoutLoser(input: {
  stripe?: Stripe;
  subscription?: Stripe.Subscription;
  stripeSubscriptionId: string;
}): Promise<void> {
  const stripe = input.stripe ?? requireHostedStripeApi();
  const subscription = input.subscription ??
    await withHostedStripeFailureLog(
      "subscription.retrieve.checkout-loser",
      () => stripe.subscriptions.retrieve(input.stripeSubscriptionId),
    );
  if (subscription.id !== input.stripeSubscriptionId) {
    throw buildCheckoutLoserCleanupSupportError();
  }

  if (
    subscription.status !== "canceled"
    && subscription.status !== "incomplete_expired"
  ) {
    await withHostedStripeFailureLog(
      "subscription.cancel.checkout-loser",
      () => stripe.subscriptions.cancel(
        subscription.id,
        {
          invoice_now: false,
          prorate: false,
        },
        {
          idempotencyKey:
            `hosted-checkout-loser-cancel:${subscription.id}`,
        },
      ),
    );
  }

  const invoices = await withHostedStripeFailureLog(
    "invoices.list.checkout-loser",
    () => stripe.invoices.list({
      limit: 2,
      subscription: subscription.id,
    }),
  );
  if (invoices.has_more) {
    throw buildCheckoutLoserCleanupSupportError();
  }
  const paidInvoices = invoices.data.filter(
    (invoice) => readPositiveInteger(invoice.amount_paid) !== null,
  );
  if (paidInvoices.length === 0) {
    return;
  }
  if (paidInvoices.length !== 1) {
    throw buildCheckoutLoserCleanupSupportError();
  }
  const [invoice] = paidInvoices;
  if (!invoice) {
    throw buildCheckoutLoserCleanupSupportError();
  }

  await refundHostedExactOrdinaryInvoicePayment({
    idempotencyKey: [
      "hosted-checkout-loser-refund",
      subscription.id,
      invoice.id,
    ].join(":"),
    invoice,
    reason: "duplicate",
    stripe,
  });
}

export async function refundHostedExactOrdinaryInvoicePayment(input: {
  idempotencyKey: string;
  invoice: Stripe.Invoice;
  metadata?: Record<string, string>;
  reason?: Stripe.RefundCreateParams.Reason;
  stripe: Stripe;
}): Promise<void> {
  const paidAmount = readPositiveInteger(input.invoice.amount_paid);
  if (!paidAmount) {
    throw buildCheckoutLoserCleanupSupportError();
  }
  const refundTarget = await readExactOrdinaryRefundTarget({
    invoice: input.invoice,
    paidAmount,
    stripe: input.stripe,
  });
  if (!refundTarget) {
    throw buildCheckoutLoserCleanupSupportError();
  }

  const refundListParams: Stripe.RefundListParams = { limit: 100 };
  if (refundTarget.paymentIntent) {
    refundListParams.payment_intent = refundTarget.paymentIntent;
  } else {
    refundListParams.charge = refundTarget.charge;
  }
  const existingRefunds = await withHostedStripeFailureLog(
    "refunds.list.checkout-loser",
    () => input.stripe.refunds.list(refundListParams),
  );
  const succeededRefundAmount = existingRefunds.data.reduce(
    (total, refund) =>
      refund.status === "succeeded" ? total + refund.amount : total,
    0,
  );
  if (existingRefunds.has_more) {
    throw buildCheckoutLoserCleanupSupportError();
  }
  if (existingRefunds.data.some((refund) =>
    refund.status !== "succeeded"
    && refund.status !== "failed"
    && refund.status !== "canceled"
  )) {
    throw new HostedStripeCheckoutLoserCleanupPendingError();
  }
  if (succeededRefundAmount === paidAmount) {
    return;
  }
  if (succeededRefundAmount !== 0) {
    throw buildCheckoutLoserCleanupSupportError();
  }

  const refundCreateParams: Stripe.RefundCreateParams = {
    amount: paidAmount,
  };
  if (input.metadata) {
    refundCreateParams.metadata = input.metadata;
  }
  if (input.reason) {
    refundCreateParams.reason = input.reason;
  }
  if (refundTarget.paymentIntent) {
    refundCreateParams.payment_intent = refundTarget.paymentIntent;
  } else {
    refundCreateParams.charge = refundTarget.charge;
  }
  const refund = await withHostedStripeFailureLog(
    "refunds.create.checkout-loser",
    () => input.stripe.refunds.create(refundCreateParams, {
      idempotencyKey: input.idempotencyKey,
    }),
  );
  if (refund.status !== "succeeded") {
    if (refund.status !== "failed" && refund.status !== "canceled") {
      throw new HostedStripeCheckoutLoserCleanupPendingError();
    }
    throw buildCheckoutLoserCleanupSupportError();
  }
  if (refund.amount !== paidAmount) {
    throw buildCheckoutLoserCleanupSupportError();
  }
}

async function readExactOrdinaryRefundTarget(input: {
  invoice: Stripe.Invoice;
  paidAmount: number;
  stripe: Stripe;
}): Promise<RefundTarget | null> {
  if (
    input.invoice.status !== "paid"
    || input.invoice.amount_due !== input.paidAmount
    || input.invoice.amount_remaining !== 0
    || input.invoice.starting_balance !== 0
    || input.invoice.pre_payment_credit_notes_amount !== 0
    || input.invoice.post_payment_credit_notes_amount !== 0
  ) {
    return null;
  }

  const payments = await withHostedStripeFailureLog(
    "invoicePayments.list.checkout-loser",
    () => input.stripe.invoicePayments.list({
      expand: [
        "data.payment.charge",
        "data.payment.payment_intent",
      ],
      invoice: input.invoice.id,
      limit: 2,
      status: "paid",
    }),
  );
  if (payments.has_more || payments.data.length !== 1) {
    return null;
  }
  const [invoicePayment] = payments.data;
  if (
    !invoicePayment
    || invoicePayment.amount_paid !== input.paidAmount
    || invoicePayment.amount_requested !== input.paidAmount
  ) {
    return null;
  }

  if (invoicePayment.payment.type === "payment_intent") {
    const paymentIntent = invoicePayment.payment.payment_intent;
    if (
      !paymentIntent
      || typeof paymentIntent === "string"
      || paymentIntent.status !== "succeeded"
      || paymentIntent.amount_received !== input.paidAmount
    ) {
      return null;
    }
    return { paymentIntent: paymentIntent.id };
  }
  if (invoicePayment.payment.type === "charge") {
    const charge = invoicePayment.payment.charge;
    if (
      !charge
      || typeof charge === "string"
      || !charge.paid
      || charge.amount !== input.paidAmount
    ) {
      return null;
    }
    return { charge: charge.id };
  }
  return null;
}

function readPositiveInteger(value: unknown): number | null {
  return typeof value === "number"
      && Number.isInteger(value)
      && value > 0
    ? value
    : null;
}

function buildCheckoutLoserCleanupSupportError() {
  return hostedOnboardingError({
    code: "HOSTED_BILLING_CHECKOUT_CLEANUP_REQUIRES_SUPPORT",
    httpStatus: 409,
    message:
      "A superseded Stripe subscription was canceled, but its payment allocation requires support review before refunding.",
  });
}
