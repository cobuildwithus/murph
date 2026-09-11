import type { HostedRuntimePlatform } from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  parseHostedMailboxFetchResponse,
  parseHostedExecutionWake,
  parseHostedMailboxPayloadFetchResponse,
} from "@murphai/hosted-execution/parsers";
import {
  fetchHostedWebControlPlaneJson,
  fetchReplaySafeHostedWebControlPlaneJson,
  HOSTED_RUNNER_WEB_CONTROL_ROUTES,
  type HostedWebControlTransport,
} from "./web-control-transport.ts";

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
          body: { ...request, decodeInlinePayloads: true },
          boundUserId: input.boundUserId,
          description: "Hosted mailbox fetch",
          fetchImpl: input.fetchImpl,
          route: HOSTED_RUNNER_WEB_CONTROL_ROUTES.mailboxFetch,
          ...(context?.signal ? { signal: context.signal } : {}),
          timeoutMs: input.timeoutMs,
          transport: input.transport,
        });
      } catch (error) {
        if (context?.signal?.aborted) {
          throw context.signal.reason;
        }
        throw error;
      }

      const mailbox = parseHostedMailboxFetchResponse(payload);
      // The ordinary parser proves these item records. Only the Worker port
      // accepts this ephemeral enrichment; Web's canonical parser discards it.
      const rawItems = (payload as { items: Array<Record<string, unknown>> }).items;
      return {
        ...mailbox,
        items: mailbox.items.map((item, index) => ({
          ...item,
          ...(rawItems[index]?.decodedWake === undefined ? {} : {
            decodedWake: parseHostedExecutionWake(rawItems[index]!.decodedWake),
          }),
        })),
      };
    },
    async fetchPayload(
      request: Parameters<NonNullable<HostedRuntimePlatform["mailboxPort"]>["fetchPayload"]>[0],
    ) {
      const payload = await fetchReplaySafeHostedWebControlPlaneJson({
        body: request,
        boundUserId: input.boundUserId,
        description: "Hosted mailbox payload fetch",
        fetchImpl: input.fetchImpl,
        route: HOSTED_RUNNER_WEB_CONTROL_ROUTES.mailboxPayloadFetch,
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
        route: HOSTED_RUNNER_WEB_CONTROL_ROUTES.memberActionOutcome,
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
