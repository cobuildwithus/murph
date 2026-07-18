import {
  HOSTED_DEVICE_SYNC_RECOVERY_SWEEP_CALLBACK_USER_ID,
  HOSTED_DEVICE_SYNC_RECOVERY_SWEEP_PATH,
} from "@murphai/hosted-execution/routes";

import {
  observeHostedTemporalActivity,
  readHostedDeviceSyncRecoverySweepTimeoutMs,
  readHostedOrchestratorTemporalWebEnvironment,
  requestHostedOrchestratorJson,
} from "./http-client.js";

export interface HostedDeviceSyncRecoverySweepResult {
  clinicalRetrievalHandoffSweeper: HostedClinicalRetrievalHandoffSweeperResult;
  dueReconcileSweeper: HostedDeviceSyncDueReconcileSweeperResult;
  preferenceHandoffSweeper: HostedPreferenceHandoffSweeperResult;
}

export interface HostedClinicalRetrievalHandoffSweeperResult {
  candidateRuns: number;
  handoffAccepted: number;
  handoffAttempted: number;
  handoffFailed: number;
  handoffLimit: number;
  handoffSkippedInactive: number;
  skippedCandidateRuns: number;
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

export interface HostedPreferenceHandoffSweeperResult {
  candidateUsers: number;
  handoffAccepted: number;
  handoffAttempted: number;
  handoffFailed: number;
  handoffLimit: number;
  handoffSkippedInactive: number;
  skippedCandidateUsers: number;
}

// The route/activity name is legacy compatibility. The current behavior asks
// web to append bounded scheduled-reconcile mailbox wakes.
export async function runHostedDeviceSyncRecoverySweep(): Promise<
  HostedDeviceSyncRecoverySweepResult
> {
  const environment = readHostedOrchestratorTemporalWebEnvironment();

  return observeHostedTemporalActivity({
    activity: "runHostedDeviceSyncRecoverySweep",
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
      timeoutMs: readHostedDeviceSyncRecoverySweepTimeoutMs(),
    })
  );
}

function parseHostedDeviceSyncRecoverySweepResult(
  value: unknown,
): HostedDeviceSyncRecoverySweepResult {
  const record = requireRecord(value, "Hosted device-sync scheduled wake sweep response");
  return {
    clinicalRetrievalHandoffSweeper: record.clinicalRetrievalHandoffSweeper === undefined
      ? emptyClinicalRetrievalHandoffSweeperResult()
      : parseClinicalRetrievalHandoffSweeperResult(
          record.clinicalRetrievalHandoffSweeper,
        ),
    dueReconcileSweeper: parseDueReconcileSweeperResult(
      record.dueReconcileSweeper,
    ),
    preferenceHandoffSweeper: parsePreferenceHandoffSweeperResult(
      record.preferenceHandoffSweeper,
    ),
  };
}

function parseClinicalRetrievalHandoffSweeperResult(
  value: unknown,
): HostedClinicalRetrievalHandoffSweeperResult {
  const record = requireRecord(
    value,
    "Hosted Clinical Records handoff sweep response",
  );
  return {
    candidateRuns: requireCount(record.candidateRuns, "candidateRuns"),
    handoffAccepted: requireCount(record.handoffAccepted, "handoffAccepted"),
    handoffAttempted: requireCount(record.handoffAttempted, "handoffAttempted"),
    handoffFailed: requireCount(record.handoffFailed, "handoffFailed"),
    handoffLimit: requireCount(record.handoffLimit, "handoffLimit"),
    handoffSkippedInactive: requireCount(
      record.handoffSkippedInactive,
      "handoffSkippedInactive",
    ),
    skippedCandidateRuns: requireCount(
      record.skippedCandidateRuns,
      "skippedCandidateRuns",
    ),
  };
}

function emptyClinicalRetrievalHandoffSweeperResult(): HostedClinicalRetrievalHandoffSweeperResult {
  return {
    candidateRuns: 0,
    handoffAccepted: 0,
    handoffAttempted: 0,
    handoffFailed: 0,
    handoffLimit: 0,
    handoffSkippedInactive: 0,
    skippedCandidateRuns: 0,
  };
}

function parsePreferenceHandoffSweeperResult(
  value: unknown,
): HostedPreferenceHandoffSweeperResult {
  const record = requireRecord(
    value,
    "Hosted preference handoff sweep response",
  );
  return {
    candidateUsers: requireCount(record.candidateUsers, "candidateUsers"),
    handoffAccepted: requireCount(record.handoffAccepted, "handoffAccepted"),
    handoffAttempted: requireCount(record.handoffAttempted, "handoffAttempted"),
    handoffFailed: requireCount(record.handoffFailed, "handoffFailed"),
    handoffLimit: requireCount(record.handoffLimit, "handoffLimit"),
    handoffSkippedInactive: requireCount(
      record.handoffSkippedInactive,
      "handoffSkippedInactive",
    ),
    skippedCandidateUsers: requireCount(
      record.skippedCandidateUsers,
      "skippedCandidateUsers",
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
