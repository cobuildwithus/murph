import type { PrismaClient } from "@prisma/client";

import { getPrisma } from "../prisma";
import { ComputerUseService } from "../computer-use/service";
import { PrismaComputerUseStore } from "../computer-use/store";
import {
  formatHostedExecutionSafeLogErrorDetails,
} from "../hosted-execution/logging";
import {
  signalHostedMailboxAppendRuntime,
} from "../hosted-orchestration/signal-runtime";
import {
  terminalizeStaleActiveHostedPhoneCalls,
  terminalizeStaleHostedPhoneCallAnalyses,
} from "../phone-calls/result";

const DAY_MS = 86_400_000;

export const HOSTED_RUN_LOG_RETENTION_MS = 14 * DAY_MS;
export const HOSTED_RUN_LOG_AUTOMATION_DETAIL_RETENTION_MS = 7 * DAY_MS;
export const HOSTED_MAILBOX_RETENTION_MS = 30 * DAY_MS;
export const HOSTED_WEB_SESSION_RETENTION_MS = 30 * DAY_MS;
export const HOSTED_INBOX_MEDIA_RETENTION_SIGNAL_BATCH_SIZE = 25;
export const HOSTED_INBOX_MEDIA_RETENTION_SIGNAL_CONCURRENCY = 5;
export const HOSTED_INBOX_MEDIA_RETENTION_SIGNAL_TIMEOUT_MS = 10_000;
export const HOSTED_ASSISTANT_NOTIFICATION_RECOVERY_BATCH_SIZE = 100;
const HOSTED_ASSISTANT_NOTIFICATION_RECOVERY_CONCURRENCY = 10;

type HostedRuntimeRecheckSignal = (input: {
  userId: string;
}) => Promise<unknown>;

type HostedMailboxAppendSignal = (input: {
  expectedUserId: string;
  mailboxItemId: string;
}) => Promise<unknown>;

export interface HostedRetentionCleanupResult {
  assistantNotificationRecoverySignalFailures: number;
  assistantNotificationRecoverySignalsSent: number;
  expiredComputerRunsCleanedUp: number;
  expiredMailboxItemsDeleted: number;
  inboxMediaRetentionRuntimeSignalFailures: number;
  inboxMediaRetentionRuntimeSignalsSent: number;
  oldRuntimeLogsDeleted: number;
  stalePhoneCallAnalysesTerminalized: number;
  staleActivePhoneCallsFailed: number;
  staleWebSessionsDeleted: number;
}

export async function runHostedRetentionCleanup(input: {
  now?: Date | string;
  prisma?: PrismaClient;
  signalMailboxAppend?: HostedMailboxAppendSignal;
  signalRuntimeRecheck?: HostedRuntimeRecheckSignal;
} = {}): Promise<HostedRetentionCleanupResult> {
  const prisma = input.prisma ?? getPrisma();
  const now = normalizeRetentionDate(input.now ?? new Date());
  const expiredMailboxItemsDeleted = await deleteExpiredMailboxItems({
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
  const staleActivePhoneCalls = await terminalizeStaleActiveHostedPhoneCalls({
    now,
    prisma,
  });
  const stalePhoneCallAnalyses = await terminalizeStaleHostedPhoneCallAnalyses({
    now,
    prisma,
  });
  const assistantNotificationSignals = await signalPendingAssistantNotifications({
    now,
    prisma,
    signalMailboxAppend: input.signalMailboxAppend,
  });
  const mediaRetentionSignals = await signalDueInboxMediaRetentionRuntimes({
    now,
    prisma,
    signalRuntimeRecheck: input.signalRuntimeRecheck,
  });

  return {
    assistantNotificationRecoverySignalFailures:
      assistantNotificationSignals.failures,
    assistantNotificationRecoverySignalsSent: assistantNotificationSignals.sent,
    expiredComputerRunsCleanedUp,
    expiredMailboxItemsDeleted,
    inboxMediaRetentionRuntimeSignalFailures: mediaRetentionSignals.failures,
    inboxMediaRetentionRuntimeSignalsSent: mediaRetentionSignals.sent,
    oldRuntimeLogsDeleted,
    stalePhoneCallAnalysesTerminalized:
      stalePhoneCallAnalyses.terminalizedPhoneCalls,
    staleActivePhoneCallsFailed: staleActivePhoneCalls.failedPhoneCalls,
    staleWebSessionsDeleted,
  };
}

interface PendingAssistantNotificationSignal {
  mailboxItemId: string;
  memberId: string;
}

async function signalPendingAssistantNotifications(input: {
  now: Date;
  prisma: PrismaClient;
  signalMailboxAppend?: HostedMailboxAppendSignal;
}): Promise<{ failures: number; sent: number }> {
  const signals = await listPendingAssistantNotificationSignals(input);
  const signalMailboxAppend =
    input.signalMailboxAppend ?? signalHostedMailboxAppendRuntime;
  let failures = 0;
  let sent = 0;
  let nextIndex = 0;
  const workerCount = Math.min(
    HOSTED_ASSISTANT_NOTIFICATION_RECOVERY_CONCURRENCY,
    signals.length,
  );
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (true) {
      const signal = signals[nextIndex];
      nextIndex += 1;
      if (!signal) return;
      try {
        await signalMailboxAppend({
          expectedUserId: signal.memberId,
          mailboxItemId: signal.mailboxItemId,
        });
        sent += 1;
      } catch (error) {
        failures += 1;
        console.error("Hosted assistant-notification recovery signal failed.", {
          ...formatHostedExecutionSafeLogErrorDetails(error, {
            code: "hosted_assistant_notification_recovery_signal_failed",
          }),
        });
      }
    }
  }));
  if (signals.length > 0) {
    await input.prisma.hostedMailboxItem.updateMany({
      data: { updatedAt: input.now },
      where: {
        consumedAt: null,
        id: { in: signals.map((signal) => signal.mailboxItemId) },
        kind: "assistant.notification.requested",
        lane: "system",
      },
    });
  }
  return { failures, sent };
}

async function listPendingAssistantNotificationSignals(input: {
  now: Date;
  prisma: PrismaClient;
}): Promise<PendingAssistantNotificationSignal[]> {
  return input.prisma.$queryRaw<PendingAssistantNotificationSignal[]>`
    SELECT
      pending."mailboxItemId",
      pending."memberId"
    FROM (
      SELECT DISTINCT ON (item."user_id")
        item."id" AS "mailboxItemId",
        item."user_id" AS "memberId",
        item."created_at" AS "createdAt",
        item."updated_at" AS "updatedAt"
      FROM "hosted_mailbox_item" AS item
      LEFT JOIN "hosted_mailbox_lane_counter" AS counter
        ON counter."user_id" = item."user_id"
        AND counter."lane" = item."lane"
      WHERE item."kind" = 'assistant.notification.requested'
        AND item."lane" = 'system'
        AND item."consumed_at" IS NULL
        AND item."lane_seq" > COALESCE(counter."consumed_seq", 0)
        AND item."created_at" <= ${input.now}
        AND (item."expires_at" IS NULL OR item."expires_at" > ${input.now})
      ORDER BY item."user_id" ASC, item."lane_seq" ASC
    ) AS pending
    ORDER BY
      pending."updatedAt" ASC,
      pending."createdAt" ASC,
      pending."memberId" ASC
    LIMIT ${HOSTED_ASSISTANT_NOTIFICATION_RECOVERY_BATCH_SIZE}
  `;
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

async function deleteExpiredMailboxItems(input: {
  now: Date;
  prisma: PrismaClient;
}): Promise<number> {
  const cutoff = new Date(input.now.getTime() - HOSTED_MAILBOX_RETENTION_MS);
  return await input.prisma.$executeRaw`
    DELETE FROM "hosted_mailbox_item"
    WHERE "expires_at" <= ${input.now}
       OR "created_at" < ${cutoff}
  `;
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
