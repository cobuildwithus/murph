import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

/**
 * Temporary control for the OC-to-ENAM bundles migration in
 * `apps/cloudflare/R2_BUNDLES_ENAM_MIGRATION.md`.
 *
 * During that cutover two buckets hold the member's objects and either one can
 * still become the active bucket. The runtime deletion path only ever targets
 * the currently active bucket, so a deletion accepted inside the window could
 * leave data behind in the bucket that later becomes live. Rather than accept
 * a deletion we cannot complete everywhere, we decline it for the length of the
 * window.
 *
 * The flag is the only authority and the message makes no timing promise, not
 * even a relative one. The window runs from before the copy until OC
 * retirement, which the runbook permits as late as 24 hours after cutover and
 * may extend, so any duration we name can expire while the window is still
 * open. Recovery guidance is stated as a condition instead, which stays true
 * for as long as the window lasts.
 *
 * Delete this module, its env var, and both call sites with the runbook once
 * the OC buckets are retired.
 */
export const HOSTED_ACCOUNT_DELETION_MAINTENANCE_ENV = "HOSTED_ACCOUNT_DELETION_MAINTENANCE";

export const HOSTED_ACCOUNT_DELETION_MAINTENANCE_CODE = "account_deletion_maintenance";

export const HOSTED_ACCOUNT_DELETION_MAINTENANCE_MESSAGE =
  "Murph is in scheduled maintenance, so we can't delete your account right now. "
  + "Nothing has changed and your request was not started. Please try again after maintenance.";

/**
 * Exact, identifier-free Vercel runtime-log marker for a deletion that passed
 * both guards and consumed its sensitive-action challenge.
 */
export const HOSTED_ACCOUNT_DELETION_ADMISSION_LOG_MESSAGE =
  "Hosted account deletion admitted before destructive effects.";

/**
 * Paired marker emitted in the same Vercel request only after every fanned-out
 * hosted-member cleanup has synchronously confirmed its R2 and Durable Object
 * effects. The migration runbook joins the two markers by Vercel requestId and
 * never treats HTTP completion, elapsed time, or a best-effort false result as
 * terminal proof.
 */
export const HOSTED_ACCOUNT_DELETION_TERMINAL_LOG_MESSAGE =
  "Hosted account deletion confirmed terminal across R2 and durable state.";

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
