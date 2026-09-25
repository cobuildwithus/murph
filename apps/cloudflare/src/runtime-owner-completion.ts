import type { HostedWorkspaceInvocationResult } from "@murphai/hosted-execution/runtime-control";
import { commandHostedRuntimeOwner } from "./runtime-owner-client.ts";

export async function recordHostedRuntimeOwnerCompletion(input: {
  source: Readonly<Record<string, unknown>>;
  userId: string;
  attemptId: string;
  generation: string;
  result: Pick<HostedWorkspaceInvocationResult, "immediateRecheckRequested">;
  /** Set only after the native invocation operation itself has settled. A
   * runtime callback alone does not prove that the outer operation is gone. */
  settledRunnerContainerName?: string;
}): Promise<boolean> {
  const completed = await commandHostedRuntimeOwner({
    source: input.source, userId: input.userId,
    command: { operation: "complete", attemptId: input.attemptId, generation: input.generation,
      settledRunnerContainerName: input.settledRunnerContainerName ?? null,
      immediateRecheckRequested: input.result.immediateRecheckRequested === true },
  });
  return completed.status === "updated";
}
