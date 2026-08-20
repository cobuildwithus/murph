import { Prisma, type PrismaClient } from "@prisma/client";

import { getPrisma } from "../prisma";
import { HOSTED_MAILBOX_RETENTION_MS } from "../hosted-retention/cleanup";
import {
  formatHostedExecutionSafeLogErrorDetails,
} from "../hosted-execution/logging";
import {
  hostedThreadContainerParticipantAccessCutoff,
} from "../hosted-groups/thread-container-participant-access";
import { hasHostedRuntimeActiveAccess } from "../hosted-mailbox/runtime-access";
import {
  createHostedPostCommitDeadline,
  waitForHostedPostCommitOperation,
} from "../hosted-onboarding/bounded-post-commit";
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
  handoffTimeoutMs?: number;
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
  const uniqueCandidates = selectFirstCandidatePerUser(candidates);
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
    uniqueCandidates,
    HANDOFF_CONCURRENCY,
    async (candidate) => {
      if (await hasActiveAccess(candidate.userId)) {
        activeUserIds.add(candidate.userId);
      } else {
        handoffSkippedInactive += 1;
      }
    },
  );
  const activeCandidates = uniqueCandidates.filter((candidate) =>
    activeUserIds.has(candidate.userId)
  );
  const selectedCandidates = activeCandidates.slice(0, handoffLimit);
  const handoffDeadlineMs = createHostedPostCommitDeadline(input.handoffTimeoutMs);

  await runWithConcurrency(
    selectedCandidates,
    HANDOFF_CONCURRENCY,
    async (candidate) => {
      handoffAttempted += 1;
      try {
        const handoff = await waitForHostedPostCommitOperation({
          deadlineMs: handoffDeadlineMs,
          operation: (abortSignal) => requestHandoff({
            abortSignal,
            expectedUserId: candidate.userId,
            mailboxItemId: candidate.mailboxItemId,
          }),
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
    candidateUsers: uniqueCandidates.length,
    handoffAccepted,
    handoffAttempted,
    handoffFailed,
    handoffLimit,
    handoffSkippedInactive,
    skippedCandidateUsers,
  });

  return {
    candidateUsers: uniqueCandidates.length,
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
      const participantAccessCutoff =
        hostedThreadContainerParticipantAccessCutoff(input.now);
      // Preference writes can target a person member or a synthetic thread
      // container, while Clinical Records wakes only target person members.
      // One exact mailbox signal wakes the runtime to reconcile all durable
      // mailbox lag, so choose at most one pending item per user before LIMIT.
      // Mirror the person branch of member-access.ts once, then let containers
      // inherit active owner or current-participant access. The async access
      // gate above remains the canonical race check.
      return await prisma.$queryRaw<Array<HostedPreferenceHandoffCandidate>>(Prisma.sql`
        WITH "pending_preference_users" AS (
          SELECT DISTINCT ON ("item"."user_id")
            "item"."id" AS "mailboxItemId",
            "item"."user_id" AS "userId",
            "item"."created_at" AS "createdAt",
            "item"."lane_seq" AS "laneSeq"
          FROM "hosted_mailbox_item" AS "item"
          LEFT JOIN "hosted_workspace" AS "workspace"
            ON "workspace"."user_id" = "item"."user_id"
          WHERE "item"."kind" = 'member.preferences.updated'
            -- Import transfers retry ownership from this handoff sweep to the
            -- runtime. Handled-through can remain behind while runtime-owned
            -- work waits for its persisted retry timestamp.
            AND "item"."lane_seq" > CASE
              WHEN (
                "workspace"."redacted_status_json"
                  ->> 'hostedMailboxSystemImportedSeq'
              ) ~ '^(0|[1-9][0-9]*)$'
                THEN (
                  "workspace"."redacted_status_json"
                    ->> 'hostedMailboxSystemImportedSeq'
                )::bigint
              ELSE 0
            END
            AND ("item"."expires_at" IS NULL OR "item"."expires_at" > ${input.now})
            AND "item"."created_at" >= ${retainedAt}
          ORDER BY "item"."user_id", "item"."lane_seq" ASC
        ),
        "pending_runtime_control_users" AS (
          SELECT DISTINCT ON ("item"."user_id")
            "item"."id" AS "mailboxItemId",
            "item"."user_id" AS "userId",
            "item"."created_at" AS "createdAt",
            "item"."lane_seq" AS "laneSeq"
          FROM "hosted_mailbox_item" AS "item"
          LEFT JOIN "hosted_workspace" AS "workspace"
            ON "workspace"."user_id" = "item"."user_id"
          WHERE "item"."kind" IN (
              'device-sync.wake',
              'health.daily-metric.reported',
              'runtime.browser-vault-refresh-requested',
              'runtime.maintenance-requested'
            )
            AND "item"."lane_seq" > CASE
              WHEN (
                "workspace"."redacted_status_json"
                  ->> 'hostedMailboxSystemImportedSeq'
              ) ~ '^(0|[1-9][0-9]*)$'
                THEN (
                  "workspace"."redacted_status_json"
                    ->> 'hostedMailboxSystemImportedSeq'
                )::bigint
              ELSE 0
            END
            AND ("item"."expires_at" IS NULL OR "item"."expires_at" > ${input.now})
            AND "item"."created_at" >= ${retainedAt}
          ORDER BY "item"."user_id", "item"."lane_seq" ASC
        ),
        "pending_clinical_record_users" AS (
          SELECT
            "item"."id" AS "mailboxItemId",
            "item"."user_id" AS "userId",
            "item"."created_at" AS "createdAt",
            "item"."lane_seq" AS "laneSeq"
          FROM "clinical_record_retrieval_run" AS "run"
          JOIN "clinical_record_connection" AS "connection"
            ON "connection"."id" = "run"."connection_id"
            AND "connection"."status" = 'active'
            AND "connection"."retrieval_generation" = "run"."generation"
          JOIN "hosted_mailbox_item" AS "item"
            ON "item"."user_id" = "run"."member_id"
            AND "item"."kind" = 'clinical-records.sync-requested'
            AND "item"."lane" = 'system'
            AND "item"."dedupe_key" = (
              'clinical-records:sync:v1:' || "run"."id" || ':' || "run"."generation"::text
            )
          LEFT JOIN "hosted_workspace" AS "workspace"
            ON "workspace"."user_id" = "item"."user_id"
          WHERE "run"."status" = 'queued'
            AND "run"."completed_at" IS NULL
            AND "item"."lane_seq" > CASE
              WHEN (
                "workspace"."redacted_status_json"
                  ->> 'hostedMailboxSystemImportedSeq'
              ) ~ '^(0|[1-9][0-9]*)$'
                THEN (
                  "workspace"."redacted_status_json"
                    ->> 'hostedMailboxSystemImportedSeq'
                )::bigint
              ELSE 0
            END
            AND ("item"."expires_at" IS NULL OR "item"."expires_at" > ${input.now})
            AND "item"."created_at" > ${retainedAt}
        ),
        "pending_handoff_candidates" AS (
          SELECT "mailboxItemId", "userId", "createdAt", "laneSeq"
          FROM "pending_preference_users"
          UNION ALL
          SELECT "mailboxItemId", "userId", "createdAt", "laneSeq"
          FROM "pending_runtime_control_users"
          UNION ALL
          SELECT "mailboxItemId", "userId", "createdAt", "laneSeq"
          FROM "pending_clinical_record_users"
        ),
        "pending_handoff_users" AS (
          SELECT DISTINCT ON ("userId")
            "mailboxItemId",
            "userId",
            "createdAt"
          FROM "pending_handoff_candidates"
          ORDER BY "userId", "createdAt" ASC, "laneSeq" ASC, "mailboxItemId" ASC
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
        FROM "pending_handoff_users" AS "pending"
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
                    AND "participant"."last_seen_at" >= ${participantAccessCutoff}
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

function selectFirstCandidatePerUser(
  candidates: readonly HostedPreferenceHandoffCandidate[],
): HostedPreferenceHandoffCandidate[] {
  const selected: HostedPreferenceHandoffCandidate[] = [];
  const selectedUserIds = new Set<string>();
  for (const candidate of candidates) {
    if (!selectedUserIds.has(candidate.userId)) {
      selectedUserIds.add(candidate.userId);
      selected.push(candidate);
    }
  }
  return selected;
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
