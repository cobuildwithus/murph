import {
  runHostedDeviceSyncDueReconcileSweeper,
  type HostedDeviceSyncDueReconcileSweeperResult,
} from "./due-reconcile-sweeper";
import {
  formatHostedExecutionSafeLogErrorDetails,
} from "../hosted-execution/logging";
import {
  runHostedPreferenceHandoffSweeper,
  type HostedPreferenceHandoffSweepResult,
} from "../hosted-orchestration/preference-handoff-sweeper";

export interface HostedDeviceSyncRecoverySweepResult {
  dueReconcileSweeper: HostedDeviceSyncDueReconcileSweeperResult;
  preferenceHandoffSweeper: HostedPreferenceHandoffSweepResult;
}

type HostedDeviceSyncRecoverySweepLogger = Pick<Console, "warn">;
type HostedDeviceSyncDueReconcileSweepRunner =
  typeof runHostedDeviceSyncDueReconcileSweeper;
type HostedPreferenceHandoffSweepRunner =
  typeof runHostedPreferenceHandoffSweeper;

// The route/API name is legacy compatibility. The current behavior is a bounded
// scheduled-reconcile mailbox wake sweep, not recovery-signal production.
export async function runHostedDeviceSyncRecoverySweep(input: {
  logger?: HostedDeviceSyncRecoverySweepLogger;
  runDueReconcileSweeper?: HostedDeviceSyncDueReconcileSweepRunner;
  runPreferenceHandoffSweeper?: HostedPreferenceHandoffSweepRunner;
} = {}): Promise<HostedDeviceSyncRecoverySweepResult> {
  const logger = input.logger ?? console;
  const runDueReconcileSweeper = input.runDueReconcileSweeper
    ?? runHostedDeviceSyncDueReconcileSweeper;
  const runPreferenceHandoffSweeper = input.runPreferenceHandoffSweeper
    ?? runHostedPreferenceHandoffSweeper;

  let dueReconcileSweep: HostedDeviceSyncDueReconcileSweeperResult | null = null;
  let dueReconcileError: unknown = null;
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
    dueReconcileError = error;
  }

  if (
    dueReconcileSweep !== null
    && (
      dueReconcileSweep.wakeFailed > 0
      || dueReconcileSweep.wakeNotAccepted > 0
    )
  ) {
    logger.warn("Hosted device-sync scheduled wake sweep failed.", {
      dueReconcileWakeFailed: dueReconcileSweep.wakeFailed,
      dueReconcileWakeNotAccepted: dueReconcileSweep.wakeNotAccepted,
      dueReconcileWakeRequestFailed: true,
      errorCode: "HOSTED_DEVICE_SYNC_SCHEDULED_WAKE_SWEEP_WAKE_FAILED",
      errorMessage: "Hosted device-sync scheduled wake sweep did not request every due wake.",
      dueReconcileSweeperFailed: false,
    });

    dueReconcileError = new Error(
      "Hosted device-sync due reconcile sweeper failed to request one or more wakes.",
    );
  }

  let preferenceHandoffSweep: HostedPreferenceHandoffSweepResult | null = null;
  let preferenceHandoffError: unknown = null;
  try {
    preferenceHandoffSweep = await runPreferenceHandoffSweeper();
  } catch (error) {
    preferenceHandoffError = error;
  }
  if (
    preferenceHandoffSweep !== null
    && preferenceHandoffSweep.handoffFailed > 0
  ) {
    logger.warn("Hosted preference mailbox handoff recovery failed.", {
      errorCode: "HOSTED_PREFERENCE_HANDOFF_RECOVERY_SWEEP_FAILED",
      errorMessage: "Hosted preference mailbox handoff recovery did not request every handoff.",
      handoffFailed: preferenceHandoffSweep.handoffFailed,
    });
    preferenceHandoffError = new Error(
      "Hosted preference mailbox handoff recovery failed.",
    );
  }

  if (dueReconcileError !== null) {
    throw dueReconcileError;
  }
  if (preferenceHandoffError !== null) {
    throw preferenceHandoffError;
  }
  if (dueReconcileSweep === null || preferenceHandoffSweep === null) {
    throw new Error("Hosted scheduled recovery sweep completed without a result.");
  }

  return {
    dueReconcileSweeper: dueReconcileSweep,
    preferenceHandoffSweeper: preferenceHandoffSweep,
  };
}
