import { emitHostedExecutionStructuredLog } from "@murphai/hosted-execution";
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
  let outcome: "updated" | "not_updated" | "unconfirmed" = "unconfirmed";
  try {
    const completed = await commandHostedRuntimeOwner({
      source: input.source, userId: input.userId,
      command: { operation: "complete", attemptId: input.attemptId, generation: input.generation,
        settledRunnerContainerName: input.settledRunnerContainerName ?? null,
        immediateRecheckRequested: input.result.immediateRecheckRequested === true },
    });
    const updated = completed.status === "updated";
    // Canonical acknowledgment only, not proof of downstream delivery.
    outcome = updated ? "updated" : "not_updated";
    return updated;
  } finally {
    try {
      const caller: "runtime_callback" | "native_invocation" =
        input.settledRunnerContainerName === undefined ? "runtime_callback" : "native_invocation";
      emitHostedExecutionStructuredLog({
        component: "container", level: "info", phase: "checkpoint",
        message: "Hosted runtime canonical completion call settled.",
        userId: input.userId,
        details: {
          runtimeCompletionCaller: caller,
          runtimeCompletionOutcome: outcome,
          workspaceAttemptId: input.attemptId,
        },
      });
    } catch {
      // Diagnostics cannot replace the boolean result or the original failure.
    }
  }
}
