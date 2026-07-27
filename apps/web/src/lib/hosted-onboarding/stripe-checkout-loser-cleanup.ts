import type Stripe from "stripe";

import { coerceStripeObjectId } from "./billing";
import { hostedOnboardingError } from "./errors";
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

/**
 * Stops a superseded standard Checkout subscription and refunds only the
 * ordinary one-invoice/one-payment case. Anything involving balance credit,
 * credit notes, partial refunds, or multiple payment allocations stays
 * visible as a support-required Stripe event instead of guessing at financial
 * ownership.
 */
export async function cleanupHostedStandardCheckoutLoser(input: {
  stripe?: Stripe;
  stripeSubscriptionId: string;
}): Promise<void> {
  const stripe = input.stripe ?? requireHostedStripeApi();
  const subscription = await withHostedStripeFailureLog(
    "subscription.retrieve.checkout-loser",
    () => stripe.subscriptions.retrieve(input.stripeSubscriptionId, {
      expand: ["latest_invoice"],
    }),
  );
  const invoice = await readLatestInvoice({
    stripe,
    subscription,
  });
  const paidAmount = readPositiveInteger(invoice?.amount_paid);
  const refundTarget = paidAmount && invoice
    ? await readExactOrdinaryRefundTarget({
        invoice,
        paidAmount,
        stripe,
      })
    : null;

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

  if (!paidAmount) {
    return;
  }
  if (!refundTarget || !invoice) {
    throw buildCheckoutLoserCleanupSupportError();
  }

  const existingRefunds = await withHostedStripeFailureLog(
    "refunds.list.checkout-loser",
    () => stripe.refunds.list({
      ...(refundTarget.paymentIntent
        ? { payment_intent: refundTarget.paymentIntent }
        : { charge: refundTarget.charge }),
      limit: 100,
    }),
  );
  const activeRefundAmount = existingRefunds.data.reduce(
    (total, refund) =>
      refund.status === "failed" || refund.status === "canceled"
        ? total
        : total + refund.amount,
    0,
  );
  if (existingRefunds.has_more) {
    throw buildCheckoutLoserCleanupSupportError();
  }
  if (activeRefundAmount === paidAmount) {
    return;
  }
  if (activeRefundAmount !== 0) {
    throw buildCheckoutLoserCleanupSupportError();
  }

  const refund = await withHostedStripeFailureLog(
    "refunds.create.checkout-loser",
    () => stripe.refunds.create({
      amount: paidAmount,
      ...(refundTarget.paymentIntent
        ? { payment_intent: refundTarget.paymentIntent }
        : { charge: refundTarget.charge }),
      reason: "duplicate",
    }, {
      idempotencyKey: [
        "hosted-checkout-loser-refund",
        subscription.id,
        invoice.id,
      ].join(":"),
    }),
  );
  if (refund.status === "failed" || refund.status === "canceled") {
    throw buildCheckoutLoserCleanupSupportError();
  }
}

async function readLatestInvoice(input: {
  stripe: Stripe;
  subscription: Stripe.Subscription;
}): Promise<Stripe.Invoice | null> {
  const latestInvoice = input.subscription.latest_invoice;
  if (latestInvoice && typeof latestInvoice === "object") {
    return latestInvoice;
  }
  const invoiceId = coerceStripeObjectId(latestInvoice);
  if (!invoiceId) {
    return null;
  }
  return withHostedStripeFailureLog(
    "invoices.retrieve.checkout-loser",
    () => input.stripe.invoices.retrieve(invoiceId),
  );
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
