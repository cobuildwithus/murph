import type { HostedRuntimePlatform } from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  parseHostedRuntimeIMessageContactToolResponse,
} from "@murphai/hosted-execution/parsers";
import {
  fetchHostedWebControlPlaneJson,
  HOSTED_RUNNER_WEB_CONTROL_ROUTES,
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
        route: HOSTED_RUNNER_WEB_CONTROL_ROUTES.imessageContactTool,
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
