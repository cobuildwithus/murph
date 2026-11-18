import type { HostedRuntimePlatform } from "@murphai/assistant-runtime/hosted-runtime-contracts";
import { HOSTED_RUNTIME_FAMILY_PLAN_INVITE_IDS_PARAM } from "@murphai/hosted-execution/runtime-control";
import {
  parseHostedRuntimeFamilyPlanToolResponse,
} from "@murphai/hosted-execution/parsers";
import {
  bindHostedRunnerWebControlRoutePath,
  fetchHostedWebControlPlaneJson,
  HOSTED_RUNNER_WEB_CONTROL_ROUTES,
  type HostedWebControlTransport,
} from "./web-control-transport.ts";

export function createHostedRuntimeFamilyPlanToolPort(input: {
  boundUserId: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  transport: HostedWebControlTransport;
}): NonNullable<HostedRuntimePlatform["familyPlanToolPort"]> {
  return {
    async request(request) {
      const route = HOSTED_RUNNER_WEB_CONTROL_ROUTES.familyPlanTool;
      const payload = await fetchHostedWebControlPlaneJson({
        body: request,
        boundUserId: input.boundUserId,
        description: "Hosted family plan tool",
        fetchImpl: input.fetchImpl,
        // Older Web ignores the query and its status response simply has no IDs.
        route: request.action === "read_status"
          ? bindHostedRunnerWebControlRoutePath(route, `${route.path}?${HOSTED_RUNTIME_FAMILY_PLAN_INVITE_IDS_PARAM}=1`)
          : route,
        timeoutMs: input.timeoutMs,
        transport: input.transport,
      });

      try {
        return parseHostedRuntimeFamilyPlanToolResponse(payload);
      } catch (error) {
        throw new Error("Hosted family plan tool returned invalid JSON.", {
          cause: error,
        });
      }
    },
  };
}
