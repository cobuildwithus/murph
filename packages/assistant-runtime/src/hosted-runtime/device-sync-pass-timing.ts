import { AsyncLocalStorage } from "node:async_hooks";

const stages = [
  "writeLockWait",
  "localLedgerWrite",
  "receiptBuild",
  "artifactUpload",
  "webCheckpoint",
  "runtimeSnapshot",
  "localProgressCommit",
  "providerFetch",
  "identityIndex",
  "normalization",
  "idleYieldWait",
] as const;

export type DeviceSyncPassTimingStage = typeof stages[number];
type StageTotals = { count: number; totalMs: number; maxMs: number };
export type DeviceSyncPassTimings = Record<DeviceSyncPassTimingStage, StageTotals>;

const activePass = new AsyncLocalStorage<DeviceSyncPassTimings>();

export function createDeviceSyncPassTimings(): DeviceSyncPassTimings {
  return Object.fromEntries(stages.map((stage) => [
    stage,
    { count: 0, totalMs: 0, maxMs: 0 },
  ])) as DeviceSyncPassTimings;
}

export function withDeviceSyncPassTimings<T>(
  timings: DeviceSyncPassTimings,
  run: () => Promise<T>,
): Promise<T> {
  return activePass.run(timings, run);
}

export function recordDeviceSyncPassTiming(
  stage: DeviceSyncPassTimingStage,
  elapsedMs: number,
  count = 1,
): void {
  const totals = activePass.getStore()?.[stage];
  if (!totals || !Number.isFinite(elapsedMs) || count <= 0) return;
  const duration = Math.max(0, elapsedMs);
  totals.count += count;
  totals.totalMs += duration;
  totals.maxMs = Math.max(totals.maxMs, duration);
}

export function flattenDeviceSyncPassTimings(
  timings: DeviceSyncPassTimings,
): Record<string, number> {
  const fields: Record<string, number> = {};
  for (const stage of stages) {
    const prefix = `deviceSyncStage${stage[0]?.toUpperCase()}${stage.slice(1)}`;
    fields[`${prefix}Count`] = timings[stage].count;
    fields[`${prefix}TotalMs`] = Math.round(timings[stage].totalMs);
    fields[`${prefix}MaxMs`] = Math.round(timings[stage].maxMs);
  }
  return fields;
}
