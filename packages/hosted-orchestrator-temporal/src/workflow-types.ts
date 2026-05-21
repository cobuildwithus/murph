import type {
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
  ensureRuntimeProcessingStartToCloseTimeoutMs?: number;
  /** Legacy option accepted for in-flight workflow compatibility. */
  ensureCloudflareExecutionStartToCloseTimeoutMs?: number;
  readRuntimeDemandStartToCloseTimeoutMs?: number;
  runtimeCompletedFailureRecheckDelayMs?: number;
}
