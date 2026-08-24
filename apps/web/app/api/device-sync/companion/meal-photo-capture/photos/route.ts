import {
  assertCurrentMealPhotoCaptureEnrollmentTx,
  readAndValidateMealPhotoUpload,
  requireActiveMealPhotoCaptureEnrollment,
} from "@/src/lib/device-sync/meal-photo-capture";
import { ingestCompanionMealPhoto } from "@/src/lib/device-sync/meal-photo-ingestion";
import { jsonOk, withJsonError } from "@/src/lib/device-sync/settings-http";
import { getPrisma } from "@/src/lib/prisma";

export const POST = withJsonError(async (request: Request) => {
  const prisma = getPrisma();
  const enrollment = await requireActiveMealPhotoCaptureEnrollment({
    prisma,
    request,
  });
  const upload = await readAndValidateMealPhotoUpload(request);
  const eventId = `meal-photo:${enrollment.enrollmentId}:${upload.captureId}`;
  return jsonOk(await ingestCompanionMealPhoto({
    assertCurrentAuthorityTx: async (tx) => await assertCurrentMealPhotoCaptureEnrollmentTx({
      enrollment,
      prisma: tx,
      request,
    }),
    directRouteRequiredMessage:
      "Connect iMessage, Telegram, or a verified email before retrying meal capture.",
    eventId,
    memberId: enrollment.memberId,
    prisma,
    upload,
  }), 202);
});
