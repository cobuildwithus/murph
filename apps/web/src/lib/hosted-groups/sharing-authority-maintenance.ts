import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

/**
 * Temporary release gate for the first sharing-decision-revision deployment.
 *
 * Promote the revision-aware bundle once with this flag enabled, wait the full
 * prior-function drain, and only then redeploy the same head without the flag.
 * Delete this module and both owner call sites after that rollout is complete.
 */
export const HOSTED_GROUP_SHARING_AUTHORITY_MAINTENANCE_ENV =
  "HOSTED_GROUP_SHARING_AUTHORITY_MAINTENANCE";

export const HOSTED_GROUP_SHARING_AUTHORITY_MAINTENANCE_CODE =
  "hosted_group_sharing_authority_maintenance";

export const HOSTED_GROUP_SHARING_AUTHORITY_MAINTENANCE_MESSAGE =
  "Murph is in scheduled maintenance, so group sharing can't be changed right now. "
  + "Nothing changed and your request was not started. Please try again after maintenance.";

export function assertHostedGroupSharingAuthorityAvailable(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): void {
  if (
    environment[HOSTED_GROUP_SHARING_AUTHORITY_MAINTENANCE_ENV]?.trim() !== "1"
  ) {
    return;
  }

  throw hostedOnboardingError({
    code: HOSTED_GROUP_SHARING_AUTHORITY_MAINTENANCE_CODE,
    httpStatus: 503,
    message: HOSTED_GROUP_SHARING_AUTHORITY_MAINTENANCE_MESSAGE,
    retryable: true,
  });
}
