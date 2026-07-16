import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import {
  assertHostedAssistantAskCompletionDeliveryAuthorityTx,
} from "@/src/lib/hosted-groups/group-assistant-ask";
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
  const authorityCheckOnly = parseRequiredAuthorityCheckOnly(
    body.authorityCheckOnly,
  );
  const directRecipientPhoneNumber = readOptionalBodyString(
    body.directRecipientPhoneNumber,
  );
  const fromPhoneNumber = readOptionalBodyString(body.fromPhoneNumber);
  const idempotencyKey = readOptionalBodyString(body.idempotencyKey);
  const intentId = readOptionalBodyString(body.intentId);
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

    await assertHostedAssistantAskCompletionDeliveryAuthorityTx({
      answeredMailboxItemIds,
      boundRuntimeMemberId: userId,
      idempotencyKey,
      tx,
    });

    let providerDispatchClaimed: boolean | null = null;
    if (!authorityCheckOnly) {
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
        linqChatId: providerTargetKind === "participant" ? null : providerTarget,
        phoneNumber: fromPhoneNumber,
        prisma: tx,
        sourceRef: intentId ?? idempotencyKey,
        targetKind: providerTargetKind,
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
      asserted,
      providerDispatchClaimed,
    };
  });

  return jsonOk({
    ok: true,
    threadIsDirect: assertion.asserted.threadIsDirect,
    ...(assertion.asserted.targetOverride
      ? { targetOverride: assertion.asserted.targetOverride }
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
