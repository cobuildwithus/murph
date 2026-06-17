import {
  runHostedDeviceSyncDueReconcileSweeper,
  type HostedDeviceSyncDueReconcileSweeperResult,
} from "./due-reconcile-sweeper";
import {
  formatHostedExecutionSafeLogErrorDetails,
} from "../hosted-execution/logging";

export interface HostedDeviceSyncRecoverySweepResult {
  dueReconcileSweeper: HostedDeviceSyncDueReconcileSweeperResult;
}

type HostedDeviceSyncRecoverySweepLogger = Pick<Console, "warn">;
type HostedDeviceSyncDueReconcileSweepRunner =
  typeof runHostedDeviceSyncDueReconcileSweeper;

// The route/API name is legacy compatibility. The current behavior is a bounded
// scheduled-reconcile mailbox wake sweep, not recovery-signal production.
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
      ...formatHostedExecutionSafeLogErrorDetails(error, {
        code: "HOSTED_DEVICE_SYNC_SCHEDULED_WAKE_SWEEP_FAILED",
      }),
      dueReconcileWakeFailed: null,
      dueReconcileWakeNotAccepted: null,
      dueReconcileWakeRequestFailed: false,
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
      errorCode: "HOSTED_DEVICE_SYNC_SCHEDULED_WAKE_SWEEP_WAKE_FAILED",
      errorMessage: "Hosted device-sync scheduled wake sweep did not request every due wake.",
      dueReconcileSweeperFailed: false,
    });

    throw new Error("Hosted device-sync due reconcile sweeper failed to request one or more wakes.");
  }

  return {
    dueReconcileSweeper: dueReconcileSweep,
  };
}
