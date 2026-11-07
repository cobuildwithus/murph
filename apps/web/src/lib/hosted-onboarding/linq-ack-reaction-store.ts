import { Prisma, type PrismaClient } from "@prisma/client";

import { acquireHostedLinqChatOwnershipLockTx } from "../hosted-routing/linq-chat-ownership-lock";
import {
  createHostedLinqChatLookupKey,
  createHostedLinqChatLookupKeyReadCandidates,
  createHostedLinqMessageLookupKey,
  createHostedLinqMessageLookupKeyReadCandidates,
} from "./contact-privacy";

/**
 * Burst state for the Web "on it" emoji tapback (one row per eligible chat).
 *
 * A burst is the member's messages after the chat's latest
 * `hosted_linq_delivery.attempted_at`: the runtime dispatch fence writes that
 * row before every provider send, so any Murph outbound ends the burst. A
 * timestamp counts for the current burst only while it is later than that
 * boundary.
 *
 * - `claimed_at` reserves the burst's single tapback. It is the token that
 *   confirm and release must match, so a late task never touches a newer
 *   burst. An ambiguous send keeps it, so a lost response cannot become a
 *   second tapback.
 * - `reacted_at` marks Linq accepting the tapback. Only a confirmed tapback
 *   suppresses a runtime progress update.
 * - `heavy_at` silences the rest of the burst after a heavy message.
 * - `message_lookup_key` and `reaction` say which member message the
 *   reservation is for and with which emoji, so Murph's own
 *   `react_to_message` can skip a message that already has a tapback.
 *
 * A reservation belongs to the current burst for at most
 * `HOSTED_LINQ_ACK_REACTION_BURST_MAX_AGE_MS`: a turn that ends without any
 * outbound (a reaction-only reply whose reaction was skipped, or a plain
 * finish-without-reply) would otherwise keep the burst open and cost the
 * member's next message its tapback and progress note.
 *
 * Opted-in quick asks skip a live conversation without writing burst state,
 * leaving later tapbacks and progress updates eligible.
 *
 * Claims and heavy marks take the same chat ownership lock as the engagement
 * route's dispatch fence, so a claim and a progress send serialize. Every
 * transaction is short, bounded, and never holds the lock across a network
 * call. Rows are keyed by the current chat lookup key and read across all
 * configured key versions.
 */

type HostedLinqAckReactionClient = Pick<PrismaClient, "$transaction">;
type HostedLinqAckReactionTx = Pick<Prisma.TransactionClient, "$executeRaw" | "$queryRaw">;

export const HOSTED_LINQ_ACK_REACTION_BURST_MAX_AGE_MS = 120_000;
/**
 * A message this soon after Murph's last send is part of a live conversation.
 * Counted from receipt, so classifier time cannot push it past the window.
 */
const HOSTED_LINQ_ACK_REACTION_LIVE_WINDOW_MS = 5 * 60_000;

const HOSTED_LINQ_ACK_REACTION_TX_OPTIONS = { timeout: 1_500 } as const;
const HOSTED_LINQ_ACK_REACTION_LOCK_TIMEOUT = "300ms";
const HOSTED_LINQ_ACK_REACTION_STATEMENT_TIMEOUT = "500ms";

function resolveKeys(linqChatId: string): { candidates: string[]; key: string } | null {
  const key = createHostedLinqChatLookupKey(linqChatId);
  const candidates = createHostedLinqChatLookupKeyReadCandidates(linqChatId);
  return key && candidates.length > 0 ? { candidates, key } : null;
}

function lastOutboundSql(candidates: readonly string[]): Prisma.Sql {
  return Prisma.sql`(
    SELECT MAX(d.attempted_at)
    FROM hosted_linq_delivery d
    WHERE d.linq_chat_lookup_key IN (${Prisma.join(candidates)})
  )`;
}

/**
 * Where the current burst starts: Murph's last outbound, but never earlier
 * than the max burst age before `now` (the app clock that writes claimed_at).
 */
function burstStartSql(candidates: readonly string[], now: Date, maxAgeMs = HOSTED_LINQ_ACK_REACTION_BURST_MAX_AGE_MS): Prisma.Sql {
  const oldest = new Date(now.getTime() - maxAgeMs);
  return Prisma.sql`GREATEST(${lastOutboundSql(candidates)}, ${oldest})`;
}

/** Murph has not sent anything to the chat since the message arrived. */
function noOutboundSinceSql(candidates: readonly string[], messageReceivedAt: Date): Prisma.Sql {
  return Prisma.sql`COALESCE(${lastOutboundSql(candidates)} < ${messageReceivedAt}, TRUE)`;
}

async function withBoundedTransaction<T>(input: {
  linqChatId?: string;
  prisma: HostedLinqAckReactionClient;
  run: (tx: HostedLinqAckReactionTx) => Promise<T>;
}): Promise<T> {
  return input.prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      SELECT
        set_config('lock_timeout', ${HOSTED_LINQ_ACK_REACTION_LOCK_TIMEOUT}, true),
        set_config('statement_timeout', ${HOSTED_LINQ_ACK_REACTION_STATEMENT_TIMEOUT}, true)
    `;
    if (input.linqChatId) {
      await acquireHostedLinqChatOwnershipLockTx({ chatId: input.linqChatId, tx });
    }
    return input.run(tx);
  }, HOSTED_LINQ_ACK_REACTION_TX_OPTIONS);
}

type HostedLinqAckReactionClaimInput = {
  linqChatId: string;
  messageId: string;
  messageReceivedAt: Date;
  now?: () => Date;
  prisma: HostedLinqAckReactionClient;
  reaction: string;
  skipLiveConversation?: boolean;
};

/**
 * Reserves the burst's single tapback. Returns the reservation token, or null
 * when the burst already has a reservation or a heavy message, or when Murph
 * has sent anything since `messageReceivedAt` (the reply beat us). Otherwise,
 * opted-in quick asks return `live_conversation` for a recent prior outbound.
 */
export function claimHostedLinqAckReaction(
  input: HostedLinqAckReactionClaimInput & { skipLiveConversation?: false },
): Promise<Date | null>;
export function claimHostedLinqAckReaction(
  input: HostedLinqAckReactionClaimInput,
): Promise<Date | "live_conversation" | null>;
export async function claimHostedLinqAckReaction(
  input: HostedLinqAckReactionClaimInput,
): Promise<Date | "live_conversation" | null> {
  const keys = resolveKeys(input.linqChatId);
  const messageKey = createHostedLinqMessageLookupKey(input.messageId);
  if (!keys || !messageKey) return null;
  return withBoundedTransaction({
    linqChatId: input.linqChatId,
    prisma: input.prisma,
    run: async (tx) => {
      const claimedAt = input.now?.() ?? new Date();
      const liveSince = new Date(input.messageReceivedAt.getTime() - HOSTED_LINQ_ACK_REACTION_LIVE_WINDOW_MS);
      const [state] = await tx.$queryRaw<Array<{ fresh: boolean; live: boolean; taken: boolean }>>`
        SELECT
          ${noOutboundSinceSql(keys.candidates, input.messageReceivedAt)} AS fresh,
          ${input.skipLiveConversation
            ? Prisma.sql`COALESCE(${lastOutboundSql(keys.candidates)} >= ${liveSince}, FALSE)`
            : Prisma.sql`FALSE`} AS live,
          EXISTS (
            SELECT 1 FROM hosted_linq_ack_reaction s
            WHERE s.linq_chat_lookup_key IN (${Prisma.join(keys.candidates)})
              AND (
                s.claimed_at > ${burstStartSql(keys.candidates, claimedAt)}
                OR s.heavy_at > COALESCE(${lastOutboundSql(keys.candidates)}, '-infinity'::timestamp)
              )
          ) AS taken
      `;
      if (!state?.fresh || state.taken) {
        return null;
      }
      if (state.live) return "live_conversation";
      await tx.$executeRaw`
        INSERT INTO hosted_linq_ack_reaction AS s
          (linq_chat_lookup_key, claimed_at, reacted_at, message_lookup_key, reaction, updated_at)
        VALUES (${keys.key}, ${claimedAt}, NULL, ${messageKey}, ${input.reaction}, ${claimedAt})
        ON CONFLICT (linq_chat_lookup_key) DO UPDATE
          SET claimed_at = EXCLUDED.claimed_at,
            reacted_at = NULL,
            message_lookup_key = EXCLUDED.message_lookup_key,
            reaction = EXCLUDED.reaction,
            updated_at = EXCLUDED.updated_at
      `;
      return claimedAt;
    },
  });
}

/**
 * Marks the message's burst heavy so no later message in it gets a tapback.
 * Does nothing once Murph has sent since the message arrived: that burst has
 * ended, and a late mark must not silence the next one.
 */
export async function markHostedLinqAckReactionHeavy(input: {
  linqChatId: string;
  messageReceivedAt: Date;
  now?: () => Date;
  prisma: HostedLinqAckReactionClient;
}): Promise<void> {
  const keys = resolveKeys(input.linqChatId);
  if (!keys) return;
  await withBoundedTransaction({
    linqChatId: input.linqChatId,
    prisma: input.prisma,
    run: async (tx) => {
      const heavyAt = input.now?.() ?? new Date();
      await tx.$executeRaw`
        INSERT INTO hosted_linq_ack_reaction AS s (linq_chat_lookup_key, heavy_at, updated_at)
        SELECT ${keys.key}, ${heavyAt}, ${heavyAt}
        WHERE ${noOutboundSinceSql(keys.candidates, input.messageReceivedAt)}
        ON CONFLICT (linq_chat_lookup_key) DO UPDATE
          SET heavy_at = EXCLUDED.heavy_at, updated_at = EXCLUDED.updated_at
      `;
    },
  });
}

/** Records that Linq accepted the tapback reserved by `claimedAt`. */
export async function confirmHostedLinqAckReaction(input: {
  claimedAt: Date;
  linqChatId: string;
  now?: () => Date;
  prisma: HostedLinqAckReactionClient;
}): Promise<void> {
  const keys = resolveKeys(input.linqChatId);
  if (!keys) return;
  await withBoundedTransaction({
    prisma: input.prisma,
    run: async (tx) => {
      const reactedAt = input.now?.() ?? new Date();
      await tx.$executeRaw`
        UPDATE hosted_linq_ack_reaction
        SET reacted_at = ${reactedAt}, updated_at = ${reactedAt}
        WHERE linq_chat_lookup_key IN (${Prisma.join(keys.candidates)})
          AND claimed_at = ${input.claimedAt}
      `;
    },
  });
}

/**
 * Frees the reservation after Linq definitely refused the tapback, so a later
 * message in the burst may try. Never call it for an ambiguous outcome.
 */
export async function releaseHostedLinqAckReaction(input: {
  claimedAt: Date;
  linqChatId: string;
  now?: () => Date;
  prisma: HostedLinqAckReactionClient;
}): Promise<void> {
  const keys = resolveKeys(input.linqChatId);
  if (!keys) return;
  await withBoundedTransaction({
    prisma: input.prisma,
    run: async (tx) => {
      await tx.$executeRaw`
        UPDATE hosted_linq_ack_reaction
        SET claimed_at = NULL, updated_at = ${input.now?.() ?? new Date()}
        WHERE linq_chat_lookup_key IN (${Prisma.join(keys.candidates)})
          AND claimed_at = ${input.claimedAt}
          AND reacted_at IS NULL
      `;
    },
  });
}

/**
 * True when Linq accepted a tapback for the chat's current burst, so a
 * runtime progress update would repeat the same "on it" signal. Progress
 * suppression uses a 30-second window under the delivery lock; advisory typing
 * reads use the default two-minute burst window without a transaction.
 */
export async function isHostedLinqAckReactionCoveringCurrentBurst(input: {
  maxAgeMs?: number;
  linqChatId: string;
  now?: () => Date;
  prisma: HostedLinqAckReactionTx;
}): Promise<boolean> {
  const keys = resolveKeys(input.linqChatId);
  if (!keys) return false;
  const rows = await input.prisma.$queryRaw<Array<{ covered: boolean }>>`
    SELECT EXISTS (
      SELECT 1 FROM hosted_linq_ack_reaction s
      WHERE s.linq_chat_lookup_key IN (${Prisma.join(keys.candidates)})
        AND s.reacted_at IS NOT NULL
        AND s.claimed_at > ${burstStartSql(keys.candidates, input.now?.() ?? new Date(), input.maxAgeMs)}
    ) AS covered
  `;
  return rows[0]?.covered === true;
}

/**
 * The emoji Linq accepted as Web's tapback on this exact member message, or
 * null. Only a confirmed tapback counts: a reservation can still end with
 * nothing sent, and Murph's own reaction must not be skipped for it. Callers
 * run it inside their own transaction.
 */
export async function readHostedLinqAckReactionOnMessage(input: {
  linqChatId: string;
  messageId: string;
  prisma: HostedLinqAckReactionTx;
}): Promise<string | null> {
  const keys = resolveKeys(input.linqChatId);
  const messageKeys = createHostedLinqMessageLookupKeyReadCandidates(input.messageId);
  if (!keys || messageKeys.length === 0) return null;
  const rows = await input.prisma.$queryRaw<Array<{ reaction: string | null }>>`
    SELECT s.reaction
    FROM hosted_linq_ack_reaction s
    WHERE s.linq_chat_lookup_key IN (${Prisma.join(keys.candidates)})
      AND s.message_lookup_key IN (${Prisma.join(messageKeys)})
      AND s.claimed_at IS NOT NULL
      AND s.reacted_at IS NOT NULL
    LIMIT 1
  `;
  return rows[0]?.reaction?.trim() || null;
}
