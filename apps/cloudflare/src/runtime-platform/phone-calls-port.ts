import type { HostedRuntimePlatform } from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  HOSTED_PHONE_CALLS_PATH,
  HOSTED_PHONE_CALL_STATUS_PATH,
  HOSTED_PHONE_CALL_START_TRANSPORT_TIMEOUT_MS,
  HOSTED_PHONE_CALL_STOP_PATH,
  hostedPhoneCallStatusResponseSchema,
  hostedPhoneCallStartResponseSchema,
  hostedPhoneCallStopResponseSchema,
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
    async stop(request, options) {
      const response = await fetchHostedWebControlPlaneJson({
        body: request,
        boundUserId: input.boundUserId,
        description: "Hosted phone-call termination",
        fetchImpl: input.fetchImpl,
        method: "POST",
        path: HOSTED_PHONE_CALL_STOP_PATH,
        signal: options?.signal ?? null,
        timeoutMs: input.timeoutMs,
        transport: input.transport,
      });

      return hostedPhoneCallStopResponseSchema.parse(response);
    },
    async status(request, options) {
      const response = await fetchHostedWebControlPlaneJson({
        body: request,
        boundUserId: input.boundUserId,
        description: "Hosted phone-call status",
        fetchImpl: input.fetchImpl,
        method: "POST",
        path: HOSTED_PHONE_CALL_STATUS_PATH,
        sensitiveResponseBody: {
          maxBytes: 32 * 1024,
        },
        signal: options?.signal ?? null,
        timeoutMs: input.timeoutMs,
        transport: input.transport,
      });

      return hostedPhoneCallStatusResponseSchema.parse(response);
    },
    async start(request, options) {
      const response = await fetchHostedWebControlPlaneJson({
        body: request,
        boundUserId: input.boundUserId,
        description: "Hosted phone call",
        fetchImpl: input.fetchImpl,
        method: "POST",
        path: HOSTED_PHONE_CALLS_PATH,
        signal: options?.signal ?? null,
        timeoutMs: resolveHostedPhoneCallTransportTimeoutMs(input.timeoutMs),
        transport: input.transport,
      });

      return hostedPhoneCallStartResponseSchema.parse(response);
    },
  };
}

export function resolveHostedPhoneCallTransportTimeoutMs(timeoutMs: number): number {
  return Math.max(timeoutMs, HOSTED_PHONE_CALL_START_TRANSPORT_TIMEOUT_MS);
}
