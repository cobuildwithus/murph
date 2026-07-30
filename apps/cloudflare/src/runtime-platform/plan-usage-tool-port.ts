import type { HostedRuntimePlatform } from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  parseHostedPlanUsageStatus,
} from "@murphai/hosted-execution/plan-usage";
import {
  HOSTED_RUNTIME_PLAN_USAGE_TOOL_PATH,
} from "@murphai/hosted-execution/routes";

import {
  fetchHostedWebControlPlaneJson,
  type HostedWebControlTransport,
} from "./web-control-transport.ts";

export function createHostedRuntimePlanUsageToolPort(input: {
  boundUserId: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  transport: HostedWebControlTransport;
}): NonNullable<HostedRuntimePlatform["planUsageToolPort"]> {
  return {
    async read(request) {
      const payload = await fetchHostedWebControlPlaneJson({
        body: {
          includeSubscriptionActionQuote: true,
          ...(request.includeTopUpHistory
            ? { includeTopUpHistory: true }
            : {}),
        },
        boundUserId: input.boundUserId,
        description: "Hosted plan usage tool",
        fetchImpl: input.fetchImpl,
        path: HOSTED_RUNTIME_PLAN_USAGE_TOOL_PATH,
        timeoutMs: input.timeoutMs,
        transport: input.transport,
      });

      try {
        return parseHostedPlanUsageStatus(payload);
      } catch (error) {
        throw new Error("Hosted plan usage tool returned invalid JSON.", {
          cause: error,
        });
      }
    },
  };
}
