import { HostedBillingStatus } from "@prisma/client";

import { hostedOnboardingError } from "./errors";

/**
 * Own-billing predicates. `billingStatus` here is always the member's OWN
 * Stripe relationship; sponsored access (family plan, thread containers) is
 * deliberately invisible to this module. Access gates must use
 * `member-access.ts` instead — these predicates exist for billing and
 * onboarding surfaces that genuinely mean "this member's own subscription".
 */

export type HostedOwnBillingInput = {
  billingStatus: HostedBillingStatus;
  suspendedAt?: Date | null;
};

export function hasHostedMemberOwnActiveBilling(input: HostedOwnBillingInput): boolean {
  return !isHostedMemberSuspended(input.suspendedAt)
    && input.billingStatus === HostedBillingStatus.active;
}

/**
 * Weaker onboarding-engagement gate: the member's own billing is not hard
 * blocked. Passes for `not_started`/`incomplete`/`past_due` members who are
 * still finishing signup. Sponsorship-blind by design; callers that need the
 * sponsorship escape combine this with `member-access.ts`.
 */
export function hasHostedMemberGeneralAccess(input: HostedOwnBillingInput): boolean {
  return !isHostedMemberSuspended(input.suspendedAt)
    && !isHostedAccessBlockedBillingStatus(input.billingStatus);
}

export function assertHostedMemberOwnActiveBillingAllowed(
  input: HostedOwnBillingInput,
): void {
  assertHostedMemberNotSuspended(input);

  if (!hasHostedMemberOwnActiveBilling(input)) {
    throw hostedOnboardingError({
      code: "HOSTED_ACCESS_REQUIRED",
      message: describeHostedMemberActiveAccessRequirement(input.billingStatus),
      httpStatus: 403,
    });
  }
}

export function assertHostedMemberNotSuspended(
  input: Pick<HostedOwnBillingInput, "suspendedAt">,
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

export function describeHostedMemberActiveAccessRequirement(
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
