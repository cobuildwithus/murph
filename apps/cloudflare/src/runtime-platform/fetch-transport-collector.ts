import type { HostedRuntimeRedactedObject } from "@murphai/hosted-execution/runtime-control";

import type { HostedRuntimeFetchTransportTiming } from "./fetch-transport-diagnostics.ts";

/**
 * Keeps the first typing start and the first conversation-lane mailbox fetch
 * of one invocation as scalars for its existing completion log entry.
 */
export function createHostedRuntimeFetchTransportDiagnostics() {
  let typing: HostedRuntimeRedactedObject | null = null;
  let mailbox: HostedRuntimeRedactedObject | null = null;
  return {
    recordTypingStart(timing: HostedRuntimeFetchTransportTiming, response?: Response) {
      typing ??= summarizeFetchTransport("firstTypingFetch", timing, response);
    },
    recordConversationMailboxFetch(timing: HostedRuntimeFetchTransportTiming, response?: Response) {
      mailbox ??= summarizeFetchTransport("firstMailboxFetch", timing, response);
    },
    read(): HostedRuntimeRedactedObject {
      return { ...typing, ...mailbox };
    },
  };
}

export type HostedRuntimeFetchTransportDiagnostics =
  ReturnType<typeof createHostedRuntimeFetchTransportDiagnostics>;

// Key names avoid the runtime log's forbidden raw-field substrings.
function summarizeFetchTransport(
  prefix: string,
  timing: HostedRuntimeFetchTransportTiming,
  response?: Response,
): HostedRuntimeRedactedObject {
  const ms = (value: number | null) => value === null ? null : Math.round(value);
  return {
    [`${prefix}StartedAtEpochMs`]: timing.startedAtEpochMs,
    [`${prefix}DurationMs`]: ms(timing.durationMs),
    [`${prefix}ResponseStatus`]: response?.status ?? null,
    [`${prefix}ConnectionCount`]: timing.connectionCount,
    [`${prefix}SocketPreviouslyWritten`]: timing.socketPreviouslyWritten,
    [`${prefix}DnsLookupMs`]: ms(timing.dnsLookupMs),
    [`${prefix}TcpConnectMs`]: ms(timing.tcpConnectMs),
    [`${prefix}TlsHandshakeMs`]: ms(timing.tlsHandshakeMs),
    [`${prefix}RequestSentMs`]: ms(timing.requestSentMs),
    [`${prefix}ResponseWaitMs`]: ms(timing.waitingForHeadersMs),
    [`${prefix}ResolveDelayMs`]: ms(timing.fetchResolveDelayMs),
    [`${prefix}EventLoopActiveMs`]: ms(timing.processEventLoopActiveMs),
    [`${prefix}EventLoopIdleMs`]: ms(timing.processEventLoopIdleMs),
    [`${prefix}LastStage`]: timing.lastObservedStage,
  };
}
