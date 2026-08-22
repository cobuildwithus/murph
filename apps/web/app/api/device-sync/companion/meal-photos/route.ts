import {
  assertCurrentManualMealPhotoUploadAuthorityTx,
  readAndValidateManualMealPhotoUpload,
} from "@/src/lib/device-sync/meal-photo-capture";
import { ingestCompanionMealPhoto } from "@/src/lib/device-sync/meal-photo-ingestion";
import { jsonOk, withJsonError } from "@/src/lib/device-sync/settings-http";
import {
  requireActivePrivyMemberAuthFromBearerToken,
} from "@/src/lib/hosted-onboarding/request-auth";
import { assertHostedHistoricalLaunchConsentGranted } from "@/src/lib/legal/consent";
import { getPrisma } from "@/src/lib/prisma";

export const POST = withJsonError(async (request: Request) => {
  const prisma = getPrisma();
  const auth = await requireActivePrivyMemberAuthFromBearerToken(request, prisma);
  await assertHostedHistoricalLaunchConsentGranted({
    memberId: auth.member.id,
    prisma,
  });
  const upload = await readAndValidateManualMealPhotoUpload({
    memberId: auth.member.id,
    request,
  });

  return jsonOk(await ingestCompanionMealPhoto({
    assertCurrentAuthorityTx: async (tx) =>
      await assertCurrentManualMealPhotoUploadAuthorityTx({
        identityUserId: auth.identity.userId,
        memberId: auth.member.id,
        prisma: tx,
      }),
    directRouteRequiredMessage:
      "Connect iMessage, Telegram, or a verified email before sending a meal photo.",
    eventId: `meal-photo:manual:${upload.captureId}`,
    memberId: auth.member.id,
    prisma,
    upload,
  }), 202);
});
