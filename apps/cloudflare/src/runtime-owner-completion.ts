import { buildHostedRuntimeOwnerReleaseSearch, HOSTED_RUNTIME_OWNER_RELEASED_PATH } from "@murphai/hosted-execution/routes";
import type { HostedWorkspaceInvocationResult } from "@murphai/hosted-execution/runtime-control";
import { readHostedExecutionEnvironment } from "./env.ts";
import { asWorkerStringEnvironment } from "./worker-contracts.ts";
import { commandHostedRuntimeOwner } from "./runtime-owner-client.ts";
import { fetchHostedExecutionWebControlPlaneResponse } from "./web-control-plane.ts";

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
  const retired = await commandHostedRuntimeOwner({
    source: input.source, userId: input.userId,
    command: { operation: "retire", attemptId: input.attemptId, generation: input.generation, completed: true },
  });
  if (retired.status !== "updated") return false;
  if (input.settledRunnerContainerName) {
    const released = await commandHostedRuntimeOwner({
      source: input.source, userId: input.userId,
      command: { operation: "release_completed", attemptId: input.attemptId,
        generation: input.generation, runnerContainerName: input.settledRunnerContainerName },
    });
    if (released.status !== "updated") return false;
  }
  const environment = readHostedExecutionEnvironment(asWorkerStringEnvironment(input.source));
  if (!environment.hostedWebBaseUrl) throw new Error("Hosted runtime owner URL is not configured.");
  // Scheduling remains Temporal-owned. A failed hint is recovered by its
  // existing accepted-attempt recheck; ownership changes are already durable.
  try {
    await fetchHostedExecutionWebControlPlaneResponse({
      baseUrl: environment.hostedWebBaseUrl,
      allowHttpHosts: environment.hostedWebAllowHttpHosts,
      callbackSigning: environment.webCallbackSigning,
      boundUserId: input.userId, method: "POST", path: HOSTED_RUNTIME_OWNER_RELEASED_PATH,
      search: buildHostedRuntimeOwnerReleaseSearch({
        runtimeAttemptId: input.attemptId,
        immediateRecheckRequested: input.result.immediateRecheckRequested === true,
      }),
      timeoutMs: Math.min(2_000, environment.webControlTimeoutMs),
    });
  } catch {
    // Keep the successful completion receipt even when this advisory hint fails.
  }
  return true;
}
