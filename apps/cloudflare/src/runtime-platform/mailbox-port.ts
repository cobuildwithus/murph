import type { HostedRuntimePlatform } from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  parseHostedMailboxFetchResponse,
  parseHostedMailboxPayloadFetchResponse,
} from "@murphai/hosted-execution/parsers";
import {
  HOSTED_RUNTIME_MAILBOX_FETCH_PATH,
  HOSTED_RUNTIME_MAILBOX_PAYLOAD_FETCH_PATH,
} from "@murphai/hosted-execution/routes";

import { fetchReplaySafeHostedWebControlPlaneJson, type HostedWebControlTransport } from "./web-control-transport.ts";

export function createHostedWebMailboxPort(input: {
  boundUserId: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  transport: HostedWebControlTransport;
}) {
  return {
    async fetch(request: Parameters<NonNullable<HostedRuntimePlatform["mailboxPort"]>["fetch"]>[0]) {
      const payload = await fetchReplaySafeHostedWebControlPlaneJson({
        body: request,
        boundUserId: input.boundUserId,
        description: "Hosted mailbox fetch",
        fetchImpl: input.fetchImpl,
        path: HOSTED_RUNTIME_MAILBOX_FETCH_PATH,
        timeoutMs: input.timeoutMs,
        transport: input.transport,
      });

      return parseHostedMailboxFetchResponse(payload);
    },
    async fetchPayload(
      request: Parameters<NonNullable<HostedRuntimePlatform["mailboxPort"]>["fetchPayload"]>[0],
    ) {
      const payload = await fetchReplaySafeHostedWebControlPlaneJson({
        body: request,
        boundUserId: input.boundUserId,
        description: "Hosted mailbox payload fetch",
        fetchImpl: input.fetchImpl,
        path: HOSTED_RUNTIME_MAILBOX_PAYLOAD_FETCH_PATH,
        timeoutMs: input.timeoutMs,
        transport: input.transport,
      });

      return parseHostedMailboxPayloadFetchResponse(payload);
    },
  };
}
