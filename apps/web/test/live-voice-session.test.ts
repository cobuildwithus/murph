import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveVoiceSession, type VoiceSnapshot } from "../src/components/live-voice/live-voice-session";

class FakeChannel {
  readyState = "open";
  onmessage?: (event: { data: string }) => void;
  onclose?: () => void;
  onerror?: () => void;
  send = vi.fn();
  close = vi.fn();
  emit(event: object) { this.onmessage?.({ data: JSON.stringify(event) }); }
}
class FakePeer extends EventTarget {
  static latest: FakePeer;
  channel = new FakeChannel();
  iceGatheringState = "complete";
  connectionState = "connected";
  localDescription = { sdp: "v=0" };
  ontrack?: unknown;
  onconnectionstatechange?: () => void;
  close = vi.fn();
  addTrack = vi.fn();
  createOffer = vi.fn(async () => ({ sdp: "v=0" }));
  setLocalDescription = vi.fn(async () => {});
  setRemoteDescription = vi.fn(async () => {});
  createDataChannel() { return this.channel; }
  constructor() { super(); FakePeer.latest = this; }
}
class FakeAudio {
  static latest: FakeAudio;
  muted = false;
  autoplay = false;
  srcObject: unknown;
  play = vi.fn(async () => {});
  pause = vi.fn();
  constructor() { FakeAudio.latest = this; }
}
const track = { enabled: true, stop: vi.fn(), onended: undefined };
const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
const updates: VoiceSnapshot[] = [];
let session: LiveVoiceSession;
let getUserMedia: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers();
  updates.length = 0;
  track.enabled = true;
  track.stop.mockClear();
  getUserMedia = vi.fn(async () => stream);
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  vi.stubGlobal("RTCPeerConnection", FakePeer);
  vi.stubGlobal("Audio", FakeAudio);
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ sdp: "answer" })));
  session = new LiveVoiceSession((snapshot) => updates.push(snapshot), "/api/live-voice/session");
});
afterEach(() => { session.dispose(); vi.useRealTimers(); vi.unstubAllGlobals(); });
function lastState() { return updates.at(-1)?.state; }
function acknowledge(type: string) {
  const channel = FakePeer.latest.channel;
  const sent = JSON.parse(channel.send.mock.calls.at(-1)![0]);
  channel.emit({ type, client_event_id: sent.event_id });
}
describe("GPT-Live call lifecycle", () => {
  it("waits for readiness, acknowledges pause/resume, then gracefully closes", async () => {
    await session.start();
    expect(lastState()).toBe("connecting");
    expect(track.enabled).toBe(false);
    const channel = FakePeer.latest.channel;
    channel.emit({ type: "session.started" });
    expect(lastState()).toBe("live");
    expect(track.enabled).toBe(true);
    session.togglePause();
    expect(lastState()).toBe("pausing");
    expect(track.enabled).toBe(false);
    expect(FakeAudio.latest.muted).toBe(true);
    channel.emit({ type: "session.input_audio.muted", client_event_id: "wrong" });
    expect(lastState()).toBe("pausing");
    acknowledge("session.input_audio.muted");
    expect(lastState()).toBe("paused");
    session.togglePause();
    expect(track.enabled).toBe(false);
    acknowledge("session.input_audio.unmuted");
    expect(lastState()).toBe("live");
    expect(track.enabled).toBe(true);
    expect(FakeAudio.latest.muted).toBe(false);
    session.end();
    expect(lastState()).toBe("ending");
    expect(track.enabled).toBe(false);
    expect(FakePeer.latest.close).not.toHaveBeenCalled();
    channel.emit({ type: "session.closed" });
    expect(lastState()).toBe("idle");
    expect(track.stop).toHaveBeenCalled();
    expect(FakePeer.latest.close).toHaveBeenCalled();
  });
  it("releases a microphone granted after startup is cancelled", async () => {
    let grant!: (value: typeof stream) => void;
    getUserMedia.mockImplementation(() => new Promise((resolve) => { grant = resolve; }));
    const starting = session.start();
    session.end();
    grant(stream);
    await starting;
    expect(track.stop).toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(lastState()).toBe("idle");
  });
  it("cleans up denied permissions and stalled handshakes", async () => {
    getUserMedia.mockRejectedValue(new DOMException("denied", "NotAllowedError"));
    await session.start();
    expect(lastState()).toBe("error");
    expect(updates.at(-1)?.error).toContain("Allow microphone");
    expect(FakePeer.latest.close).toHaveBeenCalled();
  });
  it("fails closed if pause is never acknowledged", async () => {
    await session.start();
    FakePeer.latest.channel.emit({ type: "session.started" });
    session.togglePause();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(lastState()).toBe("error");
    expect(track.enabled).toBe(false);
    expect(track.stop).toHaveBeenCalled();
  });
  it("releases resources and suppresses updates after disposal", async () => {
    await session.start();
    FakePeer.latest.channel.emit({ type: "session.started" });
    const count = updates.length;
    session.dispose();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(updates).toHaveLength(count);
    expect(track.stop).toHaveBeenCalled();
    expect(FakeAudio.latest.srcObject).toBeNull();
  });
});
