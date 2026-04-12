import { Prisma } from "@prisma/client";

import { hostedOnboardingError } from "./errors";
import {
  sanitizeHostedOnboardingPersistedErrorCode,
  sanitizeHostedOnboardingPersistedErrorMessage,
  sanitizeHostedOnboardingPersistedErrorName,
} from "./http";
import {
  readHostedWebhookStoredDispatchSideEffectPayload,
  requireHostedWebhookStoredDispatchSideEffectPayload,
} from "./webhook-dispatch-payload";
import type {
  HostedWebhookDispatchSideEffect,
  HostedWebhookLinqMessageSideEffect,
  HostedWebhookReceiptErrorState,
  HostedWebhookReceiptState,
  HostedWebhookRevnetIssuanceSideEffect,
  HostedWebhookSideEffect,
  HostedWebhookSideEffectErrorState,
} from "./webhook-receipt-types";

type HostedWebhookReceiptRecordLike = {
  attemptCount: number;
  attemptId: string;
  completedAt: Date | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  lastErrorName: string | null;
  lastErrorRetryable: boolean | null;
  lastReceivedAt: Date;
  plannedAt: Date | null;
  status: string;
};

type HostedWebhookReceiptSideEffectRecordLike = {
  attemptCount: number;
  effectId: string;
  kind: string;
  lastAttemptAt: Date | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  lastErrorName: string | null;
  lastErrorRetryable: boolean | null;
  payloadJson: Prisma.InputJsonValue | Prisma.JsonValue | null;
  resultJson: Prisma.InputJsonValue | Prisma.JsonValue | null;
  sentAt: Date | null;
  status: string;
};

export function readHostedWebhookReceiptState(input: {
  receipt: HostedWebhookReceiptRecordLike;
  sideEffects?: readonly HostedWebhookReceiptSideEffectRecordLike[] | null;
}): HostedWebhookReceiptState {
  const status = readHostedWebhookReceiptStatus(input.receipt.status);
  const lastReceivedAt = input.receipt.lastReceivedAt.toISOString();

  return {
    attemptCount: Math.max(Math.trunc(input.receipt.attemptCount), 1),
    attemptId: input.receipt.attemptId,
    completedAt: input.receipt.completedAt?.toISOString() ?? null,
    lastError: readHostedWebhookErrorState({
      code: input.receipt.lastErrorCode,
      message: input.receipt.lastErrorMessage,
      name: input.receipt.lastErrorName,
      retryable: input.receipt.lastErrorRetryable,
    }),
    lastReceivedAt,
    plannedAt: input.receipt.plannedAt?.toISOString() ?? null,
    sideEffects: (input.sideEffects ?? []).map((effect) => readHostedWebhookReceiptSideEffect(effect)),
    status,
  };
}

export function serializeHostedWebhookReceiptErrorState(
  value: HostedWebhookReceiptErrorState | null,
): {
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  lastErrorName: string | null;
  lastErrorRetryable: boolean | null;
} {
  return {
    lastErrorCode: sanitizeHostedOnboardingPersistedErrorCode(value?.code),
    lastErrorMessage: sanitizeHostedOnboardingPersistedErrorMessage(value?.message),
    lastErrorName: sanitizeHostedOnboardingPersistedErrorName(value?.name),
    lastErrorRetryable: value?.retryable ?? null,
  };
}

export function serializeHostedWebhookSideEffectErrorState(
  value: HostedWebhookSideEffectErrorState | null,
): {
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  lastErrorName: string | null;
  lastErrorRetryable: boolean | null;
} {
  return {
    lastErrorCode: sanitizeHostedOnboardingPersistedErrorCode(value?.code),
    lastErrorMessage: sanitizeHostedOnboardingPersistedErrorMessage(value?.message),
    lastErrorName: sanitizeHostedOnboardingPersistedErrorName(value?.name),
    lastErrorRetryable: value?.retryable ?? null,
  };
}

export function serializeHostedWebhookReceiptSideEffect(
  effect: HostedWebhookSideEffect,
): {
  attemptCount: number;
  kind: HostedWebhookSideEffect["kind"];
  lastAttemptAt: Date | null;
  payloadJson: Prisma.InputJsonValue;
  resultJson: Prisma.InputJsonValue | typeof Prisma.DbNull;
  sentAt: Date | null;
  status: HostedWebhookSideEffect["status"];
} & {
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  lastErrorName: string | null;
  lastErrorRetryable: boolean | null;
} {
  const errorFields = serializeHostedWebhookSideEffectErrorState(effect.lastError);

  return {
    ...errorFields,
    attemptCount: effect.attemptCount,
    kind: effect.kind,
    lastAttemptAt: toDateOrNull(effect.lastAttemptAt),
    payloadJson: serializeHostedWebhookSideEffectPayload(effect),
    resultJson: serializeHostedWebhookSideEffectResult(effect),
    sentAt: toDateOrNull(effect.sentAt),
    status: effect.status,
  };
}

function readHostedWebhookReceiptSideEffect(
  record: HostedWebhookReceiptSideEffectRecordLike,
): HostedWebhookSideEffect {
  const lastError = readHostedWebhookErrorState({
    code: record.lastErrorCode,
    message: record.lastErrorMessage,
    name: record.lastErrorName,
    retryable: record.lastErrorRetryable,
  });
  const attemptCount = Math.max(Math.trunc(record.attemptCount), 0);
  const lastAttemptAt = record.lastAttemptAt?.toISOString() ?? null;
  const sentAt = record.sentAt?.toISOString() ?? null;
  const status = readHostedWebhookSideEffectStatus(record.status);

  switch (record.kind) {
    case "hosted_execution_dispatch": {
      const payload = readHostedWebhookStoredDispatchSideEffectPayload(record.payloadJson);

      if (!payload) {
        throw buildHostedWebhookSideEffectPayloadError(record.effectId);
      }

      return {
        attemptCount,
        effectId: record.effectId,
        kind: "hosted_execution_dispatch",
        lastAttemptAt,
        lastError,
        payload,
        result: readHostedWebhookDispatchSideEffectResult(record.resultJson, sentAt),
        sentAt,
        status,
      } satisfies HostedWebhookDispatchSideEffect;
    }
    case "linq_message_send": {
      const payload = readHostedWebhookLinqMessagePayload(record.payloadJson);

      if (!payload) {
        throw buildHostedWebhookSideEffectPayloadError(record.effectId);
      }

      return {
        attemptCount,
        effectId: record.effectId,
        kind: "linq_message_send",
        lastAttemptAt,
        lastError,
        payload,
        result: readHostedWebhookLinqMessageResult(record.resultJson),
        sentAt,
        status,
      } satisfies HostedWebhookLinqMessageSideEffect;
    }
    case "revnet_invoice_issue": {
      const payload = readHostedWebhookRevnetIssuancePayload(record.payloadJson);

      if (!payload) {
        throw buildHostedWebhookSideEffectPayloadError(record.effectId);
      }

      return {
        attemptCount,
        effectId: record.effectId,
        kind: "revnet_invoice_issue",
        lastAttemptAt,
        lastError,
        payload,
        result: readHostedWebhookRevnetIssuanceResult(record.resultJson),
        sentAt,
        status,
      } satisfies HostedWebhookRevnetIssuanceSideEffect;
    }
    default:
      throw buildHostedWebhookSideEffectPayloadError(record.effectId);
  }
}

function serializeHostedWebhookSideEffectPayload(
  effect: HostedWebhookSideEffect,
): Prisma.InputJsonValue {
  switch (effect.kind) {
    case "hosted_execution_dispatch":
      return requireHostedWebhookStoredDispatchSideEffectPayload(
        effect.payload,
        effect.effectId,
      ) as unknown as Prisma.InputJsonValue;
    case "linq_message_send":
    case "revnet_invoice_issue":
      return effect.payload as unknown as Prisma.InputJsonValue;
    default:
      return assertNeverHostedWebhookSideEffect(effect);
  }
}

function serializeHostedWebhookSideEffectResult(
  effect: HostedWebhookSideEffect,
): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return effect.result
    ? effect.result as unknown as Prisma.InputJsonValue
    : Prisma.DbNull;
}

function readHostedWebhookDispatchSideEffectResult(
  value: Prisma.InputJsonValue | Prisma.JsonValue | null,
  sentAt: string | null,
): HostedWebhookDispatchSideEffect["result"] {
  const record = readHostedWebhookJsonObject(value);

  if (record?.dispatched === true || sentAt) {
    return { dispatched: true };
  }

  return null;
}

function readHostedWebhookLinqMessagePayload(
  value: Prisma.InputJsonValue | Prisma.JsonValue | null,
): HostedWebhookLinqMessageSideEffect["payload"] | null {
  const record = readHostedWebhookJsonObject(value);
  const chatId = readRequiredString(record?.chatId);
  const template = readHostedWebhookLinqMessageTemplate(record?.template);

  if (!chatId || !template) {
    return null;
  }

  return {
    chatId,
    homeRecipientPhone: readNullableString(record?.homeRecipientPhone),
    inviteId: readNullableString(record?.inviteId),
    replyToMessageId: readNullableString(record?.replyToMessageId),
    template,
  };
}

function readHostedWebhookLinqMessageResult(
  value: Prisma.InputJsonValue | Prisma.JsonValue | null,
): HostedWebhookLinqMessageSideEffect["result"] {
  const record = readHostedWebhookJsonObject(value);

  if (!record) {
    return null;
  }

  const chatId = readNullableString(record.chatId);
  const messageId = readNullableString(record.messageId);

  if (chatId === null && messageId === null) {
    return null;
  }

  return {
    chatId,
    messageId,
  };
}

function readHostedWebhookRevnetIssuancePayload(
  value: Prisma.InputJsonValue | Prisma.JsonValue | null,
): HostedWebhookRevnetIssuanceSideEffect["payload"] | null {
  const record = readHostedWebhookJsonObject(value);
  const amountPaid = readFiniteNumber(record?.amountPaid);
  const invoiceId = readRequiredString(record?.invoiceId);
  const memberId = readRequiredString(record?.memberId);

  if (amountPaid === null || !invoiceId || !memberId) {
    return null;
  }

  return {
    amountPaid: Math.max(Math.trunc(amountPaid), 0),
    chargeId: readNullableString(record?.chargeId),
    currency: readNullableString(record?.currency),
    invoiceId,
    memberId,
    paymentIntentId: readNullableString(record?.paymentIntentId),
  };
}

function readHostedWebhookRevnetIssuanceResult(
  value: Prisma.InputJsonValue | Prisma.JsonValue | null,
): HostedWebhookRevnetIssuanceSideEffect["result"] {
  const record = readHostedWebhookJsonObject(value);

  return record?.handled === true ? { handled: true } : null;
}

function readHostedWebhookJsonObject(
  value: Prisma.InputJsonValue | Prisma.JsonValue | null,
): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function readRequiredString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readNullableString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  return typeof value === "string" ? value : null;
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readHostedWebhookLinqMessageTemplate(
  value: unknown,
): HostedWebhookLinqMessageSideEffect["payload"]["template"] | null {
  return value === "conversation_home_redirect"
    || value === "daily_quota"
    || value === "invite_signin"
    || value === "invite_signup"
    ? value
    : null;
}

function readHostedWebhookErrorState(input: {
  code: string | null;
  message: string | null;
  name: string | null;
  retryable: boolean | null;
}): HostedWebhookReceiptErrorState | null {
  if (!input.message || !input.name) {
    return null;
  }

  return {
    code: input.code,
    message: input.message,
    name: input.name,
    retryable: input.retryable,
  };
}

function readHostedWebhookReceiptStatus(
  value: string,
): HostedWebhookReceiptState["status"] {
  if (value === "processing" || value === "completed" || value === "failed") {
    return value;
  }

  throw hostedOnboardingError({
    code: "WEBHOOK_RECEIPT_STATUS_INVALID",
    message: `Hosted webhook receipt status ${JSON.stringify(value)} is invalid.`,
    httpStatus: 500,
  });
}

function readHostedWebhookSideEffectStatus(
  value: string,
): HostedWebhookSideEffect["status"] {
  if (value === "pending" || value === "sent_unconfirmed") {
    return value;
  }

  throw hostedOnboardingError({
    code: "WEBHOOK_SIDE_EFFECT_STATUS_INVALID",
    message: `Hosted webhook side-effect status ${JSON.stringify(value)} is invalid.`,
    httpStatus: 500,
  });
}

function buildHostedWebhookSideEffectPayloadError(effectId: string): Error {
  return hostedOnboardingError({
    code: "WEBHOOK_SIDE_EFFECT_PAYLOAD_INVALID",
    message: `Hosted webhook side effect ${effectId} stores an invalid or legacy payload shape.`,
    httpStatus: 500,
  });
}

function assertNeverHostedWebhookSideEffect(value: never): never {
  throw hostedOnboardingError({
    code: "WEBHOOK_SIDE_EFFECT_KIND_INVALID",
    message: `Hosted webhook side effect kind is invalid: ${JSON.stringify(value)}.`,
    httpStatus: 500,
  });
}

function toDateOrNull(value: string | null): Date | null {
  if (!value) {
    return null;
  }

  return new Date(value);
}
