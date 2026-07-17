import type { HostedRuntimePlatform } from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  parseHostedRuntimeLabsToolResponse,
} from "@murphai/hosted-execution/labs";
import {
  HOSTED_RUNTIME_LABS_TOOL_PATH,
} from "@murphai/hosted-execution/routes";

import {
  fetchHostedWebControlPlaneJson,
  type HostedWebControlTransport,
} from "./web-control-transport.ts";

const HOSTED_LABS_TOOL_RESPONSE_MAX_BYTES = 128 * 1024;

export function createHostedRuntimeLabsToolPort(input: {
  boundUserId: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  transport: HostedWebControlTransport;
}): NonNullable<HostedRuntimePlatform["labsToolPort"]> {
  return {
    async request(request, context) {
      const payload = await fetchHostedWebControlPlaneJson({
        body: request,
        boundUserId: input.boundUserId,
        description: "Hosted labs tool",
        fetchImpl: input.fetchImpl,
        method: "POST",
        path: HOSTED_RUNTIME_LABS_TOOL_PATH,
        sensitiveResponseBody: {
          maxBytes: HOSTED_LABS_TOOL_RESPONSE_MAX_BYTES,
        },
        signal: context?.signal ?? null,
        timeoutMs: input.timeoutMs,
        transport: input.transport,
      });

      try {
        return parseHostedRuntimeLabsToolResponse(payload);
      } catch {
        throw new Error("Hosted labs tool returned invalid JSON.");
      }
    },
  };
}
