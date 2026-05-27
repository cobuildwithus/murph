import type {
  HostedMailboxLane,
  HostedMailboxLaneLag,
  HostedWorkspaceInvocationReason,
  HostedWorkspaceInvocationStatus,
} from "./runtime-control.ts";

export const HOSTED_USER_RUNTIME_WORKFLOW_TYPE =
  "hostedUserRuntimeWorkflow" as const;

export const HOSTED_USER_RUNTIME_TASK_QUEUE =
  "murph-hosted-runtime" as const;

export const HOSTED_USER_RUNTIME_SIGNAL_NAME = "runtimeSignal" as const;

export const HOSTED_USER_RUNTIME_STATUS_QUERY_NAME =
  "runtimeWorkflowStatus" as const;

export const HOSTED_RUNTIME_SIGNAL_KINDS = [
  "mailbox_appended",
  "manual_run_requested",
  "browser_vault_refresh_requested",
  "device_sync_recovery_requested",
  "mailbox_lag_observed",
] as const;

export type HostedRuntimeSignalKind = (typeof HOSTED_RUNTIME_SIGNAL_KINDS)[number];

export type HostedRuntimeMailboxSignalSource = string;

export type HostedRuntimeSignal =
  | {
      kind: "mailbox_appended";
      mailboxItemId: string;
      lane: HostedMailboxLane;
      laneSeq: string;
      source: HostedRuntimeMailboxSignalSource;
    }
  | {
      kind: "manual_run_requested";
    }
  | {
      kind: "browser_vault_refresh_requested";
    }
  | {
      kind: "device_sync_recovery_requested";
    }
  | {
      kind: "mailbox_lag_observed";
    };

export interface HostedRuntimeMailboxPointer {
  mailboxItemId: string;
  lane: HostedMailboxLane;
  laneSeq: string;
  source: HostedRuntimeMailboxSignalSource;
}

export interface HostedRuntimeDemandRequest {
  browserVaultRefreshRequested?: boolean;
  deviceSyncRecoveryRequested?: boolean;
  ignoredWorkspaceWakeKey?: string | null;
  lagRecoveryObserved?: boolean;
  manualRunRequested?: boolean;
  /**
   * Legacy `ensure-execution` runtime-completion projection. Normal
   * `ensure-processing` orchestration observes durable web demand/status instead.
   */
  runtimeResultWakeAt?: string | null;
  /**
   * Legacy `ensure-execution` runtime-completion projection. Normal
   * `ensure-processing` orchestration observes durable web demand/status instead.
   */
  runtimeResultWakeReason?: string | null;
  userId: string;
}

export const HOSTED_RUNTIME_DEMAND_KINDS = [
  "run",
  "idle",
  "blocked",
] as const;

export type HostedRuntimeDemandKind = (typeof HOSTED_RUNTIME_DEMAND_KINDS)[number];

export const HOSTED_RUNTIME_DEMAND_RUN_SOURCES = [
  "mailbox_backlog",
  "manual",
  "browser_vault_refresh",
  "device_sync_recovery",
  "workspace_wake",
  "runtime_result_wake",
  "lag_recovery",
] as const;

export type HostedRuntimeDemandRunSource =
  (typeof HOSTED_RUNTIME_DEMAND_RUN_SOURCES)[number];

export const HOSTED_RUNTIME_DEMAND_BLOCKED_REASONS = [
  "ai_usage_denied",
  "ai_usage_gate_unavailable",
  "user_not_active",
  "hosted_runtime_not_configured",
] as const;

export type HostedRuntimeDemandBlockedReason =
  (typeof HOSTED_RUNTIME_DEMAND_BLOCKED_REASONS)[number];

export interface HostedRuntimeDemandWorkspaceProjection {
  nextWakeAt: string | null;
  nextWakeReason: string | null;
  version: string | null;
}

export type HostedRuntimeDemand =
  | {
      kind: "run";
      mailboxLag: HostedMailboxLaneLag[];
      reason: HostedWorkspaceInvocationReason;
      source: HostedRuntimeDemandRunSource;
      workspace: HostedRuntimeDemandWorkspaceProjection | null;
    }
  | {
      kind: "idle";
      mailboxLag: HostedMailboxLaneLag[];
      nextWakeAt: string | null;
      workspace: HostedRuntimeDemandWorkspaceProjection | null;
    }
  | {
      kind: "blocked";
      mailboxLag: HostedMailboxLaneLag[];
      reason: HostedRuntimeDemandBlockedReason;
      retryAt: string | null;
      workspace: HostedRuntimeDemandWorkspaceProjection | null;
    };

/**
 * @deprecated Legacy replay/deploy-skew command. New orchestration uses
 * `HostedRuntimeEnsureProcessingRequest`.
 */
export interface HostedRuntimeEnsureExecutionRequest {
  orchestrationAttemptId: string;
  reason: HostedWorkspaceInvocationReason;
}

export interface HostedRuntimeEnsureProcessingRequest
  extends HostedRuntimeEnsureExecutionRequest {
  source?: HostedRuntimeDemandRunSource | null;
}

export const HOSTED_RUNTIME_ENSURE_EXECUTION_RESPONSE_KINDS = [
  "runtime_completed",
  "runtime_wake_sent",
] as const;

export type HostedRuntimeEnsureExecutionResponseKind =
  (typeof HOSTED_RUNTIME_ENSURE_EXECUTION_RESPONSE_KINDS)[number];

/**
 * @deprecated Legacy replay/deploy-skew response. Normal `ensure-processing`
 * returns `HostedRuntimeEnsureProcessingResponse`.
 */
export type HostedRuntimeEnsureExecutionResponse =
  | {
      action: "started" | "replaced";
      kind: "runtime_completed";
      runtimeAttemptId: string;
      runtimeResultNextWakeAt: string | null;
      runtimeResultNextWakeReason: string | null;
      runtimeStatus: HostedWorkspaceInvocationStatus;
    }
  | {
      kind: "runtime_wake_sent";
      recommendedRecheckAt: string | null;
      runtimeAttemptId: string;
    };

export const HOSTED_RUNTIME_ENSURE_PROCESSING_RESPONSE_KINDS = [
  "runtime_processing_accepted",
  "retry_later",
] as const;

export type HostedRuntimeEnsureProcessingResponseKind =
  (typeof HOSTED_RUNTIME_ENSURE_PROCESSING_RESPONSE_KINDS)[number];

export const HOSTED_RUNTIME_PROCESSING_ACCEPTED_ACTIONS = [
  "started",
  "replaced",
  "woken",
  "already_running",
] as const;

export type HostedRuntimeProcessingAcceptedAction =
  (typeof HOSTED_RUNTIME_PROCESSING_ACCEPTED_ACTIONS)[number];

export type HostedRuntimeEnsureProcessingResponse =
  | {
      action: HostedRuntimeProcessingAcceptedAction;
      kind: "runtime_processing_accepted";
      recommendedRecheckAt: string;
      runtimeAttemptId: string;
    }
  | {
      kind: "retry_later";
      retryAt: string;
    };

export const HOSTED_RUNTIME_CURRENT_WAIT_REASONS = [
  "idle_next_wake",
  "blocked_retry",
  "demand_failure_retry",
  "execution_failure_retry",
  "processing_retry_later",
  "runtime_wake_recheck",
  "runtime_failed_recheck",
  "non_retryable_signal_only",
] as const;

export type HostedRuntimeCurrentWaitReason =
  | (typeof HOSTED_RUNTIME_CURRENT_WAIT_REASONS)[number]
  | null;

export type HostedRuntimeLastExecutionKind =
  | HostedRuntimeEnsureExecutionResponseKind
  | HostedRuntimeEnsureProcessingResponseKind
  | "failed"
  | null;

export type HostedRuntimeLastRuntimeStatus =
  | HostedWorkspaceInvocationStatus
  | "retry_later"
  | "scheduled"
  | null;

export interface HostedRuntimeWorkflowState {
  browserVaultRefreshRequested: boolean;
  currentWaitReason: HostedRuntimeCurrentWaitReason;
  currentWaitUntil: string | null;
  deviceSyncRecoveryRequested: boolean;
  ignoredWorkspaceWakeKey: string | null;
  invalidSignalCount: number;
  lagRecoveryObserved: boolean;
  lastOrchestrationAttemptId: string | null;
  lastInvalidSignalErrorCode: string | null;
  lastDemandKind: HostedRuntimeDemandKind | null;
  lastDemandNextWakeAt: string | null;
  lastDemandSource: string | null;
  lastExecutionAt: string | null;
  lastExecutionErrorCode: string | null;
  lastExecutionKind: HostedRuntimeLastExecutionKind;
  lastMailboxLagLaneCount: number;
  lastRuntimeAttemptId: string | null;
  lastRuntimeStatus: HostedRuntimeLastRuntimeStatus;
  latestMailboxPointer: HostedRuntimeMailboxPointer | null;
  mailboxSignalCount: number;
  manualRunRequested: boolean;
  legacyRuntimeFailedWithoutNextWakeCount: number;
  /**
   * Legacy `ensure-execution` runtime-completion projection. Normal
   * `ensure-processing` orchestration observes durable web demand/status instead.
   */
  runtimeResultWakeAt: string | null;
  /**
   * Legacy `ensure-execution` runtime-completion projection. Normal
   * `ensure-processing` orchestration observes durable web demand/status instead.
   */
  runtimeResultWakeReason: string | null;
  sameRuntimeWakeAcceptedCount: number;
  signalVersion: number;
  userId: string;
}
