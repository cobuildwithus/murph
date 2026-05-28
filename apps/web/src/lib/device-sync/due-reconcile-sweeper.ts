import { createHash } from "node:crypto";

import { getPrisma } from "../prisma";
import { PrismaDeviceSyncControlPlaneStore } from "./prisma-store";
import { requestHostedDeviceSyncScheduledReconcileRecovery } from "./wake-service";

const DEFAULT_WAKE_LIMIT = 25;
const DUE_RECONCILE_WAKE_BUCKET_MS = 5 * 60_000;
const MAX_WAKE_LIMIT = 250;
const WAKE_CONCURRENCY = 5;

export interface HostedDeviceSyncDueReconcileSweeperResult {
  dueConnections: number;
  skippedDueConnections: number;
  wakeAppended: number;
  wakeAttempted: number;
  wakeDuplicate: number;
  wakeFailed: number;
  wakeLimit: number;
  wakeNotAppended: number;
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
    Math.floor(now.getTime() / DUE_RECONCILE_WAKE_BUCKET_MS) * DUE_RECONCILE_WAKE_BUCKET_MS,
  );
  const recoveryBucketStartedAtIso = recoveryBucketStartedAt.toISOString();
  const wakeLimit = normalizeLimit(input.nudgeLimit, DEFAULT_WAKE_LIMIT, MAX_WAKE_LIMIT);
  const store = input.store ?? new PrismaDeviceSyncControlPlaneStore({
    prisma: getPrisma(),
  });
  const requestRecovery = input.requestRecovery ?? requestHostedDeviceSyncScheduledReconcileRecovery;
  const dueConnections = await store.listDueReconcileConnectionsForSweep({
    dueAt: now,
    limit: wakeLimit + 1,
    recoveryBucketStartedAt,
  });
  const selectedDueConnections = dueConnections.slice(0, wakeLimit);

  logger.info("Hosted device-sync due reconcile sweeper scanned due connections.", {
    dueAt: nowIso,
    dueConnections: dueConnections.length,
    recoveryBucketStartedAt: recoveryBucketStartedAtIso,
    selectedDueConnections: selectedDueConnections.length,
    wakeLimit,
  });

  let wakeAppended = 0;
  let wakeAttempted = 0;
  let wakeDuplicate = 0;
  let wakeFailed = 0;
  let wakeNotAppended = 0;

  await runWithConcurrency(
    selectedDueConnections,
    WAKE_CONCURRENCY,
    async (dueConnection) => {
      wakeAttempted += 1;

      let wake;
      try {
        wake = await requestRecovery({
          connectionId: dueConnection.connectionId,
          createdAt: nowIso,
          eventId: buildHostedDeviceSyncDueReconcileEventId({
            ...dueConnection,
            recoveryBucketStartedAt: recoveryBucketStartedAtIso,
          }),
          nextReconcileAt: dueConnection.nextReconcileAt,
          provider: dueConnection.provider,
          traceId: null,
          userId: dueConnection.userId,
        });
      } catch (error) {
        wakeFailed += 1;
        wakeNotAppended += 1;
        logger.warn("Hosted device-sync due reconcile sweeper background recovery request failed.", {
          errorName: error instanceof Error ? error.name : "unknown",
        });
        return;
      }

      if (wake.wakeInserted) {
        wakeAppended += 1;
        return;
      }

      if (wake.wakeDuplicate) {
        wakeDuplicate += 1;
        return;
      }

      wakeFailed += 1;
      wakeNotAppended += 1;
      logger.warn("Hosted device-sync due reconcile sweeper background recovery was not requested.", {
        reason: wake.reason ?? null,
      });
    },
  );

  const skippedDueConnections = Math.max(0, dueConnections.length - selectedDueConnections.length);
  if (skippedDueConnections > 0) {
    logger.warn("Hosted device-sync due reconcile sweeper skipped due connections after wake limit.", {
      skippedDueConnections,
      wakeLimit,
    });
  }

  logger.info("Hosted device-sync due reconcile sweeper finished.", {
    dueConnections: dueConnections.length,
    skippedDueConnections,
    wakeAppended,
    wakeAttempted,
    wakeDuplicate,
    wakeFailed,
    wakeLimit,
    wakeNotAppended,
  });

  return {
    dueConnections: dueConnections.length,
    skippedDueConnections,
    wakeAppended,
    wakeAttempted,
    wakeDuplicate,
    wakeFailed,
    wakeLimit,
    wakeNotAppended,
  };
}

function buildHostedDeviceSyncDueReconcileEventId(input: {
  connectionId: string;
  nextReconcileAt: string;
  provider: string;
  recoveryBucketStartedAt: string;
  userId: string;
}): string {
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({
      connectionId: input.connectionId,
      nextReconcileAt: input.nextReconcileAt,
      provider: input.provider,
      recoveryBucketStartedAt: input.recoveryBucketStartedAt,
      userId: input.userId,
      version: 1,
    }))
    .digest("hex")
    .slice(0, 32);

  return [
    "device-sync",
    "scheduled-reconcile",
    fingerprint,
  ].join(":");
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
