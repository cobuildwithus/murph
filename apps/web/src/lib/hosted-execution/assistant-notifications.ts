import "server-only";

import type { Prisma } from "@prisma/client";
import {
  buildHostedExecutionAssistantNotificationRequestedWake,
  type HostedExecutionAssistantNotificationResponsePolicy,
  type HostedExecutionAssistantNotificationRoute,
} from "@murphai/hosted-execution";

import { appendHostedMailboxEnvelopeTx } from "../hosted-mailbox/store";
import { readHostedMemberIdentity } from "../hosted-onboarding/hosted-member-identity-store";
import { readHostedMemberRoutingState } from "../hosted-onboarding/hosted-member-routing-store";
import {
  resolveHostedMemberAssistantNotificationRoute,
  resolveHostedMemberMessagingState,
} from "../hosted-onboarding/messaging-state";
import {
  signalHostedMailboxAppendsBestEffort,
  type HostedMailboxAppendSignal,
} from "../hosted-orchestration/signal-runtime";

export type HostedAssistantNotificationSignal = HostedMailboxAppendSignal;

export async function appendHostedAssistantNotificationTx(input: {
  deliveryDispatchMode?: "queue-only";
  eventId: string;
  instructions: string;
  memberId: string;
  occurredAt: string;
  responsePolicy: HostedExecutionAssistantNotificationResponsePolicy;
  route: HostedExecutionAssistantNotificationRoute | null;
  tx: Prisma.TransactionClient;
}): Promise<{ mailboxItemId: string | null }> {
  if (!input.route) {
    return { mailboxItemId: null };
  }

  const append = await appendHostedMailboxEnvelopeTx({
    envelope: buildHostedExecutionAssistantNotificationRequestedWake({
      eventId: input.eventId,
      memberId: input.memberId,
      notification: {
        deliveryDedupeToken: input.eventId,
        deliveryDispatchMode: input.deliveryDispatchMode ?? "queue-only",
        deliveryIdempotencyKey: input.eventId,
        instructions: input.instructions,
        responsePolicy: input.responsePolicy,
        route: input.route,
      },
      occurredAt: input.occurredAt,
    }),
    tx: input.tx,
  });

  return {
    mailboxItemId: append.item.id,
  };
}

export const signalHostedAssistantNotificationsBestEffort =
  signalHostedMailboxAppendsBestEffort;

export async function resolveHostedAssistantNotificationRouteTx(input: {
  fallbackTelegramThreadId?: string | null;
  fallbackTelegramUserId?: string | null;
  memberId: string;
  tx: Prisma.TransactionClient;
}): Promise<HostedExecutionAssistantNotificationRoute | null> {
  return (await resolveHostedAssistantNotificationTargetTx(input)).route;
}

export interface HostedAssistantNotificationTarget {
  linqSourceLineLookupKey: string | null;
  route: HostedExecutionAssistantNotificationRoute | null;
}

export async function resolveHostedAssistantNotificationTargetTx(input: {
  fallbackTelegramThreadId?: string | null;
  fallbackTelegramUserId?: string | null;
  memberId: string;
  tx: Prisma.TransactionClient;
}): Promise<HostedAssistantNotificationTarget> {
  const [identity, routing] = await Promise.all([
    readHostedMemberIdentity({
      memberId: input.memberId,
      prisma: input.tx,
    }),
    readHostedMemberRoutingState({
      memberId: input.memberId,
      prisma: input.tx,
    }),
  ]);

  const route = resolveHostedMemberAssistantNotificationRoute({
    linqChatId: routing?.linqChatId ?? routing?.pendingLinqChatId ?? null,
    linqContactLookupKey:
      routing?.pendingLinqParticipantContact?.lookupKey
      ?? identity?.phoneLookupKey
      ?? null,
    linqRecipientPhone: routing?.linqRecipientPhone ?? null,
    memberId: input.memberId,
    memberPhoneNumber: identity?.phoneNumber ?? null,
    messaging: resolveHostedMemberMessagingState({
      identity: {
        phoneLookupKey: identity?.phoneLookupKey ?? null,
      },
      routing: {
        linqChatId: routing?.linqChatId ?? null,
        pendingLinqChatId: routing?.pendingLinqChatId ?? null,
        pendingLinqParticipantContact: routing?.pendingLinqParticipantContact ?? null,
        telegramThreadId:
          routing?.telegramThreadId
          ?? input.fallbackTelegramThreadId
          ?? null,
        telegramUserId:
          routing?.telegramUserId
          ?? input.fallbackTelegramUserId
          ?? null,
      },
    }),
  });
  const linqSourceLineLookupKey = route?.channel === "linq"
    ? routing?.linqChatId
      ? routing.linqRecipientPhoneLookupKey ?? null
      : routing?.pendingLinqChatId
        ? routing.pendingLinqRecipientPhoneLookupKey ?? null
        : routing?.linqRecipientPhoneLookupKey ?? null
    : null;
  return { linqSourceLineLookupKey, route };
}
