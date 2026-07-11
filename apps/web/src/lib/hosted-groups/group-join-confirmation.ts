import "server-only";

import type { Prisma } from "@prisma/client";
import {
  buildHostedExecutionAssistantNotificationRequestedWake,
  type HostedExecutionAssistantNotificationRoute,
} from "@murphai/hosted-execution";

import { appendHostedMailboxEnvelopeTx } from "../hosted-mailbox/store";
import { readHostedMemberIdentity } from "../hosted-onboarding/hosted-member-identity-store";
import { readHostedMemberRoutingState } from "../hosted-onboarding/hosted-member-routing-store";
import { readHostedMemberEmailAuthorization } from "../hosted-onboarding/hosted-member-store";
import {
  resolveHostedMemberAssistantNotificationRoute,
  resolveHostedMemberMessagingState,
} from "../hosted-onboarding/messaging-state";
import { buildHostedGroupJoinUrl } from "./group-links";

export interface HostedGroupJoinConfirmationSignal {
  mailboxItemId: string;
  memberId: string;
}

export async function appendHostedGroupJoinConfirmationTx(input: {
  joinCode: string;
  memberId: string;
  membershipId: string;
  occurredAt: Date;
  publicBaseUrl: string | null;
  tx: Prisma.TransactionClient;
}): Promise<HostedGroupJoinConfirmationSignal | null> {
  const joinUrl = buildHostedGroupJoinUrl({
    joinCode: input.joinCode,
    publicBaseUrl: input.publicBaseUrl,
  });
  if (!joinUrl) {
    return null;
  }

  const route = await resolveHostedGroupJoinConfirmationRouteTx({
    memberId: input.memberId,
    tx: input.tx,
  });
  if (!route) {
    return null;
  }

  const notificationKey = `group-join:${input.membershipId}`;
  const appended = await appendHostedMailboxEnvelopeTx({
    envelope: buildHostedExecutionAssistantNotificationRequestedWake({
      eventId: `assistant.notification.requested:${notificationKey}`,
      memberId: input.memberId,
      notification: {
        deliveryDedupeToken: notificationKey,
        deliveryDispatchMode: "queue-only",
        deliveryIdempotencyKey: notificationKey,
        instructions: "Private group-join check-in; exact user-facing text is in responsePolicy.",
        responsePolicy: {
          kind: "require_send_exact_text",
          text: buildHostedGroupJoinConfirmationText(joinUrl),
        },
        route,
      },
      occurredAt: input.occurredAt.toISOString(),
    }),
    tx: input.tx,
  });

  return {
    mailboxItemId: appended.item.id,
    memberId: appended.item.userId,
  };
}

async function resolveHostedGroupJoinConfirmationRouteTx(input: {
  memberId: string;
  tx: Prisma.TransactionClient;
}): Promise<HostedExecutionAssistantNotificationRoute | null> {
  const [emailAuthorization, identity, routing] = await Promise.all([
    readHostedMemberEmailAuthorization({
      memberId: input.memberId,
      prisma: input.tx,
    }),
    readHostedMemberIdentity({
      memberId: input.memberId,
      prisma: input.tx,
    }),
    readHostedMemberRoutingState({
      memberId: input.memberId,
      prisma: input.tx,
    }),
  ]);
  const linqChatId = routing?.linqChatId ?? routing?.pendingLinqChatId ?? null;
  const linqContactLookupKey =
    routing?.pendingLinqParticipantContact?.lookupKey
    ?? identity?.phoneLookupKey
    ?? emailAuthorization?.verifiedEmail?.lookupKey
    ?? emailAuthorization?.directPublicSender?.lookupKey
    ?? null;

  return resolveHostedMemberAssistantNotificationRoute({
    linqChatId,
    linqContactLookupKey,
    // Group-join confirmations may continue an existing private thread, but
    // must never use the participant-target first-contact delivery path.
    linqRecipientPhone: null,
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
        telegramThreadId: routing?.telegramThreadId ?? null,
        telegramUserId: routing?.telegramUserId ?? null,
      },
    }),
  });
}

function buildHostedGroupJoinConfirmationText(joinUrl: string): string {
  return [
    "Hey — you just joined a Murph group. Did you mean to? Reply yes or no.",
    `You can review or change what you share here: ${joinUrl}`,
  ].join("\n\n");
}
