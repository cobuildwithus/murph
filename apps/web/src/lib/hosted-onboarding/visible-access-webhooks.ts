import type { PrismaClient } from "@prisma/client";

import {
  sendHostedTelegramAccessNotice,
} from "../hosted-execution/telegram-access-notice";
import { getPrisma } from "../prisma";
import {
  hostedOnboardingError,
  isHostedOnboardingError,
} from "./errors";
import {
  lookupHostedMemberRoutingByHomeLinqChatId,
  resolveHostedMemberRoutingByTelegramUserId,
} from "./hosted-member-routing-store";
import {
  verifyAndParseHostedLinqWebhookRequest,
} from "./linq";
import {
  resolveHostedRecognizedInboundAccess,
  type HostedRecognizedInboundAccessResolution,
} from "./recognized-inbound-access";
import {
  buildHostedTelegramMessagePayload,
  buildHostedTelegramWebhookEventId,
  parseHostedTelegramWebhookUpdate,
  summarizeHostedTelegramWebhook,
} from "./telegram";
import {
  buildInactiveMemberAccessNoticeResponse,
  buildSignupLinkResponse,
  resolveHostedOnboardingLinqMessageContext,
} from "./webhook-provider-linq-shared";
import type {
  HostedOnboardingLinqWebhookResponse,
} from "./webhook-provider-linq-types";
import type {
  HostedOnboardingTelegramWebhookResponse,
} from "./webhook-provider-telegram";
import {
  handleHostedOnboardingLinqWebhook,
  handleHostedOnboardingTelegramWebhook,
} from "./webhook-service";
import {
  drainHostedLinqSideEffectsDirect,
} from "./webhook-transport";

export async function handleHostedOnboardingLinqWebhookWithVisibleAccess(
  input: Parameters<typeof handleHostedOnboardingLinqWebhook>[0],
): Promise<HostedOnboardingLinqWebhookResponse> {
  try {
    return await handleHostedOnboardingLinqWebhook(input);
  } catch (error) {
    if (
      !isHostedOnboardingError(error)
      || error.code !== "HOSTED_LINQ_HOME_ROUTE_CHANGED"
    ) {
      throw error;
    }

    return await recoverHostedLinqPermanentHomeRouteInbound({
      error,
      input,
      prisma: input.prisma ?? getPrisma(),
    });
  }
}

export async function handleHostedOnboardingTelegramWebhookWithVisibleAccess(
  input: Parameters<typeof handleHostedOnboardingTelegramWebhook>[0],
): Promise<HostedOnboardingTelegramWebhookResponse> {
  const response = await handleHostedOnboardingTelegramWebhook(input);
  if (
    response.reason !== "inactive-member"
    && response.reason !== "suspended-member"
  ) {
    return response;
  }

  const prisma = input.prisma ?? getPrisma();
  const update = parseHostedTelegramWebhookUpdate(input.rawBody);
  const summary = await summarizeHostedTelegramWebhook(update);
  const message = buildHostedTelegramMessagePayload(update);
  if (
    !summary?.isDirect
    || !summary.senderTelegramUserId
    || !message
  ) {
    return response;
  }

  const memberResolution = await resolveHostedMemberRoutingByTelegramUserId({
    prisma,
    telegramUserId: summary.senderTelegramUserId,
  });
  if (memberResolution.status !== "found") {
    return response;
  }

  const eventId = buildHostedTelegramWebhookEventId(update);
  const access = await resolveHostedRecognizedInboundAccess({
    allowSignupFallback: true,
    inviteChannel: "web",
    member: memberResolution.lookup.core,
    noticeSeed: eventId,
    now: new Date(summary.occurredAt),
    prisma,
  });
  if (access.kind === "allowed") {
    throw hostedOnboardingError({
      code: "HOSTED_TELEGRAM_ACCESS_CHANGED",
      httpStatus: 503,
      message: "Hosted Telegram access changed while resolving the inbound message.",
      retryable: true,
    });
  }
  if (access.kind === "silent") {
    return response;
  }

  const delivery = await sendHostedTelegramAccessNotice({
    memberId: memberResolution.lookup.core.id,
    message: access.message,
    noticeCode: readHostedRecognizedInboundNoticeCode(access),
    prisma,
    replyToMessageId: message.messageId,
    sentAt: new Date(summary.occurredAt),
    sourceEventId: eventId,
    target: message.threadId,
  });
  if (delivery.status === "sent" || delivery.status === "already_notified") {
    return {
      ignored: false,
      ok: true,
      reason: access.responseReason,
    };
  }

  throw hostedOnboardingError({
    code: delivery.status === "in_flight"
      ? "HOSTED_TELEGRAM_ACCESS_NOTICE_RETRY"
      : "HOSTED_TELEGRAM_ACCESS_NOTICE_ROUTE_CHANGED",
    details: delivery.status === "in_flight"
      ? { retryAt: delivery.retryAt.toISOString() }
      : undefined,
    httpStatus: 503,
    message: "Hosted Telegram access notice delivery is not complete.",
    retryable: true,
  });
}

async function recoverHostedLinqPermanentHomeRouteInbound(input: {
  error: Error;
  input: Parameters<typeof handleHostedOnboardingLinqWebhook>[0];
  prisma: PrismaClient;
}): Promise<HostedOnboardingLinqWebhookResponse> {
  const event = verifyAndParseHostedLinqWebhookRequest({
    rawBody: input.input.rawBody,
    signature: input.input.signature,
    timestamp: input.input.timestamp,
  });
  if (event.event_type !== "message.received") {
    throw input.error;
  }

  const context = resolveHostedOnboardingLinqMessageContext(event);
  if (
    context.summary.isFromMe
    || context.messageEvent.data.chat?.is_group === true
    || !context.participantContact
  ) {
    throw input.error;
  }

  const homeOwner = await lookupHostedMemberRoutingByHomeLinqChatId({
    linqChatId: context.summary.chatId,
    prisma: input.prisma,
  });
  if (!homeOwner) {
    throw input.error;
  }

  const access = await resolveHostedRecognizedInboundAccess({
    allowSignupFallback: true,
    inviteChannel: "linq",
    member: homeOwner.core,
    noticeSeed: event.event_id,
    now: new Date(context.occurredAt),
    prisma: input.prisma,
  });
  if (access.kind === "allowed" || access.kind === "silent") {
    throw input.error;
  }

  const plan = access.kind === "access_notice"
    ? buildInactiveMemberAccessNoticeResponse({
        chatId: context.summary.chatId,
        memberId: homeOwner.core.id,
        message: access.message,
        messageId: context.summary.messageId,
        noticeCode: access.noticeCode,
        occurredAt: context.occurredAt,
        sourceEventId: event.event_id,
      })
    : buildSignupLinkResponse({
        chatId: context.summary.chatId,
        inviteCode: access.inviteCode,
        inviteId: access.inviteId,
        memberId: homeOwner.core.id,
        messageId: context.summary.messageId,
        occurredAt: context.occurredAt,
        service: context.messageEvent.data.service ?? null,
        sourceEventId: event.event_id,
        threadIsDirect: true,
      });

  await drainHostedLinqSideEffectsDirect({
    prisma: input.prisma,
    scheduleAfterResponse: input.input.scheduleAfterResponse,
    sideEffects: plan.desiredSideEffects,
    ...(input.input.signal ? { signal: input.input.signal } : {}),
  });
  return plan.response;
}

function readHostedRecognizedInboundNoticeCode(
  access: Exclude<
    HostedRecognizedInboundAccessResolution,
    { kind: "allowed" | "silent" }
  >,
): string {
  return access.kind === "access_notice"
    ? access.noticeCode
    : "signup_required";
}
