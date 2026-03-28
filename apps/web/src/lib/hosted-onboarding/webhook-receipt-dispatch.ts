import { Prisma } from "@prisma/client";
import {
  buildHostedExecutionLinqMessageReceivedDispatch,
  buildHostedExecutionTelegramMessageReceivedDispatch,
  readHostedExecutionDispatchRef,
  type HostedExecutionDispatchRequest,
} from "@murph/hosted-execution";

import { readHostedWebhookReceiptState } from "./webhook-receipt-codec";
import { normalizePhoneNumber } from "./phone";

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
