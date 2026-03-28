import { timingSafeEqual } from "node:crypto";

import type { TelegramMessageLike, TelegramUpdateLike } from "@murph/inboxd";

import { hostedOnboardingError } from "./errors";
import { getHostedOnboardingEnvironment } from "./runtime";
import { normalizeNullableString } from "./shared";

export interface HostedTelegramWebhookSummary {
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
  let payload: unknown;

  try {
    payload = JSON.parse(rawBody) as unknown;
  } catch (error) {
    throw new TypeError(
      `Telegram webhook payload must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("Telegram webhook payload must be a JSON object.");
  }

  const record = payload as Record<string, unknown>;
  const updateId = record.update_id;

  if (!Number.isSafeInteger(updateId)) {
    throw new TypeError("Telegram webhook payload must include an integer update_id.");
  }

  return record as TelegramUpdateLike;
}

export function summarizeHostedTelegramWebhook(update: TelegramUpdateLike): HostedTelegramWebhookSummary | null {
  const message = extractHostedTelegramMessage(update);

  if (!message) {
    return null;
  }

  const senderTelegramUserId =
    typeof message.from?.id === "number" && Number.isFinite(message.from.id)
      ? String(message.from.id)
      : null;
  const chatType = normalizeNullableString(message.chat?.type ?? null);
  const isDirect = chatType === "private" || message.chat?.is_direct_messages === true;

  return {
    chatType,
    isBotMessage: message.from?.is_bot === true,
    isDirect,
    occurredAt: telegramTimestampToIso(message.date) ?? new Date().toISOString(),
    senderTelegramUserId,
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

function extractHostedTelegramMessage(update: TelegramUpdateLike): TelegramMessageLike | null {
  return update.message ?? update.business_message ?? null;
}

function telegramTimestampToIso(value: unknown): string | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? new Date(value * 1000).toISOString()
    : null;
}

function timingSafeEquals(expected: string, received: string): boolean {
  const expectedBuffer = Buffer.from(expected, "utf8");
  const receivedBuffer = Buffer.from(received, "utf8");

  if (expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }

  try {
    return timingSafeEqual(expectedBuffer, receivedBuffer);
  } catch {
    return false;
  }
}
