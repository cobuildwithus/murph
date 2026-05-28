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

  const dirtyRecoveryRequestFailed =
    dirtySweep.status === "fulfilled"
    && (
      dirtySweep.value.recoveryFailed > 0
      || dirtySweep.value.recoveryNotRequested > 0
    );
  const dueReconcileRecoveryRequestFailed =
    dueReconcileSweep.status === "fulfilled"
    && (
      dueReconcileSweep.value.recoveryFailed > 0
      || dueReconcileSweep.value.recoveryNotRequested > 0
    );

  if (
    dirtySweep.status === "rejected"
    || dirtyRecoveryRequestFailed
    || dueReconcileSweep.status === "rejected"
    || dueReconcileRecoveryRequestFailed
  ) {
    logger.warn("Hosted device-sync recovery sweep failed.", {
      dirtyRecoveryFailed: dirtySweep.status === "fulfilled"
        ? dirtySweep.value.recoveryFailed
        : null,
      dirtyRecoveryNotRequested: dirtySweep.status === "fulfilled"
        ? dirtySweep.value.recoveryNotRequested
        : null,
      dirtyRecoveryRequestFailed,
      dirtySweeperErrorName: describeErrorName(dirtySweep),
      dirtySweeperFailed: dirtySweep.status === "rejected",
      dueReconcileRecoveryFailed: dueReconcileSweep.status === "fulfilled"
        ? dueReconcileSweep.value.recoveryFailed
        : null,
      dueReconcileRecoveryNotRequested: dueReconcileSweep.status === "fulfilled"
        ? dueReconcileSweep.value.recoveryNotRequested
        : null,
      dueReconcileRecoveryRequestFailed,
      dueReconcileSweeperErrorName: describeErrorName(dueReconcileSweep),
      dueReconcileSweeperFailed: dueReconcileSweep.status === "rejected",
    });

    if (dirtySweep.status === "rejected") {
      throw dirtySweep.reason;
    }
    if (dirtyRecoveryRequestFailed) {
      throw new Error("Hosted device-sync dirty sweeper failed to request one or more recoveries.");
    }
    if (dueReconcileSweep.status === "rejected") {
      throw dueReconcileSweep.reason;
    }
    if (dueReconcileRecoveryRequestFailed) {
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
