import { Prisma } from "@prisma/client";
import {
  buildHostedExecutionLinqMessageReceivedDispatch,
  buildHostedExecutionTelegramMessageReceivedDispatch,
  readHostedExecutionDispatchRef,
  type HostedExecutionDispatchRequest,
} from "@murphai/hosted-execution";

import {
  readHostedWebhookReceiptState,
  toHostedWebhookReceiptRecord,
} from "./webhook-receipt-codec";
import { createHostedPhoneLookupKey } from "./contact-privacy";
import type { HostedWebhookDispatchSideEffect } from "./webhook-receipt-types";

const EMPTY_DISPATCH_REF_FALLBACK = {
  eventId: "",
  eventKind: "",
  occurredAt: null,
  userId: "",
} as const;

export function readHostedWebhookReceiptDispatchByEventId(
  payloadJson: Prisma.InputJsonValue | Prisma.JsonValue | null,
  eventId: string,
): HostedExecutionDispatchRequest | null {
  const receiptState = readHostedWebhookReceiptState(payloadJson);

  for (const sideEffect of receiptState.sideEffects) {
    if (sideEffect.kind !== "hosted_execution_dispatch") {
      continue;
    }

    const dispatch = buildHostedWebhookDispatchFromPayload(sideEffect.payload);
    if (dispatch?.eventId === eventId) {
      return dispatch;
    }
  }

  return null;
}

export function buildHostedWebhookDispatchFromPayload(
  payload: HostedWebhookDispatchSideEffect["payload"],
): HostedExecutionDispatchRequest | null {
  const dispatchRef = readHostedExecutionDispatchRef(
    payload as unknown as Prisma.InputJsonValue | Prisma.JsonValue,
    EMPTY_DISPATCH_REF_FALLBACK,
  );

  if (!dispatchRef) {
    return null;
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
    const linqEvent = toHostedWebhookReceiptRecord(
      payload.linqEvent as Prisma.InputJsonValue | Prisma.JsonValue | null | undefined,
    );
    const phoneLookupKey = readHostedWebhookReceiptPhoneLookupKey(payload);

    if (!linqEvent || !phoneLookupKey) {
      return null;
    }

    return buildHostedExecutionLinqMessageReceivedDispatch({
      eventId: dispatchRef.eventId,
      linqEvent,
      occurredAt: dispatchRef.occurredAt,
      phoneLookupKey,
      userId: dispatchRef.userId,
    });
  }

  if (dispatchRef.eventKind === "telegram.message.received") {
    const telegramUpdate = toHostedWebhookReceiptRecord(
      payload.telegramUpdate as Prisma.InputJsonValue | Prisma.JsonValue | null | undefined,
    );

    if (!telegramUpdate) {
      return null;
    }

    return buildHostedExecutionTelegramMessageReceivedDispatch({
      botUserId: readHostedWebhookReceiptBotUserId(payload),
      eventId: dispatchRef.eventId,
      occurredAt: dispatchRef.occurredAt,
      telegramUpdate,
      userId: dispatchRef.userId,
    });
  }

  return null;
}

function readHostedWebhookReceiptBotUserId(
  payload: HostedWebhookDispatchSideEffect["payload"],
): string | null {
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
  const update = toHostedWebhookReceiptRecord(value);

  if (!update) {
    return null;
  }

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
  return toHostedWebhookReceiptRecord(value as Prisma.InputJsonValue | Prisma.JsonValue | null | undefined);
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

function readHostedWebhookReceiptPhoneLookupKey(
  payload: HostedWebhookDispatchSideEffect["payload"],
): string | null {
  if (typeof payload.phoneLookupKey === "string" && payload.phoneLookupKey.trim().length > 0) {
    return payload.phoneLookupKey.trim();
  }

  const linqEvent = toHostedWebhookReceiptRecord(
    payload.linqEvent as Prisma.InputJsonValue | Prisma.JsonValue | null | undefined,
  );
  const fromValue = linqEvent && typeof linqEvent.data === "object" && linqEvent.data && !Array.isArray(linqEvent.data)
    ? (linqEvent.data as Record<string, unknown>).from
    : null;

  return typeof fromValue === "string"
    ? createHostedPhoneLookupKey(fromValue)
    : null;
}
