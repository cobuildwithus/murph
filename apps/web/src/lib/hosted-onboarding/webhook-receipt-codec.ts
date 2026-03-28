import { randomBytes } from "node:crypto";

import {
  readHostedExecutionDispatchRef,
  type HostedExecutionDispatchRequest,
} from "@murph/hosted-execution";
import { Prisma } from "@prisma/client";

import type {
  HostedWebhookDispatchSideEffect,
  HostedWebhookEventPayload,
  HostedWebhookReceiptClaim,
  HostedWebhookReceiptErrorState,
  HostedWebhookResponsePayload,
  HostedWebhookReceiptState,
  HostedWebhookReceiptStatus,
  HostedWebhookRevnetIssuanceSideEffect,
  HostedWebhookSideEffect,
  HostedWebhookSideEffectErrorState,
  HostedWebhookSideEffectStatus,
} from "./webhook-receipt-types";

export function serializeHostedWebhookReceiptState(
  receiptState: HostedWebhookReceiptState,
): Prisma.InputJsonValue {
  return {
    eventPayload: receiptState.eventPayload,
    receiptState: {
      attemptCount: Math.max(Math.trunc(receiptState.attemptCount), 1),
      attemptId: receiptState.attemptId ?? generateHostedWebhookReceiptAttemptId(),
      completedAt: receiptState.status === "completed" ? receiptState.completedAt : null,
      lastError: receiptState.status === "failed" ? receiptState.lastError : null,
      lastReceivedAt: receiptState.lastReceivedAt,
      plannedAt: receiptState.plannedAt,
      response: receiptState.response,
      sideEffects: receiptState.sideEffects.map((effect) => serializeHostedWebhookSideEffect(effect)),
      status: receiptState.status,
    },
  } satisfies Prisma.InputJsonObject;
}

export function readHostedWebhookReceiptState(
  payloadJson: Prisma.InputJsonValue | Prisma.JsonValue | null,
): HostedWebhookReceiptState {
  const nestedState = toHostedWebhookReceiptObject(
    toHostedWebhookReceiptObject(payloadJson).receiptState,
  );
  const attemptId = readHostedWebhookReceiptString(nestedState.attemptId);
  const attemptCount = readHostedWebhookReceiptNumber(nestedState.attemptCount);
  const status = readHostedWebhookReceiptStatusValue(nestedState.status);

  return {
    attemptCount: Math.max(attemptCount, 0),
    attemptId,
    completedAt: readHostedWebhookReceiptString(nestedState.completedAt),
    eventPayload: readHostedWebhookReceiptEventPayload(payloadJson),
    lastError: readHostedWebhookReceiptError(nestedState.lastError),
    lastReceivedAt: readHostedWebhookReceiptString(nestedState.lastReceivedAt),
    plannedAt: readHostedWebhookReceiptString(nestedState.plannedAt),
    response: readHostedWebhookReceiptResponse(nestedState.response),
    sideEffects: readHostedWebhookReceiptSideEffects(nestedState.sideEffects),
    status,
  };
}

export function toHostedWebhookReceiptObject(
  payloadJson: Prisma.InputJsonValue | Prisma.JsonValue | null | undefined,
): Record<string, Prisma.InputJsonValue | Prisma.JsonValue | null> {
  if (payloadJson && typeof payloadJson === "object" && !Array.isArray(payloadJson)) {
    return payloadJson as Record<string, Prisma.InputJsonValue | Prisma.JsonValue | null>;
  }

  if (payloadJson === null || payloadJson === undefined) {
    return {};
  }

  return {
    payload: payloadJson,
  };
}

export function toHostedWebhookReceiptRecord(
  value: Prisma.InputJsonValue | Prisma.JsonValue | null | undefined,
): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function toHostedWebhookReceiptJsonInput(
  value: HostedWebhookReceiptClaim["payloadJson"],
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
  return value === null
    ? Prisma.JsonNull
    : value as Prisma.InputJsonValue;
}

export function readHostedWebhookDispatchPayloadDispatch(
  payload: HostedWebhookDispatchSideEffect["payload"],
): HostedExecutionDispatchRequest | null {
  return "dispatch" in payload
    ? payload.dispatch
    : null;
}

export function requireHostedWebhookDispatchEffectDispatch(
  effect: HostedWebhookDispatchSideEffect,
): HostedExecutionDispatchRequest {
  const dispatch = readHostedWebhookDispatchPayloadDispatch(effect.payload);

  if (!dispatch) {
    throw new Error(`Hosted webhook dispatch side effect ${effect.effectId} no longer carries a dispatch payload.`);
  }

  return dispatch;
}

function readHostedWebhookReceiptEventPayload(
  payloadJson: Prisma.InputJsonValue | Prisma.JsonValue | null,
): HostedWebhookEventPayload {
  if (payloadJson && typeof payloadJson === "object" && !Array.isArray(payloadJson)) {
    const payloadObject = payloadJson as Record<string, Prisma.InputJsonValue | Prisma.JsonValue | null>;
    const nestedEventPayload = payloadObject.eventPayload;

    if (nestedEventPayload && typeof nestedEventPayload === "object" && !Array.isArray(nestedEventPayload)) {
      return nestedEventPayload as HostedWebhookEventPayload;
    }
  }

  return {};
}

function readHostedWebhookReceiptResponse(
  value: Prisma.InputJsonValue | Prisma.JsonValue | null | undefined,
): HostedWebhookResponsePayload | null {
  const response = toHostedWebhookReceiptRecord(value);

  return response
    ? response as HostedWebhookResponsePayload
    : null;
}

function readHostedWebhookReceiptError(
  value: Prisma.InputJsonValue | Prisma.JsonValue | null | undefined,
): HostedWebhookReceiptErrorState | null {
  const errorObject = toHostedWebhookReceiptObject(value);
  const message = readHostedWebhookReceiptString(errorObject.message);
  const name = readHostedWebhookReceiptString(errorObject.name);

  return message && name
    ? {
        code: readHostedWebhookReceiptString(errorObject.code),
        message,
        name,
        retryable:
          typeof errorObject.retryable === "boolean"
            ? errorObject.retryable
            : null,
      }
    : null;
}

function readHostedWebhookReceiptSideEffects(
  value: Prisma.InputJsonValue | Prisma.JsonValue | null | undefined,
): HostedWebhookSideEffect[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const sideEffects: HostedWebhookSideEffect[] = [];

  for (const candidate of value) {
    const parsed = readHostedWebhookSideEffect(candidate);
    if (parsed) {
      sideEffects.push(parsed);
    }
  }

  return sideEffects;
}

function readHostedWebhookReceiptNumber(
  value: Prisma.InputJsonValue | Prisma.JsonValue | null | undefined,
): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(Math.trunc(value), 0)
    : 0;
}

function readHostedWebhookReceiptString(
  value: Prisma.InputJsonValue | Prisma.JsonValue | null | undefined,
): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : null;
}

function readHostedWebhookReceiptStatusValue(
  value: Prisma.InputJsonValue | Prisma.JsonValue | null | undefined,
): HostedWebhookReceiptStatus | null {
  return value === "completed" || value === "failed" || value === "processing"
    ? value
    : null;
}

function readHostedWebhookSideEffectStatusValue(
  value: Prisma.InputJsonValue | Prisma.JsonValue | null | undefined,
): HostedWebhookSideEffectStatus | null {
  return value === "pending" || value === "sent" || value === "sent_unconfirmed"
    ? value
    : null;
}

function readHostedWebhookSideEffectError(
  value: Prisma.InputJsonValue | Prisma.JsonValue | null | undefined,
): HostedWebhookSideEffectErrorState | null {
  const errorObject = toHostedWebhookReceiptObject(value);
  const message = readHostedWebhookReceiptString(errorObject.message);
  const name = readHostedWebhookReceiptString(errorObject.name);

  return message && name
    ? {
        code: readHostedWebhookReceiptString(errorObject.code),
        message,
        name,
        retryable:
          typeof errorObject.retryable === "boolean"
            ? errorObject.retryable
            : null,
      }
    : null;
}

function serializeHostedWebhookSideEffect(
  effect: HostedWebhookSideEffect,
): Prisma.InputJsonObject {
  return {
    attemptCount: effect.attemptCount,
    effectId: effect.effectId,
    kind: effect.kind,
    lastAttemptAt: effect.lastAttemptAt,
    lastError: effect.lastError,
    payload: effect.payload as unknown as Prisma.InputJsonValue,
    result: effect.result as unknown as Prisma.InputJsonValue,
    sentAt: effect.sentAt,
    status: effect.status,
  } satisfies Prisma.InputJsonObject;
}

function readHostedWebhookSideEffect(
  value: Prisma.InputJsonValue | Prisma.JsonValue | null,
): HostedWebhookSideEffect | null {
  const effectObject = toHostedWebhookReceiptObject(value);
  const effectId = readHostedWebhookReceiptString(effectObject.effectId);
  const kind = readHostedWebhookReceiptString(effectObject.kind);
  const status = readHostedWebhookSideEffectStatusValue(effectObject.status);

  if (!effectId || !kind || !status) {
    return null;
  }

  const attemptCount = readHostedWebhookReceiptNumber(effectObject.attemptCount);
  const lastAttemptAt = readHostedWebhookReceiptString(effectObject.lastAttemptAt);
  const lastError = readHostedWebhookSideEffectError(effectObject.lastError);
  const sentAt = readHostedWebhookReceiptString(effectObject.sentAt);
  const payload = toHostedWebhookReceiptObject(effectObject.payload);
  const result = toHostedWebhookReceiptObject(effectObject.result);

  switch (kind) {
    case "hosted_execution_dispatch": {
      const dispatchPayload = payload.dispatch;

      if (dispatchPayload && typeof dispatchPayload === "object" && !Array.isArray(dispatchPayload)) {
        return {
          attemptCount,
          effectId,
          kind,
          lastAttemptAt,
          lastError,
          payload: {
            dispatch: dispatchPayload as unknown as HostedExecutionDispatchRequest,
          },
          result: result.dispatched === true ? { dispatched: true } : null,
          sentAt,
          status,
        };
      }

      const dispatchRef = readHostedExecutionDispatchRef(
        payload,
        {
          eventId: "",
          eventKind: "",
          occurredAt: null,
          userId: "",
        },
      );

      if (!dispatchRef) {
        return null;
      }

      return {
        attemptCount,
        effectId,
        kind,
        lastAttemptAt,
        lastError,
        payload: {
          botUserId: readHostedWebhookReceiptString(payload.botUserId),
          schemaVersion: payload.schemaVersion as string,
          dispatchRef,
          storage: "reference",
          linqEvent: toHostedWebhookReceiptRecord(payload.linqEvent),
          telegramUpdate: toHostedWebhookReceiptRecord(payload.telegramUpdate),
        },
        result: result.dispatched === true ? { dispatched: true } : null,
        sentAt,
        status,
      };
    }
    case "linq_message_send": {
      const chatId = readHostedWebhookReceiptString(payload.chatId);
      const message = readHostedWebhookReceiptString(payload.message);

      if (!chatId || !message) {
        return null;
      }

      return {
        attemptCount,
        effectId,
        kind,
        lastAttemptAt,
        lastError,
        payload: {
          chatId,
          inviteId: readHostedWebhookReceiptString(payload.inviteId),
          message,
          replyToMessageId: readHostedWebhookReceiptString(payload.replyToMessageId),
        },
        result:
          Object.keys(result).length === 0
            ? null
            : {
                chatId: readHostedWebhookReceiptString(result.chatId),
                messageId: readHostedWebhookReceiptString(result.messageId),
              },
        sentAt,
        status,
      };
    }
    case "revnet_invoice_issue": {
      const invoiceId = readHostedWebhookReceiptString(payload.invoiceId);
      const memberId = readHostedWebhookReceiptString(payload.memberId);
      const amountPaid = readHostedWebhookReceiptNumber(payload.amountPaid);

      if (!invoiceId || !memberId) {
        return null;
      }

      return {
        attemptCount,
        effectId,
        kind,
        lastAttemptAt,
        lastError,
        payload: {
          amountPaid,
          chargeId: readHostedWebhookReceiptString(payload.chargeId),
          currency: readHostedWebhookReceiptString(payload.currency),
          invoiceId,
          memberId,
          paymentIntentId: readHostedWebhookReceiptString(payload.paymentIntentId),
        },
        result:
          result.handled === true
            ? ({ handled: true } satisfies HostedWebhookRevnetIssuanceSideEffect["result"])
            : null,
        sentAt,
        status,
      };
    }
    default:
      return null;
  }
}

function generateHostedWebhookReceiptAttemptId(): string {
  return randomBytes(16).toString("hex");
}
