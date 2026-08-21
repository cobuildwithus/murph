import type {
  HostedRuntimePlatform,
} from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  HOSTED_PHYSICAL_NOTE_RECOVERY_PATH,
  HOSTED_PHYSICAL_NOTES_PATH,
  HOSTED_PHYSICAL_NOTE_SEND_TRANSPORT_TIMEOUT_MS,
  hostedPhysicalNoteRecoveryResponseSchema,
  hostedPhysicalNoteSendResponseSchema,
} from "@murphai/hosted-execution/physical-notes";

import {
  fetchHostedWebControlPlaneJson,
  HostedWebControlPlaneResponseError,
  type HostedWebControlTransport,
} from "./web-control-transport.ts";

export function createHostedWebPhysicalNotePort(input: {
  boundUserId: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  transport: HostedWebControlTransport;
}): NonNullable<HostedRuntimePlatform["physicalNotes"]> {
  return {
    async resolve(request, options) {
      try {
        const response = await fetchHostedWebControlPlaneJson({
          body: request,
          boundUserId: input.boundUserId,
          description: "Hosted physical-note recovery",
          fetchImpl: input.fetchImpl,
          method: "POST",
          path: HOSTED_PHYSICAL_NOTE_RECOVERY_PATH,
          signal: options?.signal ?? null,
          timeoutMs: input.timeoutMs,
          transport: input.transport,
        });
        return hostedPhysicalNoteRecoveryResponseSchema.parse(response);
      } catch (error) {
        if (
          error instanceof HostedWebControlPlaneResponseError
          && error.status >= 400
          && error.status < 500
          && error.status !== 408
        ) {
          return {
            remainingUnresolved: null,
            retryAfter: null,
            settledUsageCostUsdMicros: null,
            status: error.status === 403
              ? "permission_denied" as const
              : "unavailable" as const,
          };
        }
        throw error;
      }
    },
    async send(request, options) {
      try {
        const response = await fetchHostedWebControlPlaneJson({
          body: request,
          boundUserId: input.boundUserId,
          description: "Hosted physical note",
          fetchImpl: input.fetchImpl,
          method: "POST",
          path: HOSTED_PHYSICAL_NOTES_PATH,
          preserveInitialFailureOnReplayFailure: true,
          replayOnceOnRetryableFailure: true,
          signal: options?.signal ?? null,
          timeoutMs: Math.max(
            input.timeoutMs,
            HOSTED_PHYSICAL_NOTE_SEND_TRANSPORT_TIMEOUT_MS,
          ),
          transport: input.transport,
        });
        return hostedPhysicalNoteSendResponseSchema.parse(response);
      } catch (error) {
        if (
          error instanceof HostedWebControlPlaneResponseError
          && error.status >= 400
          && error.status < 500
          && error.status !== 408
        ) {
          return {
            complimentary: false,
            costUsdMicros: "0",
            physicalNoteId: null,
            status: error.status === 403 ? "permission_denied" : "failed",
          };
        }
        throw error;
      }
    },
  };
}
