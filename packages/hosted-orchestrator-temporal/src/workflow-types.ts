import type {
  HostedRuntimeWorkflowState,
} from "@murphai/hosted-execution/orchestration-control";

export const HOSTED_DEVICE_SYNC_RECONCILER_WORKFLOW_TYPE =
  "hostedDeviceSyncReconcilerWorkflow" as const;
export const HOSTED_DEVICE_SYNC_RECONCILER_DEFAULT_ACTIVITY_START_TO_CLOSE_TIMEOUT_MS = 60_000;
export const HOSTED_DEVICE_SYNC_RECONCILER_MAX_ACTIVITY_START_TO_CLOSE_TIMEOUT_MS = 300_000;
export const HOSTED_DEVICE_SYNC_RECONCILER_MIN_ACTIVITY_START_TO_CLOSE_TIMEOUT_MS = 1_000;

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
  continueAsNewAfterHistoryEvents?: number;
  continueAsNewAfterIterations?: number;
  ensureRuntimeProcessingStartToCloseTimeoutMs?: number;
  prewarmTaskQueue?: string;
  readRuntimeReconciliationFactsStartToCloseTimeoutMs?: number;
}

export interface HostedDeviceSyncReconcilerWorkflowInput {
  options?: HostedDeviceSyncReconcilerWorkflowOptions;
}

export interface HostedDeviceSyncReconcilerWorkflowOptions {
  recoverySweepStartToCloseTimeoutMs?: number;
}
