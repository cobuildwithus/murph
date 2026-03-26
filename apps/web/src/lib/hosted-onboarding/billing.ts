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

export function buildStripeSuccessUrl(baseUrl: string, inviteCode: string, shareCode?: string | null): string {
  const params = new URLSearchParams({
    session_id: "{CHECKOUT_SESSION_ID}",
  });

  if (shareCode) {
    params.set("share", shareCode);
  }

  return `${baseUrl}/join/${encodeURIComponent(inviteCode)}/success?${params.toString()}`;
}

export function buildStripeCancelUrl(baseUrl: string, inviteCode: string, shareCode?: string | null): string {
  const params = new URLSearchParams();

  if (shareCode) {
    params.set("share", shareCode);
  }

  const query = params.toString();
  return `${baseUrl}/join/${encodeURIComponent(inviteCode)}/cancel${query ? `?${query}` : ""}`;
}
