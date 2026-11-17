import { emitHostedExecutionStructuredLog } from "@murphai/hosted-execution";
import { commandHostedRuntimeOwner } from "./runtime-owner-client.ts";
import { obsoleteRuntimeCompletionReason, type HostedRuntimeCompletionReceipt } from "./runtime-completion-receipt.ts";

export async function recordHostedRuntimeOwnerCompletion(input: {
  source: Readonly<Record<string, unknown>>;
  userId: string;
  attemptId: string;
  generation: string;
  /** Set only after the native invocation operation itself has settled. A
   * runtime callback alone does not prove that the outer operation is gone. */
  settledRunnerContainerName?: string;
}): Promise<HostedRuntimeCompletionReceipt> {
  let outcome: "updated" | "not_updated" | "unconfirmed" = "unconfirmed";
  try {
    const completed = await commandHostedRuntimeOwner({
      source: input.source, userId: input.userId,
      command: { operation: "complete", attemptId: input.attemptId, generation: input.generation,
        settledRunnerContainerName: input.settledRunnerContainerName ?? null,
        // Web ignores it, but its parser and live protocol admission still require the boolean.
        immediateRecheckRequested: false },
    });
    const updated = completed.status === "updated";
    // Canonical acknowledgment only, not proof of downstream delivery.
    outcome = updated ? "updated" : "not_updated";
    return updated ? { completed: true } : {
      completed: false,
      reason: completed.status === "stale"
        ? obsoleteRuntimeCompletionReason(completed.owner, input.generation) ?? "canonical_completion_rejected"
        : "canonical_completion_rejected",
    };
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
      // Diagnostics cannot replace the receipt or the original failure.
    }
  }
}
