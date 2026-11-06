import { HOSTED_RECOVERY_BUDGET_MS } from "../hosted-orchestration/recovery-batch";
import {
  runHostedDeviceSyncDeferredWakeSweeper,
  type HostedDeviceSyncDeferredWakeSweeperResult,
} from "./deferred-wake-sweeper";
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
  deferredWakeSweeper: HostedDeviceSyncDeferredWakeSweeperResult;
  dueReconcileSweeper: HostedDeviceSyncDueReconcileSweeperResult;
  preferenceHandoffSweeper: HostedPreferenceHandoffSweepResult;
}

type HostedDeviceSyncRecoverySweepLogger = Pick<Console, "warn">;
type HostedDeviceSyncDueReconcileSweepRunner =
  typeof runHostedDeviceSyncDueReconcileSweeper;
type HostedPreferenceHandoffSweepRunner =
  typeof runHostedPreferenceHandoffSweeper;
type HostedDeviceSyncDeferredWakeSweepRunner =
  typeof runHostedDeviceSyncDeferredWakeSweeper;

// The route/API name is legacy compatibility. The current behavior is a bounded
// scheduled-reconcile mailbox wake sweep, not recovery-signal production.
export async function runHostedDeviceSyncRecoverySweep(input: {
  deadlineMs?: number;
  logger?: HostedDeviceSyncRecoverySweepLogger;
  runDeferredWakeSweeper?: HostedDeviceSyncDeferredWakeSweepRunner;
  runDueReconcileSweeper?: HostedDeviceSyncDueReconcileSweepRunner;
  runPreferenceHandoffSweeper?: HostedPreferenceHandoffSweepRunner;
} = {}): Promise<HostedDeviceSyncRecoverySweepResult> {
  const deadlineMs = input.deadlineMs ?? Date.now() + HOSTED_RECOVERY_BUDGET_MS;
  const logger = input.logger ?? console;
  const runDueReconcileSweeper = input.runDueReconcileSweeper
    ?? runHostedDeviceSyncDueReconcileSweeper;
  const runPreferenceHandoffSweeper = input.runPreferenceHandoffSweeper
    ?? runHostedPreferenceHandoffSweeper;
  const runDeferredWakeSweeper = input.runDeferredWakeSweeper
    ?? runHostedDeviceSyncDeferredWakeSweeper;

  // Recover old handoffs before deferred and due producers. The handoff age
  // gate is independent of this sweep's new work, so slow producers cannot
  // consume its time or make their own new items eligible for recovery.
  let preferenceHandoffSweep: HostedPreferenceHandoffSweepResult | null = null;
  let preferenceHandoffError: unknown = null;
  try {
    preferenceHandoffSweep = await runPreferenceHandoffSweeper({ deadlineMs });
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

  const {
    error: deferredWakeError,
    result: deferredWakeSweep,
  } = await runDeferredWakeSweepStage(runDeferredWakeSweeper, deadlineMs);

  let dueReconcileSweep: HostedDeviceSyncDueReconcileSweeperResult | null = null;
  let dueReconcileError: unknown = null;
  try {
    dueReconcileSweep = await runDueReconcileSweeper({ deadlineMs });
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
    && dueReconcileSweep.wakeFailed > 0
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

  if (deferredWakeError !== null) {
    logger.warn("Hosted device-sync deferred wake sweep failed.", {
      ...formatHostedExecutionSafeLogErrorDetails(deferredWakeError, {
        code: "HOSTED_DEVICE_SYNC_DEFERRED_WAKE_SWEEP_FAILED",
      }),
    });
    throw deferredWakeError;
  }
  if (dueReconcileError !== null) {
    throw dueReconcileError;
  }
  if (preferenceHandoffError !== null) {
    throw preferenceHandoffError;
  }
  if (
    deferredWakeSweep === null
    || dueReconcileSweep === null
    || preferenceHandoffSweep === null
  ) {
    throw new Error("Hosted scheduled recovery sweep completed without a result.");
  }

  return {
    deferredWakeSweeper: deferredWakeSweep,
    dueReconcileSweeper: dueReconcileSweep,
    preferenceHandoffSweeper: preferenceHandoffSweep,
  };
}

async function runDeferredWakeSweepStage(
  run: HostedDeviceSyncDeferredWakeSweepRunner,
  deadlineMs: number,
): Promise<{ error: unknown; result: HostedDeviceSyncDeferredWakeSweeperResult | null }> {
  try {
    const result = await run({ deadlineMs });
    return {
      error: result.releaseFailed > 0
        ? new Error("Hosted device-sync deferred wake sweep failed to release one or more wakes.")
        : null,
      result,
    };
  } catch (error) {
    return { error, result: null };
  }
}
