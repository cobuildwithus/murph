import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

/**
 * Temporary control for the OC-to-ENAM bundles migration in
 * `apps/cloudflare/R2_BUNDLES_ENAM_MIGRATION.md`.
 *
 * During that cutover two buckets hold the member's objects and either one can
 * still become authoritative. Before destination activation and the
 * dual-bucket deletion canary complete, a deletion cannot yet be proven
 * everywhere. Rather than accept an incomplete deletion, the operation
 * temporarily declines it.
 *
 * The flag is the only authority and the message makes no timing promise, not
 * even a relative one. Recovery guidance is stated as a condition instead, so
 * it stays true if migration or cutover validation takes longer than planned.
 *
 * Delete this module, its env var, and both call sites with the runbook once
 * the OC buckets are retired.
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
