import type {
  HostedRuntimePlatform,
} from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  HOSTED_PHYSICAL_NOTES_PATH,
  HOSTED_PHYSICAL_NOTE_SEND_TRANSPORT_TIMEOUT_MS,
  hostedPhysicalNoteSendResponseSchema,
} from "@murphai/hosted-execution/physical-notes";

import {
  fetchHostedWebControlPlaneJson,
  type HostedWebControlTransport,
} from "./web-control-transport.ts";

export function createHostedWebPhysicalNotePort(input: {
  boundUserId: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  transport: HostedWebControlTransport;
}): NonNullable<HostedRuntimePlatform["physicalNotes"]> {
  return {
    async send(request, options) {
      const response = await fetchHostedWebControlPlaneJson({
        body: request,
        boundUserId: input.boundUserId,
        description: "Hosted physical note",
        fetchImpl: input.fetchImpl,
        method: "POST",
        path: HOSTED_PHYSICAL_NOTES_PATH,
        signal: options?.signal ?? null,
        timeoutMs: Math.max(
          input.timeoutMs,
          HOSTED_PHYSICAL_NOTE_SEND_TRANSPORT_TIMEOUT_MS,
        ),
        transport: input.transport,
      });
      return hostedPhysicalNoteSendResponseSchema.parse(response);
    },
  };
}
