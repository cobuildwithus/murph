import "server-only";

import {
  formatHostedExecutionSafeLogErrorDetails,
} from "../hosted-execution/logging";
import { isHostedRuntimeLogDatabaseConfigured } from "../hosted-runtime-log/database";
import {
  deleteExpiredHostedRuntimeLogs,
} from "../hosted-runtime-log/store";
import {
  deleteExpiredHostedBrowserAssertionNonces,
} from "./browser-assertion-nonces";
import {
  HOSTED_RETENTION_BATCH_SIZE,
  HOSTED_RETENTION_MAX_BATCHES,
  HOSTED_RUN_LOG_RETENTION_MS,
  HOSTED_RUN_LOG_VERBOSE_RETENTION_MS,
  runHostedRetentionCleanup,
} from "./cleanup";

type HostedRetentionCleanupInput = NonNullable<
  Parameters<typeof runHostedRetentionCleanup>[0]
>;

export async function runHostedRetentionCleanupWithRuntimeLogDatabase(
  input: HostedRetentionCleanupInput = {},
) {
  const now = normalizeCleanupDate(input.now ?? new Date());
  const cleanup = await runHostedRetentionCleanup({
    ...input,
    now,
  });
  const expiredBrowserAssertionNoncesDeleted =
    await deleteExpiredHostedBrowserAssertionNonces({
      now,
      prisma: input.prisma,
    });
  const primaryCleanup = {
    ...cleanup,
    expiredBrowserAssertionNoncesDeleted,
  };

  try {
    if (!isHostedRuntimeLogDatabaseConfigured()) {
      return primaryCleanup;
    }

    // Keep optional observability cleanup serial. It must not fan out across the
    // small diagnostic pool.
    const dedicatedRuntimeLogsDeleted = await deleteExpiredHostedRuntimeLogs({
      batchSize: HOSTED_RETENTION_BATCH_SIZE,
      maxBatches: HOSTED_RETENTION_MAX_BATCHES,
      retentionCutoff: new Date(now.getTime() - HOSTED_RUN_LOG_RETENTION_MS),
      verboseCutoff: new Date(
        now.getTime() - HOSTED_RUN_LOG_VERBOSE_RETENTION_MS,
      ),
    });
    return {
      ...primaryCleanup,
      oldRuntimeLogsDeleted: dedicatedRuntimeLogsDeleted,
    };
  } catch (error) {
    // Primary-database retention has already completed. Optional diagnostic
    // retention must not turn that work into a retrying cron failure. The next
    // hourly run retries the isolated bounded delete.
    console.warn("Hosted runtime log database retention failed.", {
      ...formatHostedExecutionSafeLogErrorDetails(error, {
        code: "HOSTED_RUNTIME_LOG_RETENTION_FAILED",
      }),
    });
    return primaryCleanup;
  }
}

function normalizeCleanupDate(value: Date | string): Date {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError("Hosted retention cleanup date must be valid.");
  }
  return parsed;
}
