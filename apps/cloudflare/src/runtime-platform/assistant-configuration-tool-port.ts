import type { HostedRuntimePlatform } from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  parseHostedRuntimeAssistantConfigurationToolResponse,
} from "@murphai/hosted-execution/parsers";
import {
  fetchHostedWebControlPlaneJson,
  HOSTED_RUNNER_WEB_CONTROL_ROUTES,
  type HostedWebControlTransport,
} from "./web-control-transport.ts";

export function createHostedRuntimeAssistantConfigurationToolPort(input: {
  boundUserId: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  transport: HostedWebControlTransport;
}): NonNullable<HostedRuntimePlatform["assistantConfigurationToolPort"]> {
  return {
    async request(request) {
      const payload = await fetchHostedWebControlPlaneJson({
        body: request,
        boundUserId: input.boundUserId,
        description: "Hosted assistant configuration tool",
        fetchImpl: input.fetchImpl,
        route: HOSTED_RUNNER_WEB_CONTROL_ROUTES.assistantConfigurationTool,
        timeoutMs: input.timeoutMs,
        transport: input.transport,
      });

      try {
        return parseHostedRuntimeAssistantConfigurationToolResponse(payload);
      } catch (error) {
        throw new Error(
          "Hosted assistant configuration tool returned invalid JSON.",
          { cause: error },
        );
      }
    },
  };
}
