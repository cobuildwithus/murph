import type { HostedRuntimePlatform } from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  parseHostedRuntimeLabsToolResponse,
} from "@murphai/hosted-execution/labs";
import {
  fetchHostedWebControlPlaneJson,
  HOSTED_RUNNER_WEB_CONTROL_ROUTES,
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
      context?.signal?.throwIfAborted();

      const payload = await fetchHostedWebControlPlaneJson({
        body: request,
        boundUserId: input.boundUserId,
        description: "Hosted labs tool",
        fetchImpl: input.fetchImpl,
        route: HOSTED_RUNNER_WEB_CONTROL_ROUTES.labsTool,
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
