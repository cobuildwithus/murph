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
  runtimeResultWakeAt?: string | null;
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

export interface HostedRuntimeEnsureExecutionRequest {
  orchestrationAttemptId: string;
  reason: HostedWorkspaceInvocationReason;
}

export const HOSTED_RUNTIME_ENSURE_EXECUTION_RESPONSE_KINDS = [
  "runtime_completed",
  "runtime_wake_sent",
] as const;

export type HostedRuntimeEnsureExecutionResponseKind =
  (typeof HOSTED_RUNTIME_ENSURE_EXECUTION_RESPONSE_KINDS)[number];

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

export interface HostedRuntimeWorkflowState {
  browserVaultRefreshRequested: boolean;
  deviceSyncRecoveryRequested: boolean;
  ignoredWorkspaceWakeKey: string | null;
  lagRecoveryObserved: boolean;
  lastDemandKind: HostedRuntimeDemandKind | null;
  lastDemandNextWakeAt: string | null;
  lastDemandSource: string | null;
  lastExecutionAt: string | null;
  lastExecutionErrorCode: string | null;
  lastExecutionKind: HostedRuntimeEnsureExecutionResponseKind | "failed" | null;
  lastMailboxLagLaneCount: number;
  latestMailboxPointer: HostedRuntimeMailboxPointer | null;
  mailboxSignalCount: number;
  manualRunRequested: boolean;
  runtimeResultWakeAt: string | null;
  runtimeResultWakeReason: string | null;
  signalVersion: number;
  userId: string;
}
