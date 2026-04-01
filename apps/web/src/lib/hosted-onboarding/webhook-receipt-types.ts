import type {
  HostedExecutionDispatchRequest,
  HostedExecutionDispatchRef,
} from "@murphai/hosted-execution";
import {
  HOSTED_EXECUTION_OUTBOX_PAYLOAD_SCHEMA_VERSION,
  buildHostedExecutionDispatchRef,
} from "@murphai/hosted-execution";
import { Prisma, type PrismaClient } from "@prisma/client";

import {
  minimizeHostedLinqMessageReceivedEvent,
  minimizeHostedTelegramUpdate,
} from "./webhook-event-snapshots";
import {
  sanitizeHostedLinqEventForStorage,
  sanitizeHostedTelegramUpdateForStorage,
} from "./contact-privacy";

export type HostedWebhookEventPayload = Prisma.InputJsonObject;
export type HostedWebhookResponsePayload = Prisma.InputJsonObject;

export type HostedWebhookReceiptErrorState = {
  code: string | null;
  message: string;
  name: string;
  retryable: boolean | null;
};

export type HostedWebhookSideEffectErrorState = {
  code: string | null;
  message: string;
  name: string;
  retryable: boolean | null;
};

export type HostedWebhookSideEffectStatus = "pending" | "sent" | "sent_unconfirmed";

export type HostedWebhookDispatchSideEffectPayload = {
  schemaVersion: string;
  botUserId?: string | null;
  dispatchRef: HostedExecutionDispatchRef;
  phoneLookupKey?: string | null;
  storage: "reference";
  linqEvent?: Record<string, unknown> | null;
  telegramUpdate?: Record<string, unknown> | null;
};

export type HostedWebhookDispatchSideEffect = {
  attemptCount: number;
  effectId: string;
  kind: "hosted_execution_dispatch";
  lastAttemptAt: string | null;
  lastError: HostedWebhookSideEffectErrorState | null;
  payload: HostedWebhookDispatchSideEffectPayload;
  result: {
    dispatched: true;
  } | null;
  sentAt: string | null;
  status: HostedWebhookSideEffectStatus;
};

export type HostedWebhookLinqMessageSideEffect = {
  attemptCount: number;
  effectId: string;
  kind: "linq_message_send";
  lastAttemptAt: string | null;
  lastError: HostedWebhookSideEffectErrorState | null;
  payload: {
    chatId: string;
    inviteId: string | null;
    message: string;
    replyToMessageId: string | null;
  };
  result: {
    chatId: string | null;
    messageId: string | null;
  } | null;
  sentAt: string | null;
  status: HostedWebhookSideEffectStatus;
};

export type HostedWebhookRevnetIssuanceSideEffect = {
  attemptCount: number;
  effectId: string;
  kind: "revnet_invoice_issue";
  lastAttemptAt: string | null;
  lastError: HostedWebhookSideEffectErrorState | null;
  payload: {
    amountPaid: number;
    chargeId: string | null;
    currency: string | null;
    invoiceId: string;
    memberId: string;
    paymentIntentId: string | null;
  };
  result: {
    handled: true;
  } | null;
  sentAt: string | null;
  status: HostedWebhookSideEffectStatus;
};

export type HostedWebhookSideEffect =
  | HostedWebhookDispatchSideEffect
  | HostedWebhookLinqMessageSideEffect
  | HostedWebhookRevnetIssuanceSideEffect;

export type HostedWebhookReceiptStatus = "completed" | "failed" | "processing";

export type HostedWebhookReceiptState = {
  attemptCount: number;
  attemptId: string | null;
  completedAt: string | null;
  eventPayload: HostedWebhookEventPayload;
  lastError: HostedWebhookReceiptErrorState | null;
  lastReceivedAt: string | null;
  plannedAt: string | null;
  response: HostedWebhookResponsePayload | null;
  sideEffects: HostedWebhookSideEffect[];
  status: HostedWebhookReceiptStatus | null;
};

export type HostedWebhookReceiptClaim = {
  payloadJson: Prisma.InputJsonValue | Prisma.JsonValue | null;
  state: HostedWebhookReceiptState;
};

export type HostedWebhookSideEffectResult =
  | NonNullable<HostedWebhookDispatchSideEffect["result"]>
  | NonNullable<HostedWebhookLinqMessageSideEffect["result"]>
  | NonNullable<HostedWebhookRevnetIssuanceSideEffect["result"]>;

export type HostedWebhookReceiptPersistenceClient = PrismaClient | Prisma.TransactionClient;

export type HostedWebhookDispatchEnqueueInput = {
  dispatch: HostedExecutionDispatchRequest;
  eventId: string;
  nextPayloadJson: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput;
  nextStatus: HostedWebhookReceiptStatus | null;
  previousClaim: HostedWebhookReceiptClaim;
  prismaOrTransaction: HostedWebhookReceiptPersistenceClient;
  source: string;
};

export type HostedWebhookReceiptHandlers = {
  afterSideEffectSent?: (input: {
    effect: HostedWebhookSideEffect;
    prisma: HostedWebhookReceiptPersistenceClient;
  }) => Promise<void>;
  enqueueDispatchEffect: (input: HostedWebhookDispatchEnqueueInput) => Promise<number>;
  performSideEffect: (
    effect: HostedWebhookSideEffect,
    options: {
      prisma: HostedWebhookReceiptPersistenceClient;
      signal?: AbortSignal;
    },
  ) => Promise<HostedWebhookSideEffectResult>;
};

export type HostedWebhookPlan<TResult extends HostedWebhookResponsePayload> = {
  desiredSideEffects: HostedWebhookSideEffect[];
  response: TResult;
};

export class HostedWebhookReceiptSideEffectDrainError extends Error {
  readonly claimedReceipt: HostedWebhookReceiptClaim;
  readonly cause: unknown;

  constructor(claimedReceipt: HostedWebhookReceiptClaim, cause: unknown) {
    super("Hosted webhook side-effect drain failed.");
    this.name = "HostedWebhookReceiptSideEffectDrainError";
    this.claimedReceipt = claimedReceipt;
    this.cause = cause;
  }
}

export function createHostedWebhookDispatchSideEffect(input: {
  dispatch: HostedExecutionDispatchRequest;
}): HostedWebhookDispatchSideEffect {
  return {
    attemptCount: 0,
    effectId: `dispatch:${input.dispatch.eventId}`,
    kind: "hosted_execution_dispatch",
    lastAttemptAt: null,
    lastError: null,
    payload: buildHostedWebhookDispatchSideEffectPayload(input.dispatch),
    result: null,
    sentAt: null,
    status: "pending",
  };
}

function buildHostedWebhookDispatchSideEffectPayload(
  dispatch: HostedExecutionDispatchRequest,
): HostedWebhookDispatchSideEffectPayload {
  const basePayload = {
    dispatchRef: buildHostedExecutionDispatchRef(dispatch),
    schemaVersion: HOSTED_EXECUTION_OUTBOX_PAYLOAD_SCHEMA_VERSION,
    storage: "reference",
  } satisfies HostedWebhookDispatchSideEffectPayload;

  switch (dispatch.event.kind) {
    case "linq.message.received":
      return {
        ...basePayload,
        linqEvent: sanitizeHostedLinqEventForStorage(
          minimizeHostedLinqMessageReceivedEvent(dispatch.event.linqEvent as never),
          {
            omitRecipientPhone: true,
          },
        ),
        phoneLookupKey: dispatch.event.phoneLookupKey,
      };
    case "telegram.message.received":
      return {
        ...basePayload,
        botUserId: dispatch.event.botUserId,
        telegramUpdate: sanitizeHostedTelegramUpdateForStorage(
          minimizeHostedTelegramUpdate(dispatch.event.telegramUpdate as never),
        ),
      };
    default:
      return basePayload;
  }
}

export function createHostedWebhookLinqMessageSideEffect(input: {
  chatId: string;
  inviteId: string | null;
  message: string;
  replyToMessageId?: string | null;
  sourceEventId: string;
}): HostedWebhookLinqMessageSideEffect {
  return {
    attemptCount: 0,
    effectId: `linq-message:${input.sourceEventId}`,
    kind: "linq_message_send",
    lastAttemptAt: null,
    lastError: null,
    payload: {
      chatId: input.chatId,
      inviteId: input.inviteId,
      message: input.message,
      replyToMessageId: input.replyToMessageId ?? null,
    },
    result: null,
    sentAt: null,
    status: "pending",
  };
}

export function createHostedWebhookRevnetIssuanceSideEffect(input: {
  amountPaid: number;
  chargeId: string | null;
  currency: string | null;
  invoiceId: string;
  memberId: string;
  paymentIntentId: string | null;
}): HostedWebhookRevnetIssuanceSideEffect {
  return {
    attemptCount: 0,
    effectId: `revnet-issuance:${input.invoiceId}`,
    kind: "revnet_invoice_issue",
    lastAttemptAt: null,
    lastError: null,
    payload: {
      amountPaid: input.amountPaid,
      chargeId: input.chargeId,
      currency: input.currency,
      invoiceId: input.invoiceId,
      memberId: input.memberId,
      paymentIntentId: input.paymentIntentId,
    },
    result: null,
    sentAt: null,
    status: "pending",
  };
}
