import type { HostedRuntimePlatform } from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  parseHostedPlanUsageStatus,
  type HostedPlanUsageToolRequest,
} from "@murphai/hosted-execution/plan-usage";
import {
  fetchHostedWebControlPlaneJson,
  HOSTED_RUNNER_WEB_CONTROL_ROUTES,
  type HostedWebControlTransport,
} from "./web-control-transport.ts";

export function createHostedRuntimePlanUsageToolPort(input: {
  boundUserId: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  transport: HostedWebControlTransport;
}): NonNullable<HostedRuntimePlatform["planUsageToolPort"]> {
  return {
    async read(request: HostedPlanUsageToolRequest) {
      const payload = await fetchHostedWebControlPlaneJson({
        body: request,
        boundUserId: input.boundUserId,
        description: "Hosted plan usage tool",
        fetchImpl: input.fetchImpl,
        route: HOSTED_RUNNER_WEB_CONTROL_ROUTES.planUsageTool,
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
