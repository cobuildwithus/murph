import {
  readCloudflareHostedControlHttpError,
} from "@murphai/cloudflare-hosted-control/client";
import {
  parseTelegramThreadTarget,
} from "@murphai/messaging-ingress/telegram-webhook";
import type { PrismaClient } from "@prisma/client";

import {
  claimHostedLinqDeliveryProviderDispatchTx,
  markHostedLinqDeliveryAcceptedTx,
  markHostedLinqDeliverySendFailedTx,
} from "../hosted-onboarding/linq-delivery-store";
import {
  lockHostedMemberRoutingStateTx,
  readHostedMemberRoutingState,
} from "../hosted-onboarding/hosted-member-routing-store";
import { sha256Hex } from "../primitives";
import { readHostedExecutionControlClientIfConfigured } from "./control";

const HOSTED_TELEGRAM_ACCESS_NOTICE_TIMEOUT_MS = 40_000;
const HOSTED_TELEGRAM_ACCESS_NOTICE_RETRY_MS = 30_000;
// The durable Telegram notice lane predates access notices and retains its
// original source label. Reusing it preserves the existing retry semantics and
// avoids a second delivery table or provider-dispatch protocol.
const HOSTED_TELEGRAM_NOTICE_DELIVERY_SOURCE =
  "hosted_runtime_ai_usage_limit_notice";
const HOSTED_TELEGRAM_ACCESS_NOTICE_TEMPLATE = "access_notice";

export type HostedTelegramAccessNoticeDeliveryResult =
  | { status: "already_notified" }
  | { retryAt: Date; status: "in_flight" }
  | { status: "not_applicable" }
  | { status: "sent" };

export async function sendHostedTelegramAccessNotice(input: {
  memberId: string;
  message: string;
  noticeCode: string;
  prisma: PrismaClient;
  replyToMessageId: string;
  sentAt?: Date;
  sourceEventId: string;
  target: string;
}): Promise<HostedTelegramAccessNoticeDeliveryResult> {
  if (!parseTelegramThreadTarget(input.target)) {
    return { status: "not_applicable" };
  }

  const sentAt = input.sentAt ?? new Date();
  const idempotencyKey = buildHostedTelegramAccessNoticeIdempotencyKey(input);
  const claim = await input.prisma.$transaction(async (tx) => {
    await lockHostedMemberRoutingStateTx({
      memberId: input.memberId,
      prisma: tx,
    });
    const routing = await readHostedMemberRoutingState({
      memberId: input.memberId,
      prisma: tx,
    });
    if (routing?.telegramThreadId !== input.target) {
      return { status: "not_applicable" as const };
    }

    const delivery = await claimHostedLinqDeliveryProviderDispatchTx({
      attemptedAt: sentAt,
      idempotencyKey,
      prisma: tx,
      reclaimStalePreProviderAttempt: true,
      source: HOSTED_TELEGRAM_NOTICE_DELIVERY_SOURCE,
      sourceRef: input.sourceEventId,
      status: "provider_dispatch_started",
      targetKind: "telegram_thread",
      template: HOSTED_TELEGRAM_ACCESS_NOTICE_TEMPLATE,
    });
    if (delivery.claimed) {
      return { status: "claimed" as const };
    }
    if (delivery.retryAt) {
      return {
        retryAt: delivery.retryAt,
        status: "in_flight" as const,
      };
    }
    return { status: "already_notified" as const };
  });

  if (claim.status !== "claimed") {
    return claim;
  }

  const controlClient = readHostedExecutionControlClientIfConfigured(
    HOSTED_TELEGRAM_ACCESS_NOTICE_TIMEOUT_MS,
  );
  if (!controlClient) {
    return await markHostedTelegramAccessNoticeRetryable({
      failureCode: "hosted_control_unavailable",
      idempotencyKey,
      prisma: input.prisma,
      sentAt,
    });
  }

  let deliveryResult: Awaited<
    ReturnType<typeof controlClient.sendTelegramUsageLimitNotice>
  >;
  try {
    // The Cloudflare endpoint is a generic Telegram text send despite its
    // historical usage-limit name. Keep the wire contract stable here.
    deliveryResult = await controlClient.sendTelegramUsageLimitNotice({
      request: {
        message: input.message,
        replyToMessageId: input.replyToMessageId,
        target: input.target,
      },
      userId: input.memberId,
    });
  } catch (error) {
    const hostedControlError = readCloudflareHostedControlHttpError(error);
    return await markHostedTelegramAccessNoticeRetryable({
      failureCode:
        hostedControlError?.code ?? "telegram_access_notice_control_failed",
      failureReason: error instanceof Error ? error.message : null,
      idempotencyKey,
      prisma: input.prisma,
      sentAt,
    });
  }

  if (deliveryResult.status === "failed") {
    if (deliveryResult.retryable) {
      const retryAt = resolveHostedTelegramAccessNoticeRetryAt({
        retryAfterSeconds: deliveryResult.retryAfterSeconds,
        sentAt,
      });
      await markHostedLinqDeliverySendFailedTx({
        expectedAttemptedAt: sentAt,
        failedAt: sentAt,
        failureCode: deliveryResult.failureCode,
        idempotencyKey,
        prisma: input.prisma,
        retryAfterAt: retryAt,
      });
      return { retryAt, status: "in_flight" };
    }

    await markHostedLinqDeliverySendFailedTx({
      expectedAttemptedAt: sentAt,
      failedAt: sentAt,
      failureCode: deliveryResult.failureCode,
      idempotencyKey,
      prisma: input.prisma,
    });
    return { status: "already_notified" };
  }

  await markHostedLinqDeliveryAcceptedTx({
    acceptedAt: sentAt,
    idempotencyKey,
    prisma: input.prisma,
  });
  return { status: "sent" };
}

export function buildHostedTelegramAccessNoticeIdempotencyKey(input: {
  memberId: string;
  noticeCode: string;
  sourceEventId: string;
}): string {
  return `telegram-access-notice:${sha256Hex(JSON.stringify({
    memberId: input.memberId,
    noticeCode: input.noticeCode,
    sourceEventId: input.sourceEventId,
  })).slice(0, 32)}`;
}

async function markHostedTelegramAccessNoticeRetryable(input: {
  failureCode: string;
  failureReason?: string | null;
  idempotencyKey: string;
  prisma: PrismaClient;
  sentAt: Date;
}): Promise<HostedTelegramAccessNoticeDeliveryResult> {
  const retryAt = new Date(
    input.sentAt.getTime() + HOSTED_TELEGRAM_ACCESS_NOTICE_RETRY_MS,
  );
  await markHostedLinqDeliverySendFailedTx({
    expectedAttemptedAt: input.sentAt,
    failedAt: input.sentAt,
    failureCode: input.failureCode,
    failureReason: input.failureReason ?? null,
    idempotencyKey: input.idempotencyKey,
    prisma: input.prisma,
    retryAfterAt: retryAt,
  });
  return { retryAt, status: "in_flight" };
}

function resolveHostedTelegramAccessNoticeRetryAt(input: {
  retryAfterSeconds?: number;
  sentAt: Date;
}): Date {
  const retryAfterSeconds = input.retryAfterSeconds;
  const retryMs = typeof retryAfterSeconds === "number"
    && Number.isSafeInteger(retryAfterSeconds)
    && retryAfterSeconds > 0
    ? retryAfterSeconds * 1_000
    : HOSTED_TELEGRAM_ACCESS_NOTICE_RETRY_MS;
  return new Date(input.sentAt.getTime() + retryMs);
}
