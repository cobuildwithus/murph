import "server-only";

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

// Enable only after all live readers enforce the new credential owner. Turning
// this off pauses enrollment; it never disables verification of enrolled keys.
export function isApprovalPasskeyEnrollmentEnabled(): boolean {
  return process.env.HOSTED_APPROVAL_PASSKEY_ENROLLMENT_ENABLED === "true";
}

export function requireApprovalPasskeyEnrollmentEnabled(): void {
  if (!isApprovalPasskeyEnrollmentEnabled()) {
    throw hostedOnboardingError({
      code: "APPROVAL_PASSKEY_ENROLLMENT_UNAVAILABLE",
      httpStatus: 503,
      message: "Passkey updates are not available yet. Your current setup is unchanged.",
    });
  }
}
