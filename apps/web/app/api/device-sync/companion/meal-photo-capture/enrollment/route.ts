import {
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
  requireActivePrivyMemberAuthFromBearerToken,
  requirePrivyMemberAuthFromBearerToken,
} from "@/src/lib/hosted-onboarding/request-auth";
import { assertHostedLaunchRequiredConsentGranted } from "@/src/lib/legal/consent";
import { getPrisma } from "@/src/lib/prisma";

export const POST = withJsonError(async (request: Request) => {
  const prisma = getPrisma();
  const auth = await requireActivePrivyMemberAuthFromBearerToken(request, prisma);
  await assertHostedLaunchRequiredConsentGranted({
    memberId: auth.member.id,
    prisma,
  });
  const enrollmentRequest = parseMealPhotoCaptureEnrollmentRequest(
    await readOptionalJsonObject(request),
  );
  const enrollment = await issueMealPhotoCaptureEnrollment({
    memberId: auth.member.id,
    prisma,
    request: enrollmentRequest,
  });

  // Credential plaintext is response-only. Do not add request/response logging
  // or persist either returned value outside the hashed/encrypted store.
  return jsonOk(enrollment);
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
