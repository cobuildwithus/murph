import type { HostedRuntimePlatform } from "@murphai/assistant-runtime/hosted-runtime-contracts";
import type {
  HostedMailboxAccessPurpose,
} from "@murphai/hosted-execution/runtime-control";
import {
  parseHostedMailboxFetchResponse,
  parseHostedMailboxPayloadFetchResponse,
} from "@murphai/hosted-execution/parsers";
import {
  HOSTED_RUNTIME_MAILBOX_FETCH_PATH,
  HOSTED_RUNTIME_MAILBOX_PAYLOAD_FETCH_PATH,
} from "@murphai/hosted-execution/routes";

import {
  fetchReplaySafeHostedWebControlPlaneJson,
  type HostedWebControlTransport,
} from "./web-control-transport.ts";

const HOSTED_RUNTIME_MAILBOX_AI_USAGE_DENIED_CODE =
  "HOSTED_RUNTIME_MAILBOX_AI_USAGE_DENIED";

export function createHostedWebMailboxPort(input: {
  accessPurpose?: HostedMailboxAccessPurpose | null;
  boundUserId: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  transport: HostedWebControlTransport;
}) {
  return {
    async fetch(request: Parameters<NonNullable<HostedRuntimePlatform["mailboxPort"]>["fetch"]>[0]) {
      const { purpose: _callerPurpose, ...requestWithoutPurpose } = request;
      let payload: unknown;
      try {
        payload = await fetchReplaySafeHostedWebControlPlaneJson({
          body: {
            ...requestWithoutPurpose,
            ...(input.accessPurpose ? { purpose: input.accessPurpose } : {}),
          },
          boundUserId: input.boundUserId,
          description: "Hosted mailbox fetch",
          fetchImpl: input.fetchImpl,
          path: HOSTED_RUNTIME_MAILBOX_FETCH_PATH,
          timeoutMs: input.timeoutMs,
          transport: input.transport,
        });
      } catch (error) {
        if (!isHostedMailboxAiUsageDeniedError(error)) {
          throw error;
        }

        return {
          consumedSeqByLane: request.lanes.map(({ importedSeq, lane }) => ({
            consumedSeq: importedSeq,
            lane,
          })),
          fetchedAt: new Date().toISOString(),
          items: [],
          maxSeqByLane: request.lanes.map(({ importedSeq, lane }) => ({
            lane,
            maxSeq: importedSeq,
          })),
          userId: input.boundUserId,
        };
      }

      return parseHostedMailboxFetchResponse(payload);
    },
    async fetchPayload(
      request: Parameters<NonNullable<HostedRuntimePlatform["mailboxPort"]>["fetchPayload"]>[0],
    ) {
      const { purpose: _callerPurpose, ...requestWithoutPurpose } = request;
      const payload = await fetchReplaySafeHostedWebControlPlaneJson({
        body: {
          ...requestWithoutPurpose,
          ...(input.accessPurpose ? { purpose: input.accessPurpose } : {}),
        },
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

function isHostedMailboxAiUsageDeniedError(error: unknown): boolean {
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const record = current as Record<string, unknown>;
    if (record.code === HOSTED_RUNTIME_MAILBOX_AI_USAGE_DENIED_CODE) {
      return true;
    }
    current = record.cause;
  }
  return false;
}
