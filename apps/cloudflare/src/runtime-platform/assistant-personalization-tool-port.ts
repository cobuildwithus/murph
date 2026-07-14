import type { HostedRuntimePlatform } from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  HOSTED_RUNTIME_ASSISTANT_PREFERENCE_CAUSAL_SEQ_ACTION,
  HOSTED_RUNTIME_ASSISTANT_PERSONALIZATION_TOOL_PATH,
  parseHostedRuntimeAssistantPreferenceCausalSeqResponse,
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
    async resolvePreferenceCausalSeq(authority) {
      const payload = await fetchHostedWebControlPlaneJson({
        body: { action: HOSTED_RUNTIME_ASSISTANT_PREFERENCE_CAUSAL_SEQ_ACTION },
        boundUserId: input.boundUserId,
        description: "Hosted assistant preference causal sequence",
        fetchImpl: input.fetchImpl,
        path: buildAssistantPersonalizationAuthorityPath(authority),
        timeoutMs: input.timeoutMs,
        transport: input.transport,
      });

      try {
        return parseHostedRuntimeAssistantPreferenceCausalSeqResponse(payload)
          .result.causalSeq;
      } catch (error) {
        throw new Error(
          "Hosted assistant preference causal sequence returned invalid JSON.",
          { cause: error },
        );
      }
    },
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
  return `${HOSTED_RUNTIME_ASSISTANT_PERSONALIZATION_TOOL_PATH}?assistantInputId=${encodeURIComponent(authority.assistantInputId)}`;
}
