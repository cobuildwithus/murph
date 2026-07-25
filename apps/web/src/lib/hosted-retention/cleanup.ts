import type { PrismaClient } from "@prisma/client";

import { getPrisma } from "../prisma";
import { ComputerUseService } from "../computer-use/service";
import { PrismaComputerUseStore } from "../computer-use/store";
import { HOSTED_MAILBOX_RETENTION_MS } from "../hosted-mailbox/store";
import {
  formatHostedExecutionSafeLogErrorDetails,
} from "../hosted-execution/logging";

const DAY_MS = 86_400_000;

export const HOSTED_RUN_LOG_RETENTION_MS = 14 * DAY_MS;
export const HOSTED_RUN_LOG_AUTOMATION_DETAIL_RETENTION_MS = 7 * DAY_MS;
// Re-exported for existing importers; the window itself is owned by the mailbox
// store so the retention DELETE and the live-item read filter cannot drift.
export { HOSTED_MAILBOX_RETENTION_MS };
export const HOSTED_MAILBOX_STRUCTURAL_RETENTION_MS = 30 * DAY_MS;
export const HOSTED_WEB_SESSION_RETENTION_MS = 30 * DAY_MS;
export const HOSTED_INBOX_MEDIA_RETENTION_SIGNAL_BATCH_SIZE = 25;
export const HOSTED_INBOX_MEDIA_RETENTION_SIGNAL_CONCURRENCY = 5;
export const HOSTED_INBOX_MEDIA_RETENTION_SIGNAL_TIMEOUT_MS = 10_000;

type HostedRuntimeRecheckSignal = (input: {
  userId: string;
}) => Promise<unknown>;

export interface HostedRetentionCleanupResult {
  expiredComputerRunsCleanedUp: number;
  expiredConversationPolicyNonRepliesRecorded: number;
  expiredMailboxContentRetired: number;
  expiredMailboxTombstonesDeleted: number;
  inboxMediaRetentionRuntimeSignalFailures: number;
  inboxMediaRetentionRuntimeSignalsSent: number;
  oldRuntimeLogsDeleted: number;
  staleWebSessionsDeleted: number;
}

export async function runHostedRetentionCleanup(input: {
  now?: Date | string;
  prisma?: PrismaClient;
  signalRuntimeRecheck?: HostedRuntimeRecheckSignal;
} = {}): Promise<HostedRetentionCleanupResult> {
  const prisma = input.prisma ?? getPrisma();
  const now = normalizeRetentionDate(input.now ?? new Date());
  const expiredMailboxItems = await retireExpiredMailboxContent({
    now,
    prisma,
  });
  const oldRuntimeLogsDeleted = await deleteOldHostedRuntimeLogs({
    now,
    prisma,
  });
  const staleWebSessionsDeleted = await deleteStaleHostedWebSessions({
    now,
    prisma,
  });
  const expiredComputerRunsCleanedUp = await new ComputerUseService({
    now: () => now,
    store: new PrismaComputerUseStore(prisma),
  }).cleanupExpiredRuns({ now }).then((result) => result.expiredRuns);
  const mediaRetentionSignals = await signalDueInboxMediaRetentionRuntimes({
    now,
    prisma,
    signalRuntimeRecheck: input.signalRuntimeRecheck,
  });

  return {
    expiredComputerRunsCleanedUp,
    expiredConversationPolicyNonRepliesRecorded:
      expiredMailboxItems.policyNonReplies,
    expiredMailboxContentRetired: expiredMailboxItems.retired,
    expiredMailboxTombstonesDeleted: expiredMailboxItems.tombstonesDeleted,
    inboxMediaRetentionRuntimeSignalFailures: mediaRetentionSignals.failures,
    inboxMediaRetentionRuntimeSignalsSent: mediaRetentionSignals.sent,
    oldRuntimeLogsDeleted,
    staleWebSessionsDeleted,
  };
}

async function signalDueInboxMediaRetentionRuntimes(input: {
  now: Date;
  prisma: PrismaClient;
  signalRuntimeRecheck?: HostedRuntimeRecheckSignal;
}): Promise<{ failures: number; sent: number }> {
  const workspaces = await claimDueInboxMediaRetentionSignalWorkspaces({
    now: input.now,
    prisma: input.prisma,
  });

  if (workspaces.length === 0) {
    return { failures: 0, sent: 0 };
  }

  let signalRuntimeRecheck: HostedRuntimeRecheckSignal;
  try {
    signalRuntimeRecheck =
      input.signalRuntimeRecheck ?? await readDefaultHostedRuntimeRecheckSignal();
  } catch (error) {
    console.error("Hosted inbox media retention signal module load failed.", {
      ...formatHostedExecutionSafeLogErrorDetails(error, {
        code: "inbox_media_retention_signal_module_load_failed",
      }),
      failureCount: workspaces.length,
    });
    return { failures: workspaces.length, sent: 0 };
  }

  let failures = 0;
  let sent = 0;
  let nextIndex = 0;
  const workerCount = Math.min(
    HOSTED_INBOX_MEDIA_RETENTION_SIGNAL_CONCURRENCY,
    workspaces.length,
  );
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (true) {
      const workspace = workspaces[nextIndex];
      nextIndex += 1;
      if (!workspace) {
        return;
      }
      const ok = await signalRuntimeRecheckWithDeadline({
        signalRuntimeRecheck,
        userId: workspace.userId,
      });
      if (ok) {
        sent += 1;
      } else {
        failures += 1;
      }
    }
  }));

  return { failures, sent };
}

async function claimDueInboxMediaRetentionSignalWorkspaces(input: {
  now: Date;
  prisma: PrismaClient;
}): Promise<Array<{ userId: string }>> {
  return await input.prisma.$queryRaw<Array<{ userId: string }>>`
    WITH due AS (
      SELECT "user_id"
      FROM "hosted_workspace"
      WHERE "inbox_media_retention_wake_at" <= ${input.now}
      ORDER BY
        "inbox_media_retention_signal_attempted_at" ASC NULLS FIRST,
        "inbox_media_retention_wake_at" ASC,
        "user_id" ASC
      LIMIT ${HOSTED_INBOX_MEDIA_RETENTION_SIGNAL_BATCH_SIZE}
    )
    UPDATE "hosted_workspace"
    SET "inbox_media_retention_signal_attempted_at" = ${input.now}
    FROM due
    WHERE "hosted_workspace"."user_id" = due."user_id"
    RETURNING "hosted_workspace"."user_id" AS "userId"
  `;
}

async function signalRuntimeRecheckWithDeadline(input: {
  signalRuntimeRecheck: HostedRuntimeRecheckSignal;
  userId: string;
}): Promise<boolean> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<"timeout">((resolve) => {
    timeout = setTimeout(
      () => resolve("timeout"),
      HOSTED_INBOX_MEDIA_RETENTION_SIGNAL_TIMEOUT_MS,
    );
  });
  const signalPromise = input.signalRuntimeRecheck({
    userId: input.userId,
  }).then(
    () => "sent" as const,
    (error: unknown) => {
      console.error("Hosted inbox media retention runtime signal failed.", {
        ...formatHostedExecutionSafeLogErrorDetails(error, {
          code: "inbox_media_retention_runtime_signal_failed",
        }),
      });
      return "failed" as const;
    },
  );
  const result = await Promise.race([signalPromise, timeoutPromise]);
  if (timeout) {
    clearTimeout(timeout);
  }
  return result === "sent";
}

async function readDefaultHostedRuntimeRecheckSignal(): Promise<HostedRuntimeRecheckSignal> {
  const runtimeSignalModule = await import("../hosted-orchestration/signal-runtime");
  return runtimeSignalModule.signalHostedRuntimeRecheckRuntime;
}

async function retireExpiredMailboxContent(input: {
  now: Date;
  prisma: PrismaClient;
}): Promise<{
  policyNonReplies: number;
  retired: number;
  tombstonesDeleted: number;
}> {
  const cutoff = new Date(input.now.getTime() - HOSTED_MAILBOX_RETENTION_MS);
  const structuralCutoff = new Date(
    input.now.getTime() - HOSTED_MAILBOX_STRUCTURAL_RETENTION_MS,
  );
  // Retire content in place before pruning ordinary structural tombstones.
  // An unhandled conversation row becomes an explicit policy non-reply in the
  // same owner row, and its lane watermark advances in the same transaction.
  // That keeps accepted-work terminality durable while both inline and sidecar
  // ciphertext disappear at the privacy deadline.
  const rows = await input.prisma.$queryRaw<
    Array<{
      policyNonReplies: bigint;
      retired: bigint;
      tombstonesDeleted: bigint;
    }>
  >`
    WITH eligible AS MATERIALIZED (
      SELECT
        "id",
        "user_id",
        "lane",
        "lane_seq",
        "kind",
        "consumed_at"
      FROM "hosted_mailbox_item"
      WHERE "content_retired_at" IS NULL
        AND (
          "expires_at" <= ${input.now}
          OR "created_at" <= ${cutoff}
        )
      FOR UPDATE
    ),
    removed_sidecars AS (
      DELETE FROM "hosted_mailbox_payload" AS payload
      USING eligible
      WHERE payload."mailbox_item_id" = eligible."id"
      RETURNING payload."mailbox_item_id"
    ),
    retired AS (
      UPDATE "hosted_mailbox_item" AS item
      SET
        "payload_inline_ciphertext" = NULL,
        "payload_ref" = NULL,
        "payload_bytes" = NULL,
        "payload_hash" = NULL,
        "content_retired_at" = ${input.now},
        "retention_disposition" = CASE
          WHEN eligible."kind" = 'conversation.message'
            AND eligible."consumed_at" IS NULL
            THEN 'policy_non_reply.content_expired'
          ELSE NULL
        END,
        "consumed_at" = CASE
          WHEN eligible."kind" = 'conversation.message'
            AND eligible."consumed_at" IS NULL
            THEN ${input.now}
          ELSE eligible."consumed_at"
        END,
        "updated_at" = ${input.now}
      FROM eligible
      WHERE item."id" = eligible."id"
      RETURNING
        item."id",
        item."user_id",
        item."lane",
        item."lane_seq",
        item."retention_disposition"
    ),
    conversation_users AS (
      SELECT DISTINCT "user_id"
      FROM retired
      WHERE "lane" = 'conversation'
        AND "retention_disposition" = 'policy_non_reply.content_expired'
    ),
    conversation_floor AS (
      SELECT
        conversation_users."user_id",
        COALESCE(
          MIN(blocker."lane_seq") - 1,
          counter."next_seq" - 1
        ) AS "lane_seq"
      FROM conversation_users
      JOIN "hosted_mailbox_lane_counter" AS counter
        ON counter."user_id" = conversation_users."user_id"
        AND counter."lane" = 'conversation'
      LEFT JOIN "hosted_mailbox_item" AS blocker
        ON blocker."user_id" = conversation_users."user_id"
        AND blocker."lane" = 'conversation'
        AND blocker."consumed_at" IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM retired AS policy_non_reply
          WHERE policy_non_reply."id" = blocker."id"
            AND policy_non_reply."retention_disposition"
              = 'policy_non_reply.content_expired'
        )
      GROUP BY
        conversation_users."user_id",
        counter."next_seq"
    ),
    advanced AS (
      UPDATE "hosted_mailbox_lane_counter" AS counter
      SET
        "consumed_seq" = GREATEST(
          counter."consumed_seq",
          LEAST(conversation_floor."lane_seq", counter."next_seq" - 1)
        ),
        "updated_at" = ${input.now}
      FROM conversation_floor
      WHERE counter."user_id" = conversation_floor."user_id"
        AND counter."lane" = 'conversation'
      RETURNING counter."user_id"
    ),
    pruned AS (
      DELETE FROM "hosted_mailbox_item"
      WHERE "content_retired_at" IS NOT NULL
        AND "retention_disposition" IS NULL
        AND "created_at" < ${structuralCutoff}
      RETURNING "id"
    )
    SELECT
      (SELECT COUNT(*) FROM retired)::bigint AS "retired",
      (
        SELECT COUNT(*)
        FROM retired
        WHERE "retention_disposition" = 'policy_non_reply.content_expired'
      )::bigint AS "policyNonReplies",
      (SELECT COUNT(*) FROM pruned)::bigint AS "tombstonesDeleted"
  `;
  const result = rows[0];
  return {
    policyNonReplies: Number(result?.policyNonReplies ?? 0n),
    retired: Number(result?.retired ?? 0n),
    tombstonesDeleted: Number(result?.tombstonesDeleted ?? 0n),
  };
}

async function deleteOldHostedRuntimeLogs(input: {
  now: Date;
  prisma: PrismaClient;
}): Promise<number> {
  const cutoff = new Date(input.now.getTime() - HOSTED_RUN_LOG_RETENTION_MS);
  const automationDetailCutoff = new Date(
    input.now.getTime() - HOSTED_RUN_LOG_AUTOMATION_DETAIL_RETENTION_MS,
  );
  const result = await input.prisma.hostedRuntimeLog.deleteMany({
    where: {
      OR: [
        { at: { lt: cutoff } },
        {
          eventCode: "assistant.automation_detail",
          at: { lt: automationDetailCutoff },
        },
      ],
    },
  });

  return result.count;
}

async function deleteStaleHostedWebSessions(input: {
  now: Date;
  prisma: PrismaClient;
}): Promise<number> {
  const cutoff = new Date(input.now.getTime() - HOSTED_WEB_SESSION_RETENTION_MS);
  const result = await input.prisma.hostedWebSession.deleteMany({
    where: {
      OR: [
        {
          expiresAt: {
            lt: cutoff,
          },
        },
        {
          revokedAt: {
            lt: cutoff,
          },
        },
      ],
    },
  });

  return result.count;
}

function normalizeRetentionDate(value: Date | string): Date {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new TypeError("Hosted retention cleanup date must be valid.");
  }

  return date;
}
