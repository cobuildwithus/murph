import { HostedBillingStatus } from "@prisma/client";

import { hasHostedMemberActiveAccess, isHostedMemberSuspended } from "./entitlement";

export type HostedOnboardingStage =
  | "invalid"
  | "expired"
  | "verify"
  | "checkout"
  | "activating"
  | "blocked"
  | "active";

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

  if (input.activationPending) {
    return "activating";
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
  activationPending?: boolean;
  billingStatus: HostedBillingStatus;
  suspendedAt?: Date | null;
}): "active" | "activating" | "checkout" | "blocked" {
  if (isHostedMemberSuspended(input.suspendedAt)) {
    return "blocked";
  }

  if (input.activationPending) {
    return "activating";
  }

  if (input.billingStatus === HostedBillingStatus.active) {
    return "active";
  }

  return requiresHostedBillingCheckout(input.billingStatus) ? "checkout" : "blocked";
}
