import type { HostedRuntimePlatform } from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  parseHostedRuntimeSubscriptionToolResponse,
} from "@murphai/hosted-execution/subscription";
import {
  HOSTED_RUNTIME_SUBSCRIPTION_TOOL_PATH,
} from "@murphai/hosted-execution/routes";

import {
  fetchHostedWebControlPlaneJson,
  type HostedWebControlTransport,
} from "./web-control-transport.ts";

export function createHostedRuntimeSubscriptionToolPort(input: {
  boundUserId: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  transport: HostedWebControlTransport;
}): NonNullable<HostedRuntimePlatform["subscriptionToolPort"]> {
  return {
    async request(request) {
      const payload = await fetchHostedWebControlPlaneJson({
        body: request,
        boundUserId: input.boundUserId,
        description: "Hosted subscription tool",
        fetchImpl: input.fetchImpl,
        path: HOSTED_RUNTIME_SUBSCRIPTION_TOOL_PATH,
        timeoutMs: input.timeoutMs,
        transport: input.transport,
      });

      try {
        return parseHostedRuntimeSubscriptionToolResponse(payload);
      } catch (error) {
        throw new Error("Hosted subscription tool returned invalid JSON.", {
          cause: error,
        });
      }
    },
  };
}
