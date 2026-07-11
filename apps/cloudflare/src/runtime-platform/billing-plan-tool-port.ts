import type { HostedRuntimePlatform } from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  parseHostedRuntimeBillingPlanToolResponse,
} from "@murphai/hosted-execution/parsers";
import {
  HOSTED_RUNTIME_BILLING_PLAN_TOOL_PATH,
} from "@murphai/hosted-execution/routes";

import {
  fetchHostedWebControlPlaneJson,
  type HostedWebControlTransport,
} from "./web-control-transport.ts";

export function createHostedRuntimeBillingPlanToolPort(input: {
  boundUserId: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  transport: HostedWebControlTransport;
}): NonNullable<HostedRuntimePlatform["billingPlanToolPort"]> {
  return {
    async request(request) {
      const payload = await fetchHostedWebControlPlaneJson({
        body: request,
        boundUserId: input.boundUserId,
        description: "Hosted billing plan tool",
        fetchImpl: input.fetchImpl,
        path: HOSTED_RUNTIME_BILLING_PLAN_TOOL_PATH,
        timeoutMs: input.timeoutMs,
        transport: input.transport,
      });

      try {
        return parseHostedRuntimeBillingPlanToolResponse(payload);
      } catch (error) {
        throw new Error("Hosted billing plan tool returned invalid JSON.", {
          cause: error,
        });
      }
    },
  };
}
