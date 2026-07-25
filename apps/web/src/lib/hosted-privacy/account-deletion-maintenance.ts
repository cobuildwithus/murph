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
 * window and tell the member exactly when to come back.
 *
 * Delete this module, its env var, and its call site with the runbook once the
 * OC buckets are retired.
 */
export const HOSTED_ACCOUNT_DELETION_MAINTENANCE_ENV = "HOSTED_ACCOUNT_DELETION_MAINTENANCE";
export const HOSTED_ACCOUNT_DELETION_MAINTENANCE_UNTIL_ENV =
  "HOSTED_ACCOUNT_DELETION_MAINTENANCE_UNTIL";

export const HOSTED_ACCOUNT_DELETION_MAINTENANCE_CODE = "account_deletion_maintenance";

export function assertHostedAccountDeletionAvailable(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): void {
  if (environment[HOSTED_ACCOUNT_DELETION_MAINTENANCE_ENV]?.trim() !== "1") {
    return;
  }
  throw hostedOnboardingError({
    code: HOSTED_ACCOUNT_DELETION_MAINTENANCE_CODE,
    httpStatus: 503,
    message: buildHostedAccountDeletionMaintenanceMessage(
      environment[HOSTED_ACCOUNT_DELETION_MAINTENANCE_UNTIL_ENV],
    ),
    retryable: true,
  });
}

export function buildHostedAccountDeletionMaintenanceMessage(until: string | undefined): string {
  const window = formatMaintenanceWindow(until);
  return "Murph is in scheduled maintenance, so we can't delete your account right now. "
    + `Nothing has changed and your request was not started. Please try again ${window}.`;
}

function formatMaintenanceWindow(until: string | undefined): string {
  const trimmed = until?.trim();
  if (!trimmed) return "in a few hours";
  const parsed = Date.parse(trimmed);
  if (!Number.isFinite(parsed)) return "in a few hours";
  return `after ${new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(parsed))} UTC`;
}
