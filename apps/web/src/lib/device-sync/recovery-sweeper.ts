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
    logger.warn("Hosted device-sync scheduled wake sweep failed.", {
      dueReconcileWakeFailed: null,
      dueReconcileWakeNotAccepted: null,
      dueReconcileWakeRequestFailed: false,
      dueReconcileSweeperErrorName: describeErrorName(error),
      dueReconcileSweeperFailed: true,
    });
    throw error;
  }

  const dueReconcileWakeRequestFailed =
    dueReconcileSweep.wakeFailed > 0
    || dueReconcileSweep.wakeNotAccepted > 0;

  if (dueReconcileWakeRequestFailed) {
    logger.warn("Hosted device-sync scheduled wake sweep failed.", {
      dueReconcileWakeFailed: dueReconcileSweep.wakeFailed,
      dueReconcileWakeNotAccepted: dueReconcileSweep.wakeNotAccepted,
      dueReconcileWakeRequestFailed,
      dueReconcileSweeperErrorName: null,
      dueReconcileSweeperFailed: false,
    });

    throw new Error("Hosted device-sync due reconcile sweeper failed to request one or more wakes.");
  }

  return {
    dueReconcileSweeper: dueReconcileSweep,
  };
}

function describeErrorName(error: unknown): string {
  return error instanceof Error ? error.name : "unknown";
}
