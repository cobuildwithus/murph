import "server-only";

import type { PrismaClient } from "@prisma/client";
import {
  buildHostedExecutionTelegramConversationMessageWake,
  createHostedExecutionGroupReactionEventId,
  formatHostedExecutionGroupReactionEventText,
  HOSTED_EXECUTION_GROUP_REACTION_SENDER_ATTESTATION,
  HOSTED_EXECUTION_TELEGRAM_MESSAGE_SCHEMA,
  type HostedExecutionGroupReactionChange,
} from "@murphai/hosted-execution";

import { getPrisma } from "../prisma";
import {
  signalHostedMailboxAppendRuntime,
} from "../hosted-orchestration/signal-runtime";
import {
  readHostedThreadRouteByThreadIdentity,
} from "../hosted-routing/thread-route-store";
import {
  appendConsumedHostedGroupReactionMailboxEnvelopeTx,
} from "./group-reaction-mailbox";
import { logHostedOnboardingDiagnostic } from "./logging";
import { readActiveHostedMemberAccess } from "./member-access";
import { HOSTED_ONBOARDING_TRANSACTION_OPTIONS } from "./shared";
import {
  buildHostedTelegramWebhookEventId,
  parseHostedTelegramWebhookUpdate,
} from "./telegram";

const HOSTED_TELEGRAM_REACTION_ARRAY_MAX = 64;
const HOSTED_TELEGRAM_REACTION_VALUE_MAX_CHARS = 256;
const HOSTED_TELEGRAM_REACTION_COUNT_MAX = 1_000_000_000;

type HostedWebhookPostResponseScheduler = (task: () => Promise<void>) => void;

export type HostedTelegramGroupReactionWebhookResponse = {
  duplicate?: boolean;
  ignored?: boolean;
  ok: true;
  reason: string;
};

type ParsedHostedTelegramGroupReaction = {
  actor: string | null;
  changes: HostedExecutionGroupReactionChange[];
  chatId: string;
  mode: "delta" | "snapshot";
  occurredAt: string;
  targetMessageId: string;
};

/**
 * Handles only Telegram reaction update shapes. Ordinary messages and callback
 * queries return null and continue through the existing webhook service.
 */
export async function handleHostedTelegramGroupReactionWebhook(input: {
  prisma?: PrismaClient;
  rawBody: string;
  scheduleAfterResponse?: HostedWebhookPostResponseScheduler;
  signal?: AbortSignal;
}): Promise<HostedTelegramGroupReactionWebhookResponse | null> {
  input.signal?.throwIfAborted();
  const update = parseHostedTelegramWebhookUpdate(input.rawBody);
  const parsed = parseHostedTelegramGroupReactionUpdate(update);
  if (parsed.kind === "not-reaction") {
    return null;
  }
  if (parsed.kind === "invalid") {
    return {
      ignored: true,
      ok: true,
      reason: parsed.reason,
    };
  }

  const prisma = input.prisma ?? getPrisma();
  const route = await readHostedThreadRouteByThreadIdentity({
    channel: "telegram",
    prisma,
    threadId: parsed.reaction.chatId,
  });
  if (
    !route
    || !(await readActiveHostedMemberAccess({
      memberId: route.containerMemberId,
      prisma,
    }))
  ) {
    return {
      ignored: true,
      ok: true,
      reason: "telegram-group-reaction-route-unavailable",
    };
  }

  const eventId = createHostedExecutionGroupReactionEventId(
    buildHostedTelegramWebhookEventId(update),
  );
  const envelope = buildHostedExecutionTelegramConversationMessageWake({
    eventId,
    occurredAt: parsed.reaction.occurredAt,
    routeAuthority: {
      channel: "telegram",
      containerMemberId: route.containerMemberId,
      threadId: parsed.reaction.chatId,
    },
    telegramMessage: {
      from: HOSTED_EXECUTION_GROUP_REACTION_SENDER_ATTESTATION,
      messageId: eventId,
      schema: HOSTED_EXECUTION_TELEGRAM_MESSAGE_SCHEMA,
      text: formatHostedExecutionGroupReactionEventText({
        actor: parsed.reaction.actor,
        changes: parsed.reaction.changes,
        channel: "telegram",
        mode: parsed.reaction.mode,
        targetMessageId: parsed.reaction.targetMessageId,
        targetText: null,
      }),
      threadId: parsed.reaction.chatId,
      threadIsDirect: false,
    },
    userId: route.containerMemberId,
  });
  const appended = await prisma.$transaction(
    (tx) => appendConsumedHostedGroupReactionMailboxEnvelopeTx({
      envelope,
      tx,
    }),
    HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  );

  const signalRuntime = async () => {
    await signalHostedMailboxAppendRuntime({
      expectedUserId: route.containerMemberId,
      knownCheckpoint: {
        lane: appended.item.lane,
        laneSeq: appended.item.laneSeq,
        userId: route.containerMemberId,
      },
      mailboxItemId: appended.item.id,
      prisma,
    });
  };
  if (input.scheduleAfterResponse) {
    input.scheduleAfterResponse(async () => {
      try {
        await signalRuntime();
      } catch (error) {
        logHostedOnboardingDiagnostic(
          "hosted-onboarding.telegram-group-reaction-signal-failed",
          {
            errorName: error instanceof Error ? error.name : "UnknownError",
          },
        );
      }
    });
  } else {
    await signalRuntime();
  }

  return {
    duplicate: appended.duplicate || undefined,
    ok: true,
    reason: "durable-telegram-group-reaction",
  };
}

function parseHostedTelegramGroupReactionUpdate(
  update: ReturnType<typeof parseHostedTelegramWebhookUpdate>,
):
  | { kind: "not-reaction" }
  | { kind: "invalid"; reason: string }
  | { kind: "reaction"; reaction: ParsedHostedTelegramGroupReaction } {
  const record = update as Record<string, unknown>;
  const individual = record.message_reaction;
  const aggregate = record.message_reaction_count;
  if (individual === undefined && aggregate === undefined) {
    return { kind: "not-reaction" };
  }
  if (individual !== undefined && aggregate !== undefined) {
    return invalidHostedTelegramGroupReactionUpdate();
  }

  const reaction = individual !== undefined
    ? parseHostedTelegramIndividualReaction(individual)
    : parseHostedTelegramAggregateReaction(aggregate);
  return reaction
    ? { kind: "reaction", reaction }
    : invalidHostedTelegramGroupReactionUpdate();
}

function invalidHostedTelegramGroupReactionUpdate(): {
  kind: "invalid";
  reason: string;
} {
  return {
    kind: "invalid",
    reason: "invalid-telegram-group-reaction-update",
  };
}

function parseHostedTelegramIndividualReaction(
  value: unknown,
): ParsedHostedTelegramGroupReaction | null {
  const record = readHostedTelegramRecord(value);
  const common = record ? parseHostedTelegramReactionCommon(record) : null;
  if (!record || !common) {
    return null;
  }
  const oldReactions = parseHostedTelegramReactionList(record.old_reaction);
  const newReactions = parseHostedTelegramReactionList(record.new_reaction);
  if (!oldReactions || !newReactions) {
    return null;
  }
  const changes = diffHostedTelegramReactionLists(oldReactions, newReactions);
  if (changes.length === 0 || changes.length > HOSTED_TELEGRAM_REACTION_ARRAY_MAX) {
    return null;
  }

  return {
    ...common,
    actor: readHostedTelegramReactionActor(record),
    changes,
    mode: "delta",
  };
}

function parseHostedTelegramAggregateReaction(
  value: unknown,
): ParsedHostedTelegramGroupReaction | null {
  const record = readHostedTelegramRecord(value);
  const common = record ? parseHostedTelegramReactionCommon(record) : null;
  if (
    !record
    || !common
    || !Array.isArray(record.reactions)
    || record.reactions.length > HOSTED_TELEGRAM_REACTION_ARRAY_MAX
  ) {
    return null;
  }

  const changes: HostedExecutionGroupReactionChange[] = [];
  for (const item of record.reactions) {
    const countRecord = readHostedTelegramRecord(item);
    const reaction = countRecord
      ? parseHostedTelegramReactionType(countRecord.type)
      : null;
    const count = countRecord
      ? readHostedTelegramReactionCount(countRecord.total_count)
      : null;
    if (!reaction || count === null) {
      return null;
    }
    changes.push({
      count,
      operation: "snapshot",
      reaction,
    });
  }

  return {
    ...common,
    actor: null,
    changes,
    mode: "snapshot",
  };
}

function parseHostedTelegramReactionCommon(
  record: Record<string, unknown>,
): Omit<ParsedHostedTelegramGroupReaction, "actor" | "changes" | "mode"> | null {
  const chat = readHostedTelegramRecord(record.chat);
  const chatId = chat ? readHostedTelegramIdentifier(chat.id) : null;
  const chatType = chat ? readHostedTelegramText(chat.type) : null;
  const targetMessageId = readHostedTelegramNonNegativeInteger(record.message_id);
  const occurredAt = readHostedTelegramUnixTimestamp(record.date);
  if (
    !chatId
    || (chatType !== "group" && chatType !== "supergroup")
    || targetMessageId === null
    || !occurredAt
  ) {
    return null;
  }
  return {
    chatId,
    occurredAt,
    targetMessageId: String(targetMessageId),
  };
}

function diffHostedTelegramReactionLists(
  oldReactions: readonly string[],
  newReactions: readonly string[],
): HostedExecutionGroupReactionChange[] {
  const oldCounts = countHostedTelegramReactions(oldReactions);
  const newCounts = countHostedTelegramReactions(newReactions);
  const changes: HostedExecutionGroupReactionChange[] = [];

  for (const reaction of new Set([...oldReactions, ...newReactions])) {
    const oldCount = oldCounts.get(reaction) ?? 0;
    const newCount = newCounts.get(reaction) ?? 0;
    for (let index = newCount; index < oldCount; index += 1) {
      changes.push({ operation: "removed", reaction });
    }
    for (let index = oldCount; index < newCount; index += 1) {
      changes.push({ operation: "added", reaction });
    }
  }
  return changes;
}

function countHostedTelegramReactions(
  reactions: readonly string[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const reaction of reactions) {
    counts.set(reaction, (counts.get(reaction) ?? 0) + 1);
  }
  return counts;
}

function parseHostedTelegramReactionList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > HOSTED_TELEGRAM_REACTION_ARRAY_MAX) {
    return null;
  }
  const reactions: string[] = [];
  for (const item of value) {
    const reaction = parseHostedTelegramReactionType(item);
    if (!reaction) {
      return null;
    }
    reactions.push(reaction);
  }
  return reactions;
}

function parseHostedTelegramReactionType(value: unknown): string | null {
  const record = readHostedTelegramRecord(value);
  const type = record ? readHostedTelegramText(record.type) : null;
  let reaction: string | null = null;
  if (type === "emoji") {
    reaction = readHostedTelegramText(record?.emoji);
  } else if (type === "custom_emoji") {
    const customEmojiId = readHostedTelegramText(record?.custom_emoji_id);
    reaction = customEmojiId ? `custom_emoji:${customEmojiId}` : null;
  } else if (type === "paid") {
    reaction = "paid";
  } else if (record) {
    reaction = `unknown:${stableHostedTelegramReactionJson(record)}`;
  }
  return reaction
    ? Array.from(reaction)
      .slice(0, HOSTED_TELEGRAM_REACTION_VALUE_MAX_CHARS)
      .join("")
    : null;
}

function stableHostedTelegramReactionJson(
  value: Record<string, unknown>,
): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
    ),
  );
}

function readHostedTelegramReactionActor(
  record: Record<string, unknown>,
): string | null {
  const user = readHostedTelegramRecord(record.user);
  const userId = user ? readHostedTelegramIdentifier(user.id) : null;
  if (userId) {
    return `telegram-user:${userId}`;
  }
  const actorChat = readHostedTelegramRecord(record.actor_chat);
  const actorChatId = actorChat
    ? readHostedTelegramIdentifier(actorChat.id)
    : null;
  return actorChatId ? `telegram-chat:${actorChatId}` : null;
}

function readHostedTelegramReactionCount(value: unknown): number | null {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= HOSTED_TELEGRAM_REACTION_COUNT_MAX
    ? value
    : null;
}

function readHostedTelegramRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readHostedTelegramText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value
    .replace(/[\u0000-\u001f\u007f-\u009f]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return normalized || null;
}

function readHostedTelegramIdentifier(value: unknown): string | null {
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return String(value);
  }
  const normalized = readHostedTelegramText(value);
  return normalized && /^-?\d+$/u.test(normalized) ? normalized : null;
}

function readHostedTelegramNonNegativeInteger(value: unknown): number | null {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0
    ? value
    : null;
}

function readHostedTelegramUnixTimestamp(value: unknown): string | null {
  if (
    typeof value !== "number"
    || !Number.isSafeInteger(value)
    || value < 0
  ) {
    return null;
  }
  const date = new Date(value * 1_000);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
