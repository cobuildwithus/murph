import type { RunnerOutboundEnvironmentSource } from "./runner-outbound/shared.ts";
import type { RunnerRuntimeWriteFenceHeaders } from "./runner-outbound/write-fence.ts";
import { commandHostedRuntimeOwner } from "./runtime-owner-client.ts";
import { readRuntimeTargetAdapter } from "./runtime-target-adapter.ts";

/** Usage needs an adapter-owned negative receipt before the settlement HTTP
 * request. This extra ownership interaction is specific to uncertain settlement;
 * ordinary Web callbacks authorize inside their existing Web operation. */
export async function beginHostedRuntimeUsageSettlement(input: {
  env: RunnerOutboundEnvironmentSource; userId: string; authority: RunnerRuntimeWriteFenceHeaders; reportId: string;
}): Promise<{ finish(allowed: boolean | null): Promise<void> }> {
  const identity = { userId: input.userId, attemptId: input.authority.attemptId, generation: input.authority.generation };
  const admission = await commandHostedRuntimeOwner({ source: input.env, userId: input.userId, command: { operation: "authorize_effect", ...identity, runnerContainerName: null, managedAi: false } });
  const target = admission.owner?.runnerContainerName;
  if (admission.status !== "authorized" || !target) throw new Error("Runtime usage settlement owner is stale.");
  const container = readRuntimeTargetAdapter(input.env, target);
  if (!container?.beginRuntimeUsageSettlement || !container.finishRuntimeUsageSettlement) throw new Error("Native usage settlement receipts are unavailable.");
  const receipt = { ...identity, reportId: input.reportId };
  if (!await container.beginRuntimeUsageSettlement(receipt)) throw new Error("Native usage settlement receipt was rejected.");
  return {
    async finish(allowed) {
      if (allowed !== null) await container.finishRuntimeUsageSettlement!({ ...receipt, allowed });
      if (allowed !== true) {
        // An outage cannot erase the pending native receipt. Once Web is
        // reachable, revocation becomes durable at the admission owner too.
        await commandHostedRuntimeOwner({ source: input.env, userId: input.userId, command: { operation: "revoke_ai_usage", ...identity } });
      }
    },
  };
}
