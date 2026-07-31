import "server-only";

import type { PrismaClient } from "@prisma/client";
import {
  buildHostedExecutionLinqConversationMessageWake,
  createHostedExecutionGroupReactionEventId,
  formatHostedExecutionGroupReactionEventText,
  HOSTED_EXECUTION_GROUP_REACTION_SENDER_ATTESTATION,
} from "@murphai/hosted-execution";

import {
  readHostedThreadRouteByThreadIdentity,
} from "../hosted-routing/thread-route-store";
import {
  signalHostedMailboxAppendRuntime,
} from "../hosted-orchestration/signal-runtime";
import { createHostedPhoneLookupKey } from "./contact-privacy";
import {
  getHostedLinqChatSummary,
  getHostedLinqReactionTargetMessage,
  type HostedLinqReactionTargetMessage,
} from "./linq-client";
import { createHostedLinqParticipantContact } from "./linq-participant-contact";
import {
  isHostedLinqAffirmativeReaction,
  type ParsedHostedLinqProviderEvent,
} from "./linq-provider-events";
import type { HostedLinqWebhookEvent } from "./linq-webhook";
import { readActiveHostedMemberAccess } from "./member-access";
import { HOSTED_ONBOARDING_TRANSACTION_OPTIONS } from "./shared";
import {
  appendConsumedHostedGroupReactionMailboxEnvelopeTx,
} from "./group-reaction-mailbox";

const HOSTED_LINQ_GROUP_REACTION_TARGET_MAX_CHARS = 1_000;
const HOSTED_LINQ_GROUP_REACTION_VALUE_MAX_CHARS = 256;

export async function buildHostedLinqAffirmativeReactionMessageEvent(input: {
  event: ParsedHostedLinqProviderEvent;
  signal?: AbortSignal;
}): Promise<HostedLinqWebhookEvent | null> {
  if (!isHostedLinqAffirmativeReaction({
    customEmoji: input.event.reactionCustomEmoji,
    eventType: input.event.eventType,
    reactionType: input.event.reactionType,
  })) {
    return null;
  }
  const eventContext = readHostedLinqReactionEventContext(input.event);
  if (!eventContext) {
    return null;
  }

  const chat = await readHostedLinqReactionCanonicalChat({
    actor: eventContext.actor,
    chatId: eventContext.chatId,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  if (!chat) {
    return null;
  }

  const occurredAt = input.event.providerCreatedAt.toISOString();
  const service = input.event.service ?? "iMessage";
  return {
    api_version: input.event.apiVersion ?? "v3",
    created_at: occurredAt,
    event_id: input.event.eventId,
    event_type: "message.received",
    ...(input.event.webhookVersion
      ? { webhook_version: input.event.webhookVersion }
      : {}),
    data: {
      chat_id: eventContext.chatId,
      chat: {
        id: eventContext.chatId,
        is_group: chat.isGroup,
        owner_handle: {
          handle: chat.accountHandle,
          is_me: true,
          service,
        },
      },
      direction: "inbound",
      from: eventContext.actor.value,
      from_handle: {
        handle: eventContext.actor.value,
        is_me: false,
        service,
      },
      is_from_me: false,
      message: {
        id: input.event.eventId,
        parts: [
          {
            type: "text",
            value: `Reacted with ${
              input.event.reactionCustomEmoji
              ?? readHostedLinqReactionLabel(input.event)
            }.`,
          },
        ],
        reply_to: {
          message_id: eventContext.messageId,
          ...(eventContext.partIndex === null
            ? {}
            : { part_index: eventContext.partIndex }),
        },
      },
      received_at: occurredAt,
      recipient_handle: {
        handle: chat.accountHandle,
        is_me: true,
        service,
      },
      recipient_phone: chat.accountHandle,
      sender_handle: {
        handle: eventContext.actor.value,
        is_me: false,
        service,
      },
      service,
    },
  };
}

/**
 * Retains the historical function name for the webhook call site, but no longer
 * stages a lossy next-message hint. Every authenticated non-affirmative group
 * reaction is now an ordinary durable conversation mailbox item whose row is
 * marked consumed at ingress, so it is imported as context without ever
 * becoming a reply candidate.
 */
export async function stageHostedLinqGroupReactionContext(input: {
  event: ParsedHostedLinqProviderEvent;
  prisma: PrismaClient;
  signal?: AbortSignal;
}): Promise<boolean> {
  const eventContext = readHostedLinqReactionEventContext(input.event);
  if (!eventContext) {
    return false;
  }

  const route = await readHostedThreadRouteByThreadIdentity({
    channel: "linq",
    prisma: input.prisma,
    threadId: eventContext.chatId,
  });
  if (
    !route
    || !(await readActiveHostedMemberAccess({
      memberId: route.containerMemberId,
      prisma: input.prisma,
    }))
  ) {
    return false;
  }

  const chat = await readHostedLinqReactionCanonicalChat({
    actor: eventContext.actor,
    chatId: eventContext.chatId,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  if (!chat || chat.isGroup !== true) {
    return false;
  }

  const targetText = await readHostedLinqReactionTargetTextBestEffort({
    chatId: eventContext.chatId,
    messageId: eventContext.messageId,
    partIndex: eventContext.partIndex,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  const occurredAt = input.event.providerCreatedAt.toISOString();
  const reactionEventId = createHostedExecutionGroupReactionEventId(
    input.event.eventId,
  );
  const reactionText = formatHostedExecutionGroupReactionEventText({
    actor: eventContext.actor.value,
    changes: [{
      operation: input.event.eventType === "reaction.removed"
        ? "removed"
        : "added",
      reaction: readHostedLinqReactionValue(input.event),
    }],
    channel: "linq",
    mode: "delta",
    targetMessageId: eventContext.messageId,
    targetText,
  });
  const envelope = buildHostedExecutionLinqConversationMessageWake({
    accountLookupKey: chat.accountLookupKey,
    contactKind: eventContext.actor.kind,
    contactLookupKey: eventContext.actor.lookupKey,
    eventId: reactionEventId,
    linqMessage: {
      chatId: eventContext.chatId,
      from: HOSTED_EXECUTION_GROUP_REACTION_SENDER_ATTESTATION,
      isFromMe: false,
      messageId: reactionEventId,
      parts: [{ type: "text", value: reactionText }],
      reactionEligible: false,
      replyToMessageId: eventContext.messageId,
      ...(eventContext.partIndex === null
        ? {}
        : { replyToPartIndex: eventContext.partIndex }),
      service: input.event.service ?? "iMessage",
      threadIsDirect: false,
    },
    occurredAt,
    routeAuthority: {
      channel: "linq",
      containerMemberId: route.containerMemberId,
      threadId: eventContext.chatId,
    },
    userId: route.containerMemberId,
  });
  const appended = await input.prisma.$transaction(
    (tx) => appendConsumedHostedGroupReactionMailboxEnvelopeTx({
      envelope,
      tx,
    }),
    HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  );

  await signalHostedMailboxAppendRuntime({
    expectedUserId: route.containerMemberId,
    knownCheckpoint: {
      lane: appended.item.lane,
      laneSeq: appended.item.laneSeq,
      userId: route.containerMemberId,
    },
    mailboxItemId: appended.item.id,
    prisma: input.prisma,
  });
  return true;
}

async function readHostedLinqReactionCanonicalChat(input: {
  actor: NonNullable<ReturnType<typeof createHostedLinqParticipantContact>>;
  chatId: string;
  signal?: AbortSignal;
}): Promise<{
  accountHandle: string;
  accountLookupKey: string;
  isGroup: boolean;
} | null> {
  const chat = await getHostedLinqChatSummary({
    chatId: input.chatId,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  if (chat.isGroup === null) {
    return null;
  }
  const accountHandles = chat.handles.filter((handle) =>
    handle.isMe && isHostedLinqRosterHandleActive(handle.status),
  );
  const accountLookupKeys = new Set(
    accountHandles
      .map((handle) => createHostedPhoneLookupKey(handle.handle))
      .filter((value): value is string => value !== null),
  );
  if (accountLookupKeys.size !== 1) {
    return null;
  }
  const accountLookupKey = accountLookupKeys.values().next().value;
  const accountHandle = accountHandles.find((handle) =>
    createHostedPhoneLookupKey(handle.handle) === accountLookupKey,
  )?.handle;
  if (!accountLookupKey || !accountHandle) {
    return null;
  }

  const matchingActors = chat.handles.filter((handle) => {
    if (handle.isMe || !isHostedLinqRosterHandleActive(handle.status)) {
      return false;
    }
    const participant = createHostedLinqParticipantContact({
      kind: handle.handle.includes("@") ? "email" : "phone",
      value: handle.handle,
    });
    return participant?.kind === input.actor.kind
      && participant.lookupKey === input.actor.lookupKey;
  });
  return matchingActors.length === 1
    ? { accountHandle, accountLookupKey, isGroup: chat.isGroup }
    : null;
}

function isHostedLinqRosterHandleActive(
  status: string | null | undefined,
): boolean {
  return status?.trim().toLowerCase() === "active";
}

function readHostedLinqReactionEventContext(
  event: ParsedHostedLinqProviderEvent,
): {
  actor: NonNullable<ReturnType<typeof createHostedLinqParticipantContact>>;
  chatId: string;
  messageId: string;
  partIndex: number | null;
} | null {
  if (
    event.reactionIsFromMe === true
    || !event.linqChatId
    || !event.linqMessageId
    || !event.reactionFromHandle
    || (!event.reactionType && !event.reactionCustomEmoji)
  ) {
    return null;
  }
  const actor = createHostedLinqParticipantContact({
    kind: event.reactionFromHandle.includes("@") ? "email" : "phone",
    value: event.reactionFromHandle,
  });
  if (!actor) {
    return null;
  }
  return {
    actor,
    chatId: event.linqChatId,
    messageId: event.linqMessageId,
    partIndex: event.reactionPartIndex,
  };
}

async function readHostedLinqReactionTargetTextBestEffort(input: {
  chatId: string;
  messageId: string;
  partIndex: number | null;
  signal?: AbortSignal;
}): Promise<string | null> {
  try {
    return buildHostedLinqReactionTargetText({
      chatId: input.chatId,
      messageId: input.messageId,
      partIndex: input.partIndex,
      target: await getHostedLinqReactionTargetMessage({
        messageId: input.messageId,
        ...(input.signal ? { signal: input.signal } : {}),
      }),
    });
  } catch {
    input.signal?.throwIfAborted();
    return null;
  }
}

function buildHostedLinqReactionTargetText(input: {
  chatId: string;
  messageId: string;
  partIndex: number | null;
  target: HostedLinqReactionTargetMessage;
}): string | null {
  if (input.target.id !== input.messageId || input.target.chatId !== input.chatId) {
    return null;
  }
  const parts = input.partIndex === null
    ? input.target.parts
    : input.target.parts[input.partIndex] === undefined
      ? null
      : [input.target.parts[input.partIndex]];
  if (!parts) {
    return null;
  }
  const text = parts
    .join(" ")
    .replace(/\s+/gu, " ")
    .trim();
  if (!text) {
    return null;
  }
  return Array.from(text)
    .slice(0, HOSTED_LINQ_GROUP_REACTION_TARGET_MAX_CHARS)
    .join("");
}

function readHostedLinqReactionValue(event: ParsedHostedLinqProviderEvent): string {
  const value = event.reactionCustomEmoji?.trim()
    || event.reactionType?.trim().toLowerCase().replace(/[\s-]+/gu, "_")
    || "unknown";
  return Array.from(value)
    .slice(0, HOSTED_LINQ_GROUP_REACTION_VALUE_MAX_CHARS)
    .join("");
}

function readHostedLinqReactionLabel(event: ParsedHostedLinqProviderEvent): string {
  const token = event.reactionType?.trim().toLowerCase().replace(/[\s-]+/gu, "_") ?? "";
  switch (token) {
    case "dislike":
    case "thumbs_down":
    case "thumbsdown":
      return "a dislike reaction";
    case "emphasize":
    case "exclamation":
      return "an emphasis reaction";
    case "laugh":
    case "laughed":
      return "a laugh reaction";
    case "like":
    case "thumbs_up":
    case "thumbsup":
      return "a like reaction";
    case "love":
    case "heart":
      return "a heart reaction";
    case "question":
      return "a question reaction";
    default:
      return event.reactionCustomEmoji ? "a custom reaction" : "a reaction";
  }
}
