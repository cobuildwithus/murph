import {
  COMPANION_ADMISSION_BODY_LIMIT_BYTES,
  parseCompanionAdmissionV1RequestBody,
  type CompanionAdmissionV1Response,
} from "@/src/lib/device-sync/companion";
import { jsonOk, withJsonError } from "@/src/lib/device-sync/settings-http";
import { readOptionalJsonObject } from "@/src/lib/http";
import {
  requireHostedCompanionMemberIdFromRequest,
} from "@/src/lib/hosted-onboarding/companion-member-access";
import {
  hostedOnboardingError,
  isHostedOnboardingError,
} from "@/src/lib/hosted-onboarding/errors";
import {
  readHostedSignupTimeZoneFromHeaders,
} from "@/src/lib/hosted-onboarding/time-zone-hint";
import { getPrisma } from "@/src/lib/prisma";

// Admission is intentionally separate from the sign-in-token route. It
// resolves the canonical hosted member and access state without importing or
// invoking device-sync public ingress, so signing in cannot create, resume, or
// reactivate a Junction connection.
export const POST = withJsonError(async (request: Request) => {
  const admission = parseCompanionAdmissionV1RequestBody(
    await readOptionalJsonObject(request, {
      limitBytes: COMPANION_ADMISSION_BODY_LIMIT_BYTES,
    }),
  );
  const timeZone = admission.timeZone
    ?? readHostedSignupTimeZoneFromHeaders(request.headers);

  try {
    await requireHostedCompanionMemberIdFromRequest({
      prisma: getPrisma(),
      request,
      ...(timeZone ? { timeZone } : {}),
    });
  } catch (error) {
    throw normalizeCompanionAdmissionError(error);
  }

  return jsonOk({ ok: true } satisfies CompanionAdmissionV1Response);
});

const COMPANION_ADMISSION_ACCESS_RECOVERY_CODES = new Set([
  "HOSTED_STARTER_USAGE_ENROLLMENT_BLOCKED",
]);
const COMPANION_ADMISSION_PUBLIC_RECOVERY_CODES = new Set([
  "AUTH_REQUIRED",
  "HOSTED_ACCESS_REQUIRED",
  "HOSTED_CONSENT_REQUIRED",
  "HOSTED_MEMBER_SUSPENDED",
  "PRIVY_IDENTITY_CONFLICT",
  "PRIVY_USER_MISMATCH",
]);

function normalizeCompanionAdmissionError(error: unknown): unknown {
  if (!isHostedOnboardingError(error)) {
    return error;
  }

  if (
    error.code === "PRIVY_ACCOUNT_REQUIRED"
    || error.code === "PRIVY_AUTH_FAILED"
  ) {
    return hostedOnboardingError({
      code: "AUTH_REQUIRED",
      httpStatus: 401,
      message: "Sign in to continue.",
    });
  }

  if (COMPANION_ADMISSION_ACCESS_RECOVERY_CODES.has(error.code)) {
    return hostedOnboardingError({
      code: "HOSTED_ACCESS_REQUIRED",
      httpStatus: 403,
      message: "Active hosted access is required to continue.",
    });
  }

  if (COMPANION_ADMISSION_PUBLIC_RECOVERY_CODES.has(error.code)) {
    return error;
  }

  if (error.retryable) {
    return hostedOnboardingError({
      cause: error,
      code: "COMPANION_ADMISSION_RETRYABLE",
      httpStatus: 503,
      message: "Murph account setup is temporarily unavailable. Try again.",
      retryable: true,
    });
  }

  return hostedOnboardingError({
    cause: error,
    code: "COMPANION_ADMISSION_SUPPORT_REQUIRED",
    httpStatus: 409,
    message: "Contact support to finish setting up this Murph account.",
  });
}
