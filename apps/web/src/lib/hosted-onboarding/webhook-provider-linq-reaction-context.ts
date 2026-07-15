import "server-only";

import type { PrismaClient } from "@prisma/client";
import {
  HOSTED_EXECUTION_LINQ_GROUP_REACTION_CONTEXT_ITEM_MAX_CHARS,
} from "@murphai/hosted-execution/contracts";

import {
  appendHostedLinqThreadRouteReactionContextTx,
  readHostedThreadRouteByThreadIdentity,
} from "../hosted-routing/thread-route-store";
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

const HOSTED_LINQ_GROUP_REACTION_TARGET_MAX_CHARS = 320;

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

  const [chat, target] = await Promise.all([
    readHostedLinqReactionCanonicalChat({
      actor: eventContext.actor,
      chatId: eventContext.chatId,
      ...(input.signal ? { signal: input.signal } : {}),
    }),
    getHostedLinqReactionTargetMessage({
      messageId: eventContext.messageId,
      ...(input.signal ? { signal: input.signal } : {}),
    }),
  ]);
  const targetText = buildHostedLinqReactionTargetText({
    chatId: eventContext.chatId,
    messageId: eventContext.messageId,
    partIndex: eventContext.partIndex,
    target,
  });
  if (!chat || target.isFromMe !== true || !targetText) {
    return null;
  }

  const occurredAt = input.event.providerCreatedAt.toISOString();
  const reactionLabel = readHostedLinqReactionLabel(input.event);
  const service = target.service ?? input.event.service ?? "iMessage";
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
        id: eventContext.messageId,
        parts: [
          {
            type: "text",
            value: [
              `The participant used ${reactionLabel} as an affirmative reply to your exact message.`,
              "If that message clearly asked a yes/no question or offered a specific action, treat this as yes or confirmation of only that action and do not ask the same question again. Otherwise keep it as context only; do not infer unrelated intent.",
            ].join("\n"),
          },
          {
            type: "text",
            value: `Reacted-to message:\n${targetText}`,
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

export async function stageHostedLinqGroupReactionContext(input: {
  event: ParsedHostedLinqProviderEvent;
  prisma: PrismaClient;
  signal?: AbortSignal;
}): Promise<boolean> {
  const eventContext = readHostedLinqReactionEventContext(input.event);
  if (!eventContext) {
    return false;
  }

  try {
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
    const actorHandle = eventContext.actor.value;

    const target = await getHostedLinqReactionTargetMessage({
      messageId: eventContext.messageId,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    const targetText = buildHostedLinqReactionTargetText({
      chatId: eventContext.chatId,
      messageId: eventContext.messageId,
      partIndex: eventContext.partIndex,
      target,
    });
    if (!targetText) {
      return false;
    }

    const append = await input.prisma.$transaction(
      (tx) => appendHostedLinqThreadRouteReactionContextTx({
        accountLookupKey: chat.accountLookupKey,
        containerMemberId: route.containerMemberId,
        prisma: tx,
        text: buildHostedLinqGroupReactionContextText({
          actorHandle,
          event: input.event,
          targetText,
        }),
        threadId: eventContext.chatId,
      }),
      HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
    );
    return append === "appended";
  } catch {
    // Reaction context is optional and lossy. Provider, crypto, or route-read
    // failure must not interfere with join offers or ordinary message ingress.
    return false;
  }
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
    .trim() || "[message content unavailable]";
  return truncateHostedLinqGroupReactionText(
    text,
    HOSTED_LINQ_GROUP_REACTION_TARGET_MAX_CHARS,
  );
}

function buildHostedLinqGroupReactionContextText(input: {
  actorHandle: string;
  event: ParsedHostedLinqProviderEvent;
  targetText: string;
}): string {
  const operation = input.event.eventType === "reaction.removed"
    ? "removed"
    : "added";
  return truncateHostedLinqGroupReactionText(
    `Participant ${input.actorHandle} ${operation} ${readHostedLinqReactionLabel(input.event)} on: ${input.targetText}`,
    HOSTED_EXECUTION_LINQ_GROUP_REACTION_CONTEXT_ITEM_MAX_CHARS,
  );
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

function truncateHostedLinqGroupReactionText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxChars - 12)).trimEnd()} [truncated]`;
}
