import { Prisma, type PrismaClient } from "@prisma/client";

import {
  materializeHostedLegacyAcceptedConversationAllowancePeriodTx,
} from "../hosted-execution/usage-allowance";

const DEFAULT_HOSTED_ACCEPTED_CONVERSATION_BACKFILL_BATCH_SIZE = 100;

interface HostedAcceptedConversationBackfillCandidateRow {
  id: string;
}

interface HostedAcceptedConversationBackfillCountRow {
  count: bigint;
}

export interface HostedAcceptedConversationBackfillResult {
  bound: number;
  failed: number;
  remaining: number;
  scanned: number;
}

export async function backfillHostedAcceptedConversationAllowancePeriods(input: {
  apply: boolean;
  batchSize?: number;
  prisma: PrismaClient;
}): Promise<HostedAcceptedConversationBackfillResult> {
  const batchSize = normalizeHostedAcceptedConversationBackfillBatchSize(input.batchSize);
  if (!input.apply) {
    return {
      bound: 0,
      failed: 0,
      remaining: await countHostedUnboundAcceptedConversationRows(input.prisma),
      scanned: 0,
    };
  }

  let afterId: string | null = null;
  let bound = 0;
  let failed = 0;
  let scanned = 0;
  while (true) {
    const candidates = await readHostedAcceptedConversationBackfillCandidates({
      afterId,
      batchSize,
      prisma: input.prisma,
    });
    if (candidates.length === 0) {
      break;
    }

    for (const candidate of candidates) {
      afterId = candidate.id;
      scanned += 1;
      try {
        const didBind = await input.prisma.$transaction(async (tx) => {
          const item = await tx.hostedMailboxItem.findUnique({
            select: {
              acceptedAllowancePeriodStart: true,
              consumedAt: true,
              createdAt: true,
              kind: true,
              lane: true,
              laneSeq: true,
              userId: true,
            },
            where: {
              id: candidate.id,
            },
          });
          if (
            !item
            || item.acceptedAllowancePeriodStart !== null
            || item.consumedAt !== null
            || item.kind !== "conversation.message"
            || item.lane !== "conversation"
          ) {
            return false;
          }
          const counter = await tx.hostedMailboxLaneCounter.findUnique({
            select: {
              consumedSeq: true,
            },
            where: {
              userId_lane: {
                lane: "conversation",
                userId: item.userId,
              },
            },
          });
          if ((counter?.consumedSeq ?? 0n) >= item.laneSeq) {
            return false;
          }

          const periodStart =
            await materializeHostedLegacyAcceptedConversationAllowancePeriodTx({
              acceptedAt: item.createdAt,
              memberId: item.userId,
              tx,
            });
          const updated = await tx.hostedMailboxItem.updateMany({
            data: {
              acceptedAllowancePeriodStart: periodStart,
            },
            where: {
              acceptedAllowancePeriodStart: null,
              consumedAt: null,
              id: candidate.id,
              kind: "conversation.message",
              lane: "conversation",
              laneSeq: item.laneSeq,
              userId: item.userId,
            },
          });
          if (updated.count !== 1) {
            throw new Error("Hosted accepted conversation backfill binding lost its row claim.");
          }
          return true;
        });
        if (didBind) {
          bound += 1;
        }
      } catch {
        failed += 1;
      }
    }
  }

  return {
    bound,
    failed,
    remaining: await countHostedUnboundAcceptedConversationRows(input.prisma),
    scanned,
  };
}

export async function countHostedUnboundAcceptedConversationRows(
  prisma: PrismaClient,
): Promise<number> {
  const rows = await prisma.$queryRaw<HostedAcceptedConversationBackfillCountRow[]>(Prisma.sql`
    SELECT COUNT(*)::bigint AS "count"
    FROM hosted_mailbox_item AS item
    LEFT JOIN hosted_mailbox_lane_counter AS counter
      ON counter.user_id = item.user_id
     AND counter.lane = item.lane
    WHERE item.kind = 'conversation.message'
      AND item.lane = 'conversation'
      AND item.consumed_at IS NULL
      AND item.accepted_allowance_period_start IS NULL
      AND COALESCE(counter.consumed_seq, 0::bigint) < item.lane_seq
  `);
  const count = rows[0]?.count ?? 0n;
  if (count < 0n || count > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Hosted accepted conversation backfill count is outside the safe range.");
  }
  return Number(count);
}

async function readHostedAcceptedConversationBackfillCandidates(input: {
  afterId: string | null;
  batchSize: number;
  prisma: PrismaClient;
}): Promise<HostedAcceptedConversationBackfillCandidateRow[]> {
  return input.prisma.$queryRaw<HostedAcceptedConversationBackfillCandidateRow[]>(Prisma.sql`
    SELECT item.id
    FROM hosted_mailbox_item AS item
    LEFT JOIN hosted_mailbox_lane_counter AS counter
      ON counter.user_id = item.user_id
     AND counter.lane = item.lane
    WHERE item.kind = 'conversation.message'
      AND item.lane = 'conversation'
      AND item.consumed_at IS NULL
      AND item.accepted_allowance_period_start IS NULL
      AND COALESCE(counter.consumed_seq, 0::bigint) < item.lane_seq
      ${input.afterId === null ? Prisma.empty : Prisma.sql`AND item.id > ${input.afterId}`}
    ORDER BY item.id ASC
    LIMIT ${input.batchSize}
  `);
}

function normalizeHostedAcceptedConversationBackfillBatchSize(
  value: number | undefined,
): number {
  if (value === undefined) {
    return DEFAULT_HOSTED_ACCEPTED_CONVERSATION_BACKFILL_BATCH_SIZE;
  }
  if (!Number.isSafeInteger(value) || value <= 0 || value > 1_000) {
    throw new TypeError("Hosted accepted conversation backfill batch size is invalid.");
  }
  return value;
}
