import { Prisma, type PrismaClient } from "@prisma/client";

import {
  formatHostedExecutionSafeLogErrorDetails,
} from "../hosted-execution/logging";
import { hasHostedRuntimeActiveAccess } from "../hosted-mailbox/runtime-access";
import { signalHostedMailboxAppendRuntime } from "../hosted-orchestration/signal-runtime";
import { getPrisma } from "../prisma";

const DEFAULT_HANDOFF_LIMIT = 25;
const MAX_HANDOFF_LIMIT = 250;
const HANDOFF_CONCURRENCY = 5;

export interface HostedClinicalRetrievalHandoffSweepResult {
  candidateRuns: number;
  handoffAccepted: number;
  handoffAttempted: number;
  handoffFailed: number;
  handoffLimit: number;
  handoffSkippedInactive: number;
  skippedCandidateRuns: number;
}

interface HostedClinicalRetrievalHandoffCandidate {
  laneSeq: bigint;
  mailboxItemId: string;
  memberId: string;
}

interface HostedClinicalRetrievalHandoffCandidateStore {
  listCandidates(input: {
    limit: number;
    now: Date;
  }): Promise<readonly HostedClinicalRetrievalHandoffCandidate[]>;
}

type HostedClinicalRetrievalHandoffLogger = Pick<Console, "info" | "warn">;

export async function runHostedClinicalRetrievalHandoffSweeper(input: {
  handoffLimit?: number;
  hasActiveAccess?: typeof hasHostedRuntimeActiveAccess;
  logger?: HostedClinicalRetrievalHandoffLogger;
  now?: Date;
  requestHandoff?: typeof signalHostedMailboxAppendRuntime;
  store?: HostedClinicalRetrievalHandoffCandidateStore;
} = {}): Promise<HostedClinicalRetrievalHandoffSweepResult> {
  const handoffLimit = normalizeLimit(
    input.handoffLimit,
    DEFAULT_HANDOFF_LIMIT,
    MAX_HANDOFF_LIMIT,
  );
  const logger = input.logger ?? console;
  const now = input.now ?? new Date();
  const candidates = await (
    input.store ?? createHostedClinicalRetrievalHandoffCandidateStore(getPrisma())
  ).listCandidates({
    limit: handoffLimit + 1,
    now,
  });
  const hasActiveAccess = input.hasActiveAccess ?? hasHostedRuntimeActiveAccess;
  const requestHandoff = input.requestHandoff ?? signalHostedMailboxAppendRuntime;

  let handoffAccepted = 0;
  let handoffAttempted = 0;
  let handoffFailed = 0;
  let handoffSkippedInactive = 0;
  const activeMailboxItemIds = new Set<string>();

  await runWithConcurrency(candidates, HANDOFF_CONCURRENCY, async (candidate) => {
    if (await hasActiveAccess(candidate.memberId)) {
      activeMailboxItemIds.add(candidate.mailboxItemId);
    } else {
      handoffSkippedInactive += 1;
    }
  });
  const activeCandidates = candidates.filter((candidate) =>
    activeMailboxItemIds.has(candidate.mailboxItemId)
  );
  const selectedCandidates = activeCandidates.slice(0, handoffLimit);

  await runWithConcurrency(selectedCandidates, HANDOFF_CONCURRENCY, async (candidate) => {
    handoffAttempted += 1;
    try {
      await requestHandoff({
        expectedUserId: candidate.memberId,
        knownCheckpoint: {
          lane: "system",
          laneSeq: candidate.laneSeq.toString(),
          userId: candidate.memberId,
        },
        mailboxItemId: candidate.mailboxItemId,
      });
      handoffAccepted += 1;
    } catch (error) {
      handoffFailed += 1;
      logger.warn("Hosted Clinical Records mailbox handoff recovery failed.", {
        ...formatHostedExecutionSafeLogErrorDetails(error, {
          code: "HOSTED_CLINICAL_RECORDS_HANDOFF_RECOVERY_FAILED",
        }),
      });
    }
  });

  const skippedCandidateRuns = Math.max(
    0,
    activeCandidates.length - selectedCandidates.length,
  );
  logger.info("Hosted Clinical Records mailbox handoff recovery finished.", {
    candidateRuns: candidates.length,
    handoffAccepted,
    handoffAttempted,
    handoffFailed,
    handoffLimit,
    handoffSkippedInactive,
    skippedCandidateRuns,
  });

  return {
    candidateRuns: candidates.length,
    handoffAccepted,
    handoffAttempted,
    handoffFailed,
    handoffLimit,
    handoffSkippedInactive,
    skippedCandidateRuns,
  };
}

function createHostedClinicalRetrievalHandoffCandidateStore(
  prisma: PrismaClient,
): HostedClinicalRetrievalHandoffCandidateStore {
  return {
    async listCandidates(input) {
      return await prisma.$queryRaw<Array<HostedClinicalRetrievalHandoffCandidate>>(Prisma.sql`
        SELECT
          "item"."id" AS "mailboxItemId",
          "item"."lane_seq" AS "laneSeq",
          "run"."member_id" AS "memberId"
        FROM "clinical_record_retrieval_run" AS "run"
        JOIN "clinical_record_connection" AS "connection"
          ON "connection"."id" = "run"."connection_id"
          AND "connection"."status" = 'active'
          AND "connection"."retrieval_generation" = "run"."generation"
        JOIN "hosted_member" AS "member"
          ON "member"."id" = "run"."member_id"
        JOIN "hosted_mailbox_item" AS "item"
          ON "item"."user_id" = "run"."member_id"
          AND "item"."kind" = 'clinical-records.sync-requested'
          AND "item"."lane" = 'system'
          AND "item"."dedupe_key" = (
            'clinical-records:sync:v1:' || "run"."id" || ':' || "run"."generation"::text
          )
        LEFT JOIN "hosted_mailbox_lane_counter" AS "lane_counter"
          ON "lane_counter"."user_id" = "item"."user_id"
          AND "lane_counter"."lane" = "item"."lane"
        WHERE "run"."status" = 'queued'
          AND "run"."completed_at" IS NULL
          AND "item"."lane_seq" > COALESCE("lane_counter"."consumed_seq", 0)
          AND ("item"."expires_at" IS NULL OR "item"."expires_at" > ${input.now})
          AND "member"."suspended_at" IS NULL
          AND (
            "member"."billing_status" = 'active'
            OR EXISTS (
              SELECT 1
              FROM "hosted_account_group_membership" AS "membership"
              JOIN "hosted_account_group" AS "account_group"
                ON "account_group"."id" = "membership"."group_id"
              WHERE "membership"."member_id" = "member"."id"
                AND "membership"."status" = 'active'
                AND "account_group"."billing_status" = 'active'
                AND "account_group"."suspended_at" IS NULL
            )
          )
        ORDER BY "run"."created_at" ASC, "run"."id" ASC
        LIMIT ${input.limit}
      `);
    },
  };
}

function normalizeLimit(
  value: number | null | undefined,
  fallback: number,
  max: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(1, Math.min(Math.floor(value), max));
}

async function runWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      const item = items[index];
      if (item !== undefined) {
        await worker(item);
      }
    }
  }));
}
