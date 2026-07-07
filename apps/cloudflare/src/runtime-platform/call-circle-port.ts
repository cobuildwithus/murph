import type { HostedRuntimePlatform } from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  HOSTED_CALL_CIRCLE_RESPOND_PATH,
  hostedCallCircleRespondResponseSchema,
} from "@murphai/hosted-execution/call-circle";

import {
  fetchHostedWebControlPlaneJson,
  type HostedWebControlTransport,
} from "./web-control-transport.ts";

export function createHostedWebCallCirclePort(input: {
  boundUserId: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  transport: HostedWebControlTransport;
}): NonNullable<HostedRuntimePlatform["callCircle"]> {
  return {
    async respond(request, options) {
      const inboundMailboxItemIds = options?.inboundMailboxItemIds ?? [];
      const response = await fetchHostedWebControlPlaneJson({
        body: inboundMailboxItemIds.length > 0
          ? {
              context: {
                inboundMailboxItemIds: [...inboundMailboxItemIds],
              },
              request,
            }
          : request,
        boundUserId: input.boundUserId,
        description: "Hosted Call Circle response",
        fetchImpl: input.fetchImpl,
        method: "POST",
        path: HOSTED_CALL_CIRCLE_RESPOND_PATH,
        signal: options?.signal ?? null,
        timeoutMs: input.timeoutMs,
        transport: input.transport,
      });

      return hostedCallCircleRespondResponseSchema.parse(response);
    },
  };
}
