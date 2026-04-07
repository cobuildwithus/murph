import type {
  HostedExecutionDispatchRequest,
} from "@murphai/hosted-execution";
import type { PrismaClient } from "@prisma/client";
import { type Prisma } from "@prisma/client";

import {
  createHostedWebhookDispatchSideEffectPayload,
  type HostedWebhookDispatchSideEffectPayload as HostedWebhookDispatchPayload,
  type HostedWebhookStoredDispatchSideEffectPayload as HostedWebhookStoredDispatchPayload,
} from "./webhook-dispatch-payload";

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

export type HostedWebhookSideEffectStatus = "pending" | "sent_unconfirmed";

export type HostedWebhookDispatchSideEffectPayload = HostedWebhookDispatchPayload;
export type HostedWebhookStoredDispatchSideEffectPayload = HostedWebhookStoredDispatchPayload;

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
    replyToMessageId: string | null;
    template: "daily_quota" | "invite_signin" | "invite_signup";
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
  attemptId: string;
  completedAt: string | null;
  lastError: HostedWebhookReceiptErrorState | null;
  lastReceivedAt: string;
  plannedAt: string | null;
  sideEffects: HostedWebhookSideEffect[];
  status: HostedWebhookReceiptStatus;
};

export type HostedWebhookReceiptClaim = {
  eventId: string;
  source: string;
  state: HostedWebhookReceiptState;
  version: number;
};

export type HostedWebhookSideEffectResult =
  | NonNullable<HostedWebhookDispatchSideEffect["result"]>
  | NonNullable<HostedWebhookLinqMessageSideEffect["result"]>
  | NonNullable<HostedWebhookRevnetIssuanceSideEffect["result"]>;

export type HostedWebhookReceiptPersistenceClient = PrismaClient | Prisma.TransactionClient;

export type HostedWebhookDispatchEnqueueInput = {
  eventId: string;
  payload: HostedWebhookStoredDispatchSideEffectPayload;
  prismaOrTransaction: HostedWebhookReceiptPersistenceClient;
  source: string;
};

export type HostedWebhookReceiptHandlers = {
  afterSideEffectSent?: (input: {
    effect: HostedWebhookSideEffect;
    prisma: HostedWebhookReceiptPersistenceClient;
  }) => Promise<void>;
  enqueueDispatchEffect: (input: HostedWebhookDispatchEnqueueInput) => Promise<void>;
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
    payload: createHostedWebhookDispatchSideEffectPayload(input.dispatch),
    result: null,
    sentAt: null,
    status: "pending",
  };
}

export function createHostedWebhookLinqMessageSideEffect(input: {
  chatId: string;
  inviteId: string | null;
  replyToMessageId?: string | null;
  sourceEventId: string;
  template: HostedWebhookLinqMessageSideEffect["payload"]["template"];
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
      replyToMessageId: input.replyToMessageId ?? null,
      template: input.template,
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
