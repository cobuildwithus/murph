import { Prisma, type PrismaClient } from "@prisma/client";

import { acquireHostedLinqChatOwnershipLockTx } from "../hosted-routing/linq-chat-ownership-lock";
import {
  createHostedLinqChatLookupKey,
  createHostedLinqChatLookupKeyReadCandidates,
} from "./contact-privacy";

/**
 * Burst state for the Web "on it" emoji tapback (one row per direct chat).
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
 *
 * Claims and heavy marks take the same chat ownership lock as the engagement
 * route's dispatch fence, so a claim and a progress send serialize. Every
 * transaction is short, bounded, and never holds the lock across a network
 * call. Rows are keyed by the current chat lookup key and read across all
 * configured key versions.
 */

type HostedLinqAckReactionClient = Pick<PrismaClient, "$transaction">;
type HostedLinqAckReactionTx = Pick<Prisma.TransactionClient, "$executeRaw" | "$queryRaw">;

const HOSTED_LINQ_ACK_REACTION_TX_OPTIONS = { maxWait: 500, timeout: 1_500 } as const;
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

/**
 * Reserves the burst's single tapback. Returns the reservation token, or null
 * when the burst already has a reservation or a heavy message, or when Murph
 * has sent anything since `messageReceivedAt` (the reply beat us).
 */
export async function claimHostedLinqAckReaction(input: {
  linqChatId: string;
  messageReceivedAt: Date;
  now?: () => Date;
  prisma: HostedLinqAckReactionClient;
}): Promise<Date | null> {
  const keys = resolveKeys(input.linqChatId);
  if (!keys) return null;
  return withBoundedTransaction({
    linqChatId: input.linqChatId,
    prisma: input.prisma,
    run: async (tx) => {
      const [state] = await tx.$queryRaw<Array<{ fresh: boolean; taken: boolean }>>`
        SELECT
          ${noOutboundSinceSql(keys.candidates, input.messageReceivedAt)} AS fresh,
          EXISTS (
            SELECT 1 FROM hosted_linq_ack_reaction s
            WHERE s.linq_chat_lookup_key IN (${Prisma.join(keys.candidates)})
              AND (
                s.claimed_at > COALESCE(${lastOutboundSql(keys.candidates)}, '-infinity'::timestamp)
                OR s.heavy_at > COALESCE(${lastOutboundSql(keys.candidates)}, '-infinity'::timestamp)
              )
          ) AS taken
      `;
      if (!state?.fresh || state.taken) {
        return null;
      }
      const claimedAt = input.now?.() ?? new Date();
      await tx.$executeRaw`
        INSERT INTO hosted_linq_ack_reaction AS s (linq_chat_lookup_key, claimed_at, reacted_at, updated_at)
        VALUES (${keys.key}, ${claimedAt}, NULL, ${claimedAt})
        ON CONFLICT (linq_chat_lookup_key) DO UPDATE
          SET claimed_at = EXCLUDED.claimed_at, reacted_at = NULL, updated_at = EXCLUDED.updated_at
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
 * runtime progress update would repeat the same "on it" signal. Callers run
 * it inside their own transaction while holding the chat ownership lock.
 */
export async function isHostedLinqAckReactionCoveringCurrentBurst(input: {
  linqChatId: string;
  prisma: HostedLinqAckReactionTx;
}): Promise<boolean> {
  const keys = resolveKeys(input.linqChatId);
  if (!keys) return false;
  const rows = await input.prisma.$queryRaw<Array<{ covered: boolean }>>`
    SELECT EXISTS (
      SELECT 1 FROM hosted_linq_ack_reaction s
      WHERE s.linq_chat_lookup_key IN (${Prisma.join(keys.candidates)})
        AND s.reacted_at IS NOT NULL
        AND s.claimed_at > COALESCE(${lastOutboundSql(keys.candidates)}, '-infinity'::timestamp)
    ) AS covered
  `;
  return rows[0]?.covered === true;
}
