import type {
  HostedRuntimeWorkflowState,
} from "@murphai/hosted-execution/orchestration-control";

export {
  HOSTED_RUNTIME_DEMAND_BLOCKED_REASONS,
  HOSTED_RUNTIME_DEMAND_KINDS,
  HOSTED_RUNTIME_DEMAND_RUN_SOURCES,
  HOSTED_RUNTIME_DEVICE_SYNC_RECOVERY_REASONS,
  HOSTED_RUNTIME_ENSURE_EXECUTION_RESPONSE_KINDS,
  HOSTED_RUNTIME_LAG_SIGNAL_SOURCES,
  HOSTED_RUNTIME_MANUAL_SIGNAL_SOURCES,
  HOSTED_RUNTIME_SIGNAL_KINDS,
  HOSTED_USER_RUNTIME_SIGNAL_NAME,
  HOSTED_USER_RUNTIME_STATUS_QUERY_NAME,
  HOSTED_USER_RUNTIME_TASK_QUEUE,
  HOSTED_USER_RUNTIME_WORKFLOW_TYPE,
} from "@murphai/hosted-execution/orchestration-control";

export type {
  HostedRuntimeDemand,
  HostedRuntimeDemandBlockedReason,
  HostedRuntimeDemandKind,
  HostedRuntimeDemandRequest,
  HostedRuntimeDemandRunSource,
  HostedRuntimeDemandWorkspaceProjection,
  HostedRuntimeDeviceSyncRecoveryReason,
  HostedRuntimeEnsureExecutionRequest,
  HostedRuntimeEnsureExecutionResponse,
  HostedRuntimeEnsureExecutionResponseKind,
  HostedRuntimeLagSignalSource,
  HostedRuntimeMailboxPointer,
  HostedRuntimeMailboxSignalSource,
  HostedRuntimeManualSignalSource,
  HostedRuntimeSignal,
  HostedRuntimeSignalKind,
  HostedRuntimeWorkflowState,
} from "@murphai/hosted-execution/orchestration-control";

export interface HostedUserRuntimeWorkflowInput {
  options?: HostedUserRuntimeWorkflowOptions;
  state?: HostedUserRuntimeWorkflowCarryForwardState;
  userId: string;
}

export type HostedUserRuntimeWorkflowCarryForwardState = Omit<
  HostedRuntimeWorkflowState,
  "userId"
>;

export interface HostedUserRuntimeWorkflowOptions {
  activeWakeRecheckDelayMs?: number;
  continueAsNewAfterIterations?: number;
}

export {
  readHostedRuntimeTemporalEnvironment,
} from "./temporal-env.js";
export type {
  HostedRuntimeTemporalEnvironment,
} from "./temporal-env.js";
