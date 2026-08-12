import { randomUUID } from "node:crypto";

import {
  HostedBillingStatus,
  type PrismaClient,
} from "@prisma/client";
import {
  buildHostedExecutionTelegramConversationMessageWake,
  type HostedExecutionAssistantAskAcceptedInputOrigin,
  type HostedExecutionExternalThreadRouteAuthority,
} from "@murphai/hosted-execution";
import {
  createHostedMailboxAssistantInputId,
} from "@murphai/hosted-execution/assistant-identifiers";

import {
  appendHostedMailboxEnvelopeWithIdentityTx,
} from "@/src/lib/hosted-mailbox/store";
import {
  createHostedExternalThreadIdentityLookupKey,
  createHostedExternalThreadLookupKey,
} from "@/src/lib/hosted-onboarding/contact-privacy";
import {
  upsertHostedMemberTelegramRoutingBindingTx,
} from "@/src/lib/hosted-onboarding/hosted-member-routing-store";
import {
  HOSTED_TELEGRAM_THREAD_ACCOUNT_LOOKUP_KEY,
} from "@/src/lib/hosted-routing/thread-delivery-route";

export interface HostedCurrentSenderAssistantAskFixture {
  assistantInputId: string;
  groupRuntimeMemberId: string;
  origin: HostedExecutionAssistantAskAcceptedInputOrigin;
  ownerMemberId: string;
  priorAssistantInputId: string | null;
  priorQuestion: string | null;
  question: string;
  routeAuthority: HostedExecutionExternalThreadRouteAuthority;
  senderMemberId: string;
  sourceEventId: string;
  sourceMessageId: string;
  telegramUserId: string;
  threadId: string;
}

export async function seedHostedCurrentSenderAssistantAskFixture(input: {
  now: Date;
  prisma: PrismaClient;
  priorQuestion?: string;
  question?: string;
}): Promise<HostedCurrentSenderAssistantAskFixture> {
  const suffix = randomUUID().replaceAll("-", "");
  const ownerMemberId = `hbm_current_sender_owner_${suffix}`;
  const senderMemberId = `hbm_current_sender_person_${suffix}`;
  const groupRuntimeMemberId = `hbm_current_sender_group_${suffix}`;
  const telegramUserId = `tg_current_sender_${suffix}`;
  const threadId = `telegram_group_current_sender_${suffix}`;
  const sourceEventId = `telegram.message.received:current-sender:${suffix}`;
  const sourceMessageId = `telegram_message_current_sender_${suffix}`;
  const priorSourceEventId = input.priorQuestion === undefined
    ? null
    : `telegram.message.received:current-sender-prior:${suffix}`;
  const priorSourceMessageId = input.priorQuestion === undefined
    ? null
    : `telegram_message_current_sender_prior_${suffix}`;
  const question = input.question
    ?? "Murph, answer this synthetic request for the group.";
  const routeAuthority = {
    channel: "telegram" as const,
    containerMemberId: groupRuntimeMemberId,
    threadId,
  };
  const threadIdentityLookupKey =
    createHostedExternalThreadIdentityLookupKey({
      channel: "telegram",
      threadId,
    });
  const threadLookupKey = createHostedExternalThreadLookupKey({
    accountLookupKey: HOSTED_TELEGRAM_THREAD_ACCOUNT_LOOKUP_KEY,
    channel: "telegram",
    threadId,
  });
  if (!threadIdentityLookupKey || !threadLookupKey) {
    throw new Error("Could not derive current-sender thread route keys.");
  }

  await input.prisma.hostedMember.createMany({
    data: [
      {
        billingStatus: HostedBillingStatus.active,
        id: ownerMemberId,
      },
      {
        billingStatus: HostedBillingStatus.active,
        id: senderMemberId,
      },
      {
        billingStatus: HostedBillingStatus.not_started,
        id: groupRuntimeMemberId,
      },
    ],
  });
  await input.prisma.hostedThreadContainer.create({
    data: {
      memberId: groupRuntimeMemberId,
      monthlyUsageLimitUsdMicros: 7_500_000n,
      ownerMemberId,
    },
  });
  await input.prisma.hostedThreadRoute.create({
    data: {
      accountLookupKey: HOSTED_TELEGRAM_THREAD_ACCOUNT_LOOKUP_KEY,
      channel: "telegram",
      containerMemberId: groupRuntimeMemberId,
      deliveryRouteEncrypted: null,
      threadIdentityLookupKey,
      threadLookupKey,
    },
  });
  await input.prisma.$transaction(async (tx) => {
    await upsertHostedMemberTelegramRoutingBindingTx({
      memberId: senderMemberId,
      prisma: tx,
      telegramThreadId: null,
      telegramUserId,
    });
  });

  const currentWake = buildHostedExecutionTelegramConversationMessageWake({
    eventId: sourceEventId,
    occurredAt: input.now.toISOString(),
    routeAuthority,
    telegramMessage: {
      from: telegramUserId,
      messageId: sourceMessageId,
      schema: "murph.hosted-telegram-message.v1",
      text: question,
      threadId,
      threadIsDirect: false,
    },
    userId: groupRuntimeMemberId,
  });
  const priorWake = priorSourceEventId && priorSourceMessageId
    ? buildHostedExecutionTelegramConversationMessageWake({
        eventId: priorSourceEventId,
        occurredAt: new Date(input.now.getTime() - 1_000).toISOString(),
        routeAuthority,
        telegramMessage: {
          from: telegramUserId,
          messageId: priorSourceMessageId,
          schema: "murph.hosted-telegram-message.v1",
          text: input.priorQuestion ?? "",
          threadId,
          threadIsDirect: false,
        },
        userId: groupRuntimeMemberId,
      })
    : null;
  await input.prisma.$transaction(async (tx) => {
    for (const [itemId, wake] of [
      ...(priorWake && priorSourceEventId
        ? [[priorSourceEventId, priorWake] as const]
        : []),
      [sourceEventId, currentWake] as const,
    ]) {
      const append = await appendHostedMailboxEnvelopeWithIdentityTx({
        envelope: wake,
        expiresAt: new Date(input.now.getTime() + 60 * 60 * 1_000),
        itemId,
        tx,
      });
      if (
        !append.inserted
        || append.dedupeConflict
        || append.item.id !== itemId
      ) {
        throw new Error("Could not append the current-sender source wake.");
      }
    }
  });

  const assistantInputId = createHostedMailboxAssistantInputId({
    dedupeKey: sourceEventId,
    eventId: sourceEventId,
    lane: "conversation",
    secret: threadId,
    userId: groupRuntimeMemberId,
  });
  const priorAssistantInputId = priorSourceEventId
    ? createHostedMailboxAssistantInputId({
        dedupeKey: priorSourceEventId,
        eventId: priorSourceEventId,
        lane: "conversation",
        secret: threadId,
        userId: groupRuntimeMemberId,
      })
    : null;
  return {
    assistantInputId,
    groupRuntimeMemberId,
    origin: {
      assistantInputId,
      kind: "accepted_input",
      sessionId: `session_current_sender_${suffix}`,
    },
    ownerMemberId,
    priorAssistantInputId,
    priorQuestion: input.priorQuestion ?? null,
    question,
    routeAuthority,
    senderMemberId,
    sourceEventId,
    sourceMessageId,
    telegramUserId,
    threadId,
  };
}

export async function deleteHostedCurrentSenderAssistantAskFixture(input: {
  fixture: HostedCurrentSenderAssistantAskFixture;
  prisma: PrismaClient;
}): Promise<void> {
  const memberIds = [
    input.fixture.groupRuntimeMemberId,
    input.fixture.ownerMemberId,
    input.fixture.senderMemberId,
  ];
  await input.prisma.hostedThreadRoute.deleteMany({
    where: {
      channel: "telegram",
      containerMemberId: input.fixture.groupRuntimeMemberId,
    },
  });
  await input.prisma.hostedThreadContainer.deleteMany({
    where: { memberId: input.fixture.groupRuntimeMemberId },
  });
  await input.prisma.hostedMember.deleteMany({
    where: { id: { in: memberIds } },
  });
}
