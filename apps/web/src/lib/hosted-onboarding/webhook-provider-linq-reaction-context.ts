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

type HostedLinqGroupReactionContextSkipReason =
  | "context_unavailable"
  | "invalid_actor"
  | "invalid_group"
  | "invalid_target"
  | "missing_context"
  | "route_unavailable";

export type HostedLinqGroupReactionContextResult =
  | { status: "staged" }
  | {
      reason: HostedLinqGroupReactionContextSkipReason;
      status: "ignored";
    };

export async function stageHostedLinqGroupReactionContext(input: {
  event: ParsedHostedLinqProviderEvent;
  prisma: PrismaClient;
  signal?: AbortSignal;
}): Promise<HostedLinqGroupReactionContextResult> {
  const eventContext = readHostedLinqReactionEventContext(input.event);
  if (eventContext.status === "ignored") {
    return eventContext;
  }

  try {
    const route = await readHostedThreadRouteByThreadIdentity({
      accountLookupKey: eventContext.accountLookupKey,
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
      return { reason: "route_unavailable", status: "ignored" };
    }

    const chat = await getHostedLinqChatSummary({
      chatId: eventContext.chatId,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    if (chat.isGroup !== true) {
      return { reason: "invalid_group", status: "ignored" };
    }
    const canonicalAccountLookupKeys = new Set(
      chat.handles
        .filter((handle) => handle.isMe)
        .map((handle) => createHostedPhoneLookupKey(handle.handle))
        .filter((value): value is string => value !== null),
    );
    if (
      canonicalAccountLookupKeys.size !== 1
      || !canonicalAccountLookupKeys.has(eventContext.accountLookupKey)
    ) {
      return { reason: "invalid_group", status: "ignored" };
    }

    const matchingActors = chat.handles.filter((handle) => {
      if (
        handle.isMe
        || (handle.status && handle.status.trim().toLowerCase() !== "active")
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
      return { reason: "invalid_actor", status: "ignored" };
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
      return { reason: "invalid_target", status: "ignored" };
    }

    const append = await input.prisma.$transaction(
      (tx) => appendHostedLinqThreadRouteReactionContextTx({
        accountLookupKey: eventContext.accountLookupKey,
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
    return append === "appended"
      ? { status: "staged" }
      : { reason: "route_unavailable", status: "ignored" };
  } catch {
    // Reaction context is optional and lossy. Provider, crypto, or route-read
    // failure must not interfere with join offers or ordinary message ingress.
    return { reason: "context_unavailable", status: "ignored" };
  }
}

function readHostedLinqReactionEventContext(
  event: ParsedHostedLinqProviderEvent,
):
  | {
      accountLookupKey: string;
      actor: NonNullable<ReturnType<typeof createHostedLinqParticipantContact>>;
      chatId: string;
      messageId: string;
      partIndex: number | null;
      status: "ready";
    }
  | {
      reason: "invalid_actor" | "missing_context";
      status: "ignored";
    } {
  const accountLookupKey = createHostedPhoneLookupKey(event.phoneNumber);
  if (
    !accountLookupKey
    || !event.linqChatId
    || !event.linqMessageId
    || !event.reactionFromHandle
    || (!event.reactionType && !event.reactionCustomEmoji)
  ) {
    return { reason: "missing_context", status: "ignored" };
  }
  const actor = createHostedLinqParticipantContact({
    kind: event.reactionFromHandle.includes("@") ? "email" : "phone",
    value: event.reactionFromHandle,
  });
  if (!actor) {
    return { reason: "invalid_actor", status: "ignored" };
  }
  return {
    accountLookupKey,
    actor,
    chatId: event.linqChatId,
    messageId: event.linqMessageId,
    partIndex: event.reactionPartIndex,
    status: "ready",
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
    .map((part) => part.value)
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
