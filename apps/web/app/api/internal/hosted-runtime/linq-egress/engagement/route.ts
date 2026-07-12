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
  recordHostedLinqRuntimeProviderDispatchFenceTx,
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
import {
  acquireHostedLinqChatOwnershipLockTx,
} from "@/src/lib/hosted-routing/linq-chat-ownership-lock";

const HOSTED_LINQ_EGRESS_ENGAGEMENT_BODY_LIMIT_BYTES = 8 * 1024;

export const POST = withJsonError(async (request: Request) => {
  const userId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: HOSTED_LINQ_EGRESS_ENGAGEMENT_BODY_LIMIT_BYTES,
  });
  const body = await readOptionalJsonObject(request);
  const routeAuthority = parseHostedLinqEgressRouteAuthority(body.routeAuthority);
  const currentInbound = parseHostedLinqLegacyCurrentInboundProof(body.currentInbound);
  const directRecipientPhoneNumber = readOptionalBodyString(
    body.directRecipientPhoneNumber,
  );
  const fromPhoneNumber = readOptionalBodyString(body.fromPhoneNumber);
  const idempotencyKey = readOptionalBodyString(body.idempotencyKey);
  const authorityCheckOnly = body.authorityCheckOnly === true;
  const intentId = readOptionalBodyString(body.intentId);
  const replyToMessageId = readOptionalBodyString(body.replyToMessageId);
  const target = readOptionalBodyString(body.target);
  const targetKind = readOptionalBodyString(body.targetKind);
  const providerDispatchIdempotencyKey = idempotencyKey
    ?? (currentInbound
      ? `legacy-current-inbound:${currentInbound.dedupeKey}`
      : null);
  const prisma = getPrisma();

  const assertion = await prisma.$transaction(async (tx) => {
    if (targetKind !== "participant" && target) {
      await acquireHostedLinqChatOwnershipLockTx({
        chatId: target,
        tx,
      });
    }

    const asserted = await assertHostedLinqRecentInboundEngagementForRuntime({
      currentInbound,
      directRecipientPhoneNumber,
      fromPhoneNumber,
      homeRouteFallbackAllowed: body.homeRouteFallbackAllowed === true,
      idempotencyKey,
      memberId: userId,
      prisma: tx,
      replyToMessageId,
      routeAuthority,
      target,
      targetKind,
    });
    const providerTarget = asserted.targetOverride?.target ?? target;
    const providerTargetKind = asserted.targetOverride?.targetKind ?? targetKind;
    if (
      providerTargetKind !== "participant"
      && providerTarget
      && providerTarget !== target
    ) {
      await acquireHostedLinqChatOwnershipLockTx({
        chatId: providerTarget,
        tx,
      });
      await assertHostedLinqRecentInboundEngagementForRuntime({
        currentInbound,
        directRecipientPhoneNumber,
        fromPhoneNumber,
        homeRouteFallbackAllowed: false,
        idempotencyKey,
        memberId: userId,
        prisma: tx,
        replyToMessageId,
        routeAuthority,
        target: providerTarget,
        targetKind: providerTargetKind,
      });
    }

    if (!authorityCheckOnly) {
      if (!providerDispatchIdempotencyKey) {
        throw hostedOnboardingError({
          code: "HOSTED_LINQ_PROVIDER_DISPATCH_IDEMPOTENCY_REQUIRED",
          httpStatus: 400,
          message: "Hosted Linq provider dispatch requires an idempotency key.",
          retryable: false,
        });
      }
      const claim = await recordHostedLinqRuntimeProviderDispatchFenceTx({
        idempotencyKey: providerDispatchIdempotencyKey,
        linqChatId: providerTargetKind === "participant" ? null : providerTarget,
        phoneNumber: fromPhoneNumber,
        prisma: tx,
        sourceRef: intentId ?? providerDispatchIdempotencyKey,
        targetKind: providerTargetKind,
      });
      if (!claim.claimed) {
        throw hostedOnboardingError({
          code: "HOSTED_LINQ_PROVIDER_DISPATCH_NOT_CLAIMED",
          httpStatus: 409,
          message: "Hosted Linq provider dispatch is already claimed.",
          retryable: false,
        });
      }
    }
    return asserted;
  });

  return jsonOk({
    ok: true,
    ...(assertion.targetOverride ? { targetOverride: assertion.targetOverride } : {}),
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

function parseHostedLinqEgressRouteAuthority(
  value: unknown,
): HostedExecutionLinqExternalThreadRouteAuthority | null {
  if (value === undefined || value === null) {
    return null;
  }
  const authority = parseHostedExecutionExternalThreadRouteAuthority(
    value,
    "Hosted Linq egress authority request route authority",
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
