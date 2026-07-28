import {
  readCloudflareHostedControlHttpError,
} from "@murphai/cloudflare-hosted-control/client";
import {
  parseTelegramThreadTarget,
  type TelegramThreadTarget,
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
import { isHostedOnboardingError } from "../hosted-onboarding/errors";
import { sendHostedTelegramTextMessage } from "../hosted-onboarding/telegram-client";
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
const HOSTED_TELEGRAM_ACCESS_NOTICE_DEFINITE_FAILURE_CODE =
  "telegram_access_notice_definite_failure";
const HOSTED_TELEGRAM_API_RESPONSE_REJECTED_CODE =
  "HOSTED_TELEGRAM_API_RESPONSE_REJECTED";

export type HostedTelegramAccessNoticeDeliveryResult =
  | { status: "already_notified" }
  | { status: "definite_failure" }
  | { retryAt: Date; status: "in_flight" }
  | { status: "not_applicable" }
  | { status: "sent" };

type HostedTelegramAccessNoticeDispatchClaim =
  | {
      attemptedAt: Date;
      status: "claimed";
      target: TelegramThreadTarget;
    }
  | { status: "already_notified" }
  | { status: "definite_failure" }
  | { retryAt: Date; status: "in_flight" }
  | { status: "not_applicable" };

type HostedTelegramAccessNoticeInput = {
  authorizedTelegramUserId?: string;
  memberId: string;
  message: string;
  noticeCode: string;
  prisma: PrismaClient;
  replyToMessageId: string | null;
  sentAt?: Date;
  sourceEventId: string;
  target: string;
};

export async function sendHostedTelegramAccessNotice(
  input: HostedTelegramAccessNoticeInput,
): Promise<HostedTelegramAccessNoticeDeliveryResult> {
  const target = parseTelegramThreadTarget(input.target);
  if (!target) {
    return { status: "not_applicable" };
  }

  const idempotencyKey = buildHostedTelegramAccessNoticeIdempotencyKey(input);
  if (input.replyToMessageId === null) {
    // A group-origin recovery targets the sender's private chat, where the
    // group's message id is not a valid reply anchor. Keep the existing durable
    // claim and use Web's established unanchored Telegram text transport rather
    // than creating a second delivery owner or weakening target authorization.
    return await sendHostedTelegramUnanchoredAccessNotice({
      idempotencyKey,
      input,
      target,
    });
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
          target,
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
    if (claim?.status === "definite_failure") {
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

async function sendHostedTelegramUnanchoredAccessNotice(input: {
  idempotencyKey: string;
  input: HostedTelegramAccessNoticeInput;
  target: TelegramThreadTarget;
}): Promise<HostedTelegramAccessNoticeDeliveryResult> {
  const claim = await claimHostedTelegramAccessNoticeDispatch({
    idempotencyKey: input.idempotencyKey,
    input: input.input,
    target: input.target,
  });
  if (claim.status !== "claimed") {
    return claim;
  }

  try {
    await sendHostedTelegramTextMessage({
      message: input.input.message,
      replyToMessageId: null,
      target: claim.target,
    });
  } catch (error) {
    if (
      isHostedOnboardingError(error)
      && error.code === "HOSTED_TELEGRAM_BOT_TOKEN_NOT_CONFIGURED"
    ) {
      return await markHostedTelegramAccessNoticeRetryable({
        attemptedAt: claim.attemptedAt,
        failureCode: error.code,
        failureReason: error.message,
        idempotencyKey: input.idempotencyKey,
        prisma: input.input.prisma,
      });
    }

    if (
      isHostedOnboardingError(error)
      && error.code === HOSTED_TELEGRAM_API_RESPONSE_REJECTED_CODE
      && readHostedTelegramResponseStatus(error) === 429
    ) {
      return await markHostedTelegramAccessNoticeRetryable({
        attemptedAt: claim.attemptedAt,
        failureCode: error.code,
        failureReason: error.message,
        idempotencyKey: input.idempotencyKey,
        prisma: input.input.prisma,
        retryAfterSeconds: readHostedTelegramRetryAfterSeconds(error),
      });
    }

    if (
      isHostedOnboardingError(error)
      && error.code === HOSTED_TELEGRAM_API_RESPONSE_REJECTED_CODE
      && isHostedTelegramPermanentResponseRejection(error)
    ) {
      // Telegram permanently rejected the request, so the private message
      // definitely did not land. Preserve the terminal provider-effect record
      // and let the webhook adapter use its account-neutral room fallback.
      await markHostedLinqDeliverySendFailedTx({
        expectedAttemptedAt: claim.attemptedAt,
        failedAt: claim.attemptedAt,
        failureCode: HOSTED_TELEGRAM_ACCESS_NOTICE_DEFINITE_FAILURE_CODE,
        failureReason: error.message,
        idempotencyKey: input.idempotencyKey,
        prisma: input.input.prisma,
      });
      return { status: "definite_failure" };
    }

    // A direct Bot API request that throws after dispatch may already have
    // reached Telegram. Terminalize the exact event instead of risking a second
    // private recovery message on webhook replay.
    await markHostedLinqDeliverySendFailedTx({
      expectedAttemptedAt: claim.attemptedAt,
      failedAt: claim.attemptedAt,
      failureCode: readHostedTelegramAccessNoticeFailureCode(error),
      failureReason: error instanceof Error ? error.message : null,
      idempotencyKey: input.idempotencyKey,
      prisma: input.input.prisma,
    });
    return { status: "already_notified" };
  }

  await markHostedLinqDeliveryAcceptedTx({
    acceptedAt: claim.attemptedAt,
    idempotencyKey: input.idempotencyKey,
    prisma: input.input.prisma,
  });
  return { status: "sent" };
}

async function claimHostedTelegramAccessNoticeDispatch(input: {
  idempotencyKey: string;
  input: HostedTelegramAccessNoticeInput;
  target: TelegramThreadTarget;
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
      const threadStillAuthorized =
        routing?.telegramThreadId === input.input.target;
      const currentInboundSenderStillAuthorized = Boolean(
        input.input.authorizedTelegramUserId
        && routing?.telegramUserId === input.input.authorizedTelegramUserId,
      );
      if (!threadStillAuthorized && !currentInboundSenderStillAuthorized) {
        return { status: "not_applicable" };
      }

      const delivery = await claimHostedLinqDeliveryProviderDispatchTx({
        attemptedAt,
        idempotencyKey: input.idempotencyKey,
        prisma: tx,
        reclaimStalePreProviderAttempt: true,
        returnExistingFailureCode: true,
        source: HOSTED_TELEGRAM_NOTICE_DELIVERY_SOURCE,
        sourceRef: input.input.sourceEventId,
        status: "provider_dispatch_started",
        targetKind: "telegram_thread",
        template: HOSTED_TELEGRAM_ACCESS_NOTICE_TEMPLATE,
      });
      if (delivery.claimed) {
        return {
          attemptedAt,
          status: "claimed",
          target: resolveHostedTelegramAccessNoticeDispatchTarget({
            authorizedTelegramUserId: input.input.authorizedTelegramUserId,
            currentInboundSenderStillAuthorized,
            fallbackTarget: input.target,
            replyToMessageId: input.input.replyToMessageId,
            routingTelegramThreadId: routing?.telegramThreadId ?? null,
          }),
        };
      }
      if (delivery.retryAt) {
        return {
          retryAt: delivery.retryAt,
          status: "in_flight",
        };
      }
      if (
        delivery.failureCode
        === HOSTED_TELEGRAM_ACCESS_NOTICE_DEFINITE_FAILURE_CODE
      ) {
        return { status: "definite_failure" };
      }
      return { status: "already_notified" };
    },
  );
}

function resolveHostedTelegramAccessNoticeDispatchTarget(input: {
  authorizedTelegramUserId?: string;
  currentInboundSenderStillAuthorized: boolean;
  fallbackTarget: TelegramThreadTarget;
  replyToMessageId: string | null;
  routingTelegramThreadId: string | null;
}): TelegramThreadTarget {
  if (
    input.replyToMessageId !== null
    || !input.currentInboundSenderStillAuthorized
    || !input.authorizedTelegramUserId
  ) {
    return input.fallbackTarget;
  }

  const storedTarget = input.routingTelegramThreadId
    ? parseTelegramThreadTarget(input.routingTelegramThreadId)
    : null;
  return storedTarget?.chatId === input.authorizedTelegramUserId
    ? storedTarget
    : input.fallbackTarget;
}

async function markHostedTelegramAccessNoticeRetryable(input: {
  attemptedAt: Date;
  failureCode: string;
  failureReason?: string | null;
  idempotencyKey: string;
  prisma: PrismaClient;
  retryAfterSeconds?: number;
}): Promise<HostedTelegramAccessNoticeDeliveryResult> {
  const retryAt = resolveHostedTelegramAccessNoticeRetryAt({
    ...(input.retryAfterSeconds === undefined
      ? {}
      : { retryAfterSeconds: input.retryAfterSeconds }),
    sentAt: input.attemptedAt,
  });
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

function readHostedTelegramRetryAfterSeconds(
  error: Readonly<{ details?: Record<string, unknown> }>,
): number | undefined {
  const retryAfterSeconds = error.details?.retryAfterSeconds;
  return typeof retryAfterSeconds === "number"
    && Number.isSafeInteger(retryAfterSeconds)
    && retryAfterSeconds > 0
    ? retryAfterSeconds
    : undefined;
}

function readHostedTelegramResponseStatus(
  error: Readonly<{ details?: Record<string, unknown> }>,
): number | undefined {
  const status = error.details?.status;
  return typeof status === "number"
    && Number.isSafeInteger(status)
    && status >= 100
    && status <= 599
    ? status
    : undefined;
}

function isHostedTelegramPermanentResponseRejection(
  error: Readonly<{ details?: Record<string, unknown> }>,
): boolean {
  const status = readHostedTelegramResponseStatus(error);
  return status !== undefined && status >= 400 && status < 500 && status !== 429;
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

function readHostedTelegramAccessNoticeFailureCode(error: unknown): string {
  const code = error && typeof error === "object" && "code" in error
    && typeof error.code === "string"
    ? error.code.trim()
    : "";
  if (code) {
    return code;
  }
  return error instanceof Error && error.name
    ? error.name
    : "telegram_access_notice_dispatch_unconfirmed";
}
