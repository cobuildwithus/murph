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
  ensureCloudflareExecutionStartToCloseTimeoutMs?: number;
  readRuntimeDemandStartToCloseTimeoutMs?: number;
}
