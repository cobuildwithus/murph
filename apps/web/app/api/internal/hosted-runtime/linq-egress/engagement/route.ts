import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import {
  assertHostedAssistantAskCompletionDeliveryAuthorityTx,
} from "@/src/lib/hosted-groups/group-assistant-ask";
import {
  assertHostedLinqRecentInboundEngagementForRuntime,
  resolveHostedLinqEgressPolicyForRuntime,
} from "@/src/lib/hosted-onboarding/linq-egress-engagement";
import {
  recordHostedLinqRuntimeProviderDispatchFenceTx,
} from "@/src/lib/hosted-onboarding/linq-delivery-store";
import {
  hostedOnboardingError,
} from "@/src/lib/hosted-onboarding/errors";
import {
  acquireHostedMemberHomeLinqRouteLockTx,
} from "@/src/lib/hosted-onboarding/hosted-member-routing-store";
import {
  jsonOk,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";
import { readOptionalJsonObject } from "@/src/lib/http";
import { getPrisma } from "@/src/lib/prisma";
import {
  acquireHostedLinqChatOwnershipLockTx,
} from "@/src/lib/hosted-routing/linq-chat-ownership-lock";
import type {
  HostedExecutionResolvedLinqDeliveryRoute,
} from "@murphai/hosted-execution/contracts";

const HOSTED_LINQ_EGRESS_ENGAGEMENT_BODY_LIMIT_BYTES = 8 * 1024;
const HOSTED_LINQ_ENGAGEMENT_ANSWERED_MAILBOX_ITEM_ID_LIMIT = 100;

export const POST = withJsonError(async (request: Request) => {
  const userId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: HOSTED_LINQ_EGRESS_ENGAGEMENT_BODY_LIMIT_BYTES,
  });
  const body = await readOptionalJsonObject(request);
  const answeredMailboxItemIds = parseAnsweredMailboxItemIds(
    body.answeredMailboxItemIds,
  );
  const assistantAskCompletionExpiresAt =
    parseOptionalAssistantAskCompletionExpiresAt(
      body.assistantAskCompletionExpiresAt,
    );
  const assistantAskFallback = parseOptionalAssistantAskFallback(
    body.assistantAskFallback,
  );
  const authorityCheckOnly = parseRequiredAuthorityCheckOnly(
    body.authorityCheckOnly,
  );
  const directRecipientPhoneNumber = readOptionalBodyString(
    body.directRecipientPhoneNumber,
  );
  const fromPhoneNumber = readOptionalBodyString(body.fromPhoneNumber);
  const idempotencyKey = readOptionalBodyString(body.idempotencyKey);
  const intentId = readOptionalBodyString(body.intentId);
  const expectedResolvedRoute = parseOptionalResolvedLinqDeliveryRoute(
    body.expectedResolvedRoute,
  );
  const replyToMessageId = readOptionalBodyString(body.replyToMessageId);
  const target = readOptionalBodyString(body.target);
  const targetKind = readOptionalBodyString(body.targetKind);
  const prisma = getPrisma();

  const assertion = await prisma.$transaction(async (tx) => {
    if (targetKind !== "participant") {
      await acquireHostedMemberHomeLinqRouteLockTx({
        memberId: userId,
        prisma: tx,
      });
    }
    if (targetKind !== "participant" && target) {
      await acquireHostedLinqChatOwnershipLockTx({
        chatId: target,
        tx,
      });
    }

    const asserted = await assertHostedLinqRecentInboundEngagementForRuntime({
      answeredMailboxItemIds,
      authorityCheckOnly,
      directRecipientPhoneNumber,
      expectedResolvedRoute,
      fromPhoneNumber,
      homeRouteFallbackAllowed: body.homeRouteFallbackAllowed === true,
      idempotencyKey,
      memberId: userId,
      prisma: tx,
      replyToMessageId,
      target,
      targetKind,
    });
    const providerTarget = asserted.resolvedRoute.target;
    const providerTargetKind = asserted.resolvedRoute.targetKind;
    let finalAuthority = asserted;
    if (
      providerTargetKind !== "participant"
      && providerTarget
      && providerTarget !== target
    ) {
      await acquireHostedLinqChatOwnershipLockTx({
        chatId: providerTarget,
        tx,
      });
      finalAuthority =
        await assertHostedLinqRecentInboundEngagementForRuntime({
          answeredMailboxItemIds,
          authorityCheckOnly,
          directRecipientPhoneNumber,
          expectedResolvedRoute: asserted.resolvedRoute,
          fromPhoneNumber,
          homeRouteFallbackAllowed: false,
          idempotencyKey,
          memberId: userId,
          prisma: tx,
          replyToMessageId,
          target: providerTarget,
          targetKind: providerTargetKind,
        });
    }

    if (
      expectedResolvedRoute
      && !resolvedLinqDeliveryRoutesEqual(
        finalAuthority.resolvedRoute,
        expectedResolvedRoute,
      )
    ) {
      throw hostedOnboardingError({
        code: "HOSTED_LINQ_EGRESS_RESOLVED_ROUTE_MISMATCH",
        httpStatus: 403,
        message: "Hosted Linq send-time route authority changed before provider entry.",
        retryable: false,
      });
    }

    const health = await resolveHostedLinqEgressPolicyForRuntime({
      fromPhoneNumber: finalAuthority.resolvedRoute.fromPhoneNumber,
      linePhoneNumberLookupKey:
        finalAuthority.linePhoneNumberLookupKey,
      prisma: tx,
      target: finalAuthority.resolvedRoute.target,
      targetKind: finalAuthority.resolvedRoute.targetKind,
    });
    if (health.policy.kind === "block") {
      return {
        assistantAskFallbackRequired: false,
        asserted: finalAuthority,
        deliveryBlockCode: health.policy.code,
        deliveryPosture: null,
        providerDispatchClaimed: null,
      };
    }

    const assistantAskAuthority =
      await assertHostedAssistantAskCompletionDeliveryAuthorityTx({
        answeredMailboxItemIds,
        assistantAskCompletionExpiresAt,
        assistantAskFallback,
        boundRuntimeMemberId: userId,
        idempotencyKey,
        tx,
      });

    let providerDispatchClaimed: boolean | null = null;
    if (
      !authorityCheckOnly
      && assistantAskAuthority?.assistantAskFallbackRequired !== true
    ) {
      if (!idempotencyKey) {
        throw hostedOnboardingError({
          code: "HOSTED_LINQ_PROVIDER_DISPATCH_IDEMPOTENCY_REQUIRED",
          httpStatus: 400,
          message: "Hosted Linq provider dispatch requires an idempotency key.",
          retryable: false,
        });
      }
      const claim = await recordHostedLinqRuntimeProviderDispatchFenceTx({
        idempotencyKey,
        linqChatId: finalAuthority.resolvedRoute.targetKind === "participant"
          ? null
          : finalAuthority.resolvedRoute.target,
        phoneNumber: finalAuthority.resolvedRoute.fromPhoneNumber,
        prisma: tx,
        sourceRef: intentId ?? idempotencyKey,
        targetKind: finalAuthority.resolvedRoute.targetKind,
      });
      if (!claim.claimed) {
        throw hostedOnboardingError({
          code: "HOSTED_LINQ_PROVIDER_DISPATCH_ALREADY_STARTED",
          httpStatus: 409,
          message: "Hosted Linq provider dispatch is already started.",
          retryable: false,
        });
      }
      providerDispatchClaimed = claim.claimed;
    }
    return {
      assistantAskFallbackRequired:
        assistantAskAuthority?.assistantAskFallbackRequired === true,
      asserted: finalAuthority,
      deliveryBlockCode: null,
      deliveryPosture: health.policy.posture === "normal"
        ? null
        : health.policy.posture,
      providerDispatchClaimed,
    };
  });

  const resolvedRoute = assertion.asserted.resolvedRoute;
  return jsonOk({
    ok: true,
    ...(assertion.assistantAskFallbackRequired
      ? { assistantAskFallbackRequired: true }
      : {}),
    resolvedRoute,
    // Keep the pre-canonical-route response shape during the Web-first rollout.
    // The old runtime ignores `resolvedRoute`; the new runtime ignores these
    // legacy fields and requires the complete route above.
    threadIsDirect: resolvedRoute.threadIsDirect,
    ...(resolvedRoute.targetKind === "thread" && resolvedRoute.target !== target
      ? {
          targetOverride: {
            ...(resolvedRoute.conversationThreadId
              ? { conversationThreadId: resolvedRoute.conversationThreadId }
              : {}),
            target: resolvedRoute.target,
            targetKind: resolvedRoute.targetKind,
          },
        }
      : {}),
    ...(assertion.deliveryBlockCode
      ? { deliveryBlockCode: assertion.deliveryBlockCode }
      : {}),
    ...(assertion.deliveryPosture
      ? { deliveryPosture: assertion.deliveryPosture }
      : {}),
    ...(assertion.providerDispatchClaimed === null
      ? {}
      : { providerDispatchClaimed: assertion.providerDispatchClaimed }),
  });
});

function readOptionalBodyString(value: unknown): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized : null;
}

function parseOptionalResolvedLinqDeliveryRoute(
  value: unknown,
): HostedExecutionResolvedLinqDeliveryRoute | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throwResolvedLinqDeliveryRouteInvalid();
  }
  const record = value as Record<string, unknown>;
  const target = readOptionalBodyString(record.target);
  const targetKind = readOptionalBodyString(record.targetKind);
  const conversationThreadId = readRequiredNullableBodyString(
    record,
    "conversationThreadId",
  );
  const directRecipientPhoneNumber = readRequiredNullableBodyString(
    record,
    "directRecipientPhoneNumber",
  );
  const fromPhoneNumber = readRequiredNullableBodyString(
    record,
    "fromPhoneNumber",
  );
  if (
    !target
    || (targetKind !== "participant" && targetKind !== "thread")
    || conversationThreadId === undefined
    || directRecipientPhoneNumber === undefined
    || fromPhoneNumber === undefined
    || typeof record.threadIsDirect !== "boolean"
  ) {
    throwResolvedLinqDeliveryRouteInvalid();
  }
  return {
    conversationThreadId,
    directRecipientPhoneNumber,
    fromPhoneNumber,
    target,
    targetKind,
    threadIsDirect: record.threadIsDirect,
  };
}

function readRequiredNullableBodyString(
  record: Record<string, unknown>,
  field: string,
): string | null | undefined {
  if (!(field in record)) {
    return undefined;
  }
  const value = record[field];
  if (value === null) {
    return null;
  }
  const normalized = readOptionalBodyString(value);
  return normalized ?? undefined;
}

function throwResolvedLinqDeliveryRouteInvalid(): never {
  throw hostedOnboardingError({
    code: "HOSTED_LINQ_EGRESS_RESOLVED_ROUTE_INVALID",
    httpStatus: 400,
    message: "Hosted Linq expected resolved route is invalid.",
    retryable: false,
  });
}

function resolvedLinqDeliveryRoutesEqual(
  left: HostedExecutionResolvedLinqDeliveryRoute,
  right: HostedExecutionResolvedLinqDeliveryRoute,
): boolean {
  return left.conversationThreadId === right.conversationThreadId
    && left.directRecipientPhoneNumber === right.directRecipientPhoneNumber
    && left.fromPhoneNumber === right.fromPhoneNumber
    && left.target === right.target
    && left.targetKind === right.targetKind
    && left.threadIsDirect === right.threadIsDirect;
}

function parseRequiredAuthorityCheckOnly(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  throw hostedOnboardingError({
    code: "HOSTED_LINQ_EGRESS_AUTHORITY_CHECK_ONLY_INVALID",
    httpStatus: 400,
    message: "Hosted Linq egress authorityCheckOnly must be a boolean.",
    retryable: false,
  });
}

function parseOptionalAssistantAskFallback(
  value: unknown,
): boolean | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "boolean") {
    return value;
  }
  throw hostedOnboardingError({
    code: "HOSTED_LINQ_EGRESS_ASSISTANT_ASK_FALLBACK_INVALID",
    httpStatus: 400,
    message: "Hosted Linq egress Assistant Ask fallback must be a boolean.",
    retryable: false,
  });
}

function parseOptionalAssistantAskCompletionExpiresAt(
  value: unknown,
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const normalized = typeof value === "string" ? value.trim() : "";
  const parsed = Date.parse(normalized);
  if (
    normalized
    && Number.isFinite(parsed)
    && new Date(parsed).toISOString() === normalized
  ) {
    return normalized;
  }
  throw hostedOnboardingError({
    code: "HOSTED_LINQ_EGRESS_ASSISTANT_ASK_COMPLETION_EXPIRY_INVALID",
    httpStatus: 400,
    message: "Hosted Linq egress Assistant Ask completion expiry must be a canonical timestamp.",
    retryable: false,
  });
}

function parseAnsweredMailboxItemIds(value: unknown): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw hostedOnboardingError({
      code: "HOSTED_LINQ_ENGAGEMENT_ANSWERED_MAILBOX_ITEM_IDS_INVALID",
      httpStatus: 400,
      message: "Hosted Linq engagement answered mailbox item ids must be an array.",
      retryable: false,
    });
  }

  const itemIds: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const itemId = readOptionalBodyString(entry);
    if (!itemId) {
      throw hostedOnboardingError({
        code: "HOSTED_LINQ_ENGAGEMENT_ANSWERED_MAILBOX_ITEM_ID_INVALID",
        httpStatus: 400,
        message: "Hosted Linq engagement answered mailbox item id is invalid.",
        retryable: false,
      });
    }
    if (seen.has(itemId)) {
      continue;
    }
    seen.add(itemId);
    itemIds.push(itemId);
    if (itemIds.length > HOSTED_LINQ_ENGAGEMENT_ANSWERED_MAILBOX_ITEM_ID_LIMIT) {
      throw hostedOnboardingError({
        code: "HOSTED_LINQ_ENGAGEMENT_ANSWERED_MAILBOX_ITEM_IDS_TOO_MANY",
        httpStatus: 400,
        message: "Hosted Linq engagement answered mailbox item ids are too many.",
        retryable: false,
      });
    }
  }

  return itemIds;
}
