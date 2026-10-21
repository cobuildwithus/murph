import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBrowserVoiceCall, type VoiceCallState } from "../src/components/voice/browser-voice-call";

class SyntheticPeer {
  static latest: SyntheticPeer;
  connectionState = "new";
  onconnectionstatechange: (() => void) | null = null;
  ontrack: ((event: { streams: object[] }) => void) | null = null;
  channel = { onmessage: null as ((event: { data: string }) => void) | null, onclose: null as (() => void) | null, close: vi.fn() };
  addTrack = vi.fn();
  createOffer = vi.fn(async () => ({ type: "offer", sdp: "v=0\r\nsynthetic-offer" }));
  setLocalDescription = vi.fn(async () => {});
  setRemoteDescription = vi.fn(async () => {});
  close = vi.fn();
  constructor() { SyntheticPeer.latest = this; }
  createDataChannel() { return this.channel; }
  connected() { this.connectionState = "connected"; this.onconnectionstatechange?.(); }
}
class SyntheticAnalyser {
  fftSize = 512;
  amplitude = 0;
  disconnect = vi.fn();
  getFloatTimeDomainData(samples: Float32Array) { samples.fill(this.amplitude); }
}
class SyntheticAudioContext {
  static latest: SyntheticAudioContext;
  state = "running";
  analysers: SyntheticAnalyser[] = [];
  sources: Array<{ connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = [];
  resume = vi.fn(async () => {});
  close = vi.fn(async () => { this.state = "closed"; });
  constructor() { SyntheticAudioContext.latest = this; }
  createAnalyser() { const analyser = new SyntheticAnalyser(); this.analysers.push(analyser); return analyser; }
  createMediaStreamSource() {
    const source = { connect: vi.fn(), disconnect: vi.fn() };
    this.sources.push(source);
    return source;
  }
}
function pending<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function fixture() {
  const track = { enabled: true, stop: vi.fn(), onended: null as (() => void) | null };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const getUserMedia = vi.fn(async () => stream);
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  vi.stubGlobal("RTCPeerConnection", SyntheticPeer);
  const fetch = vi.fn(async (_url: string, options?: RequestInit) => {
    const body = JSON.parse(String(options?.body));
    return Response.json(body.action === "reserve"
      ? { kind: "reserved", callId: body.callId, attemptId: "attempt_synthetic", leaseGeneration: "7" }
      : body.action === "connect" ? { kind: "connected", sdp: "v=0\r\nsynthetic-answer" }
        : { kind: "closed", providerConfirmed: true, seconds: 12 });
  });
  vi.stubGlobal("fetch", fetch);
  const audio = { srcObject: null as HTMLAudioElement["srcObject"], play: vi.fn(async () => {}), pause: vi.fn() };
  const states: VoiceCallState[] = [];
  const call = createBrowserVoiceCall(audio, (state) => states.push(state));
  return { call, track, stream, audio, fetch, getUserMedia, states,
    requests: () => fetch.mock.calls.map(([, options]) => JSON.parse(String(options?.body))),
  };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("browser voice media ownership", () => {
  it("meters local speech, masks muted input and blocked output, and disposes before server closure", async () => {
    vi.stubGlobal("AudioContext", SyntheticAudioContext);
    const h = fixture();
    await h.call.start();
    SyntheticPeer.latest.ontrack?.({ streams: [h.stream] });
    await Promise.resolve();
    const context = SyntheticAudioContext.latest;
    expect(context.analysers).toHaveLength(2);
    context.sources.forEach((source, index) => expect(source.connect).toHaveBeenCalledExactlyOnceWith(context.analysers[index]));
    context.analysers[0]!.amplitude = 0.1;
    context.analysers[1]!.amplitude = 0.08;
    SyntheticPeer.latest.connected();
    await vi.advanceTimersByTimeAsync(50);
    expect(h.states.at(-1)?.inputLevel).toBeGreaterThan(0.04);
    expect(h.states.at(-1)?.outputLevel).toBeGreaterThan(0.04);
    h.call.mute();
    expect(h.states.at(-1)?.inputLevel).toBe(0);
    await vi.advanceTimersByTimeAsync(50);
    expect(h.states.at(-1)?.inputLevel).toBe(0);
    expect(h.states.at(-1)?.outputLevel).toBeGreaterThan(0.04);
    h.audio.play.mockRejectedValueOnce(new Error("blocked"));
    await h.call.play();
    await vi.advanceTimersByTimeAsync(50);
    expect(h.states.at(-1)?.outputLevel).toBe(0);
    const closure = pending<Response>();
    h.fetch.mockImplementationOnce(() => closure.promise);
    const closing = h.call.close();
    expect(context.close).toHaveBeenCalledOnce();
    context.sources.forEach((source) => expect(source.disconnect).toHaveBeenCalledOnce());
    context.analysers.forEach((analyser) => expect(analyser.disconnect).toHaveBeenCalledOnce());
    expect(h.states.at(-1)).toMatchObject({ phase: "ending", inputLevel: 0, outputLevel: 0 });
    const count = h.states.length;
    await vi.advanceTimersByTimeAsync(100);
    expect(h.states).toHaveLength(count);
    closure.resolve(Response.json({ kind: "closed", providerConfirmed: true, seconds: 12 }));
    await closing;
  });

  it("keeps voice usable when optional audio metering is unavailable", async () => {
    vi.stubGlobal("AudioContext", class { constructor() { throw new Error("unsupported"); } });
    const h = fixture();
    await h.call.start();
    SyntheticPeer.latest.connected();
    expect(h.states.at(-1)?.phase).toBe("connected");
    await h.call.close();
    expect(h.states.at(-1)?.phase).toBe("ended");
  });
  it("starts only on request, uses one fenced call, mutes locally, and releases media before awaiting closure", async () => {
    const h = fixture();
    expect(h.getUserMedia).not.toHaveBeenCalled();
    await h.call.start();
    const peer = SyntheticPeer.latest;
    expect(h.states.at(-1)?.phase).toBe("starting");
    peer.connected();
    h.call.mute();
    expect(h.track.enabled).toBe(false);
    expect(h.states.at(-1)?.muted).toBe(true);
    h.call.mute();
    expect(h.track.enabled).toBe(true);
    const closure = pending<Response>();
    h.fetch.mockImplementationOnce(() => closure.promise);
    const closing = h.call.close();
    expect(h.track.stop).toHaveBeenCalledOnce();
    expect(peer.close).toHaveBeenCalledOnce();
    expect(h.states.at(-1)?.phase).toBe("ending");
    closure.resolve(Response.json({ kind: "closed", providerConfirmed: true, seconds: 12 }));
    await closing;
    expect(h.states.at(-1)?.phase).toBe("ended");
    const [reserve, connect, close] = h.requests();
    expect(connect).toEqual({ action: "connect", callId: reserve.callId,
      attemptId: "attempt_synthetic", leaseGeneration: "7", sdp: "v=0\r\nsynthetic-offer" });
    expect(close).toEqual({ action: "close", callId: reserve.callId, attemptId: "attempt_synthetic", leaseGeneration: "7" });
  });

  it("stops a microphone permission result arriving after cancellation without reserving work", async () => {
    vi.stubGlobal("AudioContext", SyntheticAudioContext);
    const h = fixture();
    const permission = pending<typeof h.stream>();
    h.getUserMedia.mockImplementationOnce(() => permission.promise);
    const starting = h.call.start();
    await h.call.close();
    permission.resolve(h.stream);
    await starting;
    expect(h.track.stop).toHaveBeenCalledOnce();
    expect(h.fetch).not.toHaveBeenCalled();
    expect(h.states.at(-1)?.phase).toBe("ended");
    expect(SyntheticAudioContext.latest.close).toHaveBeenCalledOnce();
    expect(SyntheticAudioContext.latest.analysers).toHaveLength(0);
  });

  it("closes an acknowledged reservation arriving after cancellation without connecting", async () => {
    const h = fixture();
    const reservation = pending<Response>();
    h.fetch.mockImplementationOnce(() => reservation.promise);
    const starting = h.call.start();
    await vi.waitFor(() => expect(h.fetch).toHaveBeenCalledOnce());
    await h.call.close();
    reservation.resolve(Response.json({ kind: "reserved", attemptId: "attempt_synthetic", leaseGeneration: "7" }));
    await starting;
    expect(h.requests().map((value) => value.action)).toEqual(["reserve", "close"]);
    expect(SyntheticPeer.latest.setRemoteDescription).not.toHaveBeenCalled();
  });

  it("reuses the exact offer while the invocation becomes ready", async () => {
    const h = fixture();
    const normal = h.fetch.getMockImplementation()!;
    let first = true;
    h.fetch.mockImplementation(async (url, options) => {
      if (JSON.parse(String(options?.body)).action === "connect" && first) {
        first = false;
        return Response.json({ kind: "not_ready" });
      }
      return normal(url, options);
    });
    const starting = h.call.start();
    await vi.waitFor(() => expect(h.fetch).toHaveBeenCalledTimes(2));
    await vi.advanceTimersByTimeAsync(1_000);
    await starting;
    const calls = h.requests();
    expect(calls[1]).toEqual(calls[2]);
    expect(SyntheticPeer.latest.createOffer).toHaveBeenCalledOnce();
    await h.call.close();
  });

  it("does not apply an SDP answer after the member ends the call", async () => {
    const h = fixture();
    const answer = pending<Response>();
    const normal = h.fetch.getMockImplementation()!;
    h.fetch.mockImplementation((url, options) =>
      JSON.parse(String(options?.body)).action === "connect" ? answer.promise : normal(url, options));
    const starting = h.call.start();
    await vi.waitFor(() => expect(h.fetch).toHaveBeenCalledTimes(2));
    await h.call.close();
    answer.resolve(Response.json({ kind: "connected", sdp: "v=0\r\nlate-answer" }));
    await starting;
    expect(SyntheticPeer.latest.setRemoteDescription).not.toHaveBeenCalled();
  });

  it("releases media on permission denial and shows a useful recovery without private errors", async () => {
    const h = fixture();
    h.getUserMedia.mockRejectedValueOnce(new DOMException("private-device-detail", "NotAllowedError"));
    await h.call.start();
    expect(h.states.at(-1)).toMatchObject({ phase: "error", message: "Allow microphone access in your browser, then start a new call." });
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it("ends on a lost connection without automatic reconnection", async () => {
    const h = fixture();
    await h.call.start();
    SyntheticPeer.latest.connected();
    SyntheticPeer.latest.connectionState = "disconnected";
    SyntheticPeer.latest.onconnectionstatechange?.();
    await h.call.close();
    expect(h.track.stop).toHaveBeenCalledOnce();
    expect(h.requests().map((value) => value.action)).toEqual(["reserve", "connect", "close"]);
    expect(h.states.at(-1)?.message).toContain("Connection lost");
  });

  it("bounds captions, offers audio playback recovery, and treats browser closure only as a close request", async () => {
    const h = fixture();
    await h.call.start();
    const peer = SyntheticPeer.latest;
    peer.connected();
    h.audio.play.mockRejectedValueOnce(new DOMException("blocked", "NotAllowedError"));
    peer.ontrack?.({ streams: [h.stream] });
    await vi.waitFor(() => expect(h.states.at(-1)?.audioBlocked).toBe(true));
    await h.call.play();
    expect(h.states.at(-1)?.audioBlocked).toBe(false);
    peer.channel.onmessage?.({ data: JSON.stringify({ type: "session.output_transcript.delta", delta: "x".repeat(9_000) }) });
    expect(h.states.at(-1)?.transcript).toHaveLength(8_000);
    peer.channel.onmessage?.({ data: JSON.stringify({ type: "session.closed" }) });
    await h.call.close();
    expect(h.requests().at(-1).action).toBe("close");
    expect(h.audio.pause).toHaveBeenCalledOnce();
  });

  it("ends a connection that never reaches audio readiness", async () => {
    const h = fixture();
    await h.call.start();
    await vi.advanceTimersByTimeAsync(20_000);
    await h.call.close();
    expect(h.track.stop).toHaveBeenCalledOnce();
    expect(h.states.at(-1)?.message).toContain("Could not connect audio");
  });

  it("does not claim confirmed closure when its authenticated request fails", async () => {
    const h = fixture();
    await h.call.start();
    h.fetch.mockRejectedValueOnce(new Error("private-upstream-detail"));
    await h.call.close();
    expect(h.states.at(-1)).toMatchObject({ phase: "ended", message: "Your microphone is off. Call closure could not be confirmed." });
  });

  it("does not stop a newer call's playback when an old microphone prompt resolves", async () => {
    const h = fixture();
    const permission = pending<typeof h.stream>();
    h.getUserMedia.mockImplementationOnce(() => permission.promise);
    const starting = h.call.start();
    await h.call.close();
    // A replacement call owns this element now; old cleanup must not touch it.
    const replacementAudio = {} as MediaStream;
    h.audio.srcObject = replacementAudio;
    permission.resolve(h.stream);
    await starting;
    expect(h.audio.srcObject).toBe(replacementAudio);
    expect(h.audio.pause).not.toHaveBeenCalled();
    expect(h.track.stop).toHaveBeenCalledOnce();
  });
});
