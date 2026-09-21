import { requireObject, requireString } from "./parsers/assertions.ts";

/** The native input identity and timestamp are retained across transport replay. */
export interface HostedVoiceInputRequest {
  callId: string;
  inputId: string;
  occurredAt: string;
  text: string;
}

export function parseHostedVoiceInputRequest(value: unknown): HostedVoiceInputRequest {
  const record = requireObject(value, "Hosted voice input");
  if (Object.keys(record).some((key) => !["callId", "inputId", "occurredAt", "text"].includes(key))) {
    throw new TypeError("Hosted voice input contains unsupported fields.");
  }
  const callId = requireVoiceIdentifier(record.callId);
  const inputId = requireVoiceIdentifier(record.inputId);
  const occurredAt = requireString(record.occurredAt, "Hosted voice input timestamp");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(occurredAt)
    || !Number.isFinite(Date.parse(occurredAt))
    || new Date(occurredAt).toISOString() !== occurredAt) {
    throw new TypeError("Hosted voice input timestamp is invalid.");
  }
  const text = requireString(record.text, "Hosted voice input text");
  if (!text.trim() || new TextEncoder().encode(text).byteLength > 32 * 1024) {
    throw new TypeError("Hosted voice input text is empty or too large.");
  }
  return { callId, inputId, occurredAt, text };
}

function requireVoiceIdentifier(value: unknown): string {
  const id = requireString(value, "Hosted voice input identity");
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(id)) {
    throw new TypeError("Hosted voice input identity is invalid.");
  }
  return id;
}
