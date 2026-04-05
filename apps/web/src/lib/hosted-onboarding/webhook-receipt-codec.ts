import { randomBytes } from "node:crypto";

import {
  readHostedExecutionDispatchRef,
} from "@murphai/hosted-execution";
import { Prisma } from "@prisma/client";

import { createHostedOpaqueIdentifier } from "./contact-privacy";
import { hostedOnboardingError } from "./errors";
import type {
  HostedWebhookEventPayload,
  HostedWebhookLinqMessageSideEffect,
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
  return readHostedWebhookErrorState<HostedWebhookReceiptErrorState>(value);
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
  return readHostedWebhookErrorState<HostedWebhookSideEffectErrorState>(value);
}

function readHostedWebhookErrorState<TErrorState extends HostedWebhookReceiptErrorState | HostedWebhookSideEffectErrorState>(
  value: Prisma.InputJsonValue | Prisma.JsonValue | null | undefined,
): TErrorState | null {
  const errorObject = toHostedWebhookReceiptObject(value);
  const message = readHostedWebhookReceiptString(errorObject.message);
  const name = readHostedWebhookReceiptString(errorObject.name);

  if (!message || !name) {
    return null;
  }

  return {
    code: readHostedWebhookReceiptString(errorObject.code),
    message,
    name,
    retryable:
      typeof errorObject.retryable === "boolean"
        ? errorObject.retryable
        : null,
  } as TErrorState;
}

function serializeHostedLinqMessageSideEffectPayload(
  payload: HostedWebhookLinqMessageSideEffect["payload"],
): Prisma.InputJsonObject {
  return {
    chatId: payload.chatId,
    inviteId: payload.inviteId,
    replyToMessageId: payload.replyToMessageId,
    template: payload.template,
  } satisfies Prisma.InputJsonObject;
}

function serializeHostedLinqMessageSideEffectResult(
  result: HostedWebhookLinqMessageSideEffect["result"],
): Prisma.InputJsonValue | null {
  if (!result) {
    return null;
  }

  return {
    chatId: createHostedOpaqueIdentifier("linq.chat", result.chatId),
    messageId: createHostedOpaqueIdentifier("linq.message", result.messageId),
  } satisfies Prisma.InputJsonObject;
}

function readHostedWebhookLinqMessageSideEffectPayload(
  payload: Record<string, Prisma.InputJsonValue | Prisma.JsonValue | null>,
): HostedWebhookLinqMessageSideEffect["payload"] | null {
  const chatId = readHostedWebhookReceiptString(payload.chatId);
  const template = readHostedWebhookReceiptString(payload.template);

  if (!chatId || !isHostedWebhookLinqMessageTemplate(template)) {
    return null;
  }

  return {
    chatId,
    inviteId: readHostedWebhookReceiptString(payload.inviteId),
    replyToMessageId: readHostedWebhookReceiptString(payload.replyToMessageId),
    template,
  } satisfies HostedWebhookLinqMessageSideEffect["payload"];
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
    payload:
      effect.kind === "linq_message_send"
        ? serializeHostedLinqMessageSideEffectPayload(effect.payload)
        : effect.payload as unknown as Prisma.InputJsonValue,
    result:
      effect.kind === "linq_message_send"
        ? serializeHostedLinqMessageSideEffectResult(effect.result)
        : effect.result as unknown as Prisma.InputJsonValue,
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
      const dispatchRef = readHostedExecutionDispatchRef(payload);

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
          phoneLookupKey: readHostedWebhookReceiptString(payload.phoneLookupKey),
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
      const linqPayload = readHostedWebhookLinqMessageSideEffectPayload(payload);

      if (!linqPayload) {
        throw buildHostedWebhookSideEffectPayloadError(effectId);
      }

      return {
        attemptCount,
        effectId,
        kind,
        lastAttemptAt,
        lastError,
        payload: linqPayload,
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

function buildHostedWebhookSideEffectPayloadError(effectId: string): Error {
  return hostedOnboardingError({
    code: "WEBHOOK_SIDE_EFFECT_PAYLOAD_INVALID",
    message: `Hosted webhook side effect ${effectId} stores an invalid or legacy payload shape.`,
    httpStatus: 500,
  });
}

function isHostedWebhookLinqMessageTemplate(
  value: string | null,
): value is HostedWebhookLinqMessageSideEffect["payload"]["template"] {
  return value === "daily_quota" || value === "invite_signin" || value === "invite_signup";
}

export function generateHostedWebhookReceiptAttemptId(): string {
  return randomBytes(16).toString("hex");
}
