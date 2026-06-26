import type { HostedRuntimePlatform } from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  HOSTED_PHONE_CALLS_PATH,
  hostedPhoneCallStartResponseSchema,
} from "@murphai/hosted-execution/phone-calls";

import {
  fetchHostedWebControlPlaneJson,
  type HostedWebControlTransport,
} from "./web-control-transport.ts";

export function createHostedWebPhoneCallPort(input: {
  boundUserId: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  transport: HostedWebControlTransport;
}): NonNullable<HostedRuntimePlatform["phoneCalls"]> {
  return {
    async start(request, options) {
      const response = await fetchHostedWebControlPlaneJson({
        body: request,
        boundUserId: input.boundUserId,
        description: "Hosted phone call",
        fetchImpl: input.fetchImpl,
        method: "POST",
        path: HOSTED_PHONE_CALLS_PATH,
        signal: options?.signal ?? null,
        timeoutMs: input.timeoutMs,
        transport: input.transport,
      });

      return hostedPhoneCallStartResponseSchema.parse(response);
    },
  };
}
