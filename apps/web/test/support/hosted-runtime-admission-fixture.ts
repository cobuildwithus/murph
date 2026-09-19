import type { HostedRuntimeOwnerResponse } from "@murphai/hosted-execution/runtime-owner";

export function runtimeAdmission(userId: string, attemptId = "runtime-attempt-test"): HostedRuntimeOwnerResponse {
  return {
    cutover: "postgres", status: "existing",
    owner: {
      userId, attemptId, generation: "1", phase: "active", processingMode: "default",
      allocationId: "standby-claim-11111111-1111-4111-8111-111111111111",
      runnerContainerName: `runner--v-release_1--${"1".repeat(32)}`, workspaceVersion: "0",
      customInferenceEnvelope: null, platformAiUsageAllowed: true,
      startedAt: "2026-01-01T00:00:00.000Z", acceptedAt: null, completedAt: null,
      failureCount: 0, lastErrorCode: null,
    },
  };
}
