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

export function buildStripeSuccessUrl(baseUrl: string, inviteCode: string, shareCode?: string | null): string {
  const shareParam = shareCode ? `&share=${encodeURIComponent(shareCode)}` : "";
  return `${baseUrl}/join/${encodeURIComponent(inviteCode)}/success?session_id={CHECKOUT_SESSION_ID}${shareParam}`;
}

export function buildStripeCancelUrl(baseUrl: string, inviteCode: string, shareCode?: string | null): string {
  const params = new URLSearchParams();

  if (shareCode) {
    params.set("share", shareCode);
  }

  const query = params.toString();
  return `${baseUrl}/join/${encodeURIComponent(inviteCode)}/cancel${query ? `?${query}` : ""}`;
}
