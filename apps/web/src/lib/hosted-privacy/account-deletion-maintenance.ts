import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

/**
 * Temporary control for the OC-to-ENAM retirement tracked by
 * `agent-docs/exec-plans/active/2026-08-06-retire-r2-oc-bridge.md`.
 *
 * The Worker no longer needs an OC binding, but the retired production and
 * preview buckets still exist during the staged rollout. Until the exact no-OC
 * Worker is live and both buckets are physically absent, deletion completion
 * cannot be proven everywhere. Rather than accept an incomplete deletion, the
 * operation temporarily declines it.
 *
 * The flag is the only authority and the message makes no timing promise, not
 * even a relative one. Recovery guidance is stated as a condition instead, so
 * it stays true if migration or cutover validation takes longer than planned.
 *
 * Delete this module, its env var, and both call sites only after both OC
 * bucket APIs report the buckets absent.
 */
export const HOSTED_ACCOUNT_DELETION_MAINTENANCE_ENV = "HOSTED_ACCOUNT_DELETION_MAINTENANCE";

export const HOSTED_ACCOUNT_DELETION_MAINTENANCE_CODE = "account_deletion_maintenance";

export const HOSTED_ACCOUNT_DELETION_MAINTENANCE_MESSAGE =
  "Murph is in scheduled maintenance, so we can't delete your account right now. "
  + "Nothing has changed and your request was not started. Please try again after maintenance.";

export function assertHostedAccountDeletionAvailable(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): void {
  if (environment[HOSTED_ACCOUNT_DELETION_MAINTENANCE_ENV]?.trim() !== "1") {
    return;
  }
  throw hostedOnboardingError({
    code: HOSTED_ACCOUNT_DELETION_MAINTENANCE_CODE,
    httpStatus: 503,
    message: HOSTED_ACCOUNT_DELETION_MAINTENANCE_MESSAGE,
    retryable: true,
  });
}
