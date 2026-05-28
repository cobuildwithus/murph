import { createHash } from "node:crypto";

import { getPrisma } from "../prisma";
import { PrismaDeviceSyncControlPlaneStore } from "./prisma-store";
import {
  requestHostedDeviceSyncDirtyRecovery,
} from "./wake-service";

const DEFAULT_WAKE_LIMIT = 25;
const DEFAULT_STALE_AFTER_MS = 30_000;
const MAX_WAKE_LIMIT = 250;
const WAKE_CONCURRENCY = 5;

export interface HostedDeviceSyncDirtySweeperResult {
  dirtyConnections: number;
  skippedDirtyConnections: number;
  staleAfterMs: number;
  wakeAppended: number;
  wakeAttempted: number;
  wakeDuplicate: number;
  wakeFailed: number;
  wakeLimit: number;
  wakeNotAppended: number;
}

type HostedDeviceSyncDirtySweeperLogger = Pick<Console, "info" | "warn">;
type HostedDeviceSyncDirtyRecoveryRequest = typeof requestHostedDeviceSyncDirtyRecovery;

export async function runHostedDeviceSyncDirtySweeper(input: {
  logger?: HostedDeviceSyncDirtySweeperLogger;
  now?: Date;
  nudgeLimit?: number;
  requestDirtyRecovery?: HostedDeviceSyncDirtyRecoveryRequest;
  staleAfterMs?: number;
  store?: Pick<PrismaDeviceSyncControlPlaneStore, "listDirtyConnectionsForSweep">;
} = {}): Promise<HostedDeviceSyncDirtySweeperResult> {
  const logger = input.logger ?? console;
  const now = input.now ?? new Date();
  const wakeLimit = normalizeLimit(input.nudgeLimit, DEFAULT_WAKE_LIMIT, MAX_WAKE_LIMIT);
  const staleAfterMs = normalizeStaleAfterMs(input.staleAfterMs);
  const store = input.store ?? new PrismaDeviceSyncControlPlaneStore({
    prisma: getPrisma(),
  });
  const requestDirtyRecovery = input.requestDirtyRecovery ?? requestHostedDeviceSyncDirtyRecovery;
  const dirtyConnections = await store.listDirtyConnectionsForSweep({
    limit: wakeLimit + 1,
    staleBefore: new Date(now.getTime() - staleAfterMs),
  });
  const selectedDirtyConnections = dirtyConnections.slice(0, wakeLimit);

  logger.info("Hosted device-sync dirty sweeper scanned dirty connections.", {
    dirtyConnections: dirtyConnections.length,
    selectedDirtyConnections: selectedDirtyConnections.length,
    staleAfterMs,
    wakeLimit,
  });

  let wakeAppended = 0;
  let wakeAttempted = 0;
  let wakeDuplicate = 0;
  let wakeFailed = 0;
  let wakeNotAppended = 0;

  await runWithConcurrency(
    selectedDirtyConnections,
    WAKE_CONCURRENCY,
    async (dirtyConnection) => {
      wakeAttempted += 1;
      const connectionFingerprint = fingerprintHostedDeviceSyncDirtyValue(dirtyConnection.connectionId);
      const userFingerprint = fingerprintHostedDeviceSyncDirtyValue(dirtyConnection.userId);
      logger.warn("Hosted device-sync dirty sweeper requesting background recovery for dirty state.", {
        connectionFingerprint,
        dirtyRevision: dirtyConnection.dirtyRevision.toString(),
        latestDirtyAt: dirtyConnection.latestDirtyAt,
        provider: dirtyConnection.provider,
        userFingerprint,
      });
      let wake;
      try {
        wake = await requestDirtyRecovery({
          connectionId: dirtyConnection.connectionId,
          dirtyRevision: dirtyConnection.dirtyRevision,
          eventType: dirtyConnection.latestEventType,
          occurredAt: dirtyConnection.latestDirtyAt,
          provider: dirtyConnection.provider,
          resourceCategory: dirtyConnection.latestResourceCategory,
          userId: dirtyConnection.userId,
        });
      } catch (error) {
        wakeFailed += 1;
        wakeNotAppended += 1;
        logger.warn("Hosted device-sync dirty sweeper background recovery request failed.", {
          connectionFingerprint,
          errorName: error instanceof Error ? error.name : "unknown",
          userFingerprint,
        });
        return;
      }

      if (wake.wakeInserted) {
        wakeAppended += 1;
        logger.info("Hosted device-sync dirty sweeper background recovery requested.", {
          connectionFingerprint,
          userFingerprint,
        });
        return;
      }

      if (wake.wakeDuplicate) {
        wakeDuplicate += 1;
        logger.info("Hosted device-sync dirty sweeper background recovery was already requested.", {
          connectionFingerprint,
          userFingerprint,
        });
        return;
      }

      wakeFailed += 1;
      wakeNotAppended += 1;
      logger.warn("Hosted device-sync dirty sweeper background recovery was not requested.", {
        connectionFingerprint,
        reason: wake.reason ?? null,
        userFingerprint,
      });
    },
  );

  const skippedDirtyConnections = Math.max(0, dirtyConnections.length - selectedDirtyConnections.length);
  if (skippedDirtyConnections > 0) {
    logger.warn("Hosted device-sync dirty sweeper skipped dirty connections after wake limit.", {
      skippedDirtyConnections,
      wakeLimit,
    });
  }

  return {
    dirtyConnections: dirtyConnections.length,
    skippedDirtyConnections,
    staleAfterMs,
    wakeAppended,
    wakeAttempted,
    wakeDuplicate,
    wakeFailed,
    wakeLimit,
    wakeNotAppended,
  };
}

function normalizeLimit(value: number | null | undefined, fallback: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(1, Math.min(Math.floor(value), max));
}

function normalizeStaleAfterMs(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_STALE_AFTER_MS;
  }

  return Math.max(0, Math.floor(value));
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

function fingerprintHostedDeviceSyncDirtyValue(value: string): string {
  return createHash("sha256")
    .update(value)
    .digest("hex")
    .slice(0, 16);
}
