import type { RunnerOutboundEnvironmentSource } from "./runner-outbound/shared.ts";
import type { RunnerRuntimeWriteFenceHeaders } from "./runner-outbound/write-fence.ts";
import { commandHostedRuntimeOwner } from "./runtime-owner-client.ts";
import { readNativeRuntimeProviderContainer, type RuntimeProviderCaller } from "./runtime-provider-authorization.ts";

/** Persist the native negative receipt before any fallible Web request. The
 * signed usage callback owns canonical authorization and ledger mutation. */
export async function beginHostedRuntimeUsageSettlement(input: {
  caller?: RuntimeProviderCaller; env: RunnerOutboundEnvironmentSource; userId: string; authority: RunnerRuntimeWriteFenceHeaders; reportId: string;
}): Promise<{ finish(allowed: boolean | null): Promise<void> }> {
  const identity = { userId: input.userId, attemptId: input.authority.attemptId, generation: input.authority.generation };
  const container = readNativeRuntimeProviderContainer(input.env, input.caller);
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
