import { requireHostedCloudflareCallbackRequest } from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { jsonOk, readJsonObject, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { getPrisma } from "@/src/lib/prisma";
import {
  normalizeOptionalString,
  releaseHostedShareAcceptance,
} from "@/src/lib/hosted-share/shared";

export const POST = withJsonError(async (request: Request) => {
  const memberId = await requireHostedCloudflareCallbackRequest(request);
  const body = await readJsonObject(request);
  const eventId = normalizeRequiredString(body.eventId, "eventId");
  const shareId = normalizeRequiredString(body.shareId, "shareId");
  const reason = normalizeOptionalString(typeof body.reason === "string" ? body.reason : null);
  const prisma = getPrisma();

  const released = await releaseHostedShareAcceptance({
    eventId,
    memberId,
    prisma,
    shareId,
  });

  return jsonOk({
    eventId,
    released,
    ...(reason ? { reason } : {}),
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
