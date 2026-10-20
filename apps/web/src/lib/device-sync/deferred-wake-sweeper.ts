import { runHostedRecoveryBatch } from "../hosted-orchestration/recovery-batch";
import { formatHostedExecutionSafeLogErrorDetails } from "../hosted-execution/logging";
import { getPrisma } from "../prisma";
import { PrismaDeviceSyncControlPlaneStore } from "./prisma-store";
import { releaseHostedDeviceSyncDeferredDirtyWake } from "./wake-service";

const DEFAULT_RELEASE_LIMIT = 100;
const RELEASE_RETRY_DELAY_MS = 5 * 60_000;

export interface HostedDeviceSyncDeferredWakeSweeperResult {
  dueConnections: number;
  hasMoreDueConnections: boolean;
  releaseCleared: number;
  releaseFailed: number;
  releaseLimit: number;
  released: number;
}

type HostedDeviceSyncDeferredWakeSweeperLogger = Pick<Console, "info" | "warn">;

export async function runHostedDeviceSyncDeferredWakeSweeper(input: {
  logger?: HostedDeviceSyncDeferredWakeSweeperLogger;
  now?: Date;
  release?: typeof releaseHostedDeviceSyncDeferredDirtyWake;
  releaseLimit?: number;
  store?: Pick<
    PrismaDeviceSyncControlPlaneStore,
    "listDueDeferredDirtyConnectionWakes" | "postponeDeferredDirtyConnectionWake"
  >;
} = {}): Promise<HostedDeviceSyncDeferredWakeSweeperResult> {
  const logger = input.logger ?? console;
  const now = input.now ?? new Date();
  const releaseLimit = input.releaseLimit ?? DEFAULT_RELEASE_LIMIT;
  const release = input.release ?? releaseHostedDeviceSyncDeferredDirtyWake;
  const store = input.store ?? new PrismaDeviceSyncControlPlaneStore({ prisma: getPrisma() });
  const due = await store.listDueDeferredDirtyConnectionWakes({
    dueAt: now,
    limit: releaseLimit + 1,
  });
  const selected = due.slice(0, releaseLimit);
  let released = 0;
  let releaseCleared = 0;
  let releaseFailed = 0;

  await runHostedRecoveryBatch(selected, async (deferred) => {
    try {
      const result = await release({ ...deferred, now });
      if (result.outcome === "released") released += 1;
      else releaseCleared += 1;
    } catch (error) {
      // The deadline stays durable and retries after a delay, so a persistent
      // failure cannot keep the oldest sweep slots from other batches.
      releaseFailed += 1;
      logger.warn("Hosted device-sync deferred wake release failed.", {
        ...formatHostedExecutionSafeLogErrorDetails(error, {
          code: "HOSTED_DEVICE_SYNC_DEFERRED_WAKE_RELEASE_FAILED",
        }),
      });
      await store.postponeDeferredDirtyConnectionWake({
        ...deferred,
        dueAt: now,
        retryAt: new Date(now.getTime() + RELEASE_RETRY_DELAY_MS),
      }).catch(() => undefined);
    }
  }, true);

  const result = {
    dueConnections: selected.length,
    hasMoreDueConnections: due.length > selected.length,
    releaseCleared,
    releaseFailed,
    releaseLimit,
    released,
  };
  logger.info("Hosted device-sync deferred wake sweeper finished.", result);
  return result;
}
