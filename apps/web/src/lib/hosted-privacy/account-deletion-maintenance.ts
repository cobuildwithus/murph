import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

/**
 * Shared admission control for account-deletion cutovers whose complete
 * provider target set cannot be derived by every reachable Web deployment.
 *
 * `agent-docs/operations/hosted-account-deletion-maintenance.md` is the sole
 * lifecycle owner. In particular, an environment change and a 100-percent
 * alias do not retire clients pinned by Vercel Skew Protection.
 *
 * The flag is the only authority and the message makes no timing promise, not
 * even a relative one. Recovery guidance is stated as a condition, which stays
 * true for as long as any active cutover purpose keeps the window open.
 *
 * Do not delete this module, its env var, or either effect guard from a
 * purpose-specific migration cleanup.
 */
export const HOSTED_ACCOUNT_DELETION_MAINTENANCE_ENV = "HOSTED_ACCOUNT_DELETION_MAINTENANCE";

export const HOSTED_ACCOUNT_DELETION_MAINTENANCE_CODE = "account_deletion_maintenance";

export const HOSTED_SUBSCRIPTION_CHECKOUT_MAINTENANCE_CODE =
  "subscription_checkout_maintenance";

export const HOSTED_ACCOUNT_DELETION_MAINTENANCE_MESSAGE =
  "Murph is in scheduled maintenance, so we can't delete your account right now. "
  + "Nothing has changed and your request was not started. Please try again after maintenance.";

export const HOSTED_SUBSCRIPTION_CHECKOUT_MAINTENANCE_MESSAGE =
  "Murph is in scheduled maintenance, so we can't start subscription checkout right now. "
  + "Nothing has changed and no payment session was started. Please try again after maintenance.";

function hostedAccountDeletionMaintenanceIsActive(
  environment: Readonly<Record<string, string | undefined>>,
): boolean {
  return environment[HOSTED_ACCOUNT_DELETION_MAINTENANCE_ENV]?.trim() === "1";
}

export function assertHostedAccountDeletionAvailable(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): void {
  if (!hostedAccountDeletionMaintenanceIsActive(environment)) {
    return;
  }
  throw hostedOnboardingError({
    code: HOSTED_ACCOUNT_DELETION_MAINTENANCE_CODE,
    httpStatus: 503,
    message: HOSTED_ACCOUNT_DELETION_MAINTENANCE_MESSAGE,
    retryable: true,
  });
}

export function assertHostedSubscriptionCheckoutAvailable(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): void {
  if (!hostedAccountDeletionMaintenanceIsActive(environment)) {
    return;
  }
  throw hostedOnboardingError({
    code: HOSTED_SUBSCRIPTION_CHECKOUT_MAINTENANCE_CODE,
    httpStatus: 503,
    message: HOSTED_SUBSCRIPTION_CHECKOUT_MAINTENANCE_MESSAGE,
    retryable: true,
  });
}
