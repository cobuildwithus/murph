import { createHash } from "node:crypto";

import type { Prisma, PrismaClient } from "@prisma/client";
import {
  buildHostedExecutionLinqConversationMessageWake,
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
import { hostedOnboardingError, isHostedOnboardingError } from "./errors";
import {
  getHostedLinqChatSummary,
  getHostedLinqReactionTargetMessage,
  isCurrentHostedLinqParticipantHandle,
  type HostedLinqReactionTargetMessage,
  type HostedLinqReactionTargetPart,
} from "./linq-client";
import {
  createHostedLinqProviderEventLookupKey,
} from "./linq-observability-identifiers";
import { readActiveHostedMemberAccess } from "./member-access";
import { createHostedLinqParticipantContact } from "./linq-participant-contact";
import type { ParsedHostedLinqProviderEvent } from "./linq-provider-events";
import { isHostedLinqAffirmativeReaction } from "./linq-provider-events";
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
      laneSeq: string;
      mailboxItemId: string;
      status: "staged";
      userId: string;
      wakeable: boolean;
    }
  | {
      reason: HostedLinqGroupReactionContextSkipReason;
      status: "ignored";
    };

export type HostedLinqGroupReactionAdmission =
  | {
      accountLookupKey: string;
      actor: NonNullable<ReturnType<typeof createHostedLinqParticipantContact>>;
      chatId: string;
      containerMemberId: string;
      messageId: string;
      partIndex: number | null;
      status: "ready";
      target: HostedLinqReactionTargetMessage;
    }
  | {
      reason: HostedLinqGroupReactionContextSkipReason;
      status: "ignored";
    };

export async function readHostedLinqGroupReactionDuplicateContext(input: {
  allowActionableReply?: boolean;
  event: ParsedHostedLinqProviderEvent;
  prisma: PrismaClient;
}): Promise<HostedLinqGroupReactionContextResult | null> {
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
    dedupeKey: createHostedLinqProviderEventLookupKey(input.event.eventId),
    prisma: input.prisma,
    userId: route.route.containerMemberId,
  });
  return existing
    ? projectHostedLinqGroupReactionDuplicateContext({
        allowActionableReply: input.allowActionableReply,
        event: input.event,
        existing,
        userId: route.route.containerMemberId,
      })
    : null;
}

export async function readHostedLinqGroupReactionAdmission(input: {
  event: ParsedHostedLinqProviderEvent;
  prisma: PrismaClient;
  signal?: AbortSignal;
}): Promise<HostedLinqGroupReactionAdmission> {
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
  let target: HostedLinqReactionTargetMessage;
  try {
    target = await getHostedLinqReactionTargetMessage({
      messageId: context.messageId,
      ...(input.signal ? { signal: input.signal } : {}),
    });
  } catch (error) {
    if (isHostedOnboardingError(error) && !error.retryable) {
      return { reason: "target_unavailable", status: "ignored" };
    }
    throw error;
  }
  if (
    target.id !== context.messageId
    || target.chatId !== context.chatId
    || (context.partIndex !== null && target.parts[context.partIndex] === undefined)
  ) {
    return { reason: "invalid_target", status: "ignored" };
  }

  let canonicalContext: Awaited<ReturnType<typeof readHostedLinqReactionCanonicalContext>>;
  try {
    canonicalContext = await readHostedLinqReactionCanonicalContext({
      actor: context.actor,
      chatId: context.chatId,
      event: input.event,
      ...(input.signal ? { signal: input.signal } : {}),
    });
  } catch (error) {
    if (isHostedOnboardingError(error) && !error.retryable) {
      return { reason: "target_unavailable", status: "ignored" };
    }
    throw error;
  }
  if (canonicalContext.status === "ignored") {
    return canonicalContext;
  }

  return {
    accountLookupKey: canonicalContext.accountLookupKey,
    actor: context.actor,
    chatId: context.chatId,
    containerMemberId: route.route.containerMemberId,
    messageId: context.messageId,
    partIndex: context.partIndex,
    status: "ready",
    target,
  };
}

export async function stageHostedLinqGroupReactionContext(input: {
  admission: Extract<HostedLinqGroupReactionAdmission, { status: "ready" }>;
  allowActionableReply: boolean;
  event: ParsedHostedLinqProviderEvent;
  prisma: PrismaClient;
}): Promise<HostedLinqGroupReactionContextResult> {
  const admission = input.admission;
  const providerEventLookupKey = createHostedLinqProviderEventLookupKey(
    input.event.eventId,
  );

  const existing = await readHostedMailboxItemByDedupeKey({
    dedupeKey: providerEventLookupKey,
    prisma: input.prisma,
    userId: admission.containerMemberId,
  });
  if (existing) {
    return projectHostedLinqGroupReactionDuplicateContext({
      allowActionableReply: input.allowActionableReply,
      event: input.event,
      existing,
      userId: admission.containerMemberId,
    });
  }

  const targetText = buildHostedLinqReactionTargetText({
    chatId: admission.chatId,
    messageId: admission.messageId,
    partIndex: admission.partIndex,
    target: admission.target,
  });
  if (!targetText) {
    return {
      reason: "invalid_target",
      status: "ignored",
    };
  }
  const reactionTargetKey = buildHostedLinqReactionTargetKey({
    messageId: admission.messageId,
    partIndex: admission.partIndex,
  });
  const reactionOperation = input.event.eventType === "reaction.removed"
    ? "removed"
    : "added";
  const wakeable = input.allowActionableReply !== false
    && input.event.eventType === "reaction.added"
    && admission.target.isFromMe
    && isHostedLinqAffirmativeReaction({
      customEmoji: input.event.reactionCustomEmoji,
      reactionType: input.event.reactionType,
    });

  const buildWake = wakeable
    ? buildHostedExecutionLinqConversationMessageWake
    : buildHostedExecutionLinqConversationReactionWake;
  const envelope = buildWake({
    accountLookupKey: admission.accountLookupKey,
    contactKind: admission.actor.kind,
    contactLookupKey: admission.actor.lookupKey,
    // Reuse the privacy-safe provider-ledger key as the mailbox dedupe key so
    // transport projection can join to the existing opaque group partition
    // without exposing or duplicating the raw provider event id.
    eventId: providerEventLookupKey,
    linqMessage: {
      chatId: admission.chatId,
      from: admission.actor.value,
      isFromMe: false,
      messageId: input.event.eventId,
      parts: [{
          type: "text",
          value: wakeable
              ? buildHostedLinqAffirmativeReactionReplyText({
                  reactionCustomEmoji: input.event.reactionCustomEmoji,
                  reactionType: input.event.reactionType,
                  targetText,
                })
              : buildHostedLinqReactionContextText({
                  operation: reactionOperation,
                  reactionCustomEmoji: input.event.reactionCustomEmoji,
                  reactionType: input.event.reactionType,
                  reactionTargetKey,
                  targetText,
                }),
      }],
      reactionEligible: false,
      ...(wakeable
        ? {
            replyToMessageId: admission.messageId,
            ...(admission.partIndex === null
              ? {}
              : { replyToPartIndex: admission.partIndex }),
          }
        : {
            reactionOperation,
            reactionTargetKey,
          }),
      service: input.event.service ?? admission.target.service,
      threadIsDirect: false,
    },
    occurredAt: input.event.providerCreatedAt.toISOString(),
    ...(admission.actor.kind === "phone"
      ? { phoneLookupKey: admission.actor.lookupKey }
      : {}),
    routeAuthority: {
      accountLookupKey: admission.accountLookupKey,
      channel: "linq",
      containerMemberId: admission.containerMemberId,
      threadId: admission.chatId,
    },
    userId: admission.containerMemberId,
  });

  return await input.prisma.$transaction(async (tx) => {
    const currentRoute = await readHostedActiveLinqReactionRoute({
      chatId: admission.chatId,
      prisma: tx,
    });
    if (currentRoute.status === "ignored") {
      return currentRoute;
    }
    if (currentRoute.route.containerMemberId !== admission.containerMemberId) {
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
      laneSeq: append.item.laneSeq.toString(),
      mailboxItemId: append.item.id,
      status: "staged",
      userId: admission.containerMemberId,
      wakeable,
    };
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

function projectHostedLinqGroupReactionDuplicateContext(input: {
  allowActionableReply?: boolean;
  event: ParsedHostedLinqProviderEvent;
  existing: NonNullable<Awaited<ReturnType<typeof readHostedMailboxItemByDedupeKey>>>;
  userId: string;
}): Extract<HostedLinqGroupReactionContextResult, { status: "staged" }> {
  return {
    duplicate: true,
    laneSeq: input.existing.laneSeq.toString(),
    mailboxItemId: input.existing.id,
    status: "staged",
    userId: input.userId,
    wakeable: input.existing.kind === "conversation.message"
      && input.allowActionableReply !== false
      && input.event.eventType === "reaction.added",
  };
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
  if (event.reactionIsFromMe === true) {
    return {
      reason: "own_reaction",
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

async function readHostedLinqReactionCanonicalContext(input: {
  actor: NonNullable<ReturnType<typeof createHostedLinqParticipantContact>>;
  chatId: string;
  event: ParsedHostedLinqProviderEvent;
  signal?: AbortSignal;
}): Promise<
  | { accountLookupKey: string; status: "ready" }
  | { reason: "invalid_actor" | "missing_context"; status: "ignored" }
> {
  const eventAccountLookupKey = createHostedPhoneLookupKey(input.event.phoneNumber);
  const chat = await getHostedLinqChatSummary({
    chatId: input.chatId,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  if (chat.isGroup === null) {
    throw hostedOnboardingError({
      code: "LINQ_CHAT_READ_INVALID",
      httpStatus: 502,
      message: "Linq chat read returned an invalid canonical response.",
      retryable: true,
    });
  }
  if (chat.isGroup !== true) {
    return { reason: "missing_context", status: "ignored" };
  }

  const accountLookupKeys = new Set(
    chat.handles
      .filter((handle) => handle.isMe)
      .map((handle) => createHostedPhoneLookupKey(handle.handle))
      .filter((value): value is string => value !== null),
  );
  if (accountLookupKeys.size !== 1) {
    return { reason: "missing_context", status: "ignored" };
  }
  const canonicalAccountLookupKey = accountLookupKeys.values().next().value ?? null;
  if (
    !canonicalAccountLookupKey
    || !chat.handles
      .filter(isCurrentHostedLinqParticipantHandle)
      .map((handle) => createHostedLinqParticipantContact({
        kind: handle.handle.includes("@") ? "email" : "phone",
        value: handle.handle,
      }))
      .some((participant) =>
        participant?.kind === input.actor.kind
        && participant.lookupKey === input.actor.lookupKey
      )
  ) {
    return { reason: "invalid_actor", status: "ignored" };
  }
  if (
    eventAccountLookupKey
    && eventAccountLookupKey !== canonicalAccountLookupKey
  ) {
    return { reason: "missing_context", status: "ignored" };
  }
  return {
    accountLookupKey: canonicalAccountLookupKey,
    status: "ready",
  };
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
  operation: "added" | "removed";
  reactionCustomEmoji: string | null;
  reactionType: string | null;
  reactionTargetKey: string;
  targetText: string;
}): string {
  const reaction = truncateHostedLinqReactionContextText(
    input.reactionCustomEmoji ?? input.reactionType ?? "reaction",
    HOSTED_LINQ_REACTION_LABEL_MAX_CHARS,
  );
  return [
    "Group reaction context (weak evidence; do not reply to this item alone).",
    `Action: ${input.operation} reaction ${reaction}`,
    `Reaction target: ${input.reactionTargetKey}`,
    "Reacted-to content:",
    input.targetText,
  ].join("\n");
}

function buildHostedLinqAffirmativeReactionReplyText(input: {
  reactionCustomEmoji: string | null;
  reactionType: string | null;
  targetText: string;
}): string {
  const reaction = truncateHostedLinqReactionContextText(
    input.reactionCustomEmoji ?? input.reactionType ?? "reaction",
    HOSTED_LINQ_REACTION_LABEL_MAX_CHARS,
  );
  return [
    "Group affirmative reaction reply to Murph's own message.",
    `Action: added reaction ${reaction}`,
    "The member used this as an affirmative reply to your exact message. If that message clearly asked a yes/no question or offered a specific action, treat this as yes or confirmation of that exact action, continue it, and do not ask the same question again. Otherwise keep it as context only and do not reply or act solely because of the reaction. Preserve any separate authorization, payment, or irreversible-effect safeguard not covered by the exact question. Do not infer unrelated intent.",
    "Reacted-to content:",
    input.targetText,
  ].join("\n");
}

function buildHostedLinqReactionTargetKey(input: {
  messageId: string;
  partIndex: number | null;
}): string {
  const digest = createHash("sha256")
    .update(`linq-reaction-target.v1\0${input.messageId}\0${input.partIndex ?? "message"}`)
    .digest("base64url");
  return `linq-reaction-target.v1:${digest}`;
}

function truncateHostedLinqReactionContextText(value: string, maxChars: number): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxChars - 12)).trimEnd()} [truncated]`;
}
