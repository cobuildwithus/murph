import { vi } from "vitest";
import type { HostedRuntimeOwnerSnapshot } from "@murphai/hosted-execution/runtime-owner";
import * as runtimeOwnerClient from "../src/runtime-owner-client.ts";

export function createPostgresTestOwner(overrides: Partial<HostedRuntimeOwnerSnapshot> = {}): HostedRuntimeOwnerSnapshot {
  return {
    userId: "member_123", attemptId: "attempt_1", generation: "7", workspaceVersion: "4",
    phase: "active", processingMode: "default", allocationId: "synthetic-allocation",
    runnerContainerName: "member_123--v-test", customInferenceEnvelope: null,
    platformAiUsageAllowed: true, startedAt: null, acceptedAt: null, completedAt: null,
    failureCount: 0, lastErrorCode: null, ...overrides,
  };
}

/** Supply only the canonical Web owner boundary; provider HTTP and request
 * validation remain real. Native settlement behavior has its own composed suite. */
export function mockPostgresOwnerCommand(
  implementation: typeof runtimeOwnerClient.commandHostedRuntimeOwner,
) {
  return vi.spyOn(runtimeOwnerClient, "commandHostedRuntimeOwner").mockImplementation(implementation);
}

export const forbiddenLegacyRuntime = {
  getByName(): never { throw new Error("Normal runtime requests must not access the retired namespace."); },
};

export const settledNativeRuntime = {
  runtimeUsageSettlementAllowsProviders: async () => true,
  beginRuntimeUsageSettlement: async () => true,
  finishRuntimeUsageSettlement: async () => {},
};
