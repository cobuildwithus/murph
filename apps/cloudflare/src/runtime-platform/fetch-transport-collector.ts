import type { HostedRuntimeRedactedObject } from "@murphai/hosted-execution/runtime-control";

import type { HostedRuntimeFetchTransportTiming } from "./fetch-transport-diagnostics.ts";

export type HostedRuntimeFetchTransportRecorder = (
  timing: HostedRuntimeFetchTransportTiming,
  response?: Response,
) => void;

/**
 * Keeps the first-started typing start and conversation-lane mailbox fetch of
 * one invocation as scalars for its existing completion log entry. A claim is
 * taken when a request starts, so a faster later request never replaces it and
 * later requests are not observed.
 */
export function createHostedRuntimeFetchTransportDiagnostics() {
  const recorded: HostedRuntimeRedactedObject[] = [];
  const claimFirst = (prefix: string) => {
    let claimed = false;
    return (): HostedRuntimeFetchTransportRecorder | null => {
      if (claimed) return null;
      claimed = true;
      return (timing, response) => {
        recorded.push(summarizeFetchTransport(prefix, timing, response));
      };
    };
  };
  return {
    claimTypingStart: claimFirst("firstTypingFetch"),
    claimConversationMailboxFetch: claimFirst("firstMailboxFetch"),
    read: (): HostedRuntimeRedactedObject => Object.assign({}, ...recorded),
  };
}

export type HostedRuntimeFetchTransportDiagnostics =
  ReturnType<typeof createHostedRuntimeFetchTransportDiagnostics>;

// Key names avoid the runtime log's forbidden raw-field substrings.
export function summarizeFetchTransport(
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
    // Already measured over the same fetch; counts every process thread.
    [`${prefix}ProcessCpuUserMs`]: ms(timing.processCpuUserMs),
    [`${prefix}ProcessCpuSystemMs`]: ms(timing.processCpuSystemMs),
    [`${prefix}LastStage`]: timing.lastObservedStage,
  };
}
