import "server-only";

import { companionMeasurementRequestSchema } from "@murphai/contracts";
import { assertBrowserVaultMemberAuthority } from "../browser-vault/authority";
import { hostedOnboardingError, isHostedOnboardingError } from "../hosted-onboarding/errors";
import { readHostedOnboardingJsonObject } from "../hosted-onboarding/http";
import { requireActiveHostedMemberAuthFromBearerToken } from "../hosted-onboarding/request-auth";
import { getPrisma } from "../prisma";
import { submitCompanionMemberAction } from "./companion-member-actions";

function measurementError(code: string, httpStatus: number, message: string) {
  return hostedOnboardingError({ code, httpStatus, message, retryable: httpStatus === 503 });
}

export async function queueCompanionMeasurement(request: Request) {
  const prisma = getPrisma();
  const auth = await requireActiveHostedMemberAuthFromBearerToken(request, prisma);
  await assertBrowserVaultMemberAuthority({ memberId: auth.member.id, prisma });
  const body = await readHostedOnboardingJsonObject(request, {
    limitBytes: 1024, tooLargeErrorCode: "MEASUREMENT_INVALID_REQUEST",
    tooLargeErrorMessage: "The measurement request is too large.",
  });
  const parsed = companionMeasurementRequestSchema.safeParse(body);
  if (!parsed.success || new URL(request.url).searchParams.size !== 0
    || Date.parse(parsed.data.requestedAt) > Date.now() + 24 * 60 * 60 * 1000) {
    throw measurementError("MEASUREMENT_INVALID_REQUEST", 400, "Supply a stable action identity, timestamp and supported measurement within its range.");
  }
  const { actionId, requestedAt, metric, value } = parsed.data;
  try {
    return await submitCompanionMemberAction({
      auth, prisma,
      request: { actionId, requestedAt, schemaVersion: 1, action: { kind: "measurement.add", version: 1, metric, value } },
    });
  } catch (error) {
    if (isHostedOnboardingError(error) && [401, 403, 409].includes(error.httpStatus)) throw error;
    throw measurementError("MEASUREMENT_SAVE_UNAVAILABLE", 503, "Saving this reading is temporarily unavailable.");
  }
}
