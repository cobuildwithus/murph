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
  "runtime_recheck_requested",
  "runtime_prewarm_requested",
] as const;

export type HostedRuntimeSignalKind = (typeof HOSTED_RUNTIME_SIGNAL_KINDS)[number];

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
}

export const HOSTED_RUNTIME_RECONCILIATION_BLOCKED_REASONS = [
  "ai_usage_denied",
  "ai_usage_gate_unavailable",
  "hosted_runtime_not_configured",
  "user_not_active",
] as const;

export type HostedRuntimeReconciliationBlockedReason =
  (typeof HOSTED_RUNTIME_RECONCILIATION_BLOCKED_REASONS)[number];

export interface HostedRuntimeReconciliationFactsRequest {
  userId: string;
}

export interface HostedRuntimeReconciliationFactsWorkspace {
  nextWakeAt: string | null;
  nextWakeReason: string | null;
  version: string | null;
}

export interface HostedRuntimeReconciliationFactsBlocked {
  reason: HostedRuntimeReconciliationBlockedReason;
  retryAt: string | null;
}

export interface HostedRuntimeReconciliationFacts {
  blocked: HostedRuntimeReconciliationFactsBlocked | null;
  mailboxLag: HostedMailboxLaneLag[];
  workspace: HostedRuntimeReconciliationFactsWorkspace | null;
}

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
  "reconciliation_failure_retry",
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

export const HOSTED_RUNTIME_RECONCILIATION_STATUSES = [
  "blocked",
  "idle",
  "work_pending",
] as const;

export type HostedRuntimeReconciliationStatus =
  (typeof HOSTED_RUNTIME_RECONCILIATION_STATUSES)[number];

export interface HostedRuntimeWorkflowState {
  currentWaitReason: HostedRuntimeCurrentWaitReason;
  currentWaitUntil: string | null;
  invalidSignalCount: number;
  lastOrchestrationAttemptId: string | null;
  lastInvalidSignalErrorCode: string | null;
  lastExecutionAt: string | null;
  lastExecutionErrorCode: string | null;
  lastExecutionKind: HostedRuntimeLastExecutionKind;
  lastMailboxLagLaneCount: number;
  lastReconciliationBlockedReason: HostedRuntimeReconciliationBlockedReason | null;
  lastReconciliationNextWakeAt: string | null;
  lastReconciliationStatus: HostedRuntimeReconciliationStatus | null;
  lastRuntimeAttemptId: string | null;
  lastRuntimeStatus: HostedRuntimeLastRuntimeStatus;
  latestMailboxPointer: HostedRuntimeMailboxPointer | null;
  latestPrewarmRequestedAt: string | null;
  mailboxSignalCount: number;
  lastPrewarmAttemptId: string | null;
  lastPrewarmErrorCode: string | null;
  lastPrewarmResult: HostedRuntimeLastPrewarmResult;
  prewarmRequested: boolean;
  prewarmSignalCount: number;
  signalVersion: number;
  userId: string;
}
