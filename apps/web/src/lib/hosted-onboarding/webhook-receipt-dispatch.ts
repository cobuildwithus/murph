import { Prisma } from "@prisma/client";
import {
  buildHostedExecutionLinqMessageReceivedDispatch,
  buildHostedExecutionTelegramMessageReceivedDispatch,
  readHostedExecutionDispatchRef,
  type HostedExecutionDispatchRequest,
} from "@murph/hosted-execution";

import { readHostedWebhookReceiptState } from "./webhook-receipt-codec";
import { normalizePhoneNumber } from "./phone";
import type { HostedWebhookDispatchSideEffect } from "./webhook-receipt-types";

export function readHostedWebhookReceiptDispatchByEventId(
  payloadJson: Prisma.InputJsonValue | Prisma.JsonValue | null,
  eventId: string,
  fallback?: {
    eventKind: string;
    occurredAt: string;
    userId: string;
  },
): HostedExecutionDispatchRequest | null {
  const receiptState = readHostedWebhookReceiptState(payloadJson);

  for (const sideEffect of receiptState.sideEffects) {
    if (sideEffect.kind !== "hosted_execution_dispatch") {
      continue;
    }

    if ("dispatch" in sideEffect.payload) {
      if (sideEffect.payload.dispatch.eventId === eventId) {
        return sideEffect.payload.dispatch;
      }
      continue;
    }

    if (!fallback) {
      continue;
    }

    const dispatchRef = readHostedExecutionDispatchRef(
      sideEffect.payload,
      {
        eventId,
        eventKind: fallback.eventKind,
        occurredAt: fallback.occurredAt,
        userId: fallback.userId,
      },
    );

    if (!dispatchRef || dispatchRef.eventId !== eventId) {
      continue;
    }

    if (dispatchRef.eventKind === "member.activated") {
      return {
        event: {
          kind: "member.activated",
          userId: dispatchRef.userId,
        },
        eventId: dispatchRef.eventId,
        occurredAt: dispatchRef.occurredAt,
      };
    }

    if (dispatchRef.eventKind === "linq.message.received") {
      const linqEvent = readHostedWebhookReceiptLinqEvent(
        sideEffect.payload.linqEvent as Prisma.InputJsonValue | Prisma.JsonValue | null | undefined,
      );
      const normalizedPhoneNumber = readHostedWebhookReceiptNormalizedPhoneNumber(linqEvent);

      if (!linqEvent || !normalizedPhoneNumber) {
        return null;
      }

      return buildHostedExecutionLinqMessageReceivedDispatch({
        eventId: dispatchRef.eventId,
        linqEvent,
        normalizedPhoneNumber,
        occurredAt: dispatchRef.occurredAt,
        userId: dispatchRef.userId,
      });
    }

    if (dispatchRef.eventKind === "telegram.message.received") {
      const telegramUpdate = readHostedWebhookReceiptTelegramUpdate(
        sideEffect.payload.telegramUpdate as Prisma.InputJsonValue | Prisma.JsonValue | null | undefined,
      );

      if (!telegramUpdate) {
        return null;
      }

      return buildHostedExecutionTelegramMessageReceivedDispatch({
        botUserId: readHostedWebhookReceiptBotUserId(sideEffect.payload),
        eventId: dispatchRef.eventId,
        occurredAt: dispatchRef.occurredAt,
        telegramUpdate,
        userId: dispatchRef.userId,
      });
    }
  }

  return null;
}

function readHostedWebhookReceiptLinqEvent(
  value: Prisma.InputJsonValue | Prisma.JsonValue | null | undefined,
): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readHostedWebhookReceiptTelegramUpdate(
  value: Prisma.InputJsonValue | Prisma.JsonValue | null | undefined,
): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readHostedWebhookReceiptBotUserId(
  payload: HostedWebhookDispatchSideEffect["payload"],
): string | null {
  if ("dispatch" in payload) {
    return null;
  }

  if (typeof payload.botUserId === "string") {
    const normalized = payload.botUserId.trim();
    if (normalized.length > 0) {
      return normalized;
    }
  }

  return inferHostedWebhookReceiptTelegramBotUserId(
    payload.telegramUpdate as Prisma.InputJsonValue | Prisma.JsonValue | null | undefined,
  );
}

function inferHostedWebhookReceiptTelegramBotUserId(
  value: Prisma.InputJsonValue | Prisma.JsonValue | null | undefined,
): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const update = value as Record<string, unknown>;
  const message = readHostedWebhookReceiptTelegramMessage(update.message)
    ?? readHostedWebhookReceiptTelegramMessage(update.business_message);

  if (!message) {
    return null;
  }

  const senderBusinessBotId = readHostedWebhookReceiptTelegramUserId(message.sender_business_bot);
  if (senderBusinessBotId) {
    return senderBusinessBotId;
  }

  const senderId = readHostedWebhookReceiptTelegramUserId(message.from);
  if (senderId && readHostedWebhookReceiptTelegramUserIsBot(message.from)) {
    return senderId;
  }

  return null;
}

function readHostedWebhookReceiptTelegramMessage(
  value: unknown,
): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readHostedWebhookReceiptTelegramUserId(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const id = (value as Record<string, unknown>).id;
  if (typeof id === "number" && Number.isFinite(id)) {
    return String(id);
  }

  if (typeof id === "string") {
    const normalized = id.trim();
    return normalized.length > 0 ? normalized : null;
  }

  return null;
}

function readHostedWebhookReceiptTelegramUserIsBot(value: unknown): boolean {
  return Boolean(
    value
      && typeof value === "object"
      && !Array.isArray(value)
      && (value as Record<string, unknown>).is_bot === true,
  );
}

function readHostedWebhookReceiptNormalizedPhoneNumber(
  linqEvent: Record<string, unknown> | null,
): string | null {
  if (!linqEvent) {
    return null;
  }

  const eventData = linqEvent.data;

  if (!eventData || typeof eventData !== "object" || Array.isArray(eventData)) {
    return null;
  }

  return normalizePhoneNumber((eventData as Record<string, unknown>).from as string | null | undefined);
}
