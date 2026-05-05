import { createHash } from "node:crypto";

import { nudgeHostedRunnerUserBestEffortResult } from "../hosted-runner/control";
import { getPrisma } from "../prisma";
import { PrismaDeviceSyncControlPlaneStore } from "./prisma-store";

const DEFAULT_NUDGE_LIMIT = 25;
const DEFAULT_STALE_AFTER_MS = 30_000;
const MAX_NUDGE_LIMIT = 250;
const NUDGE_CONCURRENCY = 5;
const NUDGE_TIMEOUT_MS = 5_000;

export interface HostedDeviceSyncDirtySweeperResult {
  dirtyUsers: number;
  nudgeAccepted: number;
  nudgeAttempted: number;
  nudgeLimit: number;
  nudgeNotAccepted: number;
  skippedDirtyUsers: number;
  staleAfterMs: number;
}

type HostedDeviceSyncDirtySweeperLogger = Pick<Console, "info" | "warn">;

export async function runHostedDeviceSyncDirtySweeper(input: {
  logger?: HostedDeviceSyncDirtySweeperLogger;
  now?: Date;
  nudgeLimit?: number;
  staleAfterMs?: number;
  store?: Pick<PrismaDeviceSyncControlPlaneStore, "listDirtyUsersForSweep">;
} = {}): Promise<HostedDeviceSyncDirtySweeperResult> {
  const logger = input.logger ?? console;
  const now = input.now ?? new Date();
  const nudgeLimit = normalizeLimit(input.nudgeLimit, DEFAULT_NUDGE_LIMIT, MAX_NUDGE_LIMIT);
  const staleAfterMs = normalizeStaleAfterMs(input.staleAfterMs);
  const store = input.store ?? new PrismaDeviceSyncControlPlaneStore({
    prisma: getPrisma(),
  });
  const dirtyUsers = await store.listDirtyUsersForSweep({
    limit: nudgeLimit + 1,
    staleBefore: new Date(now.getTime() - staleAfterMs),
  });
  const selectedDirtyUsers = dirtyUsers.slice(0, nudgeLimit);

  logger.info("Hosted device-sync dirty sweeper scanned dirty users.", {
    dirtyUsers: dirtyUsers.length,
    nudgeLimit,
    selectedDirtyUsers: selectedDirtyUsers.length,
    staleAfterMs,
  });

  let nudgeAccepted = 0;
  let nudgeAttempted = 0;
  let nudgeNotAccepted = 0;

  await runWithConcurrency(
    selectedDirtyUsers,
    NUDGE_CONCURRENCY,
    async (dirtyUser) => {
      nudgeAttempted += 1;
      const userFingerprint = fingerprintHostedDeviceSyncDirtyUser(dirtyUser.userId);
      logger.warn("Hosted device-sync dirty sweeper nudging runner for dirty state.", {
        dirtyConnectionCount: dirtyUser.dirtyConnectionCount.toString(),
        latestDirtyAt: dirtyUser.latestDirtyAt,
        userFingerprint,
      });
      const nudge = await nudgeHostedRunnerUserBestEffortResult({
        context: "hosted-device-sync-dirty-sweeper",
        timeoutMs: NUDGE_TIMEOUT_MS,
        userId: dirtyUser.userId,
      });

      if (nudge.accepted) {
        nudgeAccepted += 1;
        logger.info("Hosted device-sync dirty sweeper runner nudge accepted.", {
          alarmScheduled: nudge.alarmScheduled,
          alreadyRunning: nudge.alreadyRunning,
          inFlight: nudge.inFlight,
          nextAlarmAtPresent: nudge.nextAlarmAtPresent,
          userFingerprint,
        });
        return;
      }

      nudgeNotAccepted += 1;
      logger.warn("Hosted device-sync dirty sweeper runner nudge was not accepted.", {
        configured: nudge.configured,
        errorCode: nudge.errorCode,
        userFingerprint,
      });
    },
  );

  const skippedDirtyUsers = Math.max(0, dirtyUsers.length - selectedDirtyUsers.length);
  if (skippedDirtyUsers > 0) {
    logger.warn("Hosted device-sync dirty sweeper skipped dirty users after nudge limit.", {
      nudgeLimit,
      skippedDirtyUsers,
    });
  }

  return {
    dirtyUsers: dirtyUsers.length,
    nudgeAccepted,
    nudgeAttempted,
    nudgeLimit,
    nudgeNotAccepted,
    skippedDirtyUsers,
    staleAfterMs,
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

function fingerprintHostedDeviceSyncDirtyUser(userId: string): string {
  return createHash("sha256")
    .update(userId)
    .digest("hex")
    .slice(0, 16);
}
