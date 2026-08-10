import {
  activateMealPhotoCaptureEnrollmentForScopedToken,
  assertMealPhotoCaptureRequestHasNoBody,
  isMealPhotoCaptureScopedAuthorization,
  issueMealPhotoCaptureEnrollment,
  parseMealPhotoCaptureEnrollmentRequest,
  parseMealPhotoCaptureRevocationRequest,
  requireMealPhotoCaptureScopedToken,
  revokeMealPhotoCaptureEnrollmentForMember,
  revokeMealPhotoCaptureEnrollmentForScopedToken,
} from "@/src/lib/device-sync/meal-photo-capture";
import { jsonOk, withJsonError } from "@/src/lib/device-sync/settings-http";
import { readOptionalJsonObject } from "@/src/lib/http";
import {
  hostedOnboardingError,
  isHostedOnboardingError,
} from "@/src/lib/hosted-onboarding/errors";
import {
  requireActivePrivyMemberAuthFromBearerToken,
  requirePrivyMemberAuthFromBearerToken,
} from "@/src/lib/hosted-onboarding/request-auth";
import {
  readCurrentHostedMemberDirectRoute,
} from "@/src/lib/hosted-routing/member-direct-route";
import { assertHostedHistoricalLaunchConsentGranted } from "@/src/lib/legal/consent";
import { getPrisma } from "@/src/lib/prisma";

export const POST = withJsonError(async (request: Request) => {
  return withMealPhotoCapturePaidAccessBoundary(async () => {
    const prisma = getPrisma();
    const auth = await requireActivePrivyMemberAuthFromBearerToken(request, prisma);
    await assertHostedHistoricalLaunchConsentGranted({
      memberId: auth.member.id,
      prisma,
    });
    const enrollmentRequest = parseMealPhotoCaptureEnrollmentRequest(
      await readOptionalJsonObject(request),
    );
    const directRoute = await readCurrentHostedMemberDirectRoute({
      memberId: auth.member.id,
      prisma,
    });
    if (!directRoute) {
      throw hostedOnboardingError({
        code: "MEAL_PHOTO_CAPTURE_DIRECT_ROUTE_REQUIRED",
        httpStatus: 409,
        message:
          "Connect iMessage, Telegram, or a verified email before retrying meal capture setup.",
        retryable: false,
      });
    }
    const enrollment = await issueMealPhotoCaptureEnrollment({
      memberId: auth.member.id,
      prisma,
      request: enrollmentRequest,
    });

    // Credential plaintext is response-only. Do not add request/response logging
    // or persist either returned value outside the hashed/encrypted store.
    return jsonOk(enrollment);
  });
});

export const DELETE = withJsonError(async (request: Request) => {
  const prisma = getPrisma();
  if (isMealPhotoCaptureScopedAuthorization(request)) {
    await assertMealPhotoCaptureRequestHasNoBody(request);
    const result = await revokeMealPhotoCaptureEnrollmentForScopedToken({
      prisma,
      token: requireMealPhotoCaptureScopedToken(request),
    });
    return jsonOk(result);
  }

  // Revocation reduces authority, so it intentionally remains available when
  // billing or launch consent is inactive. Identity verification and member
  // ownership are still required.
  const auth = await requirePrivyMemberAuthFromBearerToken(request, prisma);
  const revocationRequest = parseMealPhotoCaptureRevocationRequest(
    await readOptionalJsonObject(request),
  );
  return jsonOk(await revokeMealPhotoCaptureEnrollmentForMember({
    memberId: auth.member.id,
    prisma,
    request: revocationRequest,
  }));
});

export const PUT = withJsonError(async (request: Request) => {
  return withMealPhotoCapturePaidAccessBoundary(async () => {
    const prisma = getPrisma();
    await assertMealPhotoCaptureRequestHasNoBody(request);
    return jsonOk(await activateMealPhotoCaptureEnrollmentForScopedToken({
      prisma,
      token: requireMealPhotoCaptureScopedToken(request),
    }));
  });
});

async function withMealPhotoCapturePaidAccessBoundary<T>(
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (isHostedOnboardingError(error) && error.code === "HOSTED_ACCESS_REQUIRED") {
      throw hostedOnboardingError({
        code: "MEAL_PHOTO_CAPTURE_ACTIVE_ACCESS_REQUIRED",
        httpStatus: 409,
        message: "Active Murph access is required for automatic meal capture.",
      });
    }
    throw error;
  }
}
