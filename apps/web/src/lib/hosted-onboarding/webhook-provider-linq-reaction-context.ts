import "server-only";

import type { PrismaClient } from "@prisma/client";

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
import type { ParsedHostedLinqProviderEvent } from "./linq-provider-events";
import { readActiveHostedMemberAccess } from "./member-access";
import { HOSTED_ONBOARDING_TRANSACTION_OPTIONS } from "./shared";

const HOSTED_LINQ_GROUP_REACTION_TARGET_MAX_CHARS = 320;

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

    const chat = await getHostedLinqChatSummary({
      chatId: eventContext.chatId,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    if (chat.isGroup !== true) {
      return false;
    }
    const canonicalAccountLookupKeys = new Set(
      chat.handles
        .filter((handle) =>
          handle.isMe && isHostedLinqRosterHandleActive(handle.status),
        )
        .map((handle) => createHostedPhoneLookupKey(handle.handle))
        .filter((value): value is string => value !== null),
    );
    if (canonicalAccountLookupKeys.size !== 1) {
      return false;
    }
    const accountLookupKey = canonicalAccountLookupKeys.values().next().value;
    if (!accountLookupKey) {
      return false;
    }

    const matchingActors = chat.handles.filter((handle) => {
      if (
        handle.isMe
        || !isHostedLinqRosterHandleActive(handle.status)
      ) {
        return false;
      }
      const participant = createHostedLinqParticipantContact({
        kind: handle.handle.includes("@") ? "email" : "phone",
        value: handle.handle,
      });
      return participant?.kind === eventContext.actor.kind
        && participant.lookupKey === eventContext.actor.lookupKey;
    });
    if (matchingActors.length !== 1) {
      return false;
    }

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
        accountLookupKey,
        containerMemberId: route.containerMemberId,
        prisma: tx,
        text: buildHostedLinqGroupReactionContextText({
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

function isHostedLinqRosterHandleActive(
  status: string | null | undefined,
): boolean {
  return !status || status.trim().toLowerCase() === "active";
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
  event: ParsedHostedLinqProviderEvent;
  targetText: string;
}): string {
  const operation = input.event.eventType === "reaction.removed"
    ? "removed"
    : "added";
  return `A participant ${operation} ${readHostedLinqReactionLabel(input.event)} on: ${input.targetText}`;
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
