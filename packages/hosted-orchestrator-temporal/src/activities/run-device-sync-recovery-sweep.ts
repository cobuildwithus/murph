import {
  HOSTED_DEVICE_SYNC_RECOVERY_SWEEP_CALLBACK_USER_ID,
  HOSTED_DEVICE_SYNC_RECOVERY_SWEEP_PATH,
} from "@murphai/hosted-execution/routes";

import {
  observeHostedTemporalActivity,
  readHostedOrchestratorTemporalWebEnvironment,
  requestHostedOrchestratorJson,
} from "./http-client.js";

export interface HostedDeviceSyncRecoverySweepResult {
  dueReconcileSweeper: HostedDeviceSyncDueReconcileSweeperResult;
  sweeper: HostedDeviceSyncDirtySweeperResult;
}

export interface HostedDeviceSyncDirtySweeperResult {
  dirtyConnections: number;
  dirtyUsers: number;
  recoveryAttempted: number;
  recoveryFailed: number;
  recoveryLimit: number;
  recoveryNotRequested: number;
  recoveryRequested: number;
  skippedDirtyUsers: number;
  staleAfterMs: number;
}

export interface HostedDeviceSyncDueReconcileSweeperResult {
  dueConnections: number;
  recoveryAttempted: number;
  recoveryFailed: number;
  recoveryLimit: number;
  recoveryNotRequested: number;
  recoveryRequested: number;
  skippedDueConnections: number;
}

export async function runHostedDeviceSyncRecoverySweep(): Promise<
  HostedDeviceSyncRecoverySweepResult
> {
  const environment = readHostedOrchestratorTemporalWebEnvironment();

  return observeHostedTemporalActivity({
    activity: "runHostedDeviceSyncRecoverySweep",
    reason: "device_sync_recovery",
    userId: "",
  }, async () =>
    requestHostedOrchestratorJson(environment.hostedWebBaseUrl, {
      body: "{}",
      boundUserId: HOSTED_DEVICE_SYNC_RECOVERY_SWEEP_CALLBACK_USER_ID,
      fetchImpl: fetch,
      label: "device-sync recovery sweep",
      method: "POST",
      parse: parseHostedDeviceSyncRecoverySweepResult,
      path: HOSTED_DEVICE_SYNC_RECOVERY_SWEEP_PATH,
      signing: environment.hostedWebCallbackSigning,
      timeoutMs: environment.deviceSyncRecoverySweepTimeoutMs,
    })
  );
}

function parseHostedDeviceSyncRecoverySweepResult(
  value: unknown,
): HostedDeviceSyncRecoverySweepResult {
  const record = requireRecord(value, "Hosted device-sync recovery sweep response");
  return {
    dueReconcileSweeper: parseDueReconcileSweeperResult(
      record.dueReconcileSweeper,
    ),
    sweeper: parseDirtySweeperResult(record.sweeper),
  };
}

function parseDirtySweeperResult(value: unknown): HostedDeviceSyncDirtySweeperResult {
  const record = requireRecord(value, "Hosted device-sync dirty sweeper response");
  return {
    dirtyConnections: requireCount(record.dirtyConnections, "dirtyConnections"),
    dirtyUsers: requireCount(
      record.dirtyUsers ?? record.dirtyConnections,
      "dirtyUsers",
    ),
    recoveryAttempted: requireCount(
      record.recoveryAttempted ?? record.wakeAttempted,
      "recoveryAttempted",
    ),
    recoveryFailed: requireCount(
      record.recoveryFailed ?? record.wakeFailed,
      "recoveryFailed",
    ),
    recoveryLimit: requireCount(
      record.recoveryLimit ?? record.wakeLimit,
      "recoveryLimit",
    ),
    recoveryNotRequested: requireCount(
      record.recoveryNotRequested ?? record.wakeNotAppended,
      "recoveryNotRequested",
    ),
    recoveryRequested: requireCount(
      record.recoveryRequested ?? countLegacyRequestedRecoveries(record),
      "recoveryRequested",
    ),
    skippedDirtyUsers: requireCount(
      record.skippedDirtyUsers ?? record.skippedDirtyConnections,
      "skippedDirtyUsers",
    ),
    staleAfterMs: requireCount(record.staleAfterMs, "staleAfterMs"),
  };
}

function parseDueReconcileSweeperResult(
  value: unknown,
): HostedDeviceSyncDueReconcileSweeperResult {
  const record = requireRecord(
    value,
    "Hosted device-sync due reconcile sweeper response",
  );
  return {
    dueConnections: requireCount(record.dueConnections, "dueConnections"),
    recoveryAttempted: requireCount(
      record.recoveryAttempted ?? record.wakeAttempted,
      "recoveryAttempted",
    ),
    recoveryFailed: requireCount(
      record.recoveryFailed ?? record.wakeFailed,
      "recoveryFailed",
    ),
    recoveryLimit: requireCount(
      record.recoveryLimit ?? record.wakeLimit,
      "recoveryLimit",
    ),
    recoveryNotRequested: requireCount(
      record.recoveryNotRequested ?? record.wakeNotAppended,
      "recoveryNotRequested",
    ),
    recoveryRequested: requireCount(
      record.recoveryRequested ?? countLegacyRequestedRecoveries(record),
      "recoveryRequested",
    ),
    skippedDueConnections: requireCount(
      record.skippedDueConnections,
      "skippedDueConnections",
    ),
  };
}

function requireRecord(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function requireCount(value: unknown, label: string): number {
  if (
    typeof value !== "number"
    || !Number.isSafeInteger(value)
    || value < 0
  ) {
    throw new TypeError(
      `Hosted device-sync recovery sweep ${label} must be a non-negative integer.`,
    );
  }

  return value;
}

function countLegacyRequestedRecoveries(record: Record<string, unknown>): number | undefined {
  if (record.wakeAppended === undefined && record.wakeDuplicate === undefined) {
    return undefined;
  }

  const appended = requireCount(record.wakeAppended ?? 0, "wakeAppended");
  const duplicate = requireCount(record.wakeDuplicate ?? 0, "wakeDuplicate");
  return appended + duplicate;
}
