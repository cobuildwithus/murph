import type { HostedRunnerDiagnosticJson } from "./runner-egress-responses-diagnostics.ts";
import { createHostedWebSocketResponseDiagnostics } from "./runner-egress-websocket-response-diagnostics.ts";

type Milestone = "client_received" | "upstream_sent" | "upstream_received"
  | "downstream_sent" | "response_received" | "response_forwarded" | "closed" | "failed";

/** Accepted reservations in the relay's shared queue, not isolate memory usage. */
export interface HostedWebSocketQueueDiagnostics {
  acceptedPendingBytes: number;
  acceptedPendingMessageCount: number;
  acceptedPendingHighWaterBytes: number;
  acceptedPendingHighWaterMessageCount: number;
  pendingLimitBytes: number;
  pendingLimitMessageCount: number;
}

/** Content-free observations of the existing relay, never a recovery owner. */
export function createHostedWebSocketDiagnostics(
  report: ((diagnostic: HostedRunnerDiagnosticJson) => void) | undefined,
  readQueue: () => HostedWebSocketQueueDiagnostics,
) {
  const startedAt = Date.now();
  const correlation = crypto.randomUUID();
  const responses = createHostedWebSocketResponseDiagnostics();
  let clientMessages = 0;
  let upstreamSends = 0;
  let activeClientMessageOrdinal: number | null = null;
  let upstreamMessages = 0;
  let downstreamMessages = 0;
  let requestAt: number | null = null;
  let sentAt: number | null = null;
  let receivedAt: number | null = null;
  let firstUpstreamMessageKind: string | null = null;
  let forwardedAt: number | null = null;
  let lastUpstreamAt: number | null = null;
  let lastDownstreamAt: number | null = null;
  let terminalEmitted = false;

  const emit = (milestone: Milestone, extra: HostedRunnerDiagnosticJson = {}) => {
    if (!report) return;
    const now = Date.now();
    try {
      report({
        diagnosticVersion: 1,
        endpointKind: "responses",
        providerKind: "openai",
        transportKind: "websocket",
        websocketConnectionCorrelation: correlation,
        websocketMilestone: milestone,
        observedAtMs: now,
        connectionElapsedMs: Math.max(0, now - startedAt),
        clientFrameCount: clientMessages,
        upstreamSends,
        activeClientMessageOrdinal,
        upstreamFrameCount: upstreamMessages,
        downstreamFrameCount: downstreamMessages,
        requestElapsedMs: requestAt === null ? null : Math.max(0, now - requestAt),
        upstreamSendElapsedMs: sentAt === null || requestAt === null ? null : Math.max(0, sentAt - requestAt),
        firstUpstreamElapsedMs: receivedAt === null || sentAt === null ? null : Math.max(0, receivedAt - sentAt),
        firstDownstreamElapsedMs: forwardedAt === null || receivedAt === null ? null : Math.max(0, forwardedAt - receivedAt),
        upstreamIdleMs: lastUpstreamAt === null ? null : Math.max(0, now - lastUpstreamAt),
        downstreamIdleMs: lastDownstreamAt === null ? null : Math.max(0, now - lastDownstreamAt),
        upstreamSendObserved: sentAt !== null,
        upstreamFrameObserved: receivedAt !== null,
        firstUpstreamMessageKind,
        downstreamSendObserved: forwardedAt !== null,
        ...readQueue(),
        ...responses.snapshot(now),
        ...extra,
      });
    } catch {
      // An unavailable diagnostics sink cannot change socket behavior.
    }
  };

  return {
    clientReceived() {
      clientMessages += 1;
      const observation = { receivedAt: Date.now(), ordinal: clientMessages };
      emit("client_received", { observedClientMessageOrdinal: observation.ordinal });
      return observation;
    },
    upstreamSent(observation: { receivedAt: number; ordinal: number }, data: ArrayBuffer | string) {
      requestAt = observation.receivedAt;
      activeClientMessageOrdinal = observation.ordinal;
      upstreamSends += 1;
      sentAt = Date.now();
      responses.sent(data, observation.ordinal, sentAt);
      receivedAt = forwardedAt = null;
      firstUpstreamMessageKind = null;
      emit("upstream_sent");
    },
    upstreamReceived(data: ArrayBuffer | string) {
      upstreamMessages += 1;
      lastUpstreamAt = Date.now();
      const observation = responses.received(data, lastUpstreamAt);
      if (receivedAt === null) {
        receivedAt = lastUpstreamAt;
        firstUpstreamMessageKind = observation.messageKind;
        emit("upstream_received", { ...observation.details, responseMilestone: observation.milestone });
      } else if (observation.milestone) {
        emit("response_received", { ...observation.details, responseMilestone: observation.milestone });
      }
      return observation;
    },
    downstreamSent(observation?: ReturnType<typeof responses.received>) {
      downstreamMessages += 1;
      lastDownstreamAt = Date.now();
      const details = observation ? {
        ...observation.details,
        responseMilestone: observation.milestone,
        responseForwardElapsedMs: Math.max(0, lastDownstreamAt - observation.receivedAt),
      } : {};
      if (forwardedAt === null) {
        forwardedAt = lastDownstreamAt;
        emit("downstream_sent", details);
      } else if (observation?.milestone) {
        emit("response_forwarded", details);
      }
    },
    terminal(milestone: "closed" | "failed", side: "client" | "provider" | "relay", code: number | null, phase: "persistence" | "protocol" | "transport" | null = null) {
      if (terminalEmitted) return;
      terminalEmitted = true;
      emit(milestone, {
        closeSide: side,
        closeCode: code,
        failurePhase: phase,
        providerResponseOutcomeKind: milestone === "failed" ? "transport_error" : "closed",
      });
    },
  };
}
