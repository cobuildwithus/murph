import { hostedOnboardingError } from "./errors";
import { sanitizeHostedOnboardingLogString } from "./http";
import { readHostedMemberRoutingState } from "./hosted-member-routing-store";
import { readHostedMemberSnapshot } from "./hosted-member-store";
import { buildHostedInviteUrl } from "./invite-service";
import {
  buildHostedDailyQuotaReply,
  buildHostedInviteReply,
  buildHostedLinqConversationHomeRedirectReply,
  sendHostedLinqChatMessage,
} from "./linq";
import { maybeIssueHostedRevnetForStripeInvoice } from "./stripe-revnet-issuance";
import type {
  HostedWebhookLinqConversationHomeRedirectPayload,
  HostedWebhookLinqInviteMessagePayload,
  HostedWebhookLinqMessagePayload,
  HostedWebhookReceiptPersistenceClient,
  HostedWebhookReceiptHandlers,
  HostedWebhookSideEffect,
} from "./webhook-receipt-types";
import { sanitizeHostedOnboardingStructuredLogDetails } from "./logging";

export function createHostedWebhookReceiptHandlers(): HostedWebhookReceiptHandlers {
  return {
    afterSideEffectSent: async ({
      effect,
      prisma,
    }: {
      effect: HostedWebhookSideEffect;
      prisma: HostedWebhookReceiptPersistenceClient;
    }) => {
      if (effect.kind === "linq_message_send" && isHostedInviteLinqMessagePayload(effect.payload)) {
        await markHostedInviteSentBestEffort(effect.payload.inviteId, prisma);
      }
    },
    performSideEffect: performHostedWebhookSideEffect,
  };
}

async function performHostedWebhookSideEffect(
  effect: HostedWebhookSideEffect,
  options: {
    prisma: HostedWebhookReceiptPersistenceClient;
    signal?: AbortSignal;
  },
): Promise<
  | { dispatched: true }
  | { delivered: true }
  | { handled: true }
> {
  switch (effect.kind) {
    case "hosted_execution_dispatch":
      throw new Error("Hosted execution dispatch effects must be queued through the execution outbox.");
    case "linq_message_send": {
      const startedAtMs = Date.now();
      try {
        await sendHostedLinqChatMessage({
          chatId: effect.payload.chatId,
          idempotencyKey: effect.effectId,
          message: await buildHostedLinqSideEffectMessage(effect, options.prisma),
          replyToMessageId: effect.payload.replyToMessageId,
          signal: options.signal,
        });
      } catch (error) {
        console.error(
          "Hosted Linq side-effect delivery failed.",
          buildHostedLinqSideEffectLogDetails(effect, error, Date.now() - startedAtMs),
        );
        throw error;
      }
      console.info(
        "Hosted Linq side-effect delivery completed.",
        buildHostedLinqSideEffectLogDetails(effect, null, Date.now() - startedAtMs),
      );
      return { delivered: true };
    }
    case "revnet_invoice_issue": {
      const member = await readHostedMemberSnapshot({
        memberId: effect.payload.memberId,
        prisma: options.prisma,
      });

      if (!member) {
        return { handled: true };
      }

      await maybeIssueHostedRevnetForStripeInvoice({
        invoice: {
          amount_paid: effect.payload.amountPaid,
          charge: effect.payload.chargeId,
          currency: effect.payload.currency,
          id: effect.payload.invoiceId,
          payment_intent: effect.payload.paymentIntentId,
        } as never,
        member,
        prisma: options.prisma,
      });

      return { handled: true };
    }
    default:
      throw new Error(`Unsupported hosted webhook side effect kind: ${JSON.stringify(effect)}`);
  }
}

function buildHostedLinqSideEffectLogDetails(
  effect: Extract<HostedWebhookSideEffect, { kind: "linq_message_send" }>,
  error: unknown,
  elapsedMs: number,
): Record<string, boolean | number | string> {
  const errorRecord = error && typeof error === "object" ? error as Record<string, unknown> : null;
  const nestedDetails = errorRecord?.details && typeof errorRecord.details === "object"
    ? errorRecord.details as Record<string, unknown>
    : null;

  return {
    elapsedMs: Math.max(0, elapsedMs),
    effectId: effect.effectId,
    hasIdempotencyKey: true,
    hasReplyToMessageId: typeof effect.payload.replyToMessageId === "string"
      && effect.payload.replyToMessageId.trim().length > 0,
    operation: "send_message",
    provider: "linq",
    retryable: readHostedLinqSideEffectRetryable(error),
    template: effect.payload.template,
    ...sanitizeHostedOnboardingStructuredLogDetails({
      errorCode: readHostedLinqSideEffectString(errorRecord, "code"),
      errorMessage:
        error instanceof Error
          ? error.message
          : typeof error === "string"
            ? error
            : null,
      errorName: error instanceof Error ? error.name : null,
      ...(nestedDetails ?? {}),
    }),
  };
}

function readHostedLinqSideEffectRetryable(error: unknown): boolean {
  return Boolean(
    error
      && typeof error === "object"
      && "retryable" in error
      && typeof error.retryable === "boolean"
      && error.retryable,
  );
}

function readHostedLinqSideEffectString(
  record: Record<string, unknown> | null,
  key: string,
): string | null {
  return record && typeof record[key] === "string"
    ? record[key] as string
    : null;
}

async function buildHostedLinqSideEffectMessage(
  effect: Extract<HostedWebhookSideEffect, { kind: "linq_message_send" }>,
  prisma: HostedWebhookReceiptPersistenceClient,
): Promise<string> {
  switch (effect.payload.template) {
    case "daily_quota":
      return buildHostedDailyQuotaReply();
    case "conversation_home_redirect": {
      const homeRecipientPhone = await resolveHostedHomeRecipientPhone(effect.payload, prisma);

      if (!homeRecipientPhone) {
        throw hostedOnboardingError({
          code: "LINQ_HOME_PHONE_REQUIRED",
          message: `Hosted webhook side effect ${effect.effectId} requires a home recipient phone.`,
          httpStatus: 500,
          retryable: false,
        });
      }

      return buildHostedLinqConversationHomeRedirectReply({
        homeRecipientPhone,
      });
    }
    case "invite_signin":
    case "invite_signup":
      return buildHostedInviteSideEffectMessage({
        effectId: effect.effectId,
        payload: effect.payload,
        prisma,
      });
  }
}

async function resolveHostedHomeRecipientPhone(
  payload: HostedWebhookLinqConversationHomeRedirectPayload,
  prisma: HostedWebhookReceiptPersistenceClient,
): Promise<string | null> {
  if (payload.memberId) {
    const routing = await readHostedMemberRoutingState({
      memberId: payload.memberId,
      prisma,
    });

    if (routing?.linqRecipientPhone) {
      return routing.linqRecipientPhone;
    }
  }

  return payload.homeRecipientPhone;
}

async function buildHostedInviteSideEffectMessage(input: {
  effectId: string;
  payload: HostedWebhookLinqInviteMessagePayload;
  prisma: HostedWebhookReceiptPersistenceClient;
}): Promise<string> {
  const inviteLookup =
    "findUnique" in input.prisma.hostedInvite && typeof input.prisma.hostedInvite.findUnique === "function"
      ? input.prisma.hostedInvite.findUnique({
          where: {
            id: input.payload.inviteId,
          },
          select: {
            inviteCode: true,
          },
        })
      : input.prisma.hostedInvite.findFirst({
          where: {
            id: input.payload.inviteId,
          },
          select: {
            inviteCode: true,
          },
        });
  const invite = await inviteLookup;

  if (!invite) {
    throw hostedOnboardingError({
      code: "HOSTED_INVITE_NOT_FOUND",
      message: `Hosted invite ${input.payload.inviteId} was not found for webhook side effect ${input.effectId}.`,
      httpStatus: 500,
      retryable: false,
    });
  }

  return buildHostedInviteReply({
    activeSubscription: input.payload.template === "invite_signin",
    joinUrl: buildHostedInviteUrl(invite.inviteCode),
  });
}

function isHostedInviteLinqMessagePayload(
  payload: HostedWebhookLinqMessagePayload,
): payload is HostedWebhookLinqInviteMessagePayload {
  return payload.template === "invite_signin" || payload.template === "invite_signup";
}

async function markHostedInviteSentBestEffort(
  inviteId: string,
  prisma: HostedWebhookReceiptPersistenceClient,
): Promise<void> {
  try {
    await prisma.hostedInvite.update({
      where: {
        id: inviteId,
      },
      data: {
        sentAt: new Date(),
      },
    });
  } catch (error) {
    console.error(
      "Hosted invite sentAt update failed.",
      sanitizeHostedOnboardingLogString(
        error instanceof Error ? error.message : String(error),
      ) ?? "Unknown error.",
    );
  }
}
