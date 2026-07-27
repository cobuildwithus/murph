import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

/**
 * Temporary admission control for account-deletion cutovers whose complete
 * provider target set cannot be derived by the currently deployed Web code.
 *
 * Current uses are the OC-to-ENAM bundles migration documented in
 * `apps/cloudflare/R2_BUNDLES_ENAM_MIGRATION.md` and the first deployment of
 * the subscription Checkout Session deletion fence. The latter must keep this
 * gate active until old Web functions drain and every open personal Checkout
 * Session issued before bind-before-return convergence is terminal.
 *
 * The flag is the only authority and the message makes no timing promise, not
 * even a relative one. The window runs from before the copy until OC
 * retirement, which the runbook permits as late as 24 hours after cutover and
 * may extend, so any duration we name can expire while the window is still
 * open. Recovery guidance is stated as a condition instead, which stays true
 * for as long as the window lasts.
 *
 * Delete this module, its env var, and both call sites only after every current
 * cutover that names this boundary has completed and its rollback floor is no
 * longer needed.
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
