import {
  parseCompanionHrvRmssdObservationRequestBody,
} from "@/src/lib/device-sync/companion";
import { deviceSyncError } from "@murphai/device-syncd/errors";
import { createHostedDeviceSyncPublicIngressService } from "@/src/lib/device-sync/public-ingress-service";
import { jsonOk, withJsonError } from "@/src/lib/device-sync/settings-http";
import { readJsonObject } from "@/src/lib/http";
import { requireHostedCompanionMemberAuthFromBearerToken } from "@/src/lib/hosted-onboarding/request-auth";
import { assertHostedHistoricalLaunchConsentGranted } from "@/src/lib/legal/consent";
import { getPrisma } from "@/src/lib/prisma";

const COMPANION_HRV_REQUEST_BODY_LIMIT_BYTES = 512;

// Accepts only one compact on-device-derived overnight RMSSD summary. Raw RR
// intervals, per-window values, BLE frames, device identity, and packet
// timestamps are not part of this API.
export const POST = withJsonError(async (request: Request) => {
  const prisma = getPrisma();
  const auth = await requireHostedCompanionMemberAuthFromBearerToken(request, prisma);
  await assertHostedHistoricalLaunchConsentGranted({
    memberId: auth.member.id,
    prisma,
  });

  const acceptedAtDate = new Date();
  const observation = parseCompanionHrvRmssdObservationRequestBody(
    await readCompanionHrvRmssdBody(request),
  );
  const acceptedAt = acceptedAtDate.toISOString();
  const publicIngress = createHostedDeviceSyncPublicIngressService(request);
  await publicIngress.acceptCompanionHrvRmssdObservation({
    acceptedAt,
    observation,
    userId: auth.member.id,
  });

  return jsonOk({
    acceptedAt,
    nightDate: observation.nightDate,
    status: "accepted",
  }, 202);
});

async function readCompanionHrvRmssdBody(request: Request): Promise<Record<string, unknown>> {
  try {
    return await readJsonObject(request, {
      limitBytes: COMPANION_HRV_REQUEST_BODY_LIMIT_BYTES,
    });
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw deviceSyncError({
        code: "COMPANION_REQUEST_INVALID",
        httpStatus: 400,
        message: "Companion HRV RMSSD observation must be valid JSON.",
        retryable: false,
      });
    }
    throw error;
  }
}
