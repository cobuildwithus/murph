import { HostedBillingStatus } from "@prisma/client";

import { hostedOnboardingError } from "./errors";

export type HostedEntitlementInput = {
  billingStatus: HostedBillingStatus;
  familyAccessActive?: boolean;
  suspendedAt?: Date | null;
};

export type HostedEntitlement = {
  accessAllowed: boolean;
  activationReady: boolean;
  billingStatus: HostedBillingStatus;
  suspendedAt: Date | null;
};

export function deriveHostedEntitlement(input: HostedEntitlementInput): HostedEntitlement {
  return {
    accessAllowed: hasHostedMemberGeneralAccess(input),
    activationReady: hasHostedMemberGeneralAccess(input),
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
  input: Pick<HostedEntitlementInput, "billingStatus" | "familyAccessActive" | "suspendedAt">,
): boolean {
  return !isHostedMemberSuspended(input.suspendedAt)
    && (
      !isHostedAccessBlockedBillingStatus(input.billingStatus) ||
      input.familyAccessActive === true
    );
}

export function assertHostedMemberActiveAccessAllowed(
  input: Pick<HostedEntitlementInput, "billingStatus" | "suspendedAt">,
): void {
  assertHostedMemberNotSuspended(input);

  if (!hasHostedMemberActiveAccess(input)) {
    throw hostedOnboardingError({
      code: "HOSTED_ACCESS_REQUIRED",
      message: describeHostedMemberActiveAccessRequirement(input.billingStatus),
      httpStatus: 403,
    });
  }
}

export function assertHostedMemberNotSuspended(
  input: Pick<HostedEntitlementInput, "suspendedAt">,
): void {
  if (isHostedMemberSuspended(input.suspendedAt)) {
    throw hostedOnboardingError({
      code: "HOSTED_MEMBER_SUSPENDED",
      message: "This hosted account is suspended. Contact support to restore access.",
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

function describeHostedMemberActiveAccessRequirement(
  billingStatus: HostedBillingStatus,
): string {
  switch (billingStatus) {
    case HostedBillingStatus.canceled:
      return "Your subscription is canceled. Open billing to resume access.";
    case HostedBillingStatus.paused:
      return "Your subscription is paused. Resume billing before continuing.";
    case HostedBillingStatus.unpaid:
      return "Your subscription is unpaid. Update billing before continuing.";
    case HostedBillingStatus.past_due:
      return "Your subscription payment is past due. Update billing before continuing.";
    case HostedBillingStatus.not_started:
    case HostedBillingStatus.incomplete:
      return "Finish hosted activation before continuing.";
    default:
      return "Active hosted access is required to continue.";
  }
}
