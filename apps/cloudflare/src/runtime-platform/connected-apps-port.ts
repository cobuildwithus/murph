import type { HostedRuntimePlatform } from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  HOSTED_CONNECTED_APPS_PATH,
  hostedConnectedAppsResponseSchema,
} from "@murphai/hosted-execution/connected-apps";

import {
  fetchHostedWebControlPlaneJson,
  type HostedWebControlTransport,
} from "./web-control-transport.ts";

export function createHostedWebConnectedAppsPort(input: {
  boundUserId: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  transport: HostedWebControlTransport;
}): NonNullable<HostedRuntimePlatform["connectedApps"]> {
  return {
    async request(request, options) {
      const response = await fetchHostedWebControlPlaneJson({
        body: request,
        boundUserId: input.boundUserId,
        description: "Hosted connected apps",
        fetchImpl: input.fetchImpl,
        method: "POST",
        path: HOSTED_CONNECTED_APPS_PATH,
        signal: options?.signal ?? null,
        timeoutMs: input.timeoutMs,
        transport: input.transport,
      });
      const parsed = hostedConnectedAppsResponseSchema.safeParse(response);
      if (!parsed.success) {
        throw new TypeError("Hosted connected apps returned an invalid response.");
      }
      return parsed.data;
    },
  };
}
