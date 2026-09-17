import { createHash } from "node:crypto";
import type { HostedRunnerDiagnosticJson } from "./runner-egress-responses-diagnostics.ts";

// Match the existing request-inspection budget. Responses may echo large
// tool schemas in acknowledgement and terminal frames; inspect once per frame.
const MAX_INSPECTION_CHARS = 6 * 1024 * 1024;
const MESSAGE_KINDS = new Set([
  "response.created", "response.in_progress", "response.completed", "response.failed",
  "response.output_item.added", "response.output_text.delta", "error",
  "codex.response.metadata",
]);

const PROGRESS_KINDS = new Set([
  "response.output_item.added", "response.output_item.done",
  "response.content_part.added", "response.output_text.delta",
  "response.function_call_arguments.delta", "response.custom_tool_call_input.delta",
  "response.reasoning_summary_text.delta", "response.reasoning_text.delta",
]);
const TERMINAL_KINDS = new Set([
  "response.completed", "response.failed", "response.incomplete", "error",
]);

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function parseFrame(data: ArrayBuffer | string): unknown {
  if (typeof data !== "string" || data.length > MAX_INSPECTION_CHARS) return undefined;
  try { return JSON.parse(data); } catch { return undefined; }
}

function responseId(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= 256
    ? value : null;
}

type RequestObservation = {
  ordinal: number;
  sentAt: number;
  kind: "generation" | "prewarm" | "unknown";
  turnCorrelation: number | null;
  responseId: string | null;
  acknowledgedAt: number | null;
  firstProgressAt: number | null;
  lastProgressAt: number | null;
  lastFrameAt: number;
  maxFrameGapMs: number;
  terminalAt: number | null;
  terminalKind: string | null;
  inspectionIncomplete: boolean;
};

function observeResponseMilestone(frame: Record<string, unknown>, active: RequestObservation, now: number) {
  const kind = typeof frame.type === "string" ? frame.type : "";
  const id = responseId(record(frame.response)?.id);
  const explicitId = responseId(frame.response_id);
  const observedId = id ?? explicitId;
  if (observedId && active.responseId && observedId !== active.responseId) return "ambiguous";
  if (id && explicitId && id !== explicitId) return "ambiguous";
  if (kind === "response.created" && id && active.acknowledgedAt === null) {
    active.responseId = id;
    active.acknowledgedAt = now;
    return "acknowledged";
  }
  if (PROGRESS_KINDS.has(kind) && active.acknowledgedAt !== null) {
    const first = active.firstProgressAt === null;
    active.firstProgressAt ??= now;
    active.lastProgressAt = now;
    return first ? "progress" : null;
  }
  if (TERMINAL_KINDS.has(kind) && (kind === "error" || id !== null)) {
    active.terminalAt = now;
    active.terminalKind = kind;
    return "terminal";
  }
  return null;
}

/** Constant-size wire observations. They never authorize or retry a request. */
export function createHostedWebSocketResponseDiagnostics() {
  let active: RequestObservation | null = null;
  // After overlapping/unknown requests, FIFO association is no longer proven.
  // Keep it unknown for this connection instead of guessing at later frames.
  let associationLost = false;

  const elapsed = (from: number | null, to: number | null) =>
    from === null || to === null ? null : Math.max(0, to - from);
  const snapshot = (now: number): HostedRunnerDiagnosticJson => {
    if (!active) return { responseAssociationKind: "unknown" };
    return {
      responseClientMessageOrdinal: active.ordinal,
      codexTurnCorrelation: active.turnCorrelation,
      responseRequestKind: active.kind,
      responseAssociationKind: active.kind === "unknown" ? "unknown"
        : associationLost ? "ambiguous" : "single-request",
      responseAcknowledged: active.acknowledgedAt !== null,
      responseAcknowledgementElapsedMs: elapsed(active.sentAt, active.acknowledgedAt),
      responseFirstProgressElapsedMs: elapsed(active.sentAt, active.firstProgressAt),
      responseProgressIdleMs: elapsed(active.lastProgressAt, now),
      responseMaxFrameGapMs: active.maxFrameGapMs,
      responseTerminalElapsedMs: elapsed(active.sentAt, active.terminalAt),
      responseTerminalKind: active.terminalKind,
      responseInspectionIncomplete: active.inspectionIncomplete,
    };
  };

  return {
    snapshot,
    sent(data: ArrayBuffer | string, ordinal: number, now: number) {
      const frame = record(parseFrame(data));
      const metadata = record(frame?.client_metadata);
      const turnId = metadata?.turn_id;
      const known = frame?.type === "response.create";
      associationLost ||= active !== null && active.terminalAt === null;
      const turnCorrelation = typeof turnId === "string" && turnId.length <= 256
        && turnId.length > 0
        // Same opaque-turn convention as native timing/action diagnostics.
        ? Number.parseInt(createHash("sha256").update(turnId).digest("hex").slice(0, 12), 16)
        : null;
      active = {
        ordinal, sentAt: now, kind: !known ? "unknown"
          : frame.generate === false ? "prewarm" : "generation",
        turnCorrelation, responseId: null, acknowledgedAt: null,
        firstProgressAt: null, lastProgressAt: null, lastFrameAt: now,
        maxFrameGapMs: 0, terminalAt: null, terminalKind: null,
        inspectionIncomplete: frame === null,
      };
      associationLost ||= !known;
    },
    received(data: ArrayBuffer | string, now: number) {
      const parsed = parseFrame(data);
      const frame = record(parsed);
      const messageKind = typeof data !== "string" ? "binary"
        : data.length > MAX_INSPECTION_CHARS ? "too_large"
        : parsed === undefined ? "invalid_json"
        : typeof frame?.type === "string" && MESSAGE_KINDS.has(frame.type) ? frame.type : "other";
      if (active && active.terminalAt === null) {
        active.maxFrameGapMs = Math.max(active.maxFrameGapMs, now - active.lastFrameAt);
        active.lastFrameAt = now;
        active.inspectionIncomplete ||= frame === null;
      }
      let milestone: "acknowledged" | "progress" | "terminal" | null = null;
      if (frame && active && !associationLost && active.terminalAt === null) {
        const observed = observeResponseMilestone(frame, active, now);
        if (observed === "ambiguous") associationLost = true;
        else milestone = observed;
      }
      return { details: snapshot(now), messageKind, milestone, receivedAt: now };
    },
  };
}
