import { HostedBillingStatus } from "@prisma/client";

import { hasHostedMemberActiveAccess, isHostedMemberSuspended } from "./entitlement";

export type HostedOnboardingStage =
  | "invalid"
  | "expired"
  | "verify"
  | "checkout"
  | "blocked"
  | "active";

export function requiresHostedBillingCheckout(
  billingStatus: HostedBillingStatus,
): boolean {
  return billingStatus === HostedBillingStatus.not_started
    || billingStatus === HostedBillingStatus.incomplete;
}

export function deriveHostedOnboardingStage(input: {
  billingStatus: HostedBillingStatus;
  expiresAt: Date;
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

  if (hasHostedMemberActiveAccess(input)) {
    return "active";
  }

  if (requiresHostedBillingCheckout(input.billingStatus)) {
    return "checkout";
  }

  return "blocked";
}

export function deriveHostedPostVerificationStage(input: {
  billingStatus: HostedBillingStatus;
  suspendedAt?: Date | null;
}): "active" | "checkout" | "blocked" {
  if (isHostedMemberSuspended(input.suspendedAt)) {
    return "blocked";
  }

  if (input.billingStatus === HostedBillingStatus.active) {
    return "active";
  }

  return requiresHostedBillingCheckout(input.billingStatus) ? "checkout" : "blocked";
}
