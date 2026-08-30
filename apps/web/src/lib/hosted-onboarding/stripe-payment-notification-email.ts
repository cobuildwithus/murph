import "server-only";

import type Stripe from "stripe";

import { sha256Hex } from "../primitives";
import { readHostedOperationalAlertEmailConfig } from "./operational-alert-email-config";
import { sendHostedResendPlainTextEmail } from "./resend-plain-text-email";

const HOSTED_STRIPE_PAYMENT_EVENT_ID_PATTERN = /^evt_[A-Za-z0-9_-]{1,128}$/u;
const HOSTED_STRIPE_PAYMENT_CURRENCY_PATTERN = /^[a-z]{3}$/u;

export type HostedStripePaymentNotificationCandidate = {
  amountMinor: number;
  category:
    | "invoice"
    | "subscription_create"
    | "subscription_cycle"
    | "subscription_threshold"
    | "subscription_update"
    | "usage_credit";
  currency: string;
  eventId: string;
  eventType: string;
  livemode: boolean;
  occurredAt: Date;
};

export type HostedStripePaymentNotificationEmailOutcome = "sent";

type HostedStripePaymentNotificationEmailSend =
  typeof sendHostedResendPlainTextEmail;

export function resolveHostedStripePaymentNotificationCandidate(input: {
  event: Stripe.Event;
  positivePaymentTransitionOccurred: boolean;
  usageCreditEventHandled: boolean;
}): HostedStripePaymentNotificationCandidate | null {
  if (input.event.type === "invoice.paid") {
    const invoice = input.event.data.object as Stripe.Invoice;
    const category = resolveHostedStripeInvoicePaymentCategory({
      billingReason: invoice.billing_reason,
      positivePaymentTransitionOccurred:
        input.positivePaymentTransitionOccurred,
    });
    if (!category) {
      return null;
    }
    return buildHostedStripePaymentNotificationCandidate({
      amountMinor: invoice.amount_paid,
      category,
      currency: invoice.currency,
      event: input.event,
    });
  }

  if (!input.usageCreditEventHandled) {
    return null;
  }

  if (
    input.event.type === "checkout.session.completed" ||
    input.event.type === "checkout.session.async_payment_succeeded"
  ) {
    const session = input.event.data.object as Stripe.Checkout.Session;
    if (session.mode !== "payment" || session.payment_status !== "paid") {
      return null;
    }
    return buildHostedStripePaymentNotificationCandidate({
      amountMinor: session.amount_total,
      category: "usage_credit",
      currency: session.currency,
      event: input.event,
    });
  }

  if (input.event.type === "payment_intent.succeeded") {
    const paymentIntent = input.event.data.object as Stripe.PaymentIntent;
    if (paymentIntent.status !== "succeeded") {
      return null;
    }
    return buildHostedStripePaymentNotificationCandidate({
      amountMinor: paymentIntent.amount_received,
      category: "usage_credit",
      currency: paymentIntent.currency,
      event: input.event,
    });
  }

  return null;
}

export async function sendHostedStripePaymentNotificationEmail(input: {
  candidate: HostedStripePaymentNotificationCandidate;
  env?: Readonly<Record<string, string | undefined>>;
  sendEmail?: HostedStripePaymentNotificationEmailSend;
}): Promise<HostedStripePaymentNotificationEmailOutcome> {
  const emailConfig = readHostedOperationalAlertEmailConfig(
    input.env ?? process.env,
  );
  if (!emailConfig) {
    throw new Error(
      "Hosted Stripe payment notification email is not configured.",
    );
  }

  const amount = formatHostedStripePaymentAmount(input.candidate);
  const eventId = readHostedStripePaymentEventId(input.candidate.eventId);
  await (input.sendEmail ?? sendHostedResendPlainTextEmail)({
    config: emailConfig.resend,
    idempotencyKey:
      `hosted-stripe-payment/${sha256Hex(input.candidate.eventId)}`,
    subject: `Murph payment received — ${amount}`,
    text: [
      "Stripe confirmed a positive Murph payment.",
      "",
      `amount: ${amount}`,
      `amount minor units: ${input.candidate.amountMinor}`,
      `category: ${formatHostedStripePaymentCategory(input.candidate.category)}`,
      `event type: ${input.candidate.eventType}`,
      `Stripe event id: ${eventId ?? "unavailable"}`,
      `paid at: ${input.candidate.occurredAt.toISOString()}`,
      `mode: ${input.candidate.livemode ? "live" : "test"}`,
      "",
      "Inspect this event in Stripe for customer and invoice details. No member or customer identity, contact detail, checkout contents, or raw provider payload is included in this email.",
    ].join("\n"),
    to: emailConfig.recipients,
  });

  return "sent";
}

function buildHostedStripePaymentNotificationCandidate(input: {
  amountMinor: number | null;
  category: HostedStripePaymentNotificationCandidate["category"];
  currency: string | null;
  event: Stripe.Event;
}): HostedStripePaymentNotificationCandidate | null {
  if (
    !Number.isSafeInteger(input.amountMinor) ||
    input.amountMinor === null ||
    input.amountMinor <= 0
  ) {
    return null;
  }
  const currency = input.currency?.toLowerCase() ?? null;
  if (!currency || !HOSTED_STRIPE_PAYMENT_CURRENCY_PATTERN.test(currency)) {
    return null;
  }
  const occurredAt =
    Number.isSafeInteger(input.event.created) && input.event.created >= 0
    ? new Date(input.event.created * 1_000)
    : null;
  if (!occurredAt || !Number.isFinite(occurredAt.getTime())) {
    return null;
  }

  return {
    amountMinor: input.amountMinor,
    category: input.category,
    currency,
    eventId: input.event.id,
    eventType: input.event.type,
    livemode: input.event.livemode,
    occurredAt,
  };
}

function resolveHostedStripeInvoicePaymentCategory(
  input: {
    billingReason: Stripe.Invoice["billing_reason"];
    positivePaymentTransitionOccurred: boolean;
  },
): HostedStripePaymentNotificationCandidate["category"] | null {
  switch (input.billingReason) {
    case "subscription_cycle":
      return input.positivePaymentTransitionOccurred
        ? "subscription_cycle"
        : null;
    case "subscription_create":
    case "subscription_threshold":
    case "subscription_update":
      return input.billingReason;
    default:
      return "invoice";
  }
}

function formatHostedStripePaymentCategory(
  category: HostedStripePaymentNotificationCandidate["category"],
): string {
  switch (category) {
    case "subscription_create":
      return "new subscription";
    case "subscription_cycle":
      return "recurring subscription";
    case "subscription_threshold":
      return "recurring usage invoice";
    case "subscription_update":
      return "subscription change";
    case "usage_credit":
      return "usage credit";
    default:
      return "invoice";
  }
}

function formatHostedStripePaymentAmount(
  candidate: Pick<
    HostedStripePaymentNotificationCandidate,
    "amountMinor" | "currency"
  >,
): string {
  return `${candidate.currency.toUpperCase()} ${(candidate.amountMinor / 100).toFixed(2)}`;
}

function readHostedStripePaymentEventId(value: string): string | null {
  return HOSTED_STRIPE_PAYMENT_EVENT_ID_PATTERN.test(value) ? value : null;
}
