import type { Prisma, PrismaClient } from "@prisma/client";

import { getPrisma } from "../prisma";
import { ComputerUseService } from "../computer-use/service";
import { PrismaComputerUseStore } from "../computer-use/store";
import { HOSTED_MAILBOX_RETENTION_MS } from "../hosted-mailbox/store";
import {
  formatHostedExecutionSafeLogErrorDetails,
} from "../hosted-execution/logging";
import {
  drainHostedAccountDeletionCleanupBatch,
  type HostedAccountDeletionCleanupBatchResult,
} from "../hosted-privacy/account-deletion-cleanup";

const DAY_MS = 86_400_000;

export const HOSTED_RUN_LOG_RETENTION_MS = 14 * DAY_MS;
export const HOSTED_RUN_LOG_VERBOSE_RETENTION_MS = 7 * DAY_MS;
// Re-exported for existing importers; the window itself is owned by the mailbox
// store so content retirement and the live-item read filter cannot drift.
export { HOSTED_MAILBOX_RETENTION_MS };
export const HOSTED_MAILBOX_STRUCTURAL_RETENTION_MS = 30 * DAY_MS;
export const HOSTED_WEB_SESSION_RETENTION_MS = 30 * DAY_MS;
export const HOSTED_INGRESS_LATENCY_TRACE_RETENTION_MS = 7 * DAY_MS;
export const HOSTED_DEVICE_WEBHOOK_TRACE_RETENTION_MS = 30 * DAY_MS;
export const HOSTED_LINQ_PROVIDER_EVENT_DIAGNOSTIC_RETENTION_MS = 7 * DAY_MS;
// Every diagnostic category is deleted in ordered batches with an explicit
// per-run ceiling, so one hourly invocation can never open a long delete
// transaction against the production pool.
export const HOSTED_RETENTION_BATCH_SIZE = 5_000;
export const HOSTED_RETENTION_MAX_BATCHES = 4;
export const HOSTED_INBOX_MEDIA_RETENTION_SIGNAL_BATCH_SIZE = 5;
export const HOSTED_INBOX_MEDIA_RETENTION_SIGNAL_TIMEOUT_MS = 10_000;

type HostedRuntimeRecheckSignal = (input: {
  abortSignal?: AbortSignal;
  userId: string;
}) => Promise<unknown>;

export interface HostedRetentionCleanupResult {
  accountDeletionCleanup: HostedAccountDeletionCleanupBatchResult;
  compactedLinqProviderEventDiagnostics: number;
  expiredAssistantRuntimeIssuesDeleted: number;
  expiredComputerRunsCleanedUp: number;
  expiredConversationPolicyNonRepliesRecorded: number;
  expiredDeviceWebhookTracesDeleted: number;
  expiredIngressLatencyTracesDeleted: number;
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
  const accountDeletionCleanup = await drainHostedAccountDeletionCleanupBatch({
    now,
    prisma,
  });
  const expiredMailboxItems = await retireExpiredMailboxContent({
    now,
    prisma,
  });
  // Serial by design: these are background deletes and must never fan out
  // across the same pool that serves user-facing control-plane work.
  const expiredIngressLatencyTracesDeleted = await deleteExpiredIngressLatencyTraces({
    now,
    prisma,
  });
  const expiredAssistantRuntimeIssuesDeleted = await deleteExpiredAssistantRuntimeIssues({
    now,
    prisma,
  });
  const expiredDeviceWebhookTracesDeleted = await deleteExpiredDeviceWebhookTraces({
    now,
    prisma,
  });
  const compactedLinqProviderEventDiagnostics = await compactOldLinqProviderEventDiagnostics({
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
    accountDeletionCleanup,
    compactedLinqProviderEventDiagnostics,
    expiredAssistantRuntimeIssuesDeleted,
    expiredComputerRunsCleanedUp,
    expiredConversationPolicyNonRepliesRecorded:
      expiredMailboxItems.policyNonReplies,
    expiredDeviceWebhookTracesDeleted,
    expiredIngressLatencyTracesDeleted,
    expiredMailboxContentRetired: expiredMailboxItems.retired,
    expiredMailboxTombstonesDeleted: expiredMailboxItems.tombstonesDeleted,
    inboxMediaRetentionRuntimeSignalFailures: mediaRetentionSignals.failures,
    inboxMediaRetentionRuntimeSignalsSent: mediaRetentionSignals.sent,
    oldRuntimeLogsDeleted: 0,
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
  const results = await Promise.all(workspaces.map(
    (workspace) => signalRuntimeRecheckWithDeadline({
      signalRuntimeRecheck,
      userId: workspace.userId,
    }),
  ));
  for (const ok of results) {
    if (ok) {
      sent += 1;
    } else {
      failures += 1;
    }
  }

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
  const abortController = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<"timeout">((resolve) => {
    timeout = setTimeout(
      () => {
        abortController.abort(
          new Error("Hosted inbox media retention runtime signal timed out."),
        );
        resolve("timeout");
      },
      HOSTED_INBOX_MEDIA_RETENTION_SIGNAL_TIMEOUT_MS,
    );
  });
  const signalPromise = Promise.resolve().then(() =>
    input.signalRuntimeRecheck({
      abortSignal: abortController.signal,
      userId: input.userId,
    })
  ).then(
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
  return runtimeSignalModule.signalHostedRetentionRuntimeRecheck;
}

export async function retireExpiredMailboxContent(input: {
  now: Date;
  prisma: PrismaClient | Prisma.TransactionClient;
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
  // ciphertext disappear at the privacy deadline. Current preference causal
  // rows retain only their retired structural metadata until a newer field
  // watermark supersedes them, preserving logical ordering without payload.
  // A consumed preference row
  // from before causal sequencing cannot be updated after the current check
  // constraint was installed, so retention deletes that already-handled legacy
  // tombstone directly instead of inventing a causal sequence. Both content
  // retirement and later structural pruning are bounded so an hourly cleanup
  // cannot monopolize the production pool while a backlog drains.
  return await runMailboxRetentionBatches(async () => {
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
          "causal_seq",
          "consumed_at"
        FROM "hosted_mailbox_item"
        WHERE "content_retired_at" IS NULL
          AND (
            "expires_at" <= ${input.now}
            OR "created_at" <= ${cutoff}
          )
        ORDER BY "created_at" ASC, "id" ASC
        LIMIT ${HOSTED_RETENTION_BATCH_SIZE}
        FOR UPDATE
      ),
      legacy_consumed_preferences AS MATERIALIZED (
        SELECT eligible."id"
        FROM eligible
        LEFT JOIN "hosted_mailbox_lane_counter" AS counter
          ON counter."user_id" = eligible."user_id"
          AND counter."lane" = eligible."lane"
        WHERE eligible."kind" = 'member.preferences.updated'
          AND eligible."causal_seq" IS NULL
          AND eligible."lane_seq" <= COALESCE(counter."consumed_seq", 0)
      ),
      removed_sidecars AS (
        DELETE FROM "hosted_mailbox_payload" AS payload
        USING eligible
        WHERE payload."mailbox_item_id" = eligible."id"
          AND NOT EXISTS (
            SELECT 1
            FROM legacy_consumed_preferences AS legacy
            WHERE legacy."id" = eligible."id"
          )
        RETURNING payload."mailbox_item_id"
      ),
      retired_legacy_preferences AS (
        DELETE FROM "hosted_mailbox_item" AS item
        USING legacy_consumed_preferences AS legacy
        WHERE item."id" = legacy."id"
        RETURNING item."id"
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
          AND NOT EXISTS (
            SELECT 1
            FROM legacy_consumed_preferences AS legacy
            WHERE legacy."id" = eligible."id"
          )
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
      prunable AS MATERIALIZED (
        SELECT item."id"
        FROM "hosted_mailbox_item" AS item
        WHERE item."content_retired_at" IS NOT NULL
          AND item."retention_disposition" IS NULL
          AND item."created_at" < ${structuralCutoff}
          AND NOT EXISTS (
            SELECT 1
            FROM "hosted_member" AS member
            WHERE member."id" = item."user_id"
              AND item."causal_seq" IN (
                member."assistant_persona_causal_seq",
                member."assistant_tone_causal_seq",
                member."assistant_voice_causal_seq",
                member."assistant_humor_causal_seq",
                member."assistant_push_causal_seq",
                member."assistant_detail_causal_seq",
                member."assistant_unhinged_causal_seq"
              )
          )
        ORDER BY item."created_at" ASC, item."id" ASC
        LIMIT ${HOSTED_RETENTION_BATCH_SIZE}
        FOR UPDATE
      ),
      pruned AS (
        DELETE FROM "hosted_mailbox_item" AS item
        USING prunable
        WHERE item."id" = prunable."id"
        RETURNING item."id"
      )
      SELECT
        (
          (SELECT COUNT(*) FROM retired)
          + (SELECT COUNT(*) FROM retired_legacy_preferences)
        )::bigint AS "retired",
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
  });
}

export async function deleteExpiredIngressLatencyTraces(input: {
  now: Date;
  prisma: Pick<PrismaClient, "$executeRaw">;
}): Promise<number> {
  const cutoff = new Date(
    input.now.getTime() - HOSTED_INGRESS_LATENCY_TRACE_RETENTION_MS,
  );
  return await runRetentionBatches(() => input.prisma.$executeRaw`
    WITH doomed AS (
      SELECT "id"
      FROM "hosted_ingress_latency_trace"
      WHERE "accepted_at" < ${cutoff}
        AND "updated_at" < ${cutoff}
      ORDER BY "accepted_at" ASC, "id" ASC
      LIMIT ${HOSTED_RETENTION_BATCH_SIZE}
    )
    DELETE FROM "hosted_ingress_latency_trace" AS trace
    USING doomed
    WHERE trace."id" = doomed."id"
  `);
}

// The rows already carry their own expiry; nothing was enforcing it.
async function deleteExpiredAssistantRuntimeIssues(input: {
  now: Date;
  prisma: PrismaClient;
}): Promise<number> {
  return await runRetentionBatches(() => input.prisma.$executeRaw`
    WITH doomed AS (
      SELECT "id"
      FROM "hosted_assistant_runtime_issue"
      WHERE "expires_at" <= ${input.now}
      ORDER BY "expires_at" ASC, "id" ASC
      LIMIT ${HOSTED_RETENTION_BATCH_SIZE}
    )
    DELETE FROM "hosted_assistant_runtime_issue" AS issue
    USING doomed
    WHERE issue."id" = doomed."id"
  `);
}

// `device_sync_signal` is deliberately absent: its `webhook_hint` rows are the
// companion status read model for per-resource `lastReceivedAt`, so deleting
// old rows would report an established device as "waiting for first data".
//
// Only processed traces expire; an in-flight claim is still the duplicate gate.
async function deleteExpiredDeviceWebhookTraces(input: {
  now: Date;
  prisma: PrismaClient;
}): Promise<number> {
  const cutoff = new Date(
    input.now.getTime() - HOSTED_DEVICE_WEBHOOK_TRACE_RETENTION_MS,
  );
  return await runRetentionBatches(() => input.prisma.$executeRaw`
    WITH doomed AS (
      SELECT "provider", "trace_id"
      FROM "device_webhook_trace"
      WHERE "status" = 'processed'
        AND "received_at" < ${cutoff}
      ORDER BY "received_at" ASC, "provider" ASC, "trace_id" ASC
      LIMIT ${HOSTED_RETENTION_BATCH_SIZE}
    )
    DELETE FROM "device_webhook_trace" AS trace
    USING doomed
    WHERE trace."provider" = doomed."provider"
      AND trace."trace_id" = doomed."trace_id"
  `);
}

// The provider-event row is the durable webhook duplicate gate and must not be
// deleted. Only its optional diagnostic JSON expires.
async function compactOldLinqProviderEventDiagnostics(input: {
  now: Date;
  prisma: PrismaClient;
}): Promise<number> {
  const cutoff = new Date(
    input.now.getTime() - HOSTED_LINQ_PROVIDER_EVENT_DIAGNOSTIC_RETENTION_MS,
  );
  return await runRetentionBatches(() => input.prisma.$executeRaw`
    WITH compactable AS (
      SELECT "event_id"
      FROM "hosted_linq_provider_event"
      WHERE "received_at" < ${cutoff}
        AND (
          "extraction_json" IS NOT NULL
          OR "payload_sanitized_json" IS NOT NULL
          OR "payload_shape_json" IS NOT NULL
        )
      ORDER BY "received_at" ASC, "event_id" ASC
      LIMIT ${HOSTED_RETENTION_BATCH_SIZE}
    )
    UPDATE "hosted_linq_provider_event" AS provider_event
    SET
      "extraction_json" = NULL,
      "payload_sanitized_json" = NULL,
      "payload_shape_json" = NULL
    FROM compactable
    WHERE provider_event."event_id" = compactable."event_id"
  `);
}

type MailboxRetentionBatchResult = {
  policyNonReplies: number;
  retired: number;
  tombstonesDeleted: number;
};

async function runMailboxRetentionBatches(
  mutateBatch: () => Promise<MailboxRetentionBatchResult>,
): Promise<MailboxRetentionBatchResult> {
  const total: MailboxRetentionBatchResult = {
    policyNonReplies: 0,
    retired: 0,
    tombstonesDeleted: 0,
  };
  for (let batch = 0; batch < HOSTED_RETENTION_MAX_BATCHES; batch += 1) {
    const result = await mutateBatch();
    total.policyNonReplies += result.policyNonReplies;
    total.retired += result.retired;
    total.tombstonesDeleted += result.tombstonesDeleted;
    if (
      result.retired < HOSTED_RETENTION_BATCH_SIZE
      && result.tombstonesDeleted < HOSTED_RETENTION_BATCH_SIZE
    ) {
      break;
    }
  }

  return total;
}

// Runs one bounded batch at a time and stops as soon as a batch comes back
// short, so a normal hour does one statement and a backlog drains over hours.
async function runRetentionBatches(
  mutateBatch: () => Promise<number>,
): Promise<number> {
  let affected = 0;
  for (let batch = 0; batch < HOSTED_RETENTION_MAX_BATCHES; batch += 1) {
    const count = await mutateBatch();
    affected += count;
    if (count < HOSTED_RETENTION_BATCH_SIZE) {
      break;
    }
  }

  return affected;
}

async function deleteStaleHostedWebSessions(input: {
  now: Date;
  prisma: PrismaClient;
}): Promise<number> {
  const cutoff = new Date(input.now.getTime() - HOSTED_WEB_SESSION_RETENTION_MS);
  const expired = await runRetentionBatches(() => input.prisma.$executeRaw`
    WITH doomed AS (
      SELECT "id"
      FROM "hosted_web_session"
      WHERE "expires_at" < ${cutoff}
      ORDER BY "expires_at" ASC, "id" ASC
      LIMIT ${HOSTED_RETENTION_BATCH_SIZE}
    )
    DELETE FROM "hosted_web_session" AS web_session
    USING doomed
    WHERE web_session."id" = doomed."id"
  `);
  const revoked = await runRetentionBatches(() => input.prisma.$executeRaw`
    WITH doomed AS (
      SELECT "id"
      FROM "hosted_web_session"
      WHERE "revoked_at" < ${cutoff}
      ORDER BY "revoked_at" ASC, "id" ASC
      LIMIT ${HOSTED_RETENTION_BATCH_SIZE}
    )
    DELETE FROM "hosted_web_session" AS web_session
    USING doomed
    WHERE web_session."id" = doomed."id"
  `);
  return expired + revoked;
}

function normalizeRetentionDate(value: Date | string): Date {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new TypeError("Hosted retention cleanup date must be valid.");
  }

  return date;
}
