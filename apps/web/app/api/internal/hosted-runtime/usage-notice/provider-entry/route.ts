import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import {
  buildHostedAiUsageDeniedResponseIdempotencyKey,
} from "@/src/lib/hosted-onboarding/linq-delivery-store";
import {
  claimHostedUsageNoticeProviderEntry,
  type HostedUsageNoticeProviderEntryAuthority,
} from "@/src/lib/hosted-execution/usage-notice-provider-entry";
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
  const authority = parseProviderEntryAuthority(body);
  const result = await claimHostedUsageNoticeProviderEntry({
    attemptedAt,
    authority,
    idempotencyKey,
    memberId: userId,
    prisma: getPrisma(),
    sourceEventId,
  });
  if (result === "authority_superseded") {
    throw hostedOnboardingError({
      code: "HOSTED_USAGE_NOTICE_PROVIDER_AUTHORITY_SUPERSEDED",
      httpStatus: 410,
      message: "Hosted usage notice provider authority is no longer current.",
      retryable: false,
    });
  }
  if (result === "dispatch_already_started") {
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

function parseProviderEntryAuthority(
  body: Record<string, unknown>,
): HostedUsageNoticeProviderEntryAuthority {
  const channel = requireBodyString(
    body.channel,
    "Hosted usage notice provider entry channel",
  );
  const target = requireBodyString(
    body.target,
    "Hosted usage notice provider entry target",
  );
  if (channel === "telegram" || channel === "whatsapp") {
    return { channel, target };
  }
  if (channel !== "email") {
    throw hostedOnboardingError({
      code: "HOSTED_USAGE_NOTICE_PROVIDER_ENTRY_INVALID",
      httpStatus: 400,
      message: "Hosted usage notice provider entry channel is invalid.",
      retryable: false,
    });
  }
  const targetKind = requireBodyString(
    body.targetKind,
    "Hosted usage notice provider entry targetKind",
  );
  if (targetKind !== "explicit" && targetKind !== "thread") {
    throw hostedOnboardingError({
      code: "HOSTED_USAGE_NOTICE_PROVIDER_ENTRY_INVALID",
      httpStatus: 400,
      message: "Hosted usage notice provider entry targetKind is invalid.",
      retryable: false,
    });
  }
  return { channel, target, targetKind };
}

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
