import type Stripe from "stripe";

import { HostedBillingStatus } from "@prisma/client";

export function mapStripeSubscriptionStatusToHostedBillingStatus(
  status: Stripe.Subscription.Status | null | undefined,
): HostedBillingStatus {
  switch (status) {
    case "active":
    case "trialing":
      return HostedBillingStatus.active;
    case "past_due":
      return HostedBillingStatus.past_due;
    case "canceled":
      return HostedBillingStatus.canceled;
    case "unpaid":
      return HostedBillingStatus.unpaid;
    case "paused":
      return HostedBillingStatus.paused;
    case "incomplete":
    case "incomplete_expired":
      return HostedBillingStatus.incomplete;
    default:
      return HostedBillingStatus.not_started;
  }
}

export function coerceStripeObjectId(value: { id?: unknown } | string | null | undefined): string | null {
  if (typeof value === "string") {
    return value;
  }

  if (value && typeof value === "object" && typeof value.id === "string") {
    return value.id;
  }

  return null;
}

export function readStripeShouldRetryDirective(error: unknown): boolean | null {
  if (
    !error ||
    typeof error !== "object" ||
    !("headers" in error) ||
    !error.headers ||
    typeof error.headers !== "object" ||
    Array.isArray(error.headers)
  ) {
    return null;
  }

  let directive: boolean | null = null;
  for (const [name, value] of Object.entries(error.headers)) {
    if (name.toLowerCase() !== "stripe-should-retry") {
      continue;
    }
    if (typeof value !== "string") {
      return null;
    }
    const normalized = value.trim().toLowerCase();
    if (normalized !== "true" && normalized !== "false") {
      return null;
    }
    const nextDirective = normalized === "true";
    if (directive !== null && directive !== nextDirective) {
      return null;
    }
    directive = nextDirective;
  }

  return directive;
}

export function coerceStripeSubscriptionId(value: string | Stripe.Subscription | null | undefined): string | null {
  if (typeof value === "string") {
    return value;
  }

  if (value && typeof value === "object" && typeof value.id === "string") {
    return value.id;
  }

  return null;
}

export function coerceStripeInvoiceSubscriptionId(
  invoice:
    | Stripe.Invoice
    | {
      lines?: {
        data?: Array<{
          subscription?: unknown;
        }> | null;
      } | null;
      parent?: {
        subscription_details?: {
          subscription?: unknown;
        } | null;
      } | null;
      subscription?: unknown;
    },
): string | null {
  const directSubscriptionId = coerceStripeSubscriptionId(
    (invoice as Stripe.Invoice & { subscription?: unknown }).subscription as never,
  );

  if (directSubscriptionId) {
    return directSubscriptionId;
  }

  const lineSubscriptionId = Array.isArray(invoice.lines?.data)
    ? invoice.lines.data
      .map((line) => coerceStripeSubscriptionId(line.subscription as never))
      .find((value) => value !== null) ?? null
    : null;

  if (lineSubscriptionId) {
    return lineSubscriptionId;
  }

  return coerceStripeSubscriptionId(invoice.parent?.subscription_details?.subscription as never);
}

/**
 * Stripe-hosted page for an unpaid subscription invoice, which is the only
 * surface that can actually collect the payment. The billing portal home is not
 * a substitute: it renders a pending update as inert status text and files the
 * payable invoice away under invoice history.
 *
 * Returns `null` unless the subscription's latest invoice is still owed by this
 * exact customer and subscription, so a stale or unrelated invoice can never be
 * presented as this subscription's payment step.
 */
export function readStripeSubscriptionPayableInvoiceUrl(input: {
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  subscription: Stripe.Subscription;
}): string | null {
  const invoice = input.subscription.latest_invoice;

  if (
    !invoice ||
    typeof invoice !== "object" ||
    invoice.status !== "open" ||
    typeof invoice.amount_remaining !== "number" ||
    invoice.amount_remaining <= 0 ||
    coerceStripeObjectId(invoice.customer) !== input.stripeCustomerId ||
    coerceStripeInvoiceSubscriptionId(invoice) !== input.stripeSubscriptionId
  ) {
    return null;
  }

  return typeof invoice.hosted_invoice_url === "string" &&
      invoice.hosted_invoice_url.startsWith("https://")
    ? invoice.hosted_invoice_url
    : null;
}

export function buildStripeSuccessUrl(baseUrl: string, inviteCode: string): string {
  return `${baseUrl}/join/${encodeURIComponent(inviteCode)}/success?session_id={CHECKOUT_SESSION_ID}`;
}

export function buildStripeCancelUrl(baseUrl: string, inviteCode: string): string {
  return `${baseUrl}/join/${encodeURIComponent(inviteCode)}/cancel`;
}
