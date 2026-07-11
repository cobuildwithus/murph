import type { Prisma, PrismaClient } from "@prisma/client";
import {
  buildHostedExecutionLinqConversationReactionWake,
} from "@murphai/hosted-execution";

import {
  appendHostedMailboxEnvelopeTx,
  readHostedMailboxItemByDedupeKey,
} from "../hosted-mailbox/store";
import {
  readHostedThreadRouteByThreadIdentity,
  type HostedThreadRouteSnapshot,
} from "../hosted-routing/thread-route-store";
import { createHostedPhoneLookupKey } from "./contact-privacy";
import { isHostedOnboardingError } from "./errors";
import {
  getHostedLinqChatSummary,
  getHostedLinqReactionTargetMessage,
  type HostedLinqReactionTargetMessage,
  type HostedLinqReactionTargetPart,
} from "./linq-client";
import { readActiveHostedMemberAccess } from "./member-access";
import { createHostedLinqParticipantContact } from "./linq-participant-contact";
import type { ParsedHostedLinqProviderEvent } from "./linq-provider-events";
import { HOSTED_ONBOARDING_TRANSACTION_OPTIONS } from "./shared";

const HOSTED_LINQ_REACTION_TARGET_TEXT_MAX_CHARS = 2_000;
const HOSTED_LINQ_REACTION_LABEL_MAX_CHARS = 80;

type HostedLinqGroupReactionContextSkipReason =
  | "inactive_route"
  | "invalid_actor"
  | "invalid_target"
  | "missing_context"
  | "own_reaction"
  | "route_missing"
  | "target_unavailable";

export type HostedLinqGroupReactionContextResult =
  | {
      duplicate: boolean;
      mailboxItemId: string;
      status: "staged";
      userId: string;
    }
  | {
      reason: HostedLinqGroupReactionContextSkipReason;
      status: "ignored";
    };

export async function stageHostedLinqGroupReactionContext(input: {
  event: ParsedHostedLinqProviderEvent;
  prisma: PrismaClient;
  signal?: AbortSignal;
}): Promise<HostedLinqGroupReactionContextResult> {
  const context = readHostedLinqGroupReactionContext(input.event);
  if (context.status === "ignored") {
    return context;
  }

  const route = await readHostedActiveLinqReactionRoute({
    chatId: context.chatId,
    prisma: input.prisma,
  });
  if (route.status === "ignored") {
    return route;
  }

  const existing = await readHostedMailboxItemByDedupeKey({
    dedupeKey: input.event.eventId,
    prisma: input.prisma,
    userId: route.route.containerMemberId,
  });
  if (existing) {
    return {
      duplicate: true,
      mailboxItemId: existing.id,
      status: "staged",
      userId: route.route.containerMemberId,
    };
  }

  let target: HostedLinqReactionTargetMessage;
  try {
    target = await getHostedLinqReactionTargetMessage({
      messageId: context.messageId,
      ...(input.signal ? { signal: input.signal } : {}),
    });
  } catch (error) {
    if (isHostedOnboardingError(error) && !error.retryable) {
      return {
        reason: "target_unavailable",
        status: "ignored",
      };
    }
    throw error;
  }

  let accountLookupKey: string | null;
  try {
    accountLookupKey = await readHostedLinqReactionAccountLookupKey({
      chatId: context.chatId,
      event: input.event,
      ...(input.signal ? { signal: input.signal } : {}),
    });
  } catch (error) {
    if (isHostedOnboardingError(error) && !error.retryable) {
      return {
        reason: "target_unavailable",
        status: "ignored",
      };
    }
    throw error;
  }
  if (!accountLookupKey) {
    return {
      reason: "missing_context",
      status: "ignored",
    };
  }

  const targetText = buildHostedLinqReactionTargetText({
    chatId: context.chatId,
    messageId: context.messageId,
    partIndex: context.partIndex,
    target,
  });
  if (!targetText) {
    return {
      reason: "invalid_target",
      status: "ignored",
    };
  }

  const envelope = buildHostedExecutionLinqConversationReactionWake({
    accountLookupKey,
    contactKind: context.actor.kind,
    contactLookupKey: context.actor.lookupKey,
    eventId: input.event.eventId,
    linqMessage: {
      chatId: context.chatId,
      from: context.actor.value,
      isFromMe: false,
      messageId: input.event.eventId,
      parts: [{
        type: "text",
        value: buildHostedLinqReactionContextText({
          eventType: input.event.eventType,
          reactionCustomEmoji: input.event.reactionCustomEmoji,
          reactionType: input.event.reactionType,
          targetText,
        }),
      }],
      reactionEligible: false,
      service: input.event.service ?? target.service,
      threadIsDirect: false,
    },
    occurredAt: input.event.providerCreatedAt.toISOString(),
    ...(context.actor.kind === "phone"
      ? { phoneLookupKey: context.actor.lookupKey }
      : {}),
    routeAuthority: {
      accountLookupKey,
      channel: "linq",
      containerMemberId: route.route.containerMemberId,
      threadId: context.chatId,
    },
    userId: route.route.containerMemberId,
  });

  return await input.prisma.$transaction(async (tx) => {
    const currentRoute = await readHostedActiveLinqReactionRoute({
      chatId: context.chatId,
      prisma: tx,
    });
    if (currentRoute.status === "ignored") {
      return currentRoute;
    }
    if (currentRoute.route.containerMemberId !== route.route.containerMemberId) {
      return {
        reason: "route_missing",
        status: "ignored",
      };
    }

    const append = await appendHostedMailboxEnvelopeTx({
      envelope,
      tx,
    });
    return {
      duplicate: append.duplicate,
      mailboxItemId: append.item.id,
      status: "staged",
      userId: route.route.containerMemberId,
    };
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

function readHostedLinqGroupReactionContext(
  event: ParsedHostedLinqProviderEvent,
):
  | {
      actor: NonNullable<ReturnType<typeof createHostedLinqParticipantContact>>;
      chatId: string;
      messageId: string;
      partIndex: number | null;
      status: "ready";
    }
  | {
      reason: HostedLinqGroupReactionContextSkipReason;
      status: "ignored";
    } {
  if (event.reactionIsFromMe !== false) {
    return {
      reason: event.reactionIsFromMe === true ? "own_reaction" : "missing_context",
      status: "ignored",
    };
  }
  if (
    !event.linqChatId
    || !event.linqMessageId
    || !event.reactionFromHandle
    || (!event.reactionType && !event.reactionCustomEmoji)
  ) {
    return {
      reason: "missing_context",
      status: "ignored",
    };
  }

  const actor = createHostedLinqParticipantContact({
    kind: event.reactionFromHandle.includes("@") ? "email" : "phone",
    value: event.reactionFromHandle,
  });
  if (!actor) {
    return {
      reason: "invalid_actor",
      status: "ignored",
    };
  }
  return {
    actor,
    chatId: event.linqChatId,
    messageId: event.linqMessageId,
    partIndex: event.reactionPartIndex,
    status: "ready",
  };
}

async function readHostedLinqReactionAccountLookupKey(input: {
  chatId: string;
  event: ParsedHostedLinqProviderEvent;
  signal?: AbortSignal;
}): Promise<string | null> {
  const eventAccountLookupKey = createHostedPhoneLookupKey(input.event.phoneNumber);
  const chat = await getHostedLinqChatSummary({
    chatId: input.chatId,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  if (chat.isGroup !== true) {
    return null;
  }

  const accountLookupKeys = new Set(
    chat.handles
      .filter((handle) => handle.isMe)
      .map((handle) => createHostedPhoneLookupKey(handle.handle))
      .filter((value): value is string => value !== null),
  );
  if (accountLookupKeys.size !== 1) {
    return null;
  }
  const canonicalAccountLookupKey = accountLookupKeys.values().next().value ?? null;
  if (
    eventAccountLookupKey
    && eventAccountLookupKey !== canonicalAccountLookupKey
  ) {
    return null;
  }
  return canonicalAccountLookupKey;
}

async function readHostedActiveLinqReactionRoute(input: {
  chatId: string;
  prisma: PrismaClient | Prisma.TransactionClient;
}): Promise<
  | { route: HostedThreadRouteSnapshot; status: "active" }
  | { reason: "inactive_route" | "route_missing"; status: "ignored" }
> {
  const route = await readHostedThreadRouteByThreadIdentity({
    channel: "linq",
    prisma: input.prisma,
    threadId: input.chatId,
  });
  if (!route) {
    return {
      reason: "route_missing",
      status: "ignored",
    };
  }
  if (!(await readActiveHostedMemberAccess({
    memberId: route.containerMemberId,
    prisma: input.prisma,
  }))) {
    return {
      reason: "inactive_route",
      status: "ignored",
    };
  }
  return {
    route,
    status: "active",
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
  const selectedParts = input.partIndex === null
    ? input.target.parts
    : input.target.parts[input.partIndex] === undefined
      ? null
      : [input.target.parts[input.partIndex]];
  if (!selectedParts) {
    return null;
  }

  const text = selectedParts
    .map(renderHostedLinqReactionTargetPart)
    .filter((value): value is string => value !== null)
    .join("\n")
    .trim();
  return truncateHostedLinqReactionContextText(
    text || "Message content unavailable.",
    HOSTED_LINQ_REACTION_TARGET_TEXT_MAX_CHARS,
  );
}

function renderHostedLinqReactionTargetPart(
  part: HostedLinqReactionTargetPart,
): string | null {
  switch (part.type) {
    case "text":
      return `Text: ${part.value}`;
    case "link":
      return `Link: ${part.value}`;
    case "media":
      return `Attachment: ${part.fileName} (${part.mimeType})`;
    case "imessage_app": {
      const text = part.visibleText.join(" · ").trim();
      return text ? `iMessage app: ${text}` : "iMessage app content";
    }
    case "unsupported":
      return "Unsupported message part";
  }
}

function buildHostedLinqReactionContextText(input: {
  eventType: ParsedHostedLinqProviderEvent["eventType"];
  reactionCustomEmoji: string | null;
  reactionType: string | null;
  targetText: string;
}): string {
  const operation = input.eventType === "reaction.removed" ? "removed" : "added";
  const reaction = truncateHostedLinqReactionContextText(
    input.reactionCustomEmoji ?? input.reactionType ?? "reaction",
    HOSTED_LINQ_REACTION_LABEL_MAX_CHARS,
  );
  return [
    "Group reaction context (weak evidence; do not reply to this item alone).",
    `Action: ${operation} reaction ${reaction}`,
    "Reacted-to content:",
    input.targetText,
  ].join("\n");
}

function truncateHostedLinqReactionContextText(value: string, maxChars: number): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxChars - 12)).trimEnd()} [truncated]`;
}
