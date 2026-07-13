import type { HostedRuntimePlatform } from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  HOSTED_RUNTIME_BILLING_CONTROL_TIMEOUT_MS,
  HOSTED_RUNTIME_FAMILY_PLAN_CONTRACT_VERSION,
} from "@murphai/hosted-execution/runtime-control";
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
  transport: HostedWebControlTransport;
}): NonNullable<HostedRuntimePlatform["familyPlanToolPort"]> {
  return {
    async request(request) {
      const payload = await fetchHostedWebControlPlaneJson({
        body: {
          ...request,
          contractVersion: HOSTED_RUNTIME_FAMILY_PLAN_CONTRACT_VERSION,
        },
        boundUserId: input.boundUserId,
        description: "Hosted family plan tool",
        fetchImpl: input.fetchImpl,
        path: HOSTED_RUNTIME_FAMILY_PLAN_TOOL_PATH,
        timeoutMs: HOSTED_RUNTIME_BILLING_CONTROL_TIMEOUT_MS,
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
