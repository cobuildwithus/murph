import { describe, expect, it, vi } from "vitest";
import { controlHostedContainerVoice, type HostedContainerActiveInvocation } from "../src/container-voice-control.ts";
import { createHostedRuntimeVoice, createHostedRuntimeVoiceCall } from "@murphai/assistant-runtime/hosted-invocation";
import type { HostedVoiceControlRequest } from "@murphai/hosted-execution";

const command: HostedVoiceControlRequest & { userId: string } = {
  action: "connect", attemptId: "attempt-synthetic", leaseGeneration: "1",
  userId: "member-synthetic", callId: "call-synthetic", sdp: "v=0\r\noffer",
};
function fixture() {
  const abort = new AbortController();
  const close = vi.fn(async () => ({ providerConfirmed: true, providerSessionId: "provider-synthetic", seconds: 0 }));
  const start = vi.fn(async () => ({
    sdp: "v=0\r\nanswer", speak: vi.fn(), close, closed: new Promise<never>(() => {}),
  }));
  const voice = createHostedRuntimeVoice({
    notifyRuntime: vi.fn(),
    createCall: (callId) => createHostedRuntimeVoiceCall({
      callId, memberId: command.userId, signal: abort.signal,
      usagePort: { recordUsage: vi.fn() }, admitInput: vi.fn(),
      notifyRuntime: vi.fn(), onError: vi.fn(),
    }),
  });
  voice.reserve(command.callId);
  voice.bindStart(start);
  const active: HostedContainerActiveInvocation = {
    ...command, abort: () => abort.abort(), signal: abort.signal, voice,
  };
  const shutdown = new AbortController();
  let current: HostedContainerActiveInvocation | null = active;
  return { active, voice, close, start, abort, shutdown,
    replace: (value: HostedContainerActiveInvocation | null) => { current = value; },
    run: (request = command) => controlHostedContainerVoice({
      command: request, readCurrent: () => current, shutdownSignal: shutdown.signal,
    }),
  };
}

describe("invocation-owned voice control", () => {
  it.each([
    ["HOSTED_VOICE_NOT_READY", "not_ready"],
    ["HOSTED_VOICE_CALL_UNAVAILABLE", "unavailable"],
    ["ASSISTANT_VOICE_DELIVERY_UNAVAILABLE", "unavailable"],
    ["UNEXPECTED_PROVIDER_FAILURE", "failed"],
  ])("returns a bounded control result for %s", async (code, kind) => {
    const h = fixture();
    try {
      h.active.voice = { closeCall: h.close, connect: async () => { throw Object.assign(new Error("synthetic failure"), { code }); } };
      expect(await h.run()).toEqual({ kind });
    } finally { await h.voice.close(); }
  });
  it("reuses the native offer and joins explicit close without a second call", async () => {
    const h = fixture();
    try {
      expect(await h.run()).toEqual({ kind: "connected", sdp: "v=0\r\nanswer" });
      expect(await h.run()).toEqual({ kind: "connected", sdp: "v=0\r\nanswer" });
      expect(h.start).toHaveBeenCalledTimes(1);
      expect(await h.run({ ...command, action: "close" })).toEqual({ kind: "closed", providerConfirmed: true, seconds: 0 });
      expect(h.close).toHaveBeenCalledTimes(1);
    } finally { await h.voice.close(); }
  });

  it.each([
    { userId: "other-member" }, { attemptId: "other-attempt" }, { leaseGeneration: "2" }, { callId: "other-call" },
  ])("rejects a mismatched identity before native startup", async (change) => {
    const h = fixture();
    try {
      expect(await h.run({ ...command, ...change })).toEqual({ kind: "unavailable" });
      expect(h.start).not.toHaveBeenCalled();
    } finally { await h.voice.close(); }
  });

  it("does not let a stale call close the current call", async () => {
    const h = fixture();
    try {
      await h.run();
      expect(await h.run({ ...command, action: "close", callId: "old-call" })).toEqual({
        kind: "closed", providerConfirmed: false, seconds: null,
      });
      expect(h.close).not.toHaveBeenCalled();
      expect(h.voice.isHoldingRuntime()).toBe(true);
    } finally { await h.voice.close(); }
  });

  it("keeps connection unavailable during shutdown but permits final closure", async () => {
    const h = fixture();
    try {
      await h.run();
      h.shutdown.abort();
      expect(await h.run()).toEqual({ kind: "unavailable" });
      expect(await h.run({ ...command, action: "close" })).toMatchObject({ kind: "closed", providerConfirmed: true });
    } finally { await h.voice.close(); }
  });

  it("does not expose a late SDP after the active invocation changes", async () => {
    const h = fixture();
    try {
      h.active.voice = { closeCall: h.close, connect: async () => {
        h.replace(null);
        return "v=0\r\nlate-answer";
      } };
      expect(await h.run()).toEqual({ kind: "unavailable" });
    } finally { await h.voice.close(); }
  });

  it("returns a retryable readiness result before ports are attached", async () => {
    const h = fixture();
    try {
      delete h.active.voice;
      expect(await h.run()).toEqual({ kind: "not_ready" });
    } finally { await h.voice.close(); }
  });
});
