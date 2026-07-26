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
 * Exact, identifier-free Vercel runtime-log marker emitted before any guard or
 * await in the delete route. Every invocation on the marker-bearing deployment
 * therefore has one request-owned migration proof anchor.
 */
export const HOSTED_ACCOUNT_DELETION_ENTRY_LOG_MESSAGE =
  "Hosted account deletion request entered the guarded route.";

/**
 * Paired marker for a request that cannot leave member data behind: either the
 * request stopped before destructive deletion began, or every fanned-out R2
 * and Durable Object cleanup synchronously confirmed success. Once deletion
 * begins, timeout, process exit, throw, or a best-effort false result emits no
 * marker and blocks the migration.
 */
export const HOSTED_ACCOUNT_DELETION_SAFE_TERMINAL_LOG_MESSAGE =
  "Hosted account deletion request reached a safe terminal disposition.";

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
