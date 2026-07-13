import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import {
  buildHostedAiUsageDeniedResponseIdempotencyKey,
  markHostedAiUsageDeniedResponseDispatchStartedTx,
} from "@/src/lib/hosted-onboarding/linq-delivery-store";
import {
  hostedOnboardingError,
} from "@/src/lib/hosted-onboarding/errors";
import {
  jsonOk,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";
import { readOptionalJsonObject } from "@/src/lib/http";
import { getPrisma } from "@/src/lib/prisma";

const HOSTED_USAGE_NOTICE_PROVIDER_ENTRY_BODY_LIMIT_BYTES = 4 * 1024;

export const POST = withJsonError(async (request: Request) => {
  const userId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: HOSTED_USAGE_NOTICE_PROVIDER_ENTRY_BODY_LIMIT_BYTES,
  });
  const body = await readOptionalJsonObject(request);
  const attemptedAt = parseCanonicalDate(
    body.attemptedAt,
    "Hosted usage notice provider entry attemptedAt",
  );
  const sourceEventId = requireBodyString(
    body.sourceEventId,
    "Hosted usage notice provider entry sourceEventId",
  );
  const idempotencyKey = buildHostedAiUsageDeniedResponseIdempotencyKey({
    memberId: userId,
    sourceEventId,
  });
  const claimed = await markHostedAiUsageDeniedResponseDispatchStartedTx({
    expectedAttemptedAt: attemptedAt,
    idempotencyKey,
    prisma: getPrisma(),
  });
  if (!claimed) {
    throw hostedOnboardingError({
      code: "HOSTED_USAGE_NOTICE_PROVIDER_DISPATCH_ALREADY_STARTED",
      httpStatus: 409,
      message: "Hosted usage notice provider dispatch is already started.",
      retryable: false,
    });
  }

  return jsonOk({
    ok: true,
    providerDispatchClaimed: true,
  });
});

function requireBodyString(value: unknown, label: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    throw hostedOnboardingError({
      code: "HOSTED_USAGE_NOTICE_PROVIDER_ENTRY_INVALID",
      httpStatus: 400,
      message: `${label} is required.`,
      retryable: false,
    });
  }
  return normalized;
}

function parseCanonicalDate(value: unknown, label: string): Date {
  const normalized = requireBodyString(value, label);
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== normalized) {
    throw hostedOnboardingError({
      code: "HOSTED_USAGE_NOTICE_PROVIDER_ENTRY_INVALID",
      httpStatus: 400,
      message: `${label} must be a canonical ISO timestamp.`,
      retryable: false,
    });
  }
  return parsed;
}
