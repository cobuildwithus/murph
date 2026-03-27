import { Prisma } from "@prisma/client";
import {
  buildHostedExecutionLinqMessageReceivedDispatch,
  type HostedExecutionDispatchRequest,
} from "@murph/hosted-execution";

import { readHostedExecutionDispatchRef } from "../hosted-execution/outbox-payload";
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
  for (const sideEffect of readHostedWebhookReceiptSideEffects(payloadJson)) {
    const effectObject = toHostedWebhookReceiptObject(sideEffect);
    const kind = readHostedWebhookReceiptText(effectObject.kind);

    if (kind !== "hosted_execution_dispatch") {
      continue;
    }

    const payloadObject = toHostedWebhookReceiptObject(effectObject.payload);
    if (!fallback) {
      continue;
    }

    const dispatchRef = readHostedExecutionDispatchRef(
      payloadObject,
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
      const linqEvent = readHostedWebhookReceiptLinqEvent(payloadObject.linqEvent);
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
  }

  return null;
}

function readHostedWebhookReceiptSideEffects(
  payloadJson: Prisma.InputJsonValue | Prisma.JsonValue | null,
): readonly (Prisma.InputJsonValue | Prisma.JsonValue | null)[] {
  const payloadObject = toHostedWebhookReceiptObject(payloadJson);
  const nestedState = toHostedWebhookReceiptObject(payloadObject.receiptState);

  return Array.isArray(nestedState.sideEffects)
    ? nestedState.sideEffects
    : [];
}

function readHostedWebhookReceiptText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : null;
}

function readHostedWebhookReceiptLinqEvent(
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

function toHostedWebhookReceiptObject(
  payloadJson: Prisma.InputJsonValue | Prisma.JsonValue | null | undefined,
): Record<string, Prisma.InputJsonValue | Prisma.JsonValue | null> {
  return payloadJson && typeof payloadJson === "object" && !Array.isArray(payloadJson)
    ? payloadJson as Record<string, Prisma.InputJsonValue | Prisma.JsonValue | null>
    : {};
}
