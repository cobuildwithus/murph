import type { HostedRuntimePlatform } from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  parseHostedRuntimeNewsletterToolResponse,
} from "@murphai/hosted-execution/parsers";
import {
  HOSTED_RUNTIME_NEWSLETTER_TOOL_PATH,
} from "@murphai/hosted-execution/routes";

import {
  fetchHostedWebControlPlaneJson,
  type HostedWebControlTransport,
} from "./web-control-transport.ts";

export function createHostedRuntimeNewsletterToolPort(input: {
  boundUserId: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  transport: HostedWebControlTransport;
}): NonNullable<HostedRuntimePlatform["newsletterToolPort"]> {
  return {
    async request(request) {
      const payload = await fetchHostedWebControlPlaneJson({
        body: request,
        boundUserId: input.boundUserId,
        description: "Hosted newsletter tool",
        fetchImpl: input.fetchImpl,
        path: HOSTED_RUNTIME_NEWSLETTER_TOOL_PATH,
        timeoutMs: input.timeoutMs,
        transport: input.transport,
      });

      try {
        return parseHostedRuntimeNewsletterToolResponse(payload);
      } catch (error) {
        throw new Error("Hosted newsletter tool returned invalid JSON.", { cause: error });
      }
    },
  };
}
