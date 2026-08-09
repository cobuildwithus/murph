import { HostedBillingStatus } from "@prisma/client";

import { HOSTED_STANDARD_CHECKOUT_OFFER } from "./billing-plans";
import { hostedOnboardingError } from "./errors";

/**
 * Product-access predicates. `billingStatus=active` means the member can use
 * Murph directly; the capacity owner can be starter usage or a paid plan.
 * Sponsored Family/thread access is deliberately derived by member-access.ts.
 */
export type HostedOwnAccessInput = {
  billingStatus: HostedBillingStatus;
  suspendedAt?: Date | null;
};

export type HostedPaidBillingRefEvidenceInput = {
  currentBillingPhase?: unknown;
  currentCheckoutOffer?: unknown;
  stripeSubscriptionLookupKey?: string | null;
};

export type HostedOwnPaidBillingInput = HostedOwnAccessInput & {
  billingRef?: HostedPaidBillingRefEvidenceInput | null;
};

export function hasHostedMemberOwnActiveAccess(
  input: HostedOwnAccessInput,
): boolean {
  return !isHostedMemberSuspended(input.suspendedAt)
    && input.billingStatus === HostedBillingStatus.active;
}

/**
 * Paid-only predicate for plan management and subscription recovery. New
 * starter members intentionally have active product access without a Stripe
 * subscription. A bound rolling-deploy subscription with no phase remains
 * paid only when it is not explicitly the retired Pulse-trial offer. An
 * explicit non-paid phase never does.
 */
export function hasHostedPaidBillingRefEvidence(
  billingRef: HostedPaidBillingRefEvidenceInput | null | undefined,
): boolean {
  if (billingRef?.currentBillingPhase === "paid") {
    return true;
  }
  const checkoutOffer = billingRef?.currentCheckoutOffer;
  return (
    (billingRef?.currentBillingPhase === null
      || billingRef?.currentBillingPhase === undefined)
    && Boolean(billingRef?.stripeSubscriptionLookupKey)
    && (
      checkoutOffer === null
      || checkoutOffer === undefined
      || checkoutOffer === HOSTED_STANDARD_CHECKOUT_OFFER
    )
  );
}

export function hasHostedMemberOwnPaidBilling(
  input: HostedOwnPaidBillingInput,
): boolean {
  return hasHostedMemberOwnActiveAccess(input)
    && hasHostedPaidBillingRefEvidence(input.billingRef);
}

/**
 * Weaker onboarding-engagement gate: the member's own access is not hard
 * blocked. Passes for `not_started`/`incomplete`/`past_due` members who are
 * still finishing signup. Sponsorship-blind by design; callers that need the
 * sponsorship escape combine this with `member-access.ts`.
 */
export function hasHostedMemberGeneralAccess(
  input: HostedOwnAccessInput,
): boolean {
  return !isHostedMemberSuspended(input.suspendedAt)
    && !isHostedAccessBlockedBillingStatus(input.billingStatus);
}

export function assertHostedMemberOwnActiveAccessAllowed(
  input: HostedOwnAccessInput,
): void {
  assertHostedMemberNotSuspended(input);

  if (!hasHostedMemberOwnActiveAccess(input)) {
    throw hostedOnboardingError({
      code: "HOSTED_ACCESS_REQUIRED",
      message: describeHostedMemberActiveAccessRequirement(input.billingStatus),
      httpStatus: 403,
    });
  }
}

export function assertHostedMemberOwnPaidBillingAllowed(
  input: HostedOwnPaidBillingInput,
): void {
  assertHostedMemberOwnActiveAccessAllowed(input);
  if (!hasHostedMemberOwnPaidBilling(input)) {
    throw hostedOnboardingError({
      code: "HOSTED_PAID_SUBSCRIPTION_REQUIRED",
      message: "Start a paid plan before managing subscription billing.",
      httpStatus: 409,
    });
  }
}

export function assertHostedMemberNotSuspended(
  input: Pick<HostedOwnAccessInput, "suspendedAt">,
): void {
  if (isHostedMemberSuspended(input.suspendedAt)) {
    throw hostedOnboardingError({
      code: "HOSTED_MEMBER_SUSPENDED",
      message: "This hosted account is suspended. Contact support to restore access.",
      httpStatus: 403,
    });
  }
}

export function isHostedMemberSuspended(
  suspendedAt: Date | null | undefined,
): boolean {
  return suspendedAt instanceof Date;
}

export function isHostedAccessBlockedBillingStatus(
  billingStatus: HostedBillingStatus,
): boolean {
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
