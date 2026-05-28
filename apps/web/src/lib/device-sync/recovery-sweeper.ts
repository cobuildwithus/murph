import {
  runHostedDeviceSyncDirtySweeper,
  type HostedDeviceSyncDirtySweeperResult,
} from "./dirty-sweeper";
import {
  runHostedDeviceSyncDueReconcileSweeper,
  type HostedDeviceSyncDueReconcileSweeperResult,
} from "./due-reconcile-sweeper";

export interface HostedDeviceSyncRecoverySweepResult {
  dueReconcileSweeper: HostedDeviceSyncDueReconcileSweeperResult;
  sweeper: HostedDeviceSyncDirtySweeperResult;
}

type HostedDeviceSyncRecoverySweepLogger = Pick<Console, "warn">;
type HostedDeviceSyncDirtySweepRunner = typeof runHostedDeviceSyncDirtySweeper;
type HostedDeviceSyncDueReconcileSweepRunner =
  typeof runHostedDeviceSyncDueReconcileSweeper;

export async function runHostedDeviceSyncRecoverySweep(input: {
  logger?: HostedDeviceSyncRecoverySweepLogger;
  runDirtySweeper?: HostedDeviceSyncDirtySweepRunner;
  runDueReconcileSweeper?: HostedDeviceSyncDueReconcileSweepRunner;
} = {}): Promise<HostedDeviceSyncRecoverySweepResult> {
  const logger = input.logger ?? console;
  const runDirtySweeper = input.runDirtySweeper
    ?? runHostedDeviceSyncDirtySweeper;
  const runDueReconcileSweeper = input.runDueReconcileSweeper
    ?? runHostedDeviceSyncDueReconcileSweeper;

  const [dirtySweep, dueReconcileSweep] = await Promise.allSettled([
    runDirtySweeper(),
    runDueReconcileSweeper(),
  ]);

  const dirtyWakeAppendFailed =
    dirtySweep.status === "fulfilled"
    && (
      dirtySweep.value.wakeFailed > 0
      || dirtySweep.value.wakeNotAppended > 0
    );
  const dueReconcileWakeAppendFailed =
    dueReconcileSweep.status === "fulfilled"
    && (
      dueReconcileSweep.value.wakeFailed > 0
      || dueReconcileSweep.value.wakeNotAppended > 0
    );

  if (
    dirtySweep.status === "rejected"
    || dirtyWakeAppendFailed
    || dueReconcileSweep.status === "rejected"
    || dueReconcileWakeAppendFailed
  ) {
    logger.warn("Hosted device-sync recovery sweep failed.", {
      dirtySweeperErrorName: describeErrorName(dirtySweep),
      dirtySweeperFailed: dirtySweep.status === "rejected",
      dirtyWakeAppendFailed,
      dirtyWakeFailed: dirtySweep.status === "fulfilled"
        ? dirtySweep.value.wakeFailed
        : null,
      dirtyWakeNotAppended: dirtySweep.status === "fulfilled"
        ? dirtySweep.value.wakeNotAppended
        : null,
      dueReconcileWakeAppendFailed,
      dueReconcileWakeFailed: dueReconcileSweep.status === "fulfilled"
        ? dueReconcileSweep.value.wakeFailed
        : null,
      dueReconcileWakeNotAppended: dueReconcileSweep.status === "fulfilled"
        ? dueReconcileSweep.value.wakeNotAppended
        : null,
      dueReconcileSweeperErrorName: describeErrorName(dueReconcileSweep),
      dueReconcileSweeperFailed: dueReconcileSweep.status === "rejected",
    });

    if (dirtySweep.status === "rejected") {
      throw dirtySweep.reason;
    }
    if (dirtyWakeAppendFailed) {
      throw new Error("Hosted device-sync dirty sweeper failed to request one or more recoveries.");
    }
    if (dueReconcileSweep.status === "rejected") {
      throw dueReconcileSweep.reason;
    }
    if (dueReconcileWakeAppendFailed) {
      throw new Error("Hosted device-sync due reconcile sweeper failed to request one or more recoveries.");
    }
  }

  return {
    dueReconcileSweeper: dueReconcileSweep.value,
    sweeper: dirtySweep.value,
  };
}

function describeErrorName<T>(
  result: PromiseSettledResult<T>,
): string | null {
  if (result.status === "fulfilled") {
    return null;
  }

  return result.reason instanceof Error ? result.reason.name : "unknown";
}
