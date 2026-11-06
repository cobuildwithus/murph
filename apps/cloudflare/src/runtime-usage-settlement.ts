import type { RunnerOutboundEnvironmentSource } from "./runner-outbound/shared.ts";
import type { RunnerRuntimeWriteFenceHeaders } from "./runner-outbound/write-fence.ts";
import { commandHostedRuntimeOwner } from "./runtime-owner-client.ts";
import { readNativeRuntimeProviderContainer, type RuntimeProviderCaller } from "./runtime-provider-authorization.ts";

/** Persist the native negative receipt before any fallible Web request. The
 * signed usage callback owns canonical authorization and ledger mutation. */
export async function beginHostedRuntimeUsageSettlement(input: {
  caller?: RuntimeProviderCaller; env: RunnerOutboundEnvironmentSource; userId: string; authority: RunnerRuntimeWriteFenceHeaders; reportId: string;
}): Promise<{ finish(allowed: boolean): Promise<void> }> {
  const identity = { userId: input.userId, attemptId: input.authority.attemptId, generation: input.authority.generation };
  const container = readNativeRuntimeProviderContainer(input.env, input.caller);
  if (!container?.beginRuntimeUsageSettlement || !container.finishRuntimeUsageSettlement) throw new Error("Native usage settlement receipts are unavailable.");
  const receipt = { ...identity, reportId: input.reportId };
  if (!await container.beginRuntimeUsageSettlement(receipt)) throw new Error("Native usage settlement receipt was rejected.");
  return {
    async finish(allowed) {
      // Denial is terminal and lands before Web is told to revoke, so a replay
      // can settle the ledger but cannot reopen this generation.
      await container.finishRuntimeUsageSettlement!({ ...receipt, allowed });
      if (!allowed) {
        await commandHostedRuntimeOwner({ source: input.env, userId: input.userId, command: { operation: "revoke_ai_usage", ...identity } });
      }
    },
  };
}
