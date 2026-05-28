import { getPrisma } from "../prisma";
import { PrismaDeviceSyncControlPlaneStore } from "./prisma-store";
import { requestHostedDeviceSyncScheduledReconcileRecovery } from "./wake-service";

const DEFAULT_RECOVERY_LIMIT = 25;
const DUE_RECONCILE_RECOVERY_BUCKET_MS = 5 * 60_000;
const MAX_RECOVERY_LIMIT = 250;
const RECOVERY_CONCURRENCY = 5;

export interface HostedDeviceSyncDueReconcileSweeperResult {
  dueConnections: number;
  recoveryAttempted: number;
  recoveryFailed: number;
  recoveryLimit: number;
  recoveryNotRequested: number;
  recoveryRequested: number;
  skippedDueConnections: number;
}

type HostedDeviceSyncDueReconcileSweeperLogger = Pick<Console, "info" | "warn">;
type HostedDeviceSyncScheduledReconcileRecoveryRequest =
  typeof requestHostedDeviceSyncScheduledReconcileRecovery;

export async function runHostedDeviceSyncDueReconcileSweeper(input: {
  logger?: HostedDeviceSyncDueReconcileSweeperLogger;
  now?: Date;
  nudgeLimit?: number;
  requestRecovery?: HostedDeviceSyncScheduledReconcileRecoveryRequest;
  store?: Pick<PrismaDeviceSyncControlPlaneStore, "listDueReconcileConnectionsForSweep">;
} = {}): Promise<HostedDeviceSyncDueReconcileSweeperResult> {
  const logger = input.logger ?? console;
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const recoveryBucketStartedAt = new Date(
    Math.floor(now.getTime() / DUE_RECONCILE_RECOVERY_BUCKET_MS) * DUE_RECONCILE_RECOVERY_BUCKET_MS,
  );
  const recoveryBucketStartedAtIso = recoveryBucketStartedAt.toISOString();
  const recoveryLimit = normalizeLimit(input.nudgeLimit, DEFAULT_RECOVERY_LIMIT, MAX_RECOVERY_LIMIT);
  const store = input.store ?? new PrismaDeviceSyncControlPlaneStore({
    prisma: getPrisma(),
  });
  const requestRecovery = input.requestRecovery ?? requestHostedDeviceSyncScheduledReconcileRecovery;
  const dueConnections = await store.listDueReconcileConnectionsForSweep({
    dueAt: now,
    limit: recoveryLimit + 1,
    recoveryBucketStartedAt,
  });
  const selectedDueConnections = dueConnections.slice(0, recoveryLimit);

  logger.info("Hosted device-sync due reconcile sweeper scanned due connections.", {
    dueAt: nowIso,
    dueConnections: dueConnections.length,
    recoveryBucketStartedAt: recoveryBucketStartedAtIso,
    recoveryLimit,
    selectedDueConnections: selectedDueConnections.length,
  });

  let recoveryAttempted = 0;
  let recoveryFailed = 0;
  let recoveryNotRequested = 0;
  let recoveryRequested = 0;

  await runWithConcurrency(
    selectedDueConnections,
    RECOVERY_CONCURRENCY,
    async (dueConnection) => {
      recoveryAttempted += 1;

      let recovery;
      try {
        recovery = await requestRecovery({
          connectionId: dueConnection.connectionId,
          createdAt: nowIso,
          nextReconcileAt: dueConnection.nextReconcileAt,
          provider: dueConnection.provider,
          traceId: null,
          userId: dueConnection.userId,
        });
      } catch (error) {
        recoveryFailed += 1;
        recoveryNotRequested += 1;
        logger.warn("Hosted device-sync due reconcile sweeper background recovery request failed.", {
          errorName: error instanceof Error ? error.name : "unknown",
        });
        return;
      }

      if (recovery.recoveryRequested) {
        recoveryRequested += 1;
        return;
      }

      recoveryFailed += 1;
      recoveryNotRequested += 1;
      logger.warn("Hosted device-sync due reconcile sweeper background recovery was not requested.", {
        reason: recovery.reason ?? null,
      });
    },
  );

  const skippedDueConnections = Math.max(0, dueConnections.length - selectedDueConnections.length);
  if (skippedDueConnections > 0) {
    logger.warn("Hosted device-sync due reconcile sweeper skipped due connections after recovery limit.", {
      recoveryLimit,
      skippedDueConnections,
    });
  }

  logger.info("Hosted device-sync due reconcile sweeper finished.", {
    dueConnections: dueConnections.length,
    recoveryAttempted,
    recoveryFailed,
    recoveryLimit,
    recoveryNotRequested,
    recoveryRequested,
    skippedDueConnections,
  });

  return {
    dueConnections: dueConnections.length,
    recoveryAttempted,
    recoveryFailed,
    recoveryLimit,
    recoveryNotRequested,
    recoveryRequested,
    skippedDueConnections,
  };
}

function normalizeLimit(value: number | null | undefined, fallback: number, max: number): number {
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
