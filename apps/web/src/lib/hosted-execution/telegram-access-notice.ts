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

type HostedTelegramAccessNoticeDispatchClaim =
  | { attemptedAt: Date; status: "claimed" }
  | { status: "already_notified" }
  | { retryAt: Date; status: "in_flight" }
  | { status: "not_applicable" };

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

  const controlClient = readHostedExecutionControlClientIfConfigured(
    HOSTED_TELEGRAM_ACCESS_NOTICE_TIMEOUT_MS,
  );
  if (!controlClient) {
    return {
      retryAt: new Date(
        (input.sentAt ?? new Date()).getTime()
          + HOSTED_TELEGRAM_ACCESS_NOTICE_RETRY_MS,
      ),
      status: "in_flight",
    };
  }

  const idempotencyKey = buildHostedTelegramAccessNoticeIdempotencyKey(input);
  const dispatch: {
    claim: HostedTelegramAccessNoticeDispatchClaim | null;
  } = { claim: null };
  let deliveryResult: Awaited<
    ReturnType<typeof controlClient.sendTelegramUsageLimitNotice>
  >;
  try {
    // The Cloudflare endpoint is a generic Telegram text send despite its
    // historical usage-limit name. Keep the wire contract stable here. The
    // callback runs immediately before the HTTP request, which is the same
    // irreversible boundary used by the existing usage-limit sender.
    deliveryResult = await controlClient.sendTelegramUsageLimitNotice({
      onRequestAttempted: async () => {
        dispatch.claim = await claimHostedTelegramAccessNoticeDispatch({
          idempotencyKey,
          input,
        });
        if (dispatch.claim.status !== "claimed") {
          throw new Error(
            "Hosted Telegram access notice delivery is already owned.",
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
  } catch (error) {
    const claim = dispatch.claim;
    if (claim?.status === "not_applicable") {
      return claim;
    }
    if (claim?.status === "already_notified") {
      return claim;
    }
    if (claim?.status === "in_flight") {
      return claim;
    }
    if (!claim || claim.status !== "claimed") {
      return {
        retryAt: new Date(Date.now() + HOSTED_TELEGRAM_ACCESS_NOTICE_RETRY_MS),
        status: "in_flight",
      };
    }

    const hostedControlError = readCloudflareHostedControlHttpError(error);
    if (isHostedTelegramControlPreProviderFailure(hostedControlError)) {
      return await markHostedTelegramAccessNoticeRetryable({
        attemptedAt: claim.attemptedAt,
        failureCode:
          hostedControlError?.code ?? "telegram_access_notice_control_failed",
        failureReason: error instanceof Error ? error.message : null,
        idempotencyKey,
        prisma: input.prisma,
      });
    }

    await markHostedLinqDeliverySendFailedTx({
      expectedAttemptedAt: claim.attemptedAt,
      failedAt: claim.attemptedAt,
      failureCode:
        hostedControlError?.code ?? "telegram_access_notice_dispatch_unconfirmed",
      failureReason: error instanceof Error ? error.message : null,
      idempotencyKey,
      prisma: input.prisma,
    });
    return { status: "already_notified" };
  }

  const claim = dispatch.claim;
  if (!claim || claim.status !== "claimed") {
    throw new Error(
      "Hosted Telegram access notice returned without a durable claim.",
    );
  }

  if (deliveryResult.status === "failed") {
    if (deliveryResult.retryable) {
      const retryAt = resolveHostedTelegramAccessNoticeRetryAt({
        ...(deliveryResult.retryAfterSeconds === undefined
          ? {}
          : { retryAfterSeconds: deliveryResult.retryAfterSeconds }),
        sentAt: claim.attemptedAt,
      });
      await markHostedLinqDeliverySendFailedTx({
        expectedAttemptedAt: claim.attemptedAt,
        failedAt: claim.attemptedAt,
        failureCode: deliveryResult.failureCode,
        idempotencyKey,
        prisma: input.prisma,
        retryAfterAt: retryAt,
      });
      return { retryAt, status: "in_flight" };
    }

    await markHostedLinqDeliverySendFailedTx({
      expectedAttemptedAt: claim.attemptedAt,
      failedAt: claim.attemptedAt,
      failureCode: deliveryResult.failureCode,
      idempotencyKey,
      prisma: input.prisma,
    });
    return { status: "already_notified" };
  }

  await markHostedLinqDeliveryAcceptedTx({
    acceptedAt: claim.attemptedAt,
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

async function claimHostedTelegramAccessNoticeDispatch(input: {
  idempotencyKey: string;
  input: {
    memberId: string;
    prisma: PrismaClient;
    sentAt?: Date;
    sourceEventId: string;
    target: string;
  };
}): Promise<HostedTelegramAccessNoticeDispatchClaim> {
  const attemptedAt = input.input.sentAt ?? new Date();
  return await input.input.prisma.$transaction(
    async (tx): Promise<HostedTelegramAccessNoticeDispatchClaim> => {
      await lockHostedMemberRoutingStateTx({
        memberId: input.input.memberId,
        prisma: tx,
      });
      const routing = await readHostedMemberRoutingState({
        memberId: input.input.memberId,
        prisma: tx,
      });
      if (routing?.telegramThreadId !== input.input.target) {
        return { status: "not_applicable" };
      }

      const delivery = await claimHostedLinqDeliveryProviderDispatchTx({
        attemptedAt,
        idempotencyKey: input.idempotencyKey,
        prisma: tx,
        source: HOSTED_TELEGRAM_NOTICE_DELIVERY_SOURCE,
        sourceRef: input.input.sourceEventId,
        status: "provider_dispatch_started",
        targetKind: "telegram_thread",
        template: HOSTED_TELEGRAM_ACCESS_NOTICE_TEMPLATE,
      });
      if (delivery.claimed) {
        return { attemptedAt, status: "claimed" };
      }
      if (delivery.retryAt) {
        return {
          retryAt: delivery.retryAt,
          status: "in_flight",
        };
      }
      return { status: "already_notified" };
    },
  );
}

async function markHostedTelegramAccessNoticeRetryable(input: {
  attemptedAt: Date;
  failureCode: string;
  failureReason?: string | null;
  idempotencyKey: string;
  prisma: PrismaClient;
}): Promise<HostedTelegramAccessNoticeDeliveryResult> {
  const retryAt = new Date(
    input.attemptedAt.getTime() + HOSTED_TELEGRAM_ACCESS_NOTICE_RETRY_MS,
  );
  await markHostedLinqDeliverySendFailedTx({
    expectedAttemptedAt: input.attemptedAt,
    failedAt: input.attemptedAt,
    failureCode: input.failureCode,
    failureReason: input.failureReason ?? null,
    idempotencyKey: input.idempotencyKey,
    prisma: input.prisma,
    retryAfterAt: retryAt,
  });
  return { retryAt, status: "in_flight" };
}

function isHostedTelegramControlPreProviderFailure(
  error: Readonly<{ code: string | undefined; status: number }> | null,
): boolean {
  return error?.status === 400
    || error?.status === 401
    || error?.status === 404;
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
