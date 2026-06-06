import { getPrisma } from "../prisma";
import { PrismaDeviceSyncControlPlaneStore } from "./prisma-store";
import {
  appendHostedDeviceSyncScheduledReconcileWake,
  buildHostedDeviceSyncScheduledReconcileWakeEventId,
} from "./wake-service";

const DEFAULT_WAKE_LIMIT = 25;
const DUE_RECONCILE_WAKE_BUCKET_MS = 5 * 60_000;
const MAX_WAKE_LIMIT = 250;
const WAKE_CONCURRENCY = 5;

export interface HostedDeviceSyncDueReconcileSweeperResult {
  dueConnections: number;
  wakeAccepted: number;
  wakeAttempted: number;
  wakeFailed: number;
  wakeLimit: number;
  wakeNotAccepted: number;
  skippedDueConnections: number;
}

type HostedDeviceSyncDueReconcileSweeperLogger = Pick<Console, "info" | "warn">;
type HostedDeviceSyncScheduledReconcileWakeRequest =
  typeof appendHostedDeviceSyncScheduledReconcileWake;

export async function runHostedDeviceSyncDueReconcileSweeper(input: {
  logger?: HostedDeviceSyncDueReconcileSweeperLogger;
  now?: Date;
  requestWake?: HostedDeviceSyncScheduledReconcileWakeRequest;
  store?: Pick<PrismaDeviceSyncControlPlaneStore, "listDueReconcileConnectionsForSweep">;
  wakeLimit?: number;
} = {}): Promise<HostedDeviceSyncDueReconcileSweeperResult> {
  const logger = input.logger ?? console;
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const wakeBucketStartedAt = new Date(
    Math.floor(now.getTime() / DUE_RECONCILE_WAKE_BUCKET_MS) * DUE_RECONCILE_WAKE_BUCKET_MS,
  );
  const wakeBucketStartedAtIso = wakeBucketStartedAt.toISOString();
  const wakeLimit = normalizeLimit(input.wakeLimit, DEFAULT_WAKE_LIMIT, MAX_WAKE_LIMIT);
  const store = input.store ?? new PrismaDeviceSyncControlPlaneStore({
    prisma: getPrisma(),
  });
  const requestWake = input.requestWake ?? appendHostedDeviceSyncScheduledReconcileWake;
  const dueConnections = await store.listDueReconcileConnectionsForSweep({
    dueAt: now,
    limit: wakeLimit + 1,
    recoveryBucketStartedAt: wakeBucketStartedAt,
  });
  const selectedDueConnections = dueConnections.slice(0, wakeLimit);

  logger.info("Hosted device-sync due reconcile sweeper scanned due connections.", {
    dueAt: nowIso,
    dueConnections: dueConnections.length,
    wakeBucketStartedAt: wakeBucketStartedAtIso,
    wakeLimit,
    selectedDueConnections: selectedDueConnections.length,
  });

  let wakeAccepted = 0;
  let wakeAttempted = 0;
  let wakeFailed = 0;
  let wakeNotAccepted = 0;

  await runWithConcurrency(
    selectedDueConnections,
    WAKE_CONCURRENCY,
    async (dueConnection) => {
      wakeAttempted += 1;

      let wake;
      try {
        wake = await requestWake({
          connectionId: dueConnection.connectionId,
          createdAt: nowIso,
          eventId: buildHostedDeviceSyncScheduledReconcileWakeEventId({
            connectionId: dueConnection.connectionId,
            nextReconcileAt: dueConnection.nextReconcileAt,
          }),
          nextReconcileAt: dueConnection.nextReconcileAt,
          provider: dueConnection.provider,
          traceId: null,
          userId: dueConnection.userId,
        });
      } catch (error) {
        wakeFailed += 1;
        wakeNotAccepted += 1;
        logger.warn("Hosted device-sync due reconcile sweeper wake request failed.", {
          errorName: error instanceof Error ? error.name : "unknown",
        });
        return;
      }

      if (wake.wakeAccepted) {
        wakeAccepted += 1;
        return;
      }

      wakeFailed += 1;
      wakeNotAccepted += 1;
      logger.warn("Hosted device-sync due reconcile sweeper wake was not accepted.", {
        reason: wake.reason ?? null,
      });
    },
  );

  const skippedDueConnections = Math.max(0, dueConnections.length - selectedDueConnections.length);
  if (skippedDueConnections > 0) {
    logger.warn("Hosted device-sync due reconcile sweeper skipped due connections after wake limit.", {
      wakeLimit,
      skippedDueConnections,
    });
  }

  logger.info("Hosted device-sync due reconcile sweeper finished.", {
    dueConnections: dueConnections.length,
    wakeAccepted,
    wakeAttempted,
    wakeFailed,
    wakeLimit,
    wakeNotAccepted,
    skippedDueConnections,
  });

  return {
    dueConnections: dueConnections.length,
    wakeAccepted,
    wakeAttempted,
    wakeFailed,
    wakeLimit,
    wakeNotAccepted,
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
