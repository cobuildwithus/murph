import type { HostedRuntimePlatform } from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  parseHostedRuntimeAssistantConfigurationWebControlResponse,
  parseHostedRuntimeAssistantConfigurationToolResponse,
} from "@murphai/hosted-execution/parsers";
import type {
  HostedRuntimeAssistantConfigurationWebControlRequest,
} from "@murphai/hosted-execution/runtime-control";
import {
  HOSTED_RUNTIME_ASSISTANT_CONFIGURATION_TOOL_PATH,
} from "@murphai/hosted-execution/routes";

import {
  fetchHostedWebControlPlaneJson,
  type HostedWebControlTransport,
} from "./web-control-transport.ts";

export function createHostedRuntimeAssistantConfigurationToolPort(input: {
  boundUserId: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  transport: HostedWebControlTransport;
}): NonNullable<HostedRuntimePlatform["assistantConfigurationToolPort"]> {
  const requestWebControl = async (
    request: HostedRuntimeAssistantConfigurationWebControlRequest,
  ): Promise<unknown> => await fetchHostedWebControlPlaneJson({
    body: request,
    boundUserId: input.boundUserId,
    description: "Hosted assistant configuration tool",
    fetchImpl: input.fetchImpl,
    path: HOSTED_RUNTIME_ASSISTANT_CONFIGURATION_TOOL_PATH,
    timeoutMs: input.timeoutMs,
    transport: input.transport,
  });

  return {
    async readProviderAuthority() {
      const payload = await requestWebControl({
        action: "read_provider_authority",
      });
      try {
        const response = parseHostedRuntimeAssistantConfigurationWebControlResponse(
          payload,
        );
        if (response.action !== "read_provider_authority") {
          throw new TypeError("Hosted assistant provider authority response is invalid.");
        }
        return response.result;
      } catch (error) {
        throw new Error(
          "Hosted assistant configuration tool returned invalid JSON.",
          { cause: error },
        );
      }
    },
    async request(request) {
      const payload = await requestWebControl(request);
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
