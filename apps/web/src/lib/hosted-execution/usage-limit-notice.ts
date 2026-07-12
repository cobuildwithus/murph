import type { Prisma, PrismaClient } from "@prisma/client";
import {
  readCloudflareHostedControlHttpError,
} from "@murphai/cloudflare-hosted-control/client";
import {
  parseTelegramThreadTarget,
} from "@murphai/messaging-ingress/telegram-webhook";

import type {
  HostedLinqThreadRouteEgressAuthority,
} from "../hosted-routing/thread-route-store";
import {
  HOSTED_AI_USAGE_LIMIT_NOTICE_CLAIM_STALE_MS,
  markHostedAiUsageLimitNoticeDeliveryRetryableTx,
  markHostedLinqDeliveryAcceptedTx,
  markHostedLinqDeliverySendFailedTx,
  startHostedAiUsageLimitNoticeDispatchTx,
} from "../hosted-onboarding/linq-delivery-store";
import {
  createHostedWebhookLinqMessageSideEffect,
  drainHostedLinqSideEffectsDirect,
  type HostedLinqAiUsageQuotaClaimToken,
} from "../hosted-onboarding/webhook-transport";
import type {
  HostedAiUsageLimitNoticeCode,
} from "./usage-allowance";
import {
  readHostedExecutionControlClientIfConfigured,
} from "./control";

type HostedAiUsageLimitNoticeClient = PrismaClient | Prisma.TransactionClient;
const HOSTED_TELEGRAM_USAGE_LIMIT_NOTICE_TIMEOUT_MS = 40_000;

export type HostedAiUsageLimitNoticeDeliveryResult =
  | { status: "already_notified" }
  | { status: "in_flight" }
  | { status: "not_applicable" }
  | { status: "sent" };

export async function sendClaimedHostedAiUsageLimitNoticeToLinqChat(input: {
  chatId: string;
  claimToken: HostedLinqAiUsageQuotaClaimToken;
  memberId: string;
  message: string;
  noticeCode: HostedAiUsageLimitNoticeCode;
  occurredAt: string;
  prisma: HostedAiUsageLimitNoticeClient;
  replyToMessageId?: string | null;
  routeAuthority?: HostedLinqThreadRouteEgressAuthority | null;
  signal?: AbortSignal;
  sourceEventId: string;
}): Promise<HostedAiUsageLimitNoticeDeliveryResult> {
  const result = await drainHostedLinqSideEffectsDirect({
    prisma: input.prisma,
    sideEffects: [
      createHostedWebhookLinqMessageSideEffect({
        chatId: input.chatId,
        claimToken: input.claimToken,
        memberId: input.memberId,
        message: input.message,
        noticeCode: input.noticeCode,
        occurredAt: input.occurredAt,
        replyToMessageId: input.replyToMessageId ?? null,
        ...(input.routeAuthority ? { routeAuthority: input.routeAuthority } : {}),
        sourceEventId: input.sourceEventId,
        template: "ai_usage_quota",
      }),
    ],
    ...(input.signal ? { signal: input.signal } : {}),
  });
  if (result.sentCount > 0) {
    return { status: "sent" };
  }

  const usageNoticeSkip = result.skipped.find((skip) => skip.template === "ai_usage_quota");
  switch (usageNoticeSkip?.reason) {
    case "notice_already_claimed":
      return { status: "already_notified" };
    case "notice_in_flight":
      return { status: "in_flight" };
    default:
      return { status: "not_applicable" };
  }
}

export async function sendClaimedHostedAiUsageLimitNoticeToTelegramThread(input: {
  memberId: string;
  message: string;
  periodStart: Date;
  prisma: PrismaClient;
  replyToMessageId: string;
  sentAt: Date;
  sourceEventId: string;
  target: string;
}): Promise<HostedAiUsageLimitNoticeDeliveryResult> {
  if (!parseTelegramThreadTarget(input.target)) {
    return { status: "not_applicable" };
  }

  const controlClient = readHostedExecutionControlClientIfConfigured(
    HOSTED_TELEGRAM_USAGE_LIMIT_NOTICE_TIMEOUT_MS,
  );
  if (!controlClient) {
    throw new Error("Hosted Telegram usage-limit delivery is not configured.");
  }

  const dispatch: {
    claim: Awaited<ReturnType<typeof startHostedAiUsageLimitNoticeDispatchTx>> | null;
  } = { claim: null };
  let deliveryResult: Awaited<ReturnType<typeof controlClient.sendTelegramUsageLimitNotice>>;
  try {
    deliveryResult = await controlClient.sendTelegramUsageLimitNotice({
      onRequestAttempted: async () => {
        dispatch.claim = await startHostedAiUsageLimitNoticeDispatchTx({
          attemptedAt: input.sentAt,
          memberId: input.memberId,
          periodStart: input.periodStart,
          prisma: input.prisma,
          source: "hosted_runtime_ai_usage_limit_notice",
          sourceRef: input.sourceEventId,
          targetKind: "telegram_thread",
        });
        if (dispatch.claim.status !== "claimed") {
          throw new Error(
            "Hosted Telegram usage-limit notice delivery is already owned.",
          );
        }
      },
      request: {
        message: input.message,
        replyToMessageId: input.replyToMessageId,
        target: input.target,
      },
      userId: input.memberId,
    });
  } catch (cause) {
    if (dispatch.claim?.status === "already_notified") {
      return { status: "already_notified" };
    }
    if (dispatch.claim?.status === "in_flight" || !dispatch.claim) {
      return { status: "in_flight" };
    }

    const hostedControlHttpError = readCloudflareHostedControlHttpError(cause);
    const retryableUnavailable = isHostedTelegramControlPreProviderFailure(
      hostedControlHttpError,
    );
    if (retryableUnavailable) {
      await markHostedAiUsageLimitNoticeDeliveryRetryableTx({
        expectedAttemptedAt: input.sentAt,
        failedAt: input.sentAt,
        failureCode: hostedControlHttpError?.code ?? "hosted_control_unavailable",
        idempotencyKey: dispatch.claim.idempotencyKey,
        memberId: input.memberId,
        periodStart: input.periodStart,
        prisma: input.prisma,
        retryAfterAt: new Date(
          input.sentAt.getTime() + HOSTED_AI_USAGE_LIMIT_NOTICE_CLAIM_STALE_MS,
        ),
      });
      return { status: "in_flight" };
    }

    await markHostedLinqDeliverySendFailedTx({
      expectedAttemptedAt: input.sentAt,
      failedAt: input.sentAt,
      failureCode: "telegram_usage_limit_dispatch_unconfirmed",
      idempotencyKey: dispatch.claim.idempotencyKey,
      prisma: input.prisma,
    });
    return { status: "already_notified" };
  }

  if (dispatch.claim?.status !== "claimed") {
    return { status: "in_flight" };
  }

  if (deliveryResult.status === "failed") {
    if (deliveryResult.retryable) {
      await markHostedAiUsageLimitNoticeDeliveryRetryableTx({
        expectedAttemptedAt: input.sentAt,
        failedAt: input.sentAt,
        failureCode: deliveryResult.failureCode,
        idempotencyKey: dispatch.claim.idempotencyKey,
        memberId: input.memberId,
        periodStart: input.periodStart,
        prisma: input.prisma,
        retryAfterAt: readHostedTelegramUsageLimitNoticeRetryAfterAt({
          result: deliveryResult,
          sentAt: input.sentAt,
        }),
      });
      return { status: "in_flight" };
    }

    await markHostedLinqDeliverySendFailedTx({
      expectedAttemptedAt: input.sentAt,
      failedAt: input.sentAt,
      failureCode: deliveryResult.failureCode,
      idempotencyKey: dispatch.claim.idempotencyKey,
      prisma: input.prisma,
    });
    return { status: "already_notified" };
  }

  await markHostedLinqDeliveryAcceptedTx({
    acceptedAt: input.sentAt,
    idempotencyKey: dispatch.claim.idempotencyKey,
    prisma: input.prisma,
  });
  return { status: "sent" };
}

function readHostedTelegramUsageLimitNoticeRetryAfterAt(input: {
  result: {
    retryAfterSeconds?: number;
  };
  sentAt: Date;
}): Date {
  const retryAfterSeconds = input.result.retryAfterSeconds;
  const retryDelayMs = typeof retryAfterSeconds === "number"
    && Number.isSafeInteger(retryAfterSeconds)
    && retryAfterSeconds > 0
    ? retryAfterSeconds * 1000
    : HOSTED_AI_USAGE_LIMIT_NOTICE_CLAIM_STALE_MS;
  return new Date(input.sentAt.getTime() + retryDelayMs);
}

function isHostedTelegramControlPreProviderFailure(
  error: Readonly<{ code: string | undefined; status: number }> | null,
): boolean {
  return error?.status === 400
    || error?.status === 401
    || error?.status === 404;
}

export async function sendHostedTrialConversionNoticeToLinqChat(input: {
  chatId: string;
  memberId: string;
  message: string;
  occurredAt: string;
  prisma: HostedAiUsageLimitNoticeClient;
  replyToMessageId?: string | null;
  routeAuthority?: HostedLinqThreadRouteEgressAuthority | null;
  signal?: AbortSignal;
  sourceEventId: string;
}): Promise<void> {
  await drainHostedLinqSideEffectsDirect({
    prisma: input.prisma,
    sideEffects: [
      createHostedWebhookLinqMessageSideEffect({
        chatId: input.chatId,
        claimToken: null,
        memberId: input.memberId,
        message: input.message,
        noticeCode: "trial_conversion_pending",
        occurredAt: input.occurredAt,
        replyToMessageId: input.replyToMessageId ?? null,
        ...(input.routeAuthority ? { routeAuthority: input.routeAuthority } : {}),
        sourceEventId: input.sourceEventId,
        template: "ai_usage_quota",
      }),
    ],
    ...(input.signal ? { signal: input.signal } : {}),
  });
}
