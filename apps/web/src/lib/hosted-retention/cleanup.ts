import type { PrismaClient } from "@prisma/client";

import { getPrisma } from "../prisma";
import { ComputerUseService } from "../computer-use/service";
import { PrismaComputerUseStore } from "../computer-use/store";
import {
  formatHostedExecutionSafeLogErrorDetails,
} from "../hosted-execution/logging";

const DAY_MS = 86_400_000;

export const HOSTED_RUN_LOG_RETENTION_MS = 14 * DAY_MS;
export const HOSTED_MAILBOX_RETENTION_MS = 30 * DAY_MS;
export const HOSTED_WEB_SESSION_RETENTION_MS = 30 * DAY_MS;
export const HOSTED_INBOX_MEDIA_RETENTION_SIGNAL_BATCH_SIZE = 25;
export const HOSTED_INBOX_MEDIA_RETENTION_SIGNAL_CONCURRENCY = 5;
export const HOSTED_INBOX_MEDIA_RETENTION_SIGNAL_TIMEOUT_MS = 10_000;

type HostedRuntimeRecheckSignal = (input: {
  userId: string;
}) => Promise<unknown>;

export interface HostedRetentionCleanupResult {
  expiredComputerRunsCleanedUp: number;
  expiredMailboxItemsDeleted: number;
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
  const mediaRetentionSignals = await signalDueInboxMediaRetentionRuntimes({
    now,
    prisma,
    signalRuntimeRecheck: input.signalRuntimeRecheck,
  });

  return {
    expiredComputerRunsCleanedUp,
    expiredMailboxItemsDeleted,
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
  const result = await input.prisma.hostedRuntimeLog.deleteMany({
    where: {
      at: {
        lt: cutoff,
      },
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
