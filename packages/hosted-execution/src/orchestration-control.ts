import type {
  HostedMailboxLane,
  HostedMailboxLaneLag,
  HostedWorkspaceInvocationReason,
} from "./runtime-control.ts";

export const HOSTED_USER_RUNTIME_WORKFLOW_TYPE =
  "hostedUserRuntimeWorkflow" as const;

export const HOSTED_USER_RUNTIME_TASK_QUEUE =
  "murph-hosted-runtime" as const;
export const HOSTED_USER_RUNTIME_PREWARM_TASK_QUEUE =
  "murph-hosted-runtime-prewarm" as const;

export const HOSTED_USER_RUNTIME_SIGNAL_NAME = "runtimeSignal" as const;

export const HOSTED_USER_RUNTIME_STATUS_QUERY_NAME =
  "runtimeWorkflowStatus" as const;

export function deriveHostedUserRuntimePrewarmTaskQueue(
  taskQueue: string,
): string {
  const normalized = taskQueue.trim();
  if (!normalized || normalized === HOSTED_USER_RUNTIME_TASK_QUEUE) {
    return HOSTED_USER_RUNTIME_PREWARM_TASK_QUEUE;
  }
  return `${normalized}-prewarm`;
}

export const HOSTED_RUNTIME_SIGNAL_KINDS = [
  "mailbox_appended",
  "manual_run_requested",
  "browser_vault_refresh_requested",
  "mailbox_lag_observed",
  "runtime_recheck_requested",
  "runtime_prewarm_requested",
] as const;

export type HostedRuntimeSignalKind = (typeof HOSTED_RUNTIME_SIGNAL_KINDS)[number];

export type HostedRuntimeMailboxSignalSource = string;

export const HOSTED_RUNTIME_PREWARM_SOURCE =
  "linq.imessage.typing" as const;

export const HOSTED_RUNTIME_PREWARM_SOURCES = [
  HOSTED_RUNTIME_PREWARM_SOURCE,
] as const;

export type HostedRuntimePrewarmSource =
  (typeof HOSTED_RUNTIME_PREWARM_SOURCES)[number];

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
      kind: "mailbox_lag_observed";
    }
  | {
      kind: "runtime_recheck_requested";
    }
  | {
      eventId: string;
      kind: "runtime_prewarm_requested";
      occurredAt: string;
      source: HostedRuntimePrewarmSource;
    };

export interface HostedRuntimeMailboxPointer {
  mailboxItemId: string;
  lane: HostedMailboxLane;
  laneSeq: string;
  source: HostedRuntimeMailboxSignalSource;
}

export interface HostedRuntimeDemandRequest {
  browserVaultRefreshRequested?: boolean;
  lagRecoveryObserved?: boolean;
  manualRunRequested?: boolean;
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
  "workspace_wake",
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

export interface HostedRuntimeEnsureProcessingRequest {
  orchestrationAttemptId: string;
  reason: HostedWorkspaceInvocationReason;
}

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

export interface HostedRuntimePrewarmRequest {
  prewarmAttemptId: string;
  source: HostedRuntimePrewarmSource;
}

export const HOSTED_RUNTIME_PREWARM_RESPONSE_KINDS = [
  "runtime_prewarm_accepted",
  "retry_later",
] as const;

export type HostedRuntimePrewarmResponseKind =
  (typeof HOSTED_RUNTIME_PREWARM_RESPONSE_KINDS)[number];

export const HOSTED_RUNTIME_PREWARM_ACCEPTED_ACTIONS = [
  "started",
  "already_warm",
  "already_running",
] as const;

export type HostedRuntimePrewarmAcceptedAction =
  (typeof HOSTED_RUNTIME_PREWARM_ACCEPTED_ACTIONS)[number];

export type HostedRuntimePrewarmResponse =
  | {
      action: HostedRuntimePrewarmAcceptedAction;
      kind: "runtime_prewarm_accepted";
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
  "non_retryable_signal_only",
] as const;

export type HostedRuntimeCurrentWaitReason =
  | (typeof HOSTED_RUNTIME_CURRENT_WAIT_REASONS)[number]
  | null;

export type HostedRuntimeLastExecutionKind =
  | HostedRuntimeEnsureProcessingResponseKind
  | "failed"
  | null;

export type HostedRuntimeLastRuntimeStatus =
  | "retry_later"
  | "scheduled"
  | null;

export type HostedRuntimeLastPrewarmResult =
  | "accepted"
  | "retry_later"
  | "failed"
  | null;

export interface HostedRuntimeWorkflowState {
  browserVaultRefreshRequested: boolean;
  currentWaitReason: HostedRuntimeCurrentWaitReason;
  currentWaitUntil: string | null;
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
  latestPrewarmRequestedAt: string | null;
  mailboxSignalCount: number;
  manualRunRequested: boolean;
  lastPrewarmAttemptId: string | null;
  lastPrewarmErrorCode: string | null;
  lastPrewarmResult: HostedRuntimeLastPrewarmResult;
  prewarmRequested: boolean;
  prewarmSignalCount: number;
  signalVersion: number;
  userId: string;
}
