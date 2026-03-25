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

export function coerceStripeSubscriptionId(value: string | Stripe.Subscription | null | undefined): string | null {
  if (typeof value === "string") {
    return value;
  }

  if (value && typeof value === "object" && typeof value.id === "string") {
    return value.id;
  }

  return null;
}

export function buildStripeSuccessUrl(baseUrl: string, inviteCode: string): string {
  return `${baseUrl}/join/${encodeURIComponent(inviteCode)}/success?session_id={CHECKOUT_SESSION_ID}`;
}

export function buildStripeCancelUrl(baseUrl: string, inviteCode: string): string {
  return `${baseUrl}/join/${encodeURIComponent(inviteCode)}/cancel`;
}
