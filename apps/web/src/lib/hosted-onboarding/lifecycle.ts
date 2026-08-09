import { HostedBillingStatus } from "@prisma/client";

import { hasHostedMemberOwnActiveAccess, isHostedMemberSuspended } from "./entitlement";
import {
  resolveHostedAccessibleOnboardingStage,
  type HostedOnboardingStage,
  type HostedPostVerificationStage,
} from "./stage";

export function requiresHostedBillingCheckout(
  billingStatus: HostedBillingStatus,
): boolean {
  return billingStatus === HostedBillingStatus.not_started
    || billingStatus === HostedBillingStatus.incomplete;
}

/**
 * Billing that lapsed after activation (`paused`, `past_due`, `canceled`,
 * `unpaid`). These members already completed checkout once, so they recover from
 * the existing billing surface rather than a fresh checkout or a support-only
 * dead end. Statuses that still owe first-time checkout are excluded.
 */
export function isHostedLapsedBillingStatus(
  billingStatus: HostedBillingStatus,
): boolean {
  return billingStatus !== HostedBillingStatus.active
    && !requiresHostedBillingCheckout(billingStatus);
}

/**
 * Whether the member is recovering existing billing rather than acquiring it.
 * `incomplete` cannot be read from status alone: the Stripe status mapper also
 * writes it while an already-owned subscription settles, including bounded
 * legacy-trial cleanup. Owning a subscription is the durable signal, so it
 * decides, and every surface asks this one question instead of re-deriving it.
 */
export function hasHostedRecoverableBilling(input: {
  billingStatus: HostedBillingStatus;
  hasExistingSubscription?: boolean;
}): boolean {
  return isHostedLapsedBillingStatus(input.billingStatus)
    || (input.billingStatus === HostedBillingStatus.incomplete
      && input.hasExistingSubscription === true);
}

export function deriveHostedOnboardingStage(input: {
  activationPending?: boolean;
  billingStatus: HostedBillingStatus;
  expiresAt: Date;
  hasExistingSubscription?: boolean;
  sponsoredAccessActive?: boolean;
  now: Date;
  sessionMatchesInvite: boolean;
  suspendedAt?: Date | null;
}): Exclude<HostedOnboardingStage, "invalid"> {
  if (input.expiresAt <= input.now) {
    return "expired";
  }

  if (!input.sessionMatchesInvite) {
    return "verify";
  }

  if (isHostedMemberSuspended(input.suspendedAt)) {
    return "blocked";
  }

  if (hasHostedOnboardingRecoverySurfaceAccess(input)) {
    return resolveHostedAccessibleOnboardingStage(input.activationPending);
  }

  if (requiresHostedBillingCheckout(input.billingStatus)) {
    return "checkout";
  }

  return "blocked";
}

export function deriveHostedPostVerificationStage(input: {
  activationPending?: boolean;
  billingStatus: HostedBillingStatus;
  hasExistingSubscription?: boolean;
  sponsoredAccessActive?: boolean;
  suspendedAt?: Date | null;
}): HostedPostVerificationStage {
  if (isHostedMemberSuspended(input.suspendedAt)) {
    return "blocked";
  }

  if (hasHostedOnboardingRecoverySurfaceAccess(input)) {
    return resolveHostedAccessibleOnboardingStage(input.activationPending);
  }

  return requiresHostedBillingCheckout(input.billingStatus) ? "checkout" : "blocked";
}

function hasHostedOnboardingRecoverySurfaceAccess(input: {
  billingStatus: HostedBillingStatus;
  hasExistingSubscription?: boolean;
  sponsoredAccessActive?: boolean;
  suspendedAt?: Date | null;
}): boolean {
  // This is a web-navigation decision, not runtime entitlement. Members whose
  // billing lapsed after activation stay dashboard-accessible so existing
  // billing can be resumed without entering a fresh checkout or a support-only
  // dead end.
  return !isHostedMemberSuspended(input.suspendedAt)
    && (
      hasHostedMemberOwnActiveAccess(input)
      || input.sponsoredAccessActive === true
      || hasHostedRecoverableBilling(input)
    );
}
