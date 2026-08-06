import type { HostedRuntimePlatform } from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  HOSTED_RUNTIME_ASSISTANT_PERSONALIZATION_TOOL_PATH,
  parseHostedRuntimeAssistantPersonalizationToolResponse,
  type HostedRuntimeAssistantPersonalizationToolAuthority,
} from "@murphai/hosted-execution/assistant-personalization";

import {
  fetchHostedWebControlPlaneJson,
  type HostedWebControlTransport,
} from "./web-control-transport.ts";

export function createHostedRuntimeAssistantPersonalizationToolPort(input: {
  boundUserId: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  transport: HostedWebControlTransport;
}): NonNullable<HostedRuntimePlatform["assistantPersonalizationToolPort"]> {
  return {
    async request(request, authority) {
      const payload = await fetchHostedWebControlPlaneJson({
        body: request,
        boundUserId: input.boundUserId,
        description: "Hosted assistant personalization tool",
        fetchImpl: input.fetchImpl,
        path: authority
          ? buildAssistantPersonalizationAuthorityPath(authority)
          : HOSTED_RUNTIME_ASSISTANT_PERSONALIZATION_TOOL_PATH,
        timeoutMs: input.timeoutMs,
        transport: input.transport,
      });

      try {
        return parseHostedRuntimeAssistantPersonalizationToolResponse(payload);
      } catch (error) {
        throw new Error(
          "Hosted assistant personalization tool returned invalid JSON.",
          { cause: error },
        );
      }
    },
  };
}

function buildAssistantPersonalizationAuthorityPath(
  authority: HostedRuntimeAssistantPersonalizationToolAuthority,
): string {
  if ('assistantInputId' in authority) {
    return `${HOSTED_RUNTIME_ASSISTANT_PERSONALIZATION_TOOL_PATH}?assistantInputId=${
      encodeURIComponent(authority.assistantInputId)
    }`;
  }
  const search = new URLSearchParams({
    automationId: authority.automationId,
    occurrenceAt: authority.occurrenceAt,
  });
  return `${HOSTED_RUNTIME_ASSISTANT_PERSONALIZATION_TOOL_PATH}?${search}`;
}
