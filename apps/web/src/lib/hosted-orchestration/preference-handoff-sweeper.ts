import { Prisma, type PrismaClient } from "@prisma/client";

import { getPrisma } from "../prisma";
import { HOSTED_MAILBOX_RETENTION_MS } from "../hosted-retention/cleanup";
import {
  formatHostedExecutionSafeLogErrorDetails,
} from "../hosted-execution/logging";
import { hasHostedRuntimeActiveAccess } from "../hosted-mailbox/runtime-access";
import { signalHostedMailboxAppendRuntime } from "./signal-runtime";

const DEFAULT_HANDOFF_LIMIT = 25;
const MAX_HANDOFF_LIMIT = 250;
const HANDOFF_CONCURRENCY = 5;

export interface HostedPreferenceHandoffSweepResult {
  candidateUsers: number;
  handoffAccepted: number;
  handoffAttempted: number;
  handoffFailed: number;
  handoffLimit: number;
  handoffSkippedInactive: number;
  skippedCandidateUsers: number;
}

interface HostedPreferenceHandoffCandidate {
  mailboxItemId: string;
  userId: string;
}

interface HostedPreferenceHandoffCandidateStore {
  listCandidates(input: {
    limit: number;
    now: Date;
  }): Promise<readonly HostedPreferenceHandoffCandidate[]>;
}

type HostedPreferenceHandoffSweepLogger = Pick<Console, "info" | "warn">;

export async function runHostedPreferenceHandoffSweeper(input: {
  hasActiveAccess?: typeof hasHostedRuntimeActiveAccess;
  handoffLimit?: number;
  logger?: HostedPreferenceHandoffSweepLogger;
  now?: Date;
  requestHandoff?: typeof signalHostedMailboxAppendRuntime;
  store?: HostedPreferenceHandoffCandidateStore;
} = {}): Promise<HostedPreferenceHandoffSweepResult> {
  const handoffLimit = normalizeLimit(
    input.handoffLimit,
    DEFAULT_HANDOFF_LIMIT,
    MAX_HANDOFF_LIMIT,
  );
  const logger = input.logger ?? console;
  const now = input.now ?? new Date();
  const candidates = await (
    input.store ?? createHostedPreferenceHandoffCandidateStore(getPrisma())
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
  const activeUserIds = new Set<string>();

  // The production query selects active members before LIMIT. Recheck through
  // the canonical async gate to fail closed if access changes after selection;
  // those races do not consume the handoff-attempt budget.
  await runWithConcurrency(
    candidates,
    HANDOFF_CONCURRENCY,
    async (candidate) => {
      if (await hasActiveAccess(candidate.userId)) {
        activeUserIds.add(candidate.userId);
      } else {
        handoffSkippedInactive += 1;
      }
    },
  );
  const activeCandidates = candidates.filter((candidate) =>
    activeUserIds.has(candidate.userId)
  );
  const selectedCandidates = activeCandidates.slice(0, handoffLimit);

  await runWithConcurrency(
    selectedCandidates,
    HANDOFF_CONCURRENCY,
    async (candidate) => {
      handoffAttempted += 1;
      try {
        const handoff = await requestHandoff({
          expectedUserId: candidate.userId,
          mailboxItemId: candidate.mailboxItemId,
        });
        if (handoff.signalAccepted) {
          handoffAccepted += 1;
        }
      } catch (error) {
        handoffFailed += 1;
        logger.warn("Hosted preference mailbox handoff recovery failed.", {
          ...formatHostedExecutionSafeLogErrorDetails(error, {
            code: "HOSTED_PREFERENCE_HANDOFF_RECOVERY_FAILED",
          }),
        });
      }
    },
  );

  const skippedCandidateUsers = Math.max(
    0,
    activeCandidates.length - selectedCandidates.length,
  );
  logger.info("Hosted preference mailbox handoff recovery finished.", {
    candidateUsers: candidates.length,
    handoffAccepted,
    handoffAttempted,
    handoffFailed,
    handoffLimit,
    handoffSkippedInactive,
    skippedCandidateUsers,
  });

  return {
    candidateUsers: candidates.length,
    handoffAccepted,
    handoffAttempted,
    handoffFailed,
    handoffLimit,
    handoffSkippedInactive,
    skippedCandidateUsers,
  };
}

function createHostedPreferenceHandoffCandidateStore(
  prisma: PrismaClient,
): HostedPreferenceHandoffCandidateStore {
  return {
    async listCandidates(input) {
      const retainedAt = new Date(input.now.getTime() - HOSTED_MAILBOX_RETENTION_MS);
      // Style writes target either a person member or a synthetic thread
      // container. Mirror the person branch of member-access.ts once, then let
      // containers inherit active owner or current-participant access before
      // LIMIT; the async access gate above remains the canonical race check.
      return await prisma.$queryRaw<Array<HostedPreferenceHandoffCandidate>>(Prisma.sql`
        WITH "pending_preference_users" AS (
          SELECT DISTINCT ON ("item"."user_id")
            "item"."id" AS "mailboxItemId",
            "item"."user_id" AS "userId",
            "item"."created_at" AS "createdAt"
          FROM "hosted_mailbox_item" AS "item"
          LEFT JOIN "hosted_mailbox_lane_counter" AS "lane_counter"
            ON "lane_counter"."user_id" = "item"."user_id"
            AND "lane_counter"."lane" = "item"."lane"
          WHERE "item"."kind" = 'member.preferences.updated'
            AND "item"."lane_seq" > COALESCE("lane_counter"."consumed_seq", 0)
            AND ("item"."expires_at" IS NULL OR "item"."expires_at" > ${input.now})
            AND "item"."created_at" >= ${retainedAt}
          ORDER BY "item"."user_id", "item"."lane_seq" ASC
        ),
        "active_person_members" AS (
          SELECT "person"."id"
          FROM "hosted_member" AS "person"
          LEFT JOIN "hosted_thread_container" AS "person_container"
            ON "person_container"."member_id" = "person"."id"
          WHERE "person_container"."member_id" IS NULL
            AND "person"."suspended_at" IS NULL
            AND (
              "person"."billing_status" = 'active'
              OR EXISTS (
                SELECT 1
                FROM "hosted_account_group_membership" AS "membership"
                JOIN "hosted_account_group" AS "account_group"
                  ON "account_group"."id" = "membership"."group_id"
                WHERE "membership"."member_id" = "person"."id"
                  AND "membership"."status" = 'active'
                  AND "account_group"."billing_status" = 'active'
                  AND "account_group"."suspended_at" IS NULL
              )
            )
        )
        SELECT "mailboxItemId", "userId"
        FROM "pending_preference_users" AS "pending"
        JOIN "hosted_member" AS "member"
          ON "member"."id" = "pending"."userId"
        LEFT JOIN "hosted_thread_container" AS "thread_container"
          ON "thread_container"."member_id" = "member"."id"
        LEFT JOIN "active_person_members" AS "active_member"
          ON "active_member"."id" = "member"."id"
        LEFT JOIN "active_person_members" AS "active_owner"
          ON "active_owner"."id" = "thread_container"."owner_member_id"
        WHERE "member"."suspended_at" IS NULL
          AND (
            (
              "thread_container"."member_id" IS NULL
              AND "active_member"."id" IS NOT NULL
            )
            OR (
              "thread_container"."member_id" IS NOT NULL
              AND (
                "active_owner"."id" IS NOT NULL
                OR EXISTS (
                  SELECT 1
                  FROM "hosted_thread_container_participant" AS "participant"
                  JOIN "active_person_members" AS "active_participant"
                    ON "active_participant"."id" = "participant"."participant_member_id"
                  WHERE "participant"."container_member_id" = "member"."id"
                    AND "participant"."removed_at" IS NULL
                )
              )
            )
          )
        ORDER BY "createdAt" ASC, "mailboxItemId" ASC
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
      const item = items[nextIndex];
      nextIndex += 1;
      await worker(item);
    }
  }));
}
