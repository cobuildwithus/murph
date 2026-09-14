import type { HostedRunnerDiagnosticJson } from "./runner-egress-responses-diagnostics.ts";

type Milestone = "client_received" | "upstream_sent" | "upstream_received"
  | "downstream_sent" | "closed" | "failed";

const MESSAGE_KINDS = new Set([
  "response.created", "response.in_progress", "response.completed", "response.failed",
  "response.output_item.added", "response.output_text.delta", "error",
  "codex.response.metadata",
]);

function readMessageKind(data: ArrayBuffer | string): string {
  if (typeof data !== "string") return "binary";
  if (data.length > 65_536) return "too_large";
  try {
    const value: unknown = JSON.parse(data);
    if (value && typeof value === "object" && "type" in value
      && typeof value.type === "string" && MESSAGE_KINDS.has(value.type)) return value.type;
    return "other";
  } catch {
    return "invalid_json";
  }
}

/** Content-free observations of the existing relay, never a recovery owner. */
export function createHostedWebSocketDiagnostics(
  report: ((diagnostic: HostedRunnerDiagnosticJson) => void) | undefined,
) {
  const startedAt = Date.now();
  const correlation = crypto.randomUUID();
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
    upstreamSent(observation: { receivedAt: number; ordinal: number }) {
      requestAt = observation.receivedAt;
      activeClientMessageOrdinal = observation.ordinal;
      upstreamSends += 1;
      sentAt = Date.now();
      receivedAt = forwardedAt = null;
      firstUpstreamMessageKind = null;
      emit("upstream_sent");
    },
    upstreamReceived(data: ArrayBuffer | string) {
      upstreamMessages += 1;
      lastUpstreamAt = Date.now();
      if (receivedAt !== null) return;
      receivedAt = lastUpstreamAt;
      firstUpstreamMessageKind = readMessageKind(data);
      emit("upstream_received");
    },
    downstreamSent() {
      downstreamMessages += 1;
      lastDownstreamAt = Date.now();
      if (forwardedAt !== null) return;
      forwardedAt = lastDownstreamAt;
      emit("downstream_sent");
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
