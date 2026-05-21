import "server-only";

import {
  HOSTED_RUNTIME_CURRENT_WAIT_REASONS,
  HOSTED_RUNTIME_DEMAND_KINDS,
  HOSTED_RUNTIME_ENSURE_EXECUTION_RESPONSE_KINDS,
  HOSTED_RUNTIME_ENSURE_PROCESSING_RESPONSE_KINDS,
  HOSTED_USER_RUNTIME_STATUS_QUERY_NAME,
  type HostedRuntimeDemand,
  type HostedRuntimeDemandKind,
  type HostedRuntimeEnsureExecutionResponseKind,
  type HostedRuntimeEnsureProcessingResponseKind,
  type HostedRuntimeWorkflowState,
} from "@murphai/hosted-execution/orchestration-control";
import {
  isHostedMailboxLane,
  type HostedRunnerStatusResponse,
} from "@murphai/hosted-execution/runtime-control";

import {
  readHostedExecutionControlClientIfConfigured,
} from "../hosted-execution/control";
import {
  readHostedRuntimeDemand,
} from "./runtime-demand";
import {
  hostedUserRuntimeWorkflowId,
} from "./signal-runtime";
import {
  readHostedRuntimeTemporalSignalClientIfConfigured,
} from "./temporal-client";

export interface HostedOrchestrationUserStatus {
  cloudflare: {
    runnerStatus: HostedRunnerStatusResponse | null;
  };
  demand: {
    current: HostedRuntimeDemand;
  };
  temporal: {
    status: HostedRuntimeWorkflowStatusProjection | null;
    workflowId: string;
  };
  userId: string;
}

export type HostedRuntimeWorkflowStatusProjection =
  Omit<HostedRuntimeWorkflowState, "latestMailboxPointer"> & {
    latestMailboxPointerPresent: boolean;
  };

export async function readHostedOrchestrationUserStatus(input: {
  userId: string;
}): Promise<HostedOrchestrationUserStatus> {
  const workflowId = hostedUserRuntimeWorkflowId(input.userId);
  const [runtimeWorkflowStatus, runnerStatus] = await Promise.all([
    readHostedRuntimeWorkflowStatusIfAvailable({
      userId: input.userId,
      workflowId,
    }),
    readHostedRunnerStatusIfAvailable(input.userId),
  ]);
  const demand = await readHostedRuntimeDemand({
    browserVaultRefreshRequested:
      runtimeWorkflowStatus?.browserVaultRefreshRequested === true,
    deviceSyncRecoveryRequested:
      runtimeWorkflowStatus?.deviceSyncRecoveryRequested === true,
    ignoredWorkspaceWakeKey:
      runtimeWorkflowStatus?.ignoredWorkspaceWakeKey ?? null,
    lagRecoveryObserved: runtimeWorkflowStatus?.lagRecoveryObserved === true,
    manualRunRequested: runtimeWorkflowStatus?.manualRunRequested === true,
    runtimeResultWakeAt: runtimeWorkflowStatus?.runtimeResultWakeAt ?? null,
    runtimeResultWakeReason:
      runtimeWorkflowStatus?.runtimeResultWakeReason ?? null,
    usageGateMode: "read_only",
    userId: input.userId,
  });

  return {
    cloudflare: {
      runnerStatus,
    },
    demand: {
      current: demand,
    },
    temporal: {
      status: runtimeWorkflowStatus
        ? projectHostedRuntimeWorkflowStatusForEndpoint(runtimeWorkflowStatus)
        : null,
      workflowId,
    },
    userId: input.userId,
  };
}

function projectHostedRuntimeWorkflowStatusForEndpoint(
  status: HostedRuntimeWorkflowState,
): HostedRuntimeWorkflowStatusProjection {
  const {
    latestMailboxPointer,
    ...scalarStatus
  } = status;

  return {
    ...scalarStatus,
    latestMailboxPointerPresent: latestMailboxPointer !== null,
  };
}

async function readHostedRuntimeWorkflowStatusIfAvailable(input: {
  userId: string;
  workflowId: string;
}): Promise<HostedRuntimeWorkflowState | null> {
  try {
    const client = await readHostedRuntimeTemporalSignalClientIfConfigured();
    const getHandle = client?.workflow.getHandle;
    if (!getHandle) {
      return null;
    }

    const queried = await getHandle.call(client.workflow, input.workflowId)
      .query(HOSTED_USER_RUNTIME_STATUS_QUERY_NAME);
    const status = parseHostedRuntimeWorkflowStatusForWeb(queried);
    if (status.userId !== input.userId) {
      return null;
    }

    return status;
  } catch {
    return null;
  }
}

async function readHostedRunnerStatusIfAvailable(
  userId: string,
): Promise<HostedRunnerStatusResponse | null> {
  try {
    const client = readHostedExecutionControlClientIfConfigured();
    return client ? await client.getRunnerStatus(userId) : null;
  } catch {
    return null;
  }
}

function parseHostedRuntimeWorkflowStatusForWeb(
  value: unknown,
): HostedRuntimeWorkflowState {
  const record = requireRecord(value);

  return {
    browserVaultRefreshRequested: requireBoolean(
      record.browserVaultRefreshRequested,
    ),
    currentWaitReason: readNullableCurrentWaitReason(record.currentWaitReason),
    currentWaitUntil: readNullableString(record.currentWaitUntil),
    deviceSyncRecoveryRequested: requireBoolean(
      record.deviceSyncRecoveryRequested,
    ),
    ignoredWorkspaceWakeKey: readNullableString(record.ignoredWorkspaceWakeKey),
    invalidSignalCount: requireSafeInteger(record.invalidSignalCount),
    lagRecoveryObserved: requireBoolean(record.lagRecoveryObserved),
    lastDemandKind: readNullableDemandKind(record.lastDemandKind),
    lastDemandNextWakeAt: readNullableString(record.lastDemandNextWakeAt),
    lastDemandSource: readNullableString(record.lastDemandSource),
    lastExecutionAt: readNullableString(record.lastExecutionAt),
    lastExecutionErrorCode: readNullableString(record.lastExecutionErrorCode),
    lastExecutionKind: readNullableExecutionKind(record.lastExecutionKind),
    lastInvalidSignalErrorCode:
      readNullableString(record.lastInvalidSignalErrorCode),
    lastMailboxLagLaneCount: requireSafeInteger(record.lastMailboxLagLaneCount),
    lastOrchestrationAttemptId:
      readNullableString(record.lastOrchestrationAttemptId),
    lastRuntimeAttemptId: readNullableString(record.lastRuntimeAttemptId),
    lastRuntimeStatus: readNullableString(record.lastRuntimeStatus),
    latestMailboxPointer:
      readNullableMailboxPointer(record.latestMailboxPointer),
    mailboxSignalCount: requireSafeInteger(record.mailboxSignalCount),
    manualRunRequested: requireBoolean(record.manualRunRequested),
    runtimeFailedWithoutNextWakeCount: requireSafeInteger(
      record.runtimeFailedWithoutNextWakeCount,
    ),
    runtimeResultWakeAt: readNullableString(record.runtimeResultWakeAt),
    runtimeResultWakeReason: readNullableString(record.runtimeResultWakeReason),
    sameRuntimeWakeSentCount: requireSafeInteger(
      record.sameRuntimeWakeSentCount,
    ),
    signalVersion: requireSafeInteger(record.signalVersion),
    userId: requireString(record.userId),
  };
}

function readNullableMailboxPointer(
  value: unknown,
): HostedRuntimeWorkflowState["latestMailboxPointer"] {
  if (value === null) {
    return null;
  }

  const record = requireRecord(value);
  const lane = requireString(record.lane);
  if (!isHostedMailboxLane(lane)) {
    throw new TypeError("Hosted runtime workflow mailbox pointer lane is invalid.");
  }

  return {
    lane,
    laneSeq: requireString(record.laneSeq),
    mailboxItemId: requireString(record.mailboxItemId),
    source: requireString(record.source),
  };
}

function readNullableDemandKind(value: unknown): HostedRuntimeDemandKind | null {
  if (value === null) {
    return null;
  }

  const kind = requireString(value);
  if (HOSTED_RUNTIME_DEMAND_KINDS.includes(kind as HostedRuntimeDemandKind)) {
    return kind as HostedRuntimeDemandKind;
  }

  throw new TypeError("Hosted runtime workflow demand kind is invalid.");
}

function readNullableCurrentWaitReason(
  value: unknown,
): HostedRuntimeWorkflowState["currentWaitReason"] {
  if (value === null) {
    return null;
  }

  const reason = requireString(value);
  if (
    HOSTED_RUNTIME_CURRENT_WAIT_REASONS.includes(
      reason as Exclude<HostedRuntimeWorkflowState["currentWaitReason"], null>,
    )
  ) {
    return reason as HostedRuntimeWorkflowState["currentWaitReason"];
  }

  throw new TypeError("Hosted runtime workflow wait reason is invalid.");
}

function readNullableExecutionKind(
  value: unknown,
): HostedRuntimeWorkflowState["lastExecutionKind"] {
  if (value === null) {
    return null;
  }

  const kind = requireString(value);
  if (kind === "failed") {
    return kind;
  }

  if (
    HOSTED_RUNTIME_ENSURE_EXECUTION_RESPONSE_KINDS.includes(
      kind as HostedRuntimeEnsureExecutionResponseKind,
    )
  ) {
    return kind as HostedRuntimeEnsureExecutionResponseKind;
  }

  if (
    HOSTED_RUNTIME_ENSURE_PROCESSING_RESPONSE_KINDS.includes(
      kind as HostedRuntimeEnsureProcessingResponseKind,
    )
  ) {
    return kind as HostedRuntimeEnsureProcessingResponseKind;
  }

  throw new TypeError("Hosted runtime workflow execution kind is invalid.");
}

function readNullableString(value: unknown): string | null {
  if (value === null) {
    return null;
  }

  return requireString(value);
}

function requireBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError("Hosted runtime workflow status boolean is invalid.");
  }

  return value;
}

function requireSafeInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new TypeError("Hosted runtime workflow status integer is invalid.");
  }

  return value;
}

function requireString(value: unknown): string {
  if (typeof value !== "string") {
    throw new TypeError("Hosted runtime workflow status string is invalid.");
  }

  return value;
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Hosted runtime workflow status object is invalid.");
  }

  return value as Record<string, unknown>;
}
