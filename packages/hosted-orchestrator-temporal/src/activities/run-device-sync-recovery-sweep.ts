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
}

export interface HostedDeviceSyncDueReconcileSweeperResult {
  dueConnections: number;
  skippedDueConnections: number;
  wakeAccepted: number;
  wakeAttempted: number;
  wakeFailed: number;
  wakeLimit: number;
  wakeNotAccepted: number;
}

export async function runHostedDeviceSyncRecoverySweep(): Promise<
  HostedDeviceSyncRecoverySweepResult
> {
  const environment = readHostedOrchestratorTemporalWebEnvironment();

  return observeHostedTemporalActivity({
    activity: "runHostedDeviceSyncRecoverySweep",
    reason: "device_sync_scheduled_wake",
    userId: "",
  }, async () =>
    requestHostedOrchestratorJson(environment.hostedWebBaseUrl, {
      body: "{}",
      boundUserId: HOSTED_DEVICE_SYNC_RECOVERY_SWEEP_CALLBACK_USER_ID,
      fetchImpl: fetch,
      label: "device-sync scheduled wake sweep",
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
  const record = requireRecord(value, "Hosted device-sync scheduled wake sweep response");
  return {
    dueReconcileSweeper: parseDueReconcileSweeperResult(
      record.dueReconcileSweeper,
    ),
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
    skippedDueConnections: requireCount(
      record.skippedDueConnections,
      "skippedDueConnections",
    ),
    wakeAccepted: requireCount(record.wakeAccepted, "wakeAccepted"),
    wakeAttempted: requireCount(record.wakeAttempted, "wakeAttempted"),
    wakeFailed: requireCount(record.wakeFailed, "wakeFailed"),
    wakeLimit: requireCount(record.wakeLimit, "wakeLimit"),
    wakeNotAccepted: requireCount(record.wakeNotAccepted, "wakeNotAccepted"),
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
      `Hosted device-sync scheduled wake sweep ${label} must be a non-negative integer.`,
    );
  }

  return value;
}
