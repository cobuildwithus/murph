import type {
  HostedExecutionLinqExternalThreadRouteAuthority,
} from "@murphai/hosted-execution";
import {
  parseHostedExecutionExternalThreadRouteAuthority,
} from "@murphai/hosted-execution/parsers";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import {
  assertHostedLinqRecentInboundEngagementForRuntime,
} from "@/src/lib/hosted-onboarding/linq-egress-engagement";
import {
  hostedOnboardingError,
} from "@/src/lib/hosted-onboarding/errors";
import {
  jsonOk,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";
import { readOptionalJsonObject } from "@/src/lib/http";
import { getPrisma } from "@/src/lib/prisma";

const HOSTED_LINQ_EGRESS_ENGAGEMENT_BODY_LIMIT_BYTES = 8 * 1024;

export const POST = withJsonError(async (request: Request) => {
  const userId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: HOSTED_LINQ_EGRESS_ENGAGEMENT_BODY_LIMIT_BYTES,
  });
  const body = await readOptionalJsonObject(request);
  const routeAuthority = parseHostedLinqEgressRouteAuthority(body.routeAuthority);

  await assertHostedLinqRecentInboundEngagementForRuntime({
    currentInbound: parseHostedLinqLegacyCurrentInboundProof(body.currentInbound),
    directRecipientPhoneNumber: readOptionalBodyString(body.directRecipientPhoneNumber),
    engagementKind: parseHostedLinqEgressEngagementKind(body.engagementKind),
    fromPhoneNumber: readOptionalBodyString(body.fromPhoneNumber),
    idempotencyKey: readOptionalBodyString(body.idempotencyKey),
    memberId: userId,
    prisma: getPrisma(),
    routeAuthority,
    target: readOptionalBodyString(body.target),
    targetKind: readOptionalBodyString(body.targetKind),
  });

  return jsonOk({
    ok: true,
  });
});

function readOptionalBodyString(value: unknown): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized : null;
}

function parseHostedLinqLegacyCurrentInboundProof(value: unknown): {
  dedupeKey: string;
  eventId: string;
  mailboxItemId: string;
  occurredAt: string;
  replyToMessageId: string;
  target: string;
} | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throwHostedLinqCurrentInboundInvalid();
  }

  const record = value as Record<string, unknown>;
  const dedupeKey = readOptionalBodyString(record.dedupeKey);
  const eventId = readOptionalBodyString(record.eventId);
  const mailboxItemId = readOptionalBodyString(record.mailboxItemId);
  const occurredAt = readOptionalBodyString(record.occurredAt);
  const replyToMessageId = readOptionalBodyString(record.replyToMessageId);
  const target = readOptionalBodyString(record.target);
  if (
    !dedupeKey
    || !eventId
    || !mailboxItemId
    || !occurredAt
    || !replyToMessageId
    || !target
  ) {
    throwHostedLinqCurrentInboundInvalid();
  }

  return {
    dedupeKey,
    eventId,
    mailboxItemId,
    occurredAt,
    replyToMessageId,
    target,
  };
}

function throwHostedLinqCurrentInboundInvalid(): never {
  throw hostedOnboardingError({
    code: "HOSTED_LINQ_EGRESS_CURRENT_INBOUND_INVALID",
    httpStatus: 400,
    message: "Hosted Linq egress current inbound proof is invalid.",
    retryable: false,
  });
}

function parseHostedLinqEgressEngagementKind(
  value: unknown,
): "first_contact" | "requires_recent_inbound" | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (value === "first_contact" || value === "requires_recent_inbound") {
    return value;
  }
  throw hostedOnboardingError({
    code: "HOSTED_LINQ_EGRESS_ENGAGEMENT_KIND_INVALID",
    httpStatus: 400,
    message: "Hosted Linq egress engagement kind is invalid.",
    retryable: false,
  });
}

function parseHostedLinqEgressRouteAuthority(
  value: unknown,
): HostedExecutionLinqExternalThreadRouteAuthority | null {
  if (value === undefined || value === null) {
    return null;
  }
  const authority = parseHostedExecutionExternalThreadRouteAuthority(
    value,
    "Hosted Linq egress engagement request route authority",
  );
  if (authority.channel !== "linq") {
    throw hostedOnboardingError({
      code: "HOSTED_LINQ_EGRESS_ROUTE_AUTHORITY_MISMATCH",
      httpStatus: 403,
      message: "Linq egress route authority must be for a Linq thread.",
      retryable: false,
    });
  }

  return {
    ...authority,
    channel: "linq",
  };
}
