import type { HostedRuntimePlatform } from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  parseHostedRuntimeIMessageContactToolResponse,
} from "@murphai/hosted-execution/parsers";
import {
  HOSTED_RUNTIME_IMESSAGE_CONTACT_TOOL_PATH,
} from "@murphai/hosted-execution/routes";

import {
  fetchHostedWebControlPlaneJson,
  type HostedWebControlTransport,
} from "./web-control-transport.ts";

export function createHostedRuntimeIMessageContactToolPort(input: {
  boundUserId: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  transport: HostedWebControlTransport;
}): NonNullable<HostedRuntimePlatform["imessageContactToolPort"]> {
  return {
    async ensure(request) {
      const payload = await fetchHostedWebControlPlaneJson({
        body: request,
        boundUserId: input.boundUserId,
        description: "Hosted iMessage contact tool",
        fetchImpl: input.fetchImpl,
        path: HOSTED_RUNTIME_IMESSAGE_CONTACT_TOOL_PATH,
        timeoutMs: input.timeoutMs,
        transport: input.transport,
      });

      try {
        return parseHostedRuntimeIMessageContactToolResponse(payload);
      } catch (error) {
        throw new Error("Hosted iMessage contact tool returned invalid JSON.", {
          cause: error,
        });
      }
    },
  };
}
