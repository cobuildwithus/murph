import { Prisma } from "@prisma/client";

import { hostedOnboardingError } from "./errors";
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
  dispatchPayloadJson: Prisma.InputJsonValue | Prisma.JsonValue | null;
  effectId: string;
  kind: string;
  lastAttemptAt: Date | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  lastErrorName: string | null;
  lastErrorRetryable: boolean | null;
  linqChatId: string | null;
  linqInviteId: string | null;
  linqReplyToMessageId: string | null;
  linqResultChatId: string | null;
  linqResultMessageId: string | null;
  linqTemplate: string | null;
  revnetAmountPaid: number | null;
  revnetChargeId: string | null;
  revnetCurrency: string | null;
  revnetInvoiceId: string | null;
  revnetMemberId: string | null;
  revnetPaymentIntentId: string | null;
  revnetResultHandled: boolean | null;
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
    lastErrorCode: value?.code ?? null,
    lastErrorMessage: value?.message ?? null,
    lastErrorName: value?.name ?? null,
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
    lastErrorCode: value?.code ?? null,
    lastErrorMessage: value?.message ?? null,
    lastErrorName: value?.name ?? null,
    lastErrorRetryable: value?.retryable ?? null,
  };
}

export function serializeHostedWebhookReceiptSideEffect(
  effect: HostedWebhookSideEffect,
): {
  attemptCount: number;
  dispatchPayloadJson: Prisma.InputJsonValue | typeof Prisma.DbNull;
  kind: "hosted_execution_dispatch" | "linq_message_send" | "revnet_invoice_issue";
  lastAttemptAt: Date | null;
  linqChatId: string | null;
  linqInviteId: string | null;
  linqReplyToMessageId: string | null;
  linqResultChatId: string | null;
  linqResultMessageId: string | null;
  linqTemplate: string | null;
  revnetAmountPaid: number | null;
  revnetChargeId: string | null;
  revnetCurrency: string | null;
  revnetInvoiceId: string | null;
  revnetMemberId: string | null;
  revnetPaymentIntentId: string | null;
  revnetResultHandled: boolean | null;
  sentAt: Date | null;
  status: "pending" | "sent_unconfirmed";
} & {
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  lastErrorName: string | null;
  lastErrorRetryable: boolean | null;
} {
  const errorFields = serializeHostedWebhookSideEffectErrorState(effect.lastError);

  switch (effect.kind) {
    case "hosted_execution_dispatch":
      return {
        ...errorFields,
        attemptCount: effect.attemptCount,
        dispatchPayloadJson: requireHostedWebhookStoredDispatchSideEffectPayload(
          effect.payload,
          effect.effectId,
        ) as unknown as Prisma.InputJsonValue,
        kind: effect.kind,
        lastAttemptAt: toDateOrNull(effect.lastAttemptAt),
        linqChatId: null,
        linqInviteId: null,
        linqReplyToMessageId: null,
        linqResultChatId: null,
        linqResultMessageId: null,
        linqTemplate: null,
        revnetAmountPaid: null,
        revnetChargeId: null,
        revnetCurrency: null,
        revnetInvoiceId: null,
        revnetMemberId: null,
        revnetPaymentIntentId: null,
        revnetResultHandled: null,
        sentAt: toDateOrNull(effect.sentAt),
        status: effect.status,
      };
    case "linq_message_send":
      return {
        ...errorFields,
        attemptCount: effect.attemptCount,
        dispatchPayloadJson: Prisma.DbNull,
        kind: effect.kind,
        lastAttemptAt: toDateOrNull(effect.lastAttemptAt),
        linqChatId: effect.payload.chatId,
        linqInviteId: effect.payload.inviteId,
        linqReplyToMessageId: effect.payload.replyToMessageId,
        linqResultChatId: effect.result?.chatId ?? null,
        linqResultMessageId: effect.result?.messageId ?? null,
        linqTemplate: effect.payload.template,
        revnetAmountPaid: null,
        revnetChargeId: null,
        revnetCurrency: null,
        revnetInvoiceId: null,
        revnetMemberId: null,
        revnetPaymentIntentId: null,
        revnetResultHandled: null,
        sentAt: toDateOrNull(effect.sentAt),
        status: effect.status,
      };
    case "revnet_invoice_issue":
      return {
        ...errorFields,
        attemptCount: effect.attemptCount,
        dispatchPayloadJson: Prisma.DbNull,
        kind: effect.kind,
        lastAttemptAt: toDateOrNull(effect.lastAttemptAt),
        linqChatId: null,
        linqInviteId: null,
        linqReplyToMessageId: null,
        linqResultChatId: null,
        linqResultMessageId: null,
        linqTemplate: null,
        revnetAmountPaid: effect.payload.amountPaid,
        revnetChargeId: effect.payload.chargeId,
        revnetCurrency: effect.payload.currency,
        revnetInvoiceId: effect.payload.invoiceId,
        revnetMemberId: effect.payload.memberId,
        revnetPaymentIntentId: effect.payload.paymentIntentId,
        revnetResultHandled: effect.result?.handled ?? null,
        sentAt: toDateOrNull(effect.sentAt),
        status: effect.status,
      };
    default:
      return assertNeverHostedWebhookSideEffect(effect);
  }
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
      const payload = readHostedWebhookStoredDispatchSideEffectPayload(record.dispatchPayloadJson);

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
        result: record.sentAt ? { dispatched: true } : null,
        sentAt,
        status,
      } satisfies HostedWebhookDispatchSideEffect;
    }
    case "linq_message_send": {
      if (!record.linqChatId || !isHostedWebhookLinqMessageTemplate(record.linqTemplate)) {
        throw buildHostedWebhookSideEffectPayloadError(record.effectId);
      }

      return {
        attemptCount,
        effectId: record.effectId,
        kind: "linq_message_send",
        lastAttemptAt,
        lastError,
        payload: {
          chatId: record.linqChatId,
          inviteId: record.linqInviteId,
          replyToMessageId: record.linqReplyToMessageId,
          template: record.linqTemplate,
        },
        result:
          record.linqResultChatId || record.linqResultMessageId
            ? {
                chatId: record.linqResultChatId,
                messageId: record.linqResultMessageId,
              }
            : null,
        sentAt,
        status,
      } satisfies HostedWebhookLinqMessageSideEffect;
    }
    case "revnet_invoice_issue": {
      const amountPaid = record.revnetAmountPaid;

      if (amountPaid === null || !Number.isFinite(amountPaid) || !record.revnetInvoiceId || !record.revnetMemberId) {
        throw buildHostedWebhookSideEffectPayloadError(record.effectId);
      }

      return {
        attemptCount,
        effectId: record.effectId,
        kind: "revnet_invoice_issue",
        lastAttemptAt,
        lastError,
        payload: {
          amountPaid: Math.max(Math.trunc(amountPaid), 0),
          chargeId: record.revnetChargeId,
          currency: record.revnetCurrency,
          invoiceId: record.revnetInvoiceId,
          memberId: record.revnetMemberId,
          paymentIntentId: record.revnetPaymentIntentId,
        },
        result: record.revnetResultHandled === true ? { handled: true } : null,
        sentAt,
        status,
      } satisfies HostedWebhookRevnetIssuanceSideEffect;
    }
    default:
      throw buildHostedWebhookSideEffectPayloadError(record.effectId);
  }
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

function isHostedWebhookLinqMessageTemplate(
  value: string | null,
): value is HostedWebhookLinqMessageSideEffect["payload"]["template"] {
  return value === "daily_quota" || value === "invite_signin" || value === "invite_signup";
}

function toDateOrNull(value: string | null): Date | null {
  if (!value) {
    return null;
  }

  return new Date(value);
}
