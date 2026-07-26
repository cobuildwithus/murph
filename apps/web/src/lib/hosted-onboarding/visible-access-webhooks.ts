import {
  sendHostedTelegramAccessNotice,
} from "../hosted-execution/telegram-access-notice";
import { getPrisma } from "../prisma";
import { hostedOnboardingError } from "./errors";
import {
  resolveHostedMemberRoutingByTelegramUserId,
} from "./hosted-member-routing-store";
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
import type {
  HostedOnboardingTelegramWebhookResponse,
} from "./webhook-provider-telegram";
import {
  handleHostedOnboardingTelegramWebhook,
} from "./webhook-service";

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
    authorizedTelegramUserId: summary.senderTelegramUserId,
    memberId: memberResolution.lookup.core.id,
    message: access.message,
    noticeCode: readHostedRecognizedInboundNoticeCode(access),
    prisma,
    replyToMessageId: message.messageId,
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
    ...(delivery.status === "in_flight"
      ? { details: { retryAt: delivery.retryAt.toISOString() } }
      : {}),
    httpStatus: 503,
    message: "Hosted Telegram access notice delivery is not complete.",
    retryable: true,
  });
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
