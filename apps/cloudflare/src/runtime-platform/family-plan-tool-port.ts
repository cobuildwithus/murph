import type { HostedRuntimePlatform } from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  parseHostedRuntimeFamilyPlanToolResponse,
} from "@murphai/hosted-execution/parsers";
import {
  HOSTED_RUNTIME_FAMILY_PLAN_TOOL_PATH,
} from "@murphai/hosted-execution/routes";

import {
  fetchHostedWebControlPlaneJson,
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
      const payload = await fetchHostedWebControlPlaneJson({
        body: request,
        boundUserId: input.boundUserId,
        description: "Hosted family plan tool",
        fetchImpl: input.fetchImpl,
        path: HOSTED_RUNTIME_FAMILY_PLAN_TOOL_PATH,
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
