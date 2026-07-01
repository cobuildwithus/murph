import type { HostedRuntimePlatform } from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  parseHostedRuntimeGroupToolResponse,
} from "@murphai/hosted-execution/parsers";
import {
  HOSTED_RUNTIME_GROUP_TOOL_PATH,
} from "@murphai/hosted-execution/routes";

import {
  fetchHostedWebControlPlaneJson,
  type HostedWebControlTransport,
} from "./web-control-transport.ts";

export function createHostedRuntimeGroupToolPort(input: {
  boundUserId: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  transport: HostedWebControlTransport;
}): NonNullable<HostedRuntimePlatform["groupToolPort"]> {
  return {
    async request(request) {
      const payload = await fetchHostedWebControlPlaneJson({
        body: request,
        boundUserId: input.boundUserId,
        description: "Hosted group tool",
        fetchImpl: input.fetchImpl,
        path: HOSTED_RUNTIME_GROUP_TOOL_PATH,
        timeoutMs: input.timeoutMs,
        transport: input.transport,
      });

      try {
        return parseHostedRuntimeGroupToolResponse(payload);
      } catch (error) {
        throw new Error("Hosted group tool returned invalid JSON.", { cause: error });
      }
    },
  };
}
