import "server-only";

import type { PrismaClient } from "@prisma/client";

import {
  formatHostedExecutionSafeLogErrorDetails,
} from "../hosted-execution/logging";
import { isHostedRuntimeLogDatabaseConfigured } from "../hosted-runtime-log/database";
import { deleteExpiredHostedRuntimeLogs } from "../hosted-runtime-log/store";
import {
  HOSTED_RETENTION_BATCH_SIZE,
  HOSTED_RETENTION_MAX_BATCHES,
  HOSTED_RUN_LOG_RETENTION_MS,
  HOSTED_RUN_LOG_VERBOSE_RETENTION_MS,
  normalizeHostedRetentionDate,
  runHostedRuntimeSignalRetentionCleanup,
} from "./cleanup";

type RuntimeRecheckSignal = NonNullable<
  Parameters<typeof runHostedRuntimeSignalRetentionCleanup>[0]
>["signalRuntimeRecheck"];

export interface HostedRuntimeMaintenanceCleanupResult {
  inboxMediaRetentionRuntimeSignalFailures: number;
  inboxMediaRetentionRuntimeSignalsSent: number;
  oldRuntimeLogsDeleted: number;
}

export async function runHostedRuntimeMaintenanceCleanup(input: {
  now?: Date | string;
  prisma?: PrismaClient;
  signalRuntimeRecheck?: RuntimeRecheckSignal;
} = {}): Promise<HostedRuntimeMaintenanceCleanupResult> {
  const now = normalizeHostedRetentionDate(input.now ?? new Date());
  const oldRuntimeLogsDeleted = await deleteRuntimeLogsBestEffort(now);
  const signalCleanup = await runHostedRuntimeSignalRetentionCleanup({
    ...input,
    now,
  });

  return {
    ...signalCleanup,
    oldRuntimeLogsDeleted,
  };
}

async function deleteRuntimeLogsBestEffort(now: Date): Promise<number> {
  try {
    if (!isHostedRuntimeLogDatabaseConfigured()) {
      return 0;
    }

    // Optional observability cleanup stays serial on the small diagnostic pool.
    return await deleteExpiredHostedRuntimeLogs({
      batchSize: HOSTED_RETENTION_BATCH_SIZE,
      maxBatches: HOSTED_RETENTION_MAX_BATCHES,
      retentionCutoff: new Date(now.getTime() - HOSTED_RUN_LOG_RETENTION_MS),
      verboseCutoff: new Date(
        now.getTime() - HOSTED_RUN_LOG_VERBOSE_RETENTION_MS,
      ),
    });
  } catch (error) {
    console.warn("Hosted runtime log database retention failed.", {
      ...formatHostedExecutionSafeLogErrorDetails(error, {
        code: "HOSTED_RUNTIME_LOG_RETENTION_FAILED",
      }),
    });
    return 0;
  }
}
