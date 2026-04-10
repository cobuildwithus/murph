import {
  HostedBillingStatus,
  HostedRevnetIssuanceStatus,
} from "@prisma/client";

import { hostedOnboardingError } from "./errors";

export type HostedEntitlementInput = {
  billingStatus: HostedBillingStatus;
  revnetIssuanceStatus?: HostedRevnetIssuanceStatus | null;
  revnetRequired?: boolean;
  suspendedAt?: Date | null;
};

export type HostedEntitlement = {
  accessAllowed: boolean;
  activationReady: boolean;
  billingStatus: HostedBillingStatus;
  suspendedAt: Date | null;
};

export function deriveHostedEntitlement(input: HostedEntitlementInput): HostedEntitlement {
  const revnetReady = !input.revnetRequired || input.revnetIssuanceStatus === HostedRevnetIssuanceStatus.confirmed;

  return {
    accessAllowed: hasHostedMemberGeneralAccess(input),
    activationReady: hasHostedMemberActiveAccess(input) && revnetReady,
    billingStatus: input.billingStatus,
    suspendedAt: input.suspendedAt ?? null,
  };
}

export function hasHostedMemberActiveAccess(
  input: Pick<HostedEntitlementInput, "billingStatus" | "suspendedAt">,
): boolean {
  return !isHostedMemberSuspended(input.suspendedAt) && input.billingStatus === HostedBillingStatus.active;
}

export function hasHostedMemberGeneralAccess(
  input: Pick<HostedEntitlementInput, "billingStatus" | "suspendedAt">,
): boolean {
  return !isHostedMemberSuspended(input.suspendedAt)
    && !isHostedAccessBlockedBillingStatus(input.billingStatus);
}

export function assertHostedMemberActiveAccessAllowed(
  input: Pick<HostedEntitlementInput, "billingStatus" | "suspendedAt">,
): void {
  if (isHostedMemberSuspended(input.suspendedAt)) {
    throw hostedOnboardingError({
      code: "HOSTED_MEMBER_SUSPENDED",
      message: "This hosted account is suspended. Contact support to restore access.",
      httpStatus: 403,
    });
  }

  if (!hasHostedMemberActiveAccess(input)) {
    throw hostedOnboardingError({
      code: "HOSTED_ACCESS_REQUIRED",
      message: "Finish hosted activation before continuing.",
      httpStatus: 403,
    });
  }
}

export function isHostedMemberSuspended(suspendedAt: Date | null | undefined): boolean {
  return suspendedAt instanceof Date;
}

export function isHostedAccessBlockedBillingStatus(billingStatus: HostedBillingStatus): boolean {
  return (
    billingStatus === HostedBillingStatus.canceled ||
    billingStatus === HostedBillingStatus.paused ||
    billingStatus === HostedBillingStatus.unpaid
  );
}
