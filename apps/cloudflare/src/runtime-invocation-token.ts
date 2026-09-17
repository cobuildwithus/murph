import type { HostedWorkspaceInvocationProcessingMode } from "@murphai/hosted-execution/runtime-control";

export interface RunnerWriteFenceToken {
  attemptId: string;
  generation: string;
  kind: "runtime";
  processingMode: HostedWorkspaceInvocationProcessingMode;
  providerEgressToken: string | null;
  runnerContainerName: string | null;
  startedAt: string;
  userId: string;
  workspaceVersion: string | null;
}
