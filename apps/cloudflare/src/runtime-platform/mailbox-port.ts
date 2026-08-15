import type { HostedRuntimePlatform } from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  parseHostedMailboxFetchResponse,
  parseHostedMailboxPayloadFetchResponse,
} from "@murphai/hosted-execution/parsers";
import {
  HOSTED_RUNTIME_MAILBOX_FETCH_PATH,
  HOSTED_RUNTIME_MAILBOX_PAYLOAD_FETCH_PATH,
  HOSTED_RUNTIME_MEMBER_ACTION_OUTCOME_PATH,
} from "@murphai/hosted-execution/routes";

import {
  fetchHostedWebControlPlaneJson,
  fetchReplaySafeHostedWebControlPlaneJson,
  type HostedWebControlTransport,
} from "./web-control-transport.ts";

const HOSTED_RUNTIME_MAILBOX_AI_USAGE_DENIED_CODE =
  "HOSTED_RUNTIME_MAILBOX_AI_USAGE_DENIED";

export function createHostedWebMailboxPort(input: {
  boundUserId: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  transport: HostedWebControlTransport;
}) {
  return {
    async fetch(
      request: Parameters<NonNullable<HostedRuntimePlatform["mailboxPort"]>["fetch"]>[0],
      context?: Parameters<NonNullable<HostedRuntimePlatform["mailboxPort"]>["fetch"]>[1],
    ) {
      let payload: unknown;
      try {
        payload = await fetchReplaySafeHostedWebControlPlaneJson({
          body: request,
          boundUserId: input.boundUserId,
          description: "Hosted mailbox fetch",
          fetchImpl: input.fetchImpl,
          path: HOSTED_RUNTIME_MAILBOX_FETCH_PATH,
          ...(context?.signal ? { signal: context.signal } : {}),
          timeoutMs: input.timeoutMs,
          transport: input.transport,
        });
      } catch (error) {
        if (context?.signal?.aborted) {
          throw context.signal.reason;
        }
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
    async recordMemberActionOutcome(
      outcome: Parameters<
        NonNullable<NonNullable<HostedRuntimePlatform["mailboxPort"]>["recordMemberActionOutcome"]>
      >[0],
      context?: Parameters<
        NonNullable<NonNullable<HostedRuntimePlatform["mailboxPort"]>["recordMemberActionOutcome"]>
      >[1],
    ) {
      const payload = await fetchHostedWebControlPlaneJson({
        body: outcome,
        boundUserId: input.boundUserId,
        description: "Hosted member action outcome record",
        fetchImpl: input.fetchImpl,
        path: HOSTED_RUNTIME_MEMBER_ACTION_OUTCOME_PATH,
        replayOnceOnRetryableFailure: true,
        ...(context?.signal ? { signal: context.signal } : {}),
        timeoutMs: input.timeoutMs,
        transport: input.transport,
      });
      if (
        typeof payload !== "object"
        || payload === null
        || Array.isArray(payload)
        || (payload as Record<string, unknown>).schemaVersion !== 1
        || (payload as Record<string, unknown>).recorded !== true
      ) {
        throw new TypeError("Hosted member action outcome response is invalid.");
      }
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
