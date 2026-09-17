import type { HostedRuntimeOwnerCommand } from "@murphai/hosted-execution/runtime-owner";
import type { RunnerOutboundEnvironmentSource } from "./runner-outbound/shared.ts";
import { commandHostedRuntimeOwner } from "./runtime-owner-client.ts";
import { readRuntimeTargetAdapter } from "./runtime-target-adapter.ts";

export async function authorizePostgresRuntimeProvider(input: {
  env: RunnerOutboundEnvironmentSource; userId: string; command: Extract<HostedRuntimeOwnerCommand, { operation: "authorize_provider" | "authorize_effect" }>; managed: boolean;
}) {
  const response = await commandHostedRuntimeOwner({ source: input.env, userId: input.userId, command: input.command });
  const owner = response.owner;
  if (response.cutover !== "postgres" || response.status !== "authorized" || !owner?.attemptId || !owner.runnerContainerName || owner.workspaceVersion === null) return null;
  let settlementPending = false;
  if (input.managed && owner.platformAiUsageAllowed) {
    const container = readRuntimeTargetAdapter(input.env, owner.runnerContainerName);
    if (!container?.runtimeUsageSettlementAllowsProviders) throw new Error("Native usage settlement evidence is unavailable.");
    settlementPending = !await container.runtimeUsageSettlementAllowsProviders({ userId: input.userId, attemptId: owner.attemptId, generation: owner.generation });
  }
  return { owner, settlementPending };
}
