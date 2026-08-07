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
  hasHostedLinqRuntimeProviderDispatchFenceTx,
  recordHostedLinqRuntimeProviderDispatchFenceTx,
  transitionHostedLinqRuntimeAppCardFallbackFenceTx,
} from "@/src/lib/hosted-onboarding/linq-delivery-store";
import {
  hostedOnboardingError,
} from "@/src/lib/hosted-onboarding/errors";
import {
  parseHostedLinqAppCardFallbackIdentity,
} from "@/src/lib/hosted-onboarding/linq-app-card-fallback";
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
  const providerDispatchPredecessorIdempotencyKey = readOptionalBodyString(
    body.providerDispatchPredecessorIdempotencyKey,
  );
  const replyToMessageId = readOptionalBodyString(body.replyToMessageId);
  const target = readOptionalBodyString(body.target);
  const targetKind = readOptionalBodyString(body.targetKind);
  assertHostedLinqAppCardFallbackTransitionRequest({
    authorityCheckOnly,
    idempotencyKey,
    intentId,
    providerDispatchPredecessorIdempotencyKey,
  });
  const prisma = getPrisma();

  const assertion = await prisma.$transaction(async (tx) => {
    const participantFallbackDispatch = targetKind === "participant"
      && providerDispatchPredecessorIdempotencyKey !== null;
    if (targetKind !== "participant" || participantFallbackDispatch) {
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
      fromPhoneNumber,
      homeRouteFallbackAllowed: body.homeRouteFallbackAllowed === true,
      idempotencyKey,
      memberId: userId,
      prisma: tx,
      replyToMessageId,
      target,
      targetKind,
    });
    const providerTarget = asserted.targetOverride?.target ?? target;
    const providerTargetKind = asserted.targetOverride?.targetKind ?? targetKind;
    if (asserted.routeDisposition) {
      return {
        assistantAskFallbackRequired: false,
        asserted,
        deliveryBlockCode: null,
        deliveryPosture: null,
        providerDispatchClaimed: null,
        providerDispatchStarted: false,
      };
    }
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

    const providerDispatchStarted =
      authorityCheckOnly && idempotencyKey
        ? await hasHostedLinqRuntimeProviderDispatchFenceTx({
            idempotencyKey,
            prisma: tx,
            sourceRef: intentId ?? idempotencyKey,
            targetKind: providerTargetKind,
          })
        : false;

    const health = await resolveHostedLinqEgressPolicyForRuntime({
      fromPhoneNumber,
      linePhoneNumberLookupKey:
        finalAuthority.linePhoneNumberLookupKey,
      prisma: tx,
      target: providerTarget,
      targetKind: providerTargetKind,
    });
    if (health.policy.kind === "block") {
      return {
        assistantAskFallbackRequired: false,
        asserted,
        deliveryBlockCode: health.policy.code,
        deliveryPosture: null,
        providerDispatchClaimed: null,
        providerDispatchStarted,
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
      const claim = providerDispatchPredecessorIdempotencyKey
        ? await transitionHostedLinqRuntimeAppCardFallbackFenceTx({
            fallbackIdempotencyKey: idempotencyKey,
            linqChatId: providerTargetKind === "participant"
              ? null
              : providerTarget,
            memberId: userId,
            participantPhoneNumber: providerTargetKind === "participant"
              ? providerTarget
              : null,
            phoneNumber: fromPhoneNumber,
            predecessorIdempotencyKey:
              providerDispatchPredecessorIdempotencyKey,
            prisma: tx,
            sourceRef: intentId ?? "",
            targetKind: providerTargetKind === "participant"
              ? "participant"
              : "thread",
          })
        : await recordHostedLinqRuntimeProviderDispatchFenceTx({
            idempotencyKey,
            linqChatId: providerTargetKind === "participant" ? null : providerTarget,
            phoneNumber: fromPhoneNumber,
            prisma: tx,
            sourceRef: intentId ?? idempotencyKey,
            targetKind: providerTargetKind,
          });
      if (!claim) {
        throw hostedOnboardingError({
          code: "HOSTED_LINQ_APP_CARD_FALLBACK_PREDECESSOR_INVALID",
          httpStatus: 409,
          message: "Hosted Linq app-card fallback predecessor is invalid.",
          retryable: false,
        });
      }
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
      asserted,
      deliveryBlockCode: null,
      deliveryPosture: health.policy.posture === "normal"
        ? null
        : health.policy.posture,
      providerDispatchClaimed,
      providerDispatchStarted,
    };
  });

  return jsonOk({
    ok: true,
    ...(assertion.assistantAskFallbackRequired
      ? { assistantAskFallbackRequired: true }
      : {}),
    threadIsDirect: assertion.asserted.threadIsDirect,
    ...(assertion.asserted.targetOverride
      ? { targetOverride: assertion.asserted.targetOverride }
      : {}),
    ...(assertion.asserted.routeDisposition
      ? { routeDisposition: assertion.asserted.routeDisposition }
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
    ...(assertion.providerDispatchStarted
      ? { providerDispatchStarted: true }
      : {}),
  });
});

function readOptionalBodyString(value: unknown): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized : null;
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

function assertHostedLinqAppCardFallbackTransitionRequest(input: {
  authorityCheckOnly: boolean;
  idempotencyKey: string | null;
  intentId: string | null;
  providerDispatchPredecessorIdempotencyKey: string | null;
}): void {
  const predecessor = input.providerDispatchPredecessorIdempotencyKey;
  if (!predecessor) {
    return;
  }
  if (
    input.authorityCheckOnly
    || !input.intentId
    || parseHostedLinqAppCardFallbackIdentity(input.idempotencyKey)
      ?.predecessorIdempotencyKey !== predecessor
  ) {
    throw hostedOnboardingError({
      code: "HOSTED_LINQ_APP_CARD_FALLBACK_TRANSITION_INVALID",
      httpStatus: 400,
      message: "Hosted Linq app-card fallback transition is invalid.",
      retryable: false,
    });
  }
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
