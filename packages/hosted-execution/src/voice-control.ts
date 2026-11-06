import { requireObject, requireString } from "./parsers/assertions.ts";
import { parseHostedVoiceCallId } from "./voice-input.ts";

export type HostedVoiceControlRequest = {
  attemptId: string;
  leaseGeneration: string;
  callId: string;
} & ({ action: "connect"; sdp: string } | { action: "close" });

export type HostedVoiceControlResponse =
  | { kind: "connected"; sdp: string }
  | { kind: "closed"; providerConfirmed: boolean; seconds: number | null }
  | { kind: "not_ready" | "unavailable" | "failed" };

export function parseHostedVoiceControlRequest(value: unknown): HostedVoiceControlRequest {
  const record = requireObject(value, "Voice control request");
  const keys = record.action === "connect"
    ? ["action", "attemptId", "leaseGeneration", "callId", "sdp"]
    : ["action", "attemptId", "leaseGeneration", "callId"];
  if (Object.keys(record).some((key) => !keys.includes(key))) {
    throw new TypeError("Voice control request contains unsupported fields.");
  }
  const attemptId = requireString(record.attemptId, "Voice runtime attempt");
  const leaseGeneration = requireString(record.leaseGeneration, "Voice runtime generation");
  if (!/^[A-Za-z0-9._:-]{1,200}$/u.test(attemptId) || !/^(?:0|[1-9][0-9]{0,19})$/u.test(leaseGeneration)) {
    throw new TypeError("Voice runtime identity is invalid.");
  }
  const identity = { attemptId, leaseGeneration, callId: parseHostedVoiceCallId(record.callId) };
  if (record.action === "close") return { ...identity, action: "close" };
  if (record.action === "connect") return { ...identity, action: "connect", sdp: parseVoiceSdp(record.sdp) };
  throw new TypeError("Voice control action is invalid.");
}

export function parseHostedVoiceControlResponse(value: unknown): HostedVoiceControlResponse {
  const record = requireObject(value, "Voice control response");
  if (record.kind === "connected") return { kind: "connected", sdp: parseVoiceSdp(record.sdp) };
  if (record.kind === "not_ready" || record.kind === "unavailable" || record.kind === "failed") {
    return { kind: record.kind };
  }
  if (record.kind === "closed" && typeof record.providerConfirmed === "boolean"
    && (record.seconds === null || (typeof record.seconds === "number" && Number.isFinite(record.seconds) && record.seconds >= 0))) {
    return { kind: "closed", providerConfirmed: record.providerConfirmed, seconds: record.seconds };
  }
  throw new TypeError("Voice control response is invalid.");
}

function parseVoiceSdp(value: unknown): string {
  const sdp = requireString(value, "Voice SDP");
  if (!sdp.startsWith("v=0") || new TextEncoder().encode(sdp).byteLength > 64 * 1024) {
    throw new TypeError("Voice SDP is invalid.");
  }
  return sdp;
}
