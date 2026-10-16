import { emitHostedExecutionStructuredLog } from "@murphai/hosted-execution";
import { HOSTED_RUNTIME_FETCH_CORRELATION_ID_HEADER } from "../runner-outbound/headers.ts";
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
import type { HostedRuntimeFetchTransportDiagnostics } from "./fetch-transport-collector.ts";
import { observeHostedRuntimeFetchTransport } from "./fetch-transport-diagnostics.ts";

export function createHostedWebMailboxPort(input: {
  boundUserId: string;
  fetchImpl: typeof fetch;
  fetchTransportDiagnostics?: HostedRuntimeFetchTransportDiagnostics | null;
  timeoutMs: number;
  transport: HostedWebControlTransport;
}) {
  return {
    async admitVoiceInput(
      request: Parameters<NonNullable<NonNullable<HostedRuntimePlatform["mailboxPort"]>["admitVoiceInput"]>>[0],
    ) {
      const payload = await fetchHostedWebControlPlaneJson({
        body: request,
        boundUserId: input.boundUserId,
        description: "Hosted voice input admission",
        fetchImpl: input.fetchImpl,
        route: HOSTED_RUNNER_WEB_CONTROL_ROUTES.voiceInput,
        replayOnceOnRetryableFailure: true,
        timeoutMs: input.timeoutMs,
        transport: input.transport,
      });
      if (typeof payload !== "object" || payload === null
        || !("mailboxItemId" in payload) || typeof payload.mailboxItemId !== "string"
        || !payload.mailboxItemId.trim()) {
        throw new TypeError("Hosted voice input admission response is invalid.");
      }
      return { mailboxItemId: payload.mailboxItemId };
    },
    async fetch(
      request: Parameters<NonNullable<HostedRuntimePlatform["mailboxPort"]>["fetch"]>[0],
      context?: Parameters<NonNullable<HostedRuntimePlatform["mailboxPort"]>["fetch"]>[1],
    ) {
      const correlationId = crypto.randomUUID();
      const startedAt = performance.now();
      const startedAtEpochMs = Date.now();
      let decodedAt: number | null = null;
      let decodedAtEpochMs: number | null = null;
      let importReadyAtEpochMs: number | null = null;
      const transportDiagnostics = request.lanes.some(({ lane }) => lane === "conversation")
        ? input.fetchTransportDiagnostics ?? null
        : null;
      try {
        let payload: unknown;
        try {
          payload = await fetchReplaySafeHostedWebControlPlaneJson({
            body: { ...request, decodeInlinePayloads: true },
            boundUserId: input.boundUserId,
            description: "Hosted mailbox fetch",
            fetchImpl: transportDiagnostics
              ? ((resource: RequestInfo | URL, init?: RequestInit) => observeHostedRuntimeFetchTransport(
                () => input.fetchImpl(resource, init),
                (timing, outcome) => transportDiagnostics.recordConversationMailboxFetch(timing, outcome.response),
              )) as typeof fetch
              : input.fetchImpl,
            headers: new Headers({ [HOSTED_RUNTIME_FETCH_CORRELATION_ID_HEADER]: correlationId }),
            route: HOSTED_RUNNER_WEB_CONTROL_ROUTES.mailboxFetch,
            ...(context?.signal ? { signal: context.signal } : {}),
            timeoutMs: input.timeoutMs,
            transport: input.transport,
          });
        } catch (error) {
          if (context?.signal?.aborted) throw context.signal.reason;
          throw error;
        }
        decodedAt = performance.now();
        decodedAtEpochMs = Date.now();
        const mailbox = parseHostedMailboxFetchResponse(payload);
        // The ordinary parser proves these item records. Only the Worker port
        // accepts this ephemeral enrichment; Web's canonical parser discards it.
        const rawItems = (payload as { items: Array<Record<string, unknown>> }).items;
        const result = {
          ...mailbox,
          items: mailbox.items.map((item, index) => ({
            ...item,
            ...(rawItems[index]?.decodedWake === undefined ? {} : {
              decodedWake: parseHostedExecutionWake(rawItems[index]!.decodedWake),
            }),
          })),
        };
        importReadyAtEpochMs = Date.now();
        return result;
      } finally {
        emitHostedExecutionStructuredLog({
          component: "mailbox",
          details: {
            mailboxFetchCorrelationId: correlationId,
            mailboxRuntimeFetchStartedAtEpochMs: startedAtEpochMs,
            mailboxRuntimeResponseDecodedAtEpochMs: decodedAtEpochMs,
            mailboxRuntimeImportReadyAtEpochMs: importReadyAtEpochMs,
            mailboxRuntimeFetchAndDecodeMs: decodedAt === null ? null : Math.max(0, Math.round(decodedAt - startedAt)),
            mailboxRuntimeParseMs: decodedAt === null ? null : Math.max(0, Math.round(performance.now() - decodedAt)),
            mailboxRuntimeTotalMs: Math.max(0, Math.round(performance.now() - startedAt)),
            mailboxRuntimeImportReady: importReadyAtEpochMs !== null,
          },
          level: importReadyAtEpochMs === null ? "warn" : "info",
          message: "Hosted runtime mailbox fetch finished.",
          phase: "wake.running",
        });
      }
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
