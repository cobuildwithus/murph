import type { PrismaClient } from "@prisma/client";
import { type Prisma } from "@prisma/client";

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

export type HostedWebhookLinqConversationHomeRedirectPayload = {
  chatId: string;
  homeRecipientPhone: string | null;
  memberId: string | null;
  replyToMessageId: string | null;
  template: "conversation_home_redirect";
};

export type HostedWebhookLinqDailyQuotaPayload = {
  chatId: string;
  replyToMessageId: string | null;
  template: "daily_quota";
};

export type HostedWebhookLinqInviteMessagePayload = {
  chatId: string;
  inviteId: string;
  replyToMessageId: string | null;
  template: "invite_signin" | "invite_signup";
};

export type HostedWebhookLinqMessagePayload =
  | HostedWebhookLinqConversationHomeRedirectPayload
  | HostedWebhookLinqDailyQuotaPayload
  | HostedWebhookLinqInviteMessagePayload;

export type HostedWebhookLinqMessageSideEffect = {
  attemptCount: number;
  effectId: string;
  kind: "linq_message_send";
  lastAttemptAt: string | null;
  lastError: HostedWebhookSideEffectErrorState | null;
  payload: HostedWebhookLinqMessagePayload;
  result: {
    delivered: true;
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
  | HostedWebhookLinqMessageSideEffect
  | HostedWebhookRevnetIssuanceSideEffect;
export type HostedWebhookReceiptLocalSideEffect = HostedWebhookSideEffect;

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
  | NonNullable<HostedWebhookLinqMessageSideEffect["result"]>
  | NonNullable<HostedWebhookRevnetIssuanceSideEffect["result"]>;

export type HostedWebhookReceiptPersistenceClient = PrismaClient | Prisma.TransactionClient;

export type HostedWebhookReceiptHandlers = {
  afterSideEffectSent?: (input: {
    effect: HostedWebhookSideEffect;
    prisma: HostedWebhookReceiptPersistenceClient;
  }) => Promise<void>;
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

export type CreateHostedWebhookLinqMessageSideEffectInput =
  | {
      chatId: string;
      homeRecipientPhone?: string | null;
      memberId: string;
      replyToMessageId?: string | null;
      sourceEventId: string;
      template: "conversation_home_redirect";
    }
  | {
      chatId: string;
      replyToMessageId?: string | null;
      sourceEventId: string;
      template: "daily_quota";
    }
  | {
      chatId: string;
      inviteId: string;
      replyToMessageId?: string | null;
      sourceEventId: string;
      template: "invite_signin" | "invite_signup";
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

export function createHostedWebhookLinqMessageSideEffect(
  input: CreateHostedWebhookLinqMessageSideEffectInput,
): HostedWebhookLinqMessageSideEffect {
  const replyToMessageId = input.replyToMessageId ?? null;

  return {
    attemptCount: 0,
    effectId: `linq-message:${input.sourceEventId}`,
    kind: "linq_message_send",
    lastAttemptAt: null,
    lastError: null,
    payload: buildHostedWebhookLinqMessagePayload(input, replyToMessageId),
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

function buildHostedWebhookLinqMessagePayload(
  input: CreateHostedWebhookLinqMessageSideEffectInput,
  replyToMessageId: string | null,
): HostedWebhookLinqMessagePayload {
  switch (input.template) {
    case "conversation_home_redirect":
      return {
        chatId: input.chatId,
        homeRecipientPhone: input.homeRecipientPhone ?? null,
        memberId: input.memberId,
        replyToMessageId,
        template: input.template,
      };
    case "daily_quota":
      return {
        chatId: input.chatId,
        replyToMessageId,
        template: input.template,
      };
    case "invite_signin":
    case "invite_signup":
      return {
        chatId: input.chatId,
        inviteId: input.inviteId,
        replyToMessageId,
        template: input.template,
      };
  }
}
