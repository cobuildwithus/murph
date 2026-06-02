import {
  runHostedDeviceSyncDueReconcileSweeper,
  type HostedDeviceSyncDueReconcileSweeperResult,
} from "./due-reconcile-sweeper";

export interface HostedDeviceSyncRecoverySweepResult {
  dueReconcileSweeper: HostedDeviceSyncDueReconcileSweeperResult;
}

type HostedDeviceSyncRecoverySweepLogger = Pick<Console, "warn">;
type HostedDeviceSyncDueReconcileSweepRunner =
  typeof runHostedDeviceSyncDueReconcileSweeper;

export async function runHostedDeviceSyncRecoverySweep(input: {
  logger?: HostedDeviceSyncRecoverySweepLogger;
  runDueReconcileSweeper?: HostedDeviceSyncDueReconcileSweepRunner;
} = {}): Promise<HostedDeviceSyncRecoverySweepResult> {
  const logger = input.logger ?? console;
  const runDueReconcileSweeper = input.runDueReconcileSweeper
    ?? runHostedDeviceSyncDueReconcileSweeper;

  let dueReconcileSweep: HostedDeviceSyncDueReconcileSweeperResult;
  try {
    dueReconcileSweep = await runDueReconcileSweeper();
  } catch (error) {
    logger.warn("Hosted device-sync recovery sweep failed.", {
      dueReconcileRecoveryFailed: null,
      dueReconcileRecoveryNotRequested: null,
      dueReconcileRecoveryRequestFailed: false,
      dueReconcileSweeperErrorName: describeErrorName(error),
      dueReconcileSweeperFailed: true,
    });
    throw error;
  }

  const dueReconcileRecoveryRequestFailed =
    dueReconcileSweep.recoveryFailed > 0
    || dueReconcileSweep.recoveryNotRequested > 0;

  if (dueReconcileRecoveryRequestFailed) {
    logger.warn("Hosted device-sync recovery sweep failed.", {
      dueReconcileRecoveryFailed: dueReconcileSweep.recoveryFailed,
      dueReconcileRecoveryNotRequested: dueReconcileSweep.recoveryNotRequested,
      dueReconcileRecoveryRequestFailed,
      dueReconcileSweeperErrorName: null,
      dueReconcileSweeperFailed: false,
    });

    throw new Error("Hosted device-sync due reconcile sweeper failed to request one or more recoveries.");
  }

  return {
    dueReconcileSweeper: dueReconcileSweep,
  };
}

function describeErrorName(error: unknown): string {
  return error instanceof Error ? error.name : "unknown";
}
