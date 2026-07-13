import type { HostedRuntimePlatform } from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  parseHostedMailboxFetchResponse,
  parseHostedMailboxPayloadFetchResponse,
} from "@murphai/hosted-execution/parsers";
import {
  HOSTED_RUNTIME_MAILBOX_FETCH_PATH,
  HOSTED_RUNTIME_MAILBOX_PAYLOAD_FETCH_PATH,
} from "@murphai/hosted-execution/routes";
import type {
  HostedMailboxReplayAuthority,
} from "@murphai/hosted-execution/runtime-control";

import {
  fetchReplaySafeHostedWebControlPlaneJson,
  type HostedWebControlTransport,
} from "./web-control-transport.ts";
import {
  requireHostedRuntimeWriteFenceHeaders,
  type HostedWorkspaceCheckpointBridgeAuthority,
} from "./authority-headers.ts";

const HOSTED_RUNTIME_MAILBOX_AI_USAGE_DENIED_CODE =
  "HOSTED_RUNTIME_MAILBOX_AI_USAGE_DENIED";

export function createHostedWebMailboxPort(input: {
  boundUserId: string;
  fetchImpl: typeof fetch;
  replayAuthority?: HostedMailboxReplayAuthority | null;
  timeoutMs: number;
  transport: HostedWebControlTransport;
  workspaceCheckpointBridge?: HostedWorkspaceCheckpointBridgeAuthority | null;
}) {
  return {
    async fetch(request: Parameters<NonNullable<HostedRuntimePlatform["mailboxPort"]>["fetch"]>[0]) {
      let payload: unknown;
      try {
        const body = bindHostedMailboxReplayAuthority({
          expected: input.replayAuthority ?? null,
          request,
        });
        payload = await fetchReplaySafeHostedWebControlPlaneJson({
          body,
          boundUserId: input.boundUserId,
          description: "Hosted mailbox fetch",
          fetchImpl: input.fetchImpl,
          ...(input.workspaceCheckpointBridge
            ? {
                headers: await requireHostedRuntimeWriteFenceHeaders(
                  input.workspaceCheckpointBridge,
                  "Hosted mailbox fetch",
                ),
              }
            : {}),
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
      const body = bindHostedMailboxReplayAuthority({
        expected: input.replayAuthority ?? null,
        request,
      });
      const payload = await fetchReplaySafeHostedWebControlPlaneJson({
        body,
        boundUserId: input.boundUserId,
        description: "Hosted mailbox payload fetch",
        fetchImpl: input.fetchImpl,
        ...(input.workspaceCheckpointBridge
          ? {
              headers: await requireHostedRuntimeWriteFenceHeaders(
                input.workspaceCheckpointBridge,
                "Hosted mailbox payload fetch",
              ),
            }
          : {}),
        path: HOSTED_RUNTIME_MAILBOX_PAYLOAD_FETCH_PATH,
        timeoutMs: input.timeoutMs,
        transport: input.transport,
      });

      return parseHostedMailboxPayloadFetchResponse(payload);
    },
  };
}

function bindHostedMailboxReplayAuthority<
  T extends { replayAuthority?: HostedMailboxReplayAuthority | null },
>(input: {
  expected: HostedMailboxReplayAuthority | null;
  request: T;
}): T {
  const supplied = input.request.replayAuthority ?? null;
  if (!input.expected) {
    if (supplied) {
      throw new Error("Hosted mailbox replay authority requires a replay invocation.");
    }
    return input.request;
  }
  if (
    !supplied
    || supplied.acceptedConversationAt !== input.expected.acceptedConversationAt
    || supplied.acceptedConversationSeq !== input.expected.acceptedConversationSeq
    || supplied.processingMode !== input.expected.processingMode
    || (supplied.bootstrapActivationAllowed && !input.expected.bootstrapActivationAllowed)
  ) {
    throw new Error("Hosted mailbox replay authority does not match the runtime invocation.");
  }

  return {
    ...input.request,
    replayAuthority: {
      ...input.expected,
      bootstrapActivationAllowed: supplied.bootstrapActivationAllowed,
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
