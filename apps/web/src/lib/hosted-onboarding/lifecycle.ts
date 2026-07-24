import { HostedBillingStatus } from "@prisma/client";

import { hasHostedMemberOwnActiveBilling, isHostedMemberSuspended } from "./entitlement";
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

export function deriveHostedOnboardingStage(input: {
  activationPending?: boolean;
  billingStatus: HostedBillingStatus;
  expiresAt: Date;
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
  sponsoredAccessActive?: boolean;
  suspendedAt?: Date | null;
}): boolean {
  // This is a web-navigation decision, not runtime entitlement. Paused members
  // stay dashboard-accessible so existing billing can be resumed without
  // entering a fresh checkout or support-only flow.
  return !isHostedMemberSuspended(input.suspendedAt)
    && (
      hasHostedMemberOwnActiveBilling(input)
      || input.sponsoredAccessActive === true
      || input.billingStatus === HostedBillingStatus.paused
    );
}
