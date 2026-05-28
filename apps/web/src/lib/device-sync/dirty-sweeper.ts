import { createHash } from "node:crypto";

import { getPrisma } from "../prisma";
import { PrismaDeviceSyncControlPlaneStore } from "./prisma-store";
import {
  requestHostedDeviceSyncDirtyRecovery,
} from "./wake-service";

const DEFAULT_RECOVERY_LIMIT = 25;
const DEFAULT_STALE_AFTER_MS = 30_000;
const MAX_RECOVERY_LIMIT = 250;
const RECOVERY_CONCURRENCY = 5;

export interface HostedDeviceSyncDirtySweeperResult {
  dirtyConnections: number;
  dirtyUsers: number;
  recoveryAttempted: number;
  recoveryFailed: number;
  recoveryLimit: number;
  recoveryNotRequested: number;
  recoveryRequested: number;
  skippedDirtyUsers: number;
  staleAfterMs: number;
}

type HostedDeviceSyncDirtySweeperLogger = Pick<Console, "info" | "warn">;
type HostedDeviceSyncDirtyRecoveryRequest = typeof requestHostedDeviceSyncDirtyRecovery;

export async function runHostedDeviceSyncDirtySweeper(input: {
  logger?: HostedDeviceSyncDirtySweeperLogger;
  now?: Date;
  nudgeLimit?: number;
  requestDirtyRecovery?: HostedDeviceSyncDirtyRecoveryRequest;
  staleAfterMs?: number;
  store?: Pick<PrismaDeviceSyncControlPlaneStore, "listDirtyUsersForSweep">;
} = {}): Promise<HostedDeviceSyncDirtySweeperResult> {
  const logger = input.logger ?? console;
  const now = input.now ?? new Date();
  const recoveryLimit = normalizeLimit(input.nudgeLimit, DEFAULT_RECOVERY_LIMIT, MAX_RECOVERY_LIMIT);
  const staleAfterMs = normalizeStaleAfterMs(input.staleAfterMs);
  const store = input.store ?? new PrismaDeviceSyncControlPlaneStore({
    prisma: getPrisma(),
  });
  const requestDirtyRecovery = input.requestDirtyRecovery ?? requestHostedDeviceSyncDirtyRecovery;
  const dirtyUsers = await store.listDirtyUsersForSweep({
    limit: recoveryLimit + 1,
    staleBefore: new Date(now.getTime() - staleAfterMs),
  });
  const selectedDirtyUsers = dirtyUsers.slice(0, recoveryLimit);

  logger.info("Hosted device-sync dirty sweeper scanned dirty users.", {
    dirtyConnections: sumDirtyConnectionCounts(dirtyUsers),
    dirtyUsers: dirtyUsers.length,
    selectedDirtyUsers: selectedDirtyUsers.length,
    staleAfterMs,
    recoveryLimit,
  });

  let recoveryAttempted = 0;
  let recoveryFailed = 0;
  let recoveryNotRequested = 0;
  let recoveryRequested = 0;

  await runWithConcurrency(
    selectedDirtyUsers,
    RECOVERY_CONCURRENCY,
    async (dirtyUser) => {
      recoveryAttempted += 1;
      const userFingerprint = fingerprintHostedDeviceSyncDirtyValue(dirtyUser.userId);
      logger.warn("Hosted device-sync dirty sweeper requesting background recovery for dirty user state.", {
        dirtyConnectionCount: dirtyUser.dirtyConnectionCount.toString(),
        latestDirtyAt: dirtyUser.latestDirtyAt,
        userFingerprint,
      });
      let recovery;
      try {
        recovery = await requestDirtyRecovery({
          userId: dirtyUser.userId,
        });
      } catch (error) {
        recoveryFailed += 1;
        recoveryNotRequested += 1;
        logger.warn("Hosted device-sync dirty sweeper background recovery request failed.", {
          errorName: error instanceof Error ? error.name : "unknown",
          userFingerprint,
        });
        return;
      }

      if (recovery.recoveryRequested) {
        recoveryRequested += 1;
        logger.info("Hosted device-sync dirty sweeper background recovery requested.", {
          userFingerprint,
        });
        return;
      }

      recoveryFailed += 1;
      recoveryNotRequested += 1;
      logger.warn("Hosted device-sync dirty sweeper background recovery was not requested.", {
        reason: recovery.reason ?? null,
        userFingerprint,
      });
    },
  );

  const skippedDirtyUsers = Math.max(0, dirtyUsers.length - selectedDirtyUsers.length);
  if (skippedDirtyUsers > 0) {
    logger.warn("Hosted device-sync dirty sweeper skipped dirty users after recovery limit.", {
      recoveryLimit,
      skippedDirtyUsers,
    });
  }

  return {
    dirtyConnections: sumDirtyConnectionCounts(dirtyUsers),
    dirtyUsers: dirtyUsers.length,
    recoveryAttempted,
    recoveryFailed,
    recoveryLimit,
    recoveryNotRequested,
    recoveryRequested,
    skippedDirtyUsers,
    staleAfterMs,
  };
}

function sumDirtyConnectionCounts(rows: Array<{ dirtyConnectionCount: bigint }>): number {
  let total = 0n;
  for (const row of rows) {
    total += row.dirtyConnectionCount;
    if (total > BigInt(Number.MAX_SAFE_INTEGER)) {
      return Number.MAX_SAFE_INTEGER;
    }
  }
  return Number(total);
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
