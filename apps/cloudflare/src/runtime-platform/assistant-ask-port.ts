import type { HostedRuntimePlatform } from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  parseHostedRuntimeAssistantAskControlResponse,
} from "@murphai/hosted-execution/parsers";
import {
  HOSTED_RUNTIME_ASSISTANT_ASK_CONTROL_PATH,
} from "@murphai/hosted-execution/routes";

import {
  fetchHostedWebControlPlaneJson,
  type HostedWebControlTransport,
} from "./web-control-transport.ts";

const HOSTED_RUNTIME_ASSISTANT_ASK_RESPONSE_MAX_BYTES = 8_192;

export function createHostedRuntimeAssistantAskPort(input: {
  boundUserId: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  transport: HostedWebControlTransport;
}): NonNullable<HostedRuntimePlatform["assistantAskPort"]> {
  return {
    async request(request, context) {
      const payload = await fetchHostedWebControlPlaneJson({
        body: request,
        boundUserId: input.boundUserId,
        description: "Hosted Assistant Ask control",
        fetchImpl: input.fetchImpl,
        path: HOSTED_RUNTIME_ASSISTANT_ASK_CONTROL_PATH,
        sensitiveResponseBody: {
          maxBytes: HOSTED_RUNTIME_ASSISTANT_ASK_RESPONSE_MAX_BYTES,
        },
        signal: context?.signal,
        timeoutMs: input.timeoutMs,
        transport: input.transport,
      });

      try {
        return parseHostedRuntimeAssistantAskControlResponse(payload);
      } catch (error) {
        throw new Error("Hosted Assistant Ask control returned invalid JSON.", {
          cause: error,
        });
      }
    },
  };
}
