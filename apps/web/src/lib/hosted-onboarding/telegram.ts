import { timingSafeEqual } from "node:crypto";

import {
  parseTelegramWebhookUpdate,
  summarizeTelegramUpdate,
  type TelegramUpdateLike,
} from "@murphai/messaging-ingress/telegram-webhook";

import { hostedOnboardingError } from "./errors";
import { getHostedOnboardingEnvironment } from "./runtime";
import { normalizeNullableString } from "./shared";

export interface HostedTelegramWebhookSummary {
  botUserId: string | null;
  chatType: string | null;
  isBotMessage: boolean;
  isDirect: boolean;
  occurredAt: string;
  senderTelegramUserId: string | null;
}

export function assertHostedTelegramWebhookSecret(secretToken: string | null): void {
  const expectedSecret = getHostedOnboardingEnvironment().telegramWebhookSecret;

  if (!expectedSecret) {
    throw hostedOnboardingError({
      code: "TELEGRAM_WEBHOOK_SECRET_NOT_CONFIGURED",
      message: "TELEGRAM_WEBHOOK_SECRET must be configured for Telegram webhooks.",
      httpStatus: 500,
    });
  }

  const normalizedSecret = normalizeNullableString(secretToken);

  if (!normalizedSecret) {
    throw hostedOnboardingError({
      code: "TELEGRAM_WEBHOOK_SECRET_REQUIRED",
      message: "Missing Telegram webhook secret header.",
      httpStatus: 401,
    });
  }

  if (!timingSafeEquals(expectedSecret, normalizedSecret)) {
    throw hostedOnboardingError({
      code: "TELEGRAM_WEBHOOK_SECRET_INVALID",
      message: "Invalid Telegram webhook secret.",
      httpStatus: 401,
    });
  }
}

export function parseHostedTelegramWebhookUpdate(rawBody: string): TelegramUpdateLike {
  return parseTelegramWebhookUpdate(rawBody);
}

export async function summarizeHostedTelegramWebhook(
  update: TelegramUpdateLike,
): Promise<HostedTelegramWebhookSummary | null> {
  const summary = summarizeTelegramUpdate({
    inferBotUserIdFromMessage: true,
    update,
  });

  if (!summary) {
    return null;
  }

  return {
    botUserId: summary.botUserId,
    chatType: summary.thread.chatType,
    isBotMessage: summary.actor.isSelf,
    isDirect: summary.thread.isDirect,
    occurredAt: summary.occurredAt,
    senderTelegramUserId: summary.actor.senderTelegramUserId,
  };
}

export function buildHostedTelegramWebhookEventId(update: TelegramUpdateLike): string {
  return `telegram:update:${update.update_id}`;
}

export function buildHostedTelegramBotLink(start: string | null = null): string | null {
  const username = normalizeNullableString(getHostedOnboardingEnvironment().telegramBotUsername);

  if (!username) {
    return null;
  }

  const botUsername = username.startsWith("@") ? username.slice(1) : username;
  const url = new URL(`https://t.me/${botUsername}`);

  if (start && start.trim()) {
    url.searchParams.set("start", start.trim());
  }

  return url.toString();
}

function timingSafeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.byteLength !== rightBuffer.byteLength) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}
