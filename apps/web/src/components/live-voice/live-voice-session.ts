export type VoiceState = "idle" | "connecting" | "live" | "pausing" | "paused" | "resuming" | "ending" | "error";
export type VoiceSnapshot = { state: VoiceState; error?: string };

/** Owns one browser call. Audio and transcripts are never persisted by the demo. */
export class LiveVoiceSession {
  private peer?: RTCPeerConnection;
  private events?: RTCDataChannel;
  private microphone?: MediaStream;
  private audio?: HTMLAudioElement;
  private abort = new AbortController();
  private timeout?: ReturnType<typeof setTimeout>;
  private pending?: string;
  private state: VoiceState = "idle";
  private disposed = false;

  constructor(private readonly update: (snapshot: VoiceSnapshot) => void, private readonly endpoint: string) {}

  private publish(state: VoiceState, error?: string) {
    this.state = state;
    if (!this.disposed) this.update({ state, error });
  }

  private release() {
    clearTimeout(this.timeout);
    this.abort.abort();
    this.microphone?.getTracks().forEach((track) => track.stop());
    if (this.events) {
      this.events.onmessage = null;
      this.events.onclose = null;
      this.events.onerror = null;
      this.events.close();
    }
    if (this.peer) {
      this.peer.onconnectionstatechange = null;
      this.peer.ontrack = null;
      this.peer.close();
    }
    if (this.audio) {
      this.audio.pause();
      this.audio.srcObject = null;
    }
  }

  private fail(message: string) {
    this.release();
    this.publish("error", message);
  }

  private deadline(message: string, milliseconds = 10_000) {
    clearTimeout(this.timeout);
    this.timeout = setTimeout(() => this.fail(message), milliseconds);
  }

  private silence(muted: boolean) {
    this.microphone?.getAudioTracks().forEach((track) => { track.enabled = !muted; });
    if (this.audio) this.audio.muted = muted;
  }

  private send(type: string, eventId?: string) {
    if (this.events?.readyState !== "open") throw new Error("The voice connection closed. Start again.");
    this.events.send(JSON.stringify({ type, event_id: eventId }));
  }

  private receive(data: string) {
    let event: { type?: string; client_event_id?: string };
    try { event = JSON.parse(data); } catch { return; }
    if (!event || typeof event !== "object") return;
    if (event.type === "session.closed") {
      this.release();
      this.publish("idle");
    } else if (event.type === "error") {
      this.fail("The voice session reported an error. End this call and try again.");
    } else if (event.type === "session.started" && this.state === "connecting") {
      clearTimeout(this.timeout);
      this.silence(false);
      this.publish("live");
    } else if (event.client_event_id === this.pending && this.pending) {
      if (event.type === "session.input_audio.muted" && this.state === "pausing") {
        clearTimeout(this.timeout);
        this.pending = undefined;
        this.publish("paused");
      } else if (event.type === "session.input_audio.unmuted" && this.state === "resuming") {
        clearTimeout(this.timeout);
        this.pending = undefined;
        this.silence(false);
        this.publish("live");
      }
    }
  }

  async start() {
    if (this.disposed || this.state !== "idle") return;
    if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === "undefined") {
      this.fail("Voice needs a browser with microphone access on HTTPS or localhost.");
      return;
    }
    this.publish("connecting");
    // Covers permission, signaling, and a missing session.started event.
    this.deadline("Connection timed out. Check microphone permission and try again.", 45_000);
    try {
      const peer = new RTCPeerConnection();
      this.peer = peer;
      this.audio = new Audio();
      this.audio.autoplay = true;
      peer.ontrack = ({ track }) => {
        if (this.abort.signal.aborted || !this.audio) return;
        this.audio.srcObject = new MediaStream([track]);
        void this.audio.play().catch(() => this.fail("Audio playback was blocked. Allow audio for this site and try again."));
      };
      peer.onconnectionstatechange = () => {
        if (["failed", "disconnected"].includes(peer.connectionState)) this.fail("Voice disconnected. Click to start again.");
      };
      const microphone = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (this.abort.signal.aborted) {
        microphone.getTracks().forEach((track) => track.stop());
        return;
      }
      this.microphone = microphone;
      for (const track of microphone.getAudioTracks()) {
        track.enabled = false;
        track.onended = () => { if (!this.abort.signal.aborted) this.fail("Microphone disconnected. Reconnect it and try again."); };
        peer.addTrack(track, microphone);
      }
      const events = peer.createDataChannel("oai-events");
      this.events = events;
      events.onmessage = ({ data }) => this.receive(data);
      events.onclose = () => this.fail("Voice disconnected. Click to start again.");
      events.onerror = () => this.fail("Voice connection failed. Please try again.");
      await peer.setLocalDescription(await peer.createOffer());
      await waitForIce(peer, this.abort.signal);
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sdp: peer.localDescription?.sdp }),
        signal: this.abort.signal,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not start voice. Please try again.");
      if (this.abort.signal.aborted) return;
      await peer.setRemoteDescription({ type: "answer", sdp: result.sdp });
    } catch (error) {
      if (this.abort.signal.aborted) return;
      const message = error instanceof Error ? error.message : "Could not start voice.";
      this.fail(error instanceof DOMException && error.name === "NotAllowedError"
        ? "Allow microphone access in your browser, then try again." : message);
    }
  }

  togglePause() {
    if (this.state !== "live" && this.state !== "paused") return;
    const pausing = this.state === "live";
    this.silence(true);
    this.publish(pausing ? "pausing" : "resuming");
    this.pending = crypto.randomUUID();
    this.deadline("Could not change microphone state. Please start a new call.");
    try { this.send(pausing ? "session.input_audio.mute" : "session.input_audio.unmute", this.pending); }
    catch { this.fail("Voice disconnected. Click to start again."); }
  }

  end() {
    if (this.state === "connecting") {
      this.release();
      this.publish("idle");
      return;
    }
    if (!["live", "paused", "pausing", "resuming"].includes(this.state)) return;
    this.silence(true);
    this.publish("ending");
    this.deadline("Call disconnected; OpenAI did not confirm finalization.", 15_000);
    try { this.send("session.close"); }
    catch { this.fail("Call disconnected; OpenAI did not confirm finalization."); }
  }

  dispose() {
    this.disposed = true;
    if (this.events?.readyState === "open") {
      try { this.send("session.close"); } catch { /* Release local media regardless. */ }
    }
    this.release();
  }
}

function waitForIce(peer: RTCPeerConnection, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new Error("Connection cancelled."));
  if (peer.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timer);
      peer.removeEventListener("icegatheringstatechange", changed);
      signal.removeEventListener("abort", cancelled);
      if (error) reject(error); else resolve();
    };
    const changed = () => { if (peer.iceGatheringState === "complete") finish(); };
    const cancelled = () => finish(new Error("Connection cancelled."));
    const timer = setTimeout(() => finish(new Error("Could not connect audio. Check your network and try again.")), 10_000);
    peer.addEventListener("icegatheringstatechange", changed);
    signal.addEventListener("abort", cancelled, { once: true });
    changed();
  });
}
