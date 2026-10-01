import { describe, expect, it } from "vitest";
import { parseHostedVoiceControlRequest, parseHostedVoiceControlResponse } from "../src/voice-control.ts";

const command = { action: "connect", callId: "call-synthetic", attemptId: "attempt-synthetic",
  leaseGeneration: "2", sdp: "v=0\r\noffer" };
describe("voice control wire contract", () => {
  it("preserves the exact SDP and runtime identity", () => {
    expect(parseHostedVoiceControlRequest(command)).toEqual(command);
  });
  it.each([{ userId: "foreign" }, { action: "speak" }, { leaseGeneration: "02" },
    { callId: "../call" }, { sdp: "invalid" }, { sdp: "v=0" + "x".repeat(65536) },
  ])("rejects unsupported authority and malformed media", (change) => {
    expect(() => parseHostedVoiceControlRequest({ ...command, ...change })).toThrow(TypeError);
  });
  it("requires close to contain only the call and runtime identities", () => {
    const { sdp: _sdp, ...close } = { ...command, action: "close" };
    expect(parseHostedVoiceControlRequest(close)).toEqual(close);
    expect(() => parseHostedVoiceControlRequest({ ...command, action: "close" })).toThrow(TypeError);
  });
  it.each([
    { kind: "connected", sdp: "v=0\r\nanswer" },
    { kind: "closed", providerConfirmed: false, seconds: null },
    { kind: "closed", providerConfirmed: true, seconds: 12.5 },
    { kind: "not_ready" }, { kind: "unavailable" }, { kind: "failed" },
  ])("parses a bounded result without fabricating confirmation", (result) => {
    expect(parseHostedVoiceControlResponse(result)).toEqual(result);
  });
  it.each([NaN, Infinity, -1, "12"])("rejects invalid usage receipts", (seconds) => {
    expect(() => parseHostedVoiceControlResponse({ kind: "closed", providerConfirmed: true, seconds })).toThrow(TypeError);
  });
});
