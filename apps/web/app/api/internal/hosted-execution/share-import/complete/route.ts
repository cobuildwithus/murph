import { requireHostedCloudflareCallbackRequest } from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { jsonOk, readJsonObject, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { getPrisma } from "@/src/lib/prisma";
import { deleteHostedSharePackObject } from "@/src/lib/hosted-share/pack-store";
import {
  finalizeHostedShareAcceptance,
  normalizeOptionalString,
} from "@/src/lib/hosted-share/shared";

export const POST = withJsonError(async (request: Request) => {
  const memberId = await requireHostedCloudflareCallbackRequest(request);
  const body = await readJsonObject(request);
  const eventId = normalizeRequiredString(body.eventId, "eventId");
  const shareId = normalizeRequiredString(body.shareId, "shareId");
  const prisma = getPrisma();
  const finalization = await finalizeHostedShareAcceptance({
    eventId,
    memberId,
    prisma,
    shareId,
  });

  if (!finalization.shareFound) {
    throw hostedOnboardingError({
      code: "HOSTED_SHARE_NOT_FOUND",
      message: `Hosted share ${shareId} was not found.`,
      httpStatus: 404,
    });
  }

  if (finalization.sharePackOwnerMemberId) {
    try {
      await deleteHostedSharePackObject({
        ownerUserId: finalization.sharePackOwnerMemberId,
        shareId,
      });
    } catch (error) {
      throw new Error(
        `Hosted share ${shareId} pack cleanup failed after finalize callback ${eventId}.`,
        { cause: error },
      );
    }
  }

  return jsonOk({
    eventId,
    finalized: finalization.finalized,
    shareId,
  });
});

function normalizeRequiredString(value: unknown, field: string): string {
  const normalized = normalizeOptionalString(typeof value === "string" ? value : null);

  if (!normalized) {
    throw hostedOnboardingError({
      code: "HOSTED_EXECUTION_INVALID_CALLBACK",
      message: `${field} is required for hosted execution business outcome callbacks.`,
      httpStatus: 400,
    });
  }

  return normalized;
}
