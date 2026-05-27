import "server-only";

import {
  HOSTED_RUNTIME_CURRENT_WAIT_REASONS,
  HOSTED_RUNTIME_DEMAND_KINDS,
  HOSTED_RUNTIME_ENSURE_PROCESSING_RESPONSE_KINDS,
  HOSTED_USER_RUNTIME_STATUS_QUERY_NAME,
  type HostedRuntimeDemand,
  type HostedRuntimeDemandKind,
  type HostedRuntimeEnsureProcessingResponseKind,
  type HostedRuntimeLastRuntimeStatus,
  type HostedRuntimeWorkflowState,
} from "@murphai/hosted-execution/orchestration-control";
import {
  isHostedMailboxLane,
  type HostedRunnerStatusResponse,
  type HostedWorkspaceState,
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
    runnerStatus: HostedRunnerStatusProjection | null;
    unavailableReason: HostedCloudflareStatusUnavailableReason;
  };
  demand: {
    current: HostedRuntimeDemand;
  };
  temporal: {
    status: HostedRuntimeWorkflowStatusProjection | null;
    unavailableReason: HostedTemporalStatusUnavailableReason;
    workflowId: string;
  };
  userId: string;
}

export type HostedTemporalStatusUnavailableReason =
  | "not_configured"
  | "not_found"
  | "query_failed"
  | "status_invalid"
  | "user_mismatch"
  | null;

export type HostedCloudflareStatusUnavailableReason =
  | "not_configured"
  | "request_failed"
  | "status_invalid"
  | null;

export type HostedRuntimeWorkflowStatusProjection =
  Omit<HostedRuntimeWorkflowState, "latestMailboxPointer"> & {
    latestMailboxPointerPresent: boolean;
  };

export type HostedRunnerStatusProjection =
  Omit<HostedRunnerStatusResponse, "recentLogs" | "userId" | "workspace"> & {
    recentLogCount: number | null;
    userIdPresent: boolean;
    workspace: HostedRunnerWorkspaceStatusProjection | null;
  };

export type HostedRunnerWorkspaceStatusProjection =
  Omit<
    HostedWorkspaceState,
    "browserVaultReplicaRef" | "redactedStatus" | "snapshotRef" | "userId"
  > & {
    browserVaultReplicaRefPresent: boolean;
    redactedStatusPresent: boolean;
    snapshotRefPresent: boolean;
    userIdPresent: boolean;
  };

export async function readHostedOrchestrationUserStatus(input: {
  userId: string;
}): Promise<HostedOrchestrationUserStatus> {
  const workflowId = hostedUserRuntimeWorkflowId(input.userId);
  const [temporalStatusResult, cloudflareStatusResult] = await Promise.all([
    readHostedRuntimeWorkflowStatusIfAvailable({
      userId: input.userId,
      workflowId,
    }),
    readHostedRunnerStatusIfAvailable(input.userId),
  ]);
  const demand = await readHostedRuntimeDemand({
    browserVaultRefreshRequested:
      temporalStatusResult.status?.browserVaultRefreshRequested === true,
    deviceSyncRecoveryRequested:
      temporalStatusResult.status?.deviceSyncRecoveryRequested === true,
    decisionSource: "status",
    lagRecoveryObserved:
      temporalStatusResult.status?.lagRecoveryObserved === true,
    manualRunRequested:
      temporalStatusResult.status?.manualRunRequested === true,
    usageGateMode: "read_only",
    userId: input.userId,
  });

  return {
    cloudflare: {
      runnerStatus: cloudflareStatusResult.runnerStatus
        ? projectHostedRunnerStatusForEndpoint(cloudflareStatusResult.runnerStatus)
        : null,
      unavailableReason: cloudflareStatusResult.unavailableReason,
    },
    demand: {
      current: demand,
    },
    temporal: {
      status: temporalStatusResult.status
        ? projectHostedRuntimeWorkflowStatusForEndpoint(
          temporalStatusResult.status,
        )
        : null,
      unavailableReason: temporalStatusResult.unavailableReason,
      workflowId,
    },
    userId: input.userId,
  };
}

function projectHostedRunnerStatusForEndpoint(
  status: HostedRunnerStatusResponse,
): HostedRunnerStatusProjection {
  const {
    recentLogs,
    userId,
    workspace,
    ...scalarStatus
  } = status;

  return {
    ...scalarStatus,
    recentLogCount: recentLogs?.length ?? null,
    userIdPresent: userId.length > 0,
    workspace: workspace
      ? projectHostedRunnerWorkspaceStatusForEndpoint(workspace)
      : null,
  };
}

function projectHostedRunnerWorkspaceStatusForEndpoint(
  workspace: HostedWorkspaceState,
): HostedRunnerWorkspaceStatusProjection {
  const {
    browserVaultReplicaRef,
    redactedStatus,
    snapshotRef,
    userId,
    ...scalarWorkspace
  } = workspace;

  return {
    ...scalarWorkspace,
    browserVaultReplicaRefPresent: browserVaultReplicaRef !== undefined,
    redactedStatusPresent: redactedStatus !== undefined && redactedStatus !== null,
    snapshotRefPresent: snapshotRef !== undefined && snapshotRef !== null,
    userIdPresent: userId.length > 0,
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
}): Promise<{
  status: HostedRuntimeWorkflowState | null;
  unavailableReason: HostedTemporalStatusUnavailableReason;
}> {
  let client:
    | Awaited<ReturnType<typeof readHostedRuntimeTemporalSignalClientIfConfigured>>
    | null;
  try {
    client = await readHostedRuntimeTemporalSignalClientIfConfigured();
  } catch {
    return { status: null, unavailableReason: "query_failed" };
  }

  const workflow = client?.workflow;
  if (!workflow?.getHandle) {
    return { status: null, unavailableReason: "not_configured" };
  }

  let queried: unknown;
  try {
    queried = await workflow.getHandle(input.workflowId)
      .query(HOSTED_USER_RUNTIME_STATUS_QUERY_NAME);
  } catch (error) {
    return {
      status: null,
      unavailableReason: readTemporalWorkflowQueryUnavailableReason(error),
    };
  }

  let status: HostedRuntimeWorkflowState;
  try {
    status = parseHostedRuntimeWorkflowStatusForWeb(queried);
  } catch {
    return { status: null, unavailableReason: "status_invalid" };
  }

  if (status.userId !== input.userId) {
    return { status: null, unavailableReason: "user_mismatch" };
  }

  return { status, unavailableReason: null };
}

async function readHostedRunnerStatusIfAvailable(
  userId: string,
): Promise<{
  runnerStatus: HostedRunnerStatusResponse | null;
  unavailableReason: HostedCloudflareStatusUnavailableReason;
}> {
  let client: ReturnType<typeof readHostedExecutionControlClientIfConfigured>;
  try {
    client = readHostedExecutionControlClientIfConfigured();
  } catch {
    return { runnerStatus: null, unavailableReason: "not_configured" };
  }

  if (!client) {
    return { runnerStatus: null, unavailableReason: "not_configured" };
  }

  try {
    return {
      runnerStatus: await client.getRunnerStatus(userId),
      unavailableReason: null,
    };
  } catch (error) {
    return {
      runnerStatus: null,
      unavailableReason: readCloudflareRunnerStatusUnavailableReason(error),
    };
  }
}

function readTemporalWorkflowQueryUnavailableReason(
  error: unknown,
): HostedTemporalStatusUnavailableReason {
  return isNotFoundErrorLike(error) ? "not_found" : "query_failed";
}

function readCloudflareRunnerStatusUnavailableReason(
  error: unknown,
): HostedCloudflareStatusUnavailableReason {
  if (error instanceof SyntaxError) {
    return "status_invalid";
  }

  if (
    error instanceof TypeError
    && error.message.startsWith("Hosted runner status")
  ) {
    return "status_invalid";
  }

  return "request_failed";
}

function isNotFoundErrorLike(error: unknown): boolean {
  const record = typeof error === "object" && error !== null
    ? error as Record<string, unknown>
    : {};
  return hasNotFoundText(error instanceof Error ? error.name : null)
    || hasNotFoundText(error instanceof Error ? error.message : null)
    || hasNotFoundText(readErrorRecordText(record.type))
    || hasNotFoundText(readErrorRecordText(record.code));
}

function readErrorRecordText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function hasNotFoundText(value: string | null): boolean {
  return value !== null && /not[\s_-]*found/iu.test(value);
}

function parseHostedRuntimeWorkflowStatusForWeb(
  value: unknown,
): HostedRuntimeWorkflowState {
  const record = requireRecord(value);

  return {
    browserVaultRefreshRequested: requireBoolean(
      record.browserVaultRefreshRequested,
    ),
    currentWaitReason:
      readNullableCurrentWaitReason(record.currentWaitReason ?? null),
    currentWaitUntil: readNullableString(record.currentWaitUntil ?? null),
    deviceSyncRecoveryRequested: requireBoolean(
      record.deviceSyncRecoveryRequested,
    ),
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
      readNullableString(record.lastOrchestrationAttemptId ?? null),
    lastRuntimeAttemptId: readNullableString(record.lastRuntimeAttemptId ?? null),
    lastRuntimeStatus: readNullableLastRuntimeStatus(
      record.lastRuntimeStatus ?? null,
    ),
    latestMailboxPointer:
      readNullableObservabilityMailboxPointer(record.latestMailboxPointer),
    mailboxSignalCount: requireSafeInteger(record.mailboxSignalCount),
    manualRunRequested: requireBoolean(record.manualRunRequested),
    sameRuntimeWakeAcceptedCount: readOptionalSafeInteger(
      record.sameRuntimeWakeAcceptedCount,
      0,
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

function readNullableObservabilityMailboxPointer(
  value: unknown,
): HostedRuntimeWorkflowState["latestMailboxPointer"] {
  try {
    return readNullableMailboxPointer(value);
  } catch {
    return null;
  }
}

function readNullableDemandKind(value: unknown): HostedRuntimeDemandKind | null {
  if (value === null) {
    return null;
  }

  const kind = requireString(value);
  if (HOSTED_RUNTIME_DEMAND_KINDS.includes(kind as HostedRuntimeDemandKind)) {
    return kind as HostedRuntimeDemandKind;
  }

  return null;
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

  return null;
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
    HOSTED_RUNTIME_ENSURE_PROCESSING_RESPONSE_KINDS.includes(
      kind as HostedRuntimeEnsureProcessingResponseKind,
    )
  ) {
    return kind as HostedRuntimeEnsureProcessingResponseKind;
  }

  return null;
}

function readNullableLastRuntimeStatus(
  value: unknown,
): HostedRuntimeLastRuntimeStatus {
  if (value === null) {
    return null;
  }

  const status = requireString(value);
  if (status === "retry_later") {
    return status;
  }

  if (status === "scheduled") {
    return status as HostedRuntimeLastRuntimeStatus;
  }

  return null;
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

function readOptionalSafeInteger(value: unknown, fallback: number): number {
  return value === undefined ? fallback : requireSafeInteger(value);
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
