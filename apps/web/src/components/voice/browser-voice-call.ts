import { parseHostedVoiceControlRequest, parseHostedVoiceControlResponse } from "@murphai/hosted-execution/voice-control";
import { HostedOnboardingApiError, requestHostedOnboardingJson } from "@/src/components/hosted-onboarding/client-api";

export type VoiceCallState = {
  phase: "idle" | "starting" | "connected" | "ending" | "ended" | "error";
  muted: boolean;
  audioBlocked: boolean;
  transcript: string;
  message: string | null;
};
export const INITIAL_VOICE_CALL_STATE: VoiceCallState = {
  phase: "idle", muted: false, audioBlocked: false, transcript: "", message: null,
};
type CallIdentity = { callId: string; attemptId: string; leaseGeneration: string };

/** Browser media only. The authenticated server owns admission, work, and settlement. */
export function createBrowserVoiceCall(
  audio: Pick<HTMLAudioElement, "srcObject" | "play" | "pause">,
  onChange: (state: VoiceCallState) => void,
) {
  const callId = crypto.randomUUID();
  let state: VoiceCallState = { ...INITIAL_VOICE_CALL_STATE, phase: "starting" };
  let stopped = false;
  let identity: CallIdentity | null = null;
  let stream: MediaStream | null = null;
  let remoteStream: MediaStream | null = null;
  let peer: RTCPeerConnection | null = null;
  let events: RTCDataChannel | null = null;
  let connectionTimer: ReturnType<typeof setTimeout> | undefined;
  let closing: Promise<void> | null = null;
  const changed = (patch: Partial<VoiceCallState>) => {
    state = { ...state, ...patch };
    onChange(state);
  };
  const request = (payload: Record<string, unknown>, keepalive = false) =>
    requestHostedOnboardingJson<unknown>({
      url: "/api/voice", payload, keepalive, signal: AbortSignal.timeout(45_000),
    });
  function releaseMedia() {
    clearTimeout(connectionTimer);
    for (const track of stream?.getTracks() ?? []) track.stop();
    events?.close();
    peer?.close();
    if (remoteStream && audio.srcObject === remoteStream) {
      audio.pause();
      audio.srcObject = null;
    }
  }
  async function closeOnServer() {
    if (!identity) return;
    const response = parseHostedVoiceControlResponse(await request({ action: "close", ...identity }, true));
    if (response.kind !== "closed" || !response.providerConfirmed) {
      changed({ message: "Your microphone is off. Call closure could not be confirmed." });
    }
  }
  function close(message: string | null = null): Promise<void> {
    if (closing) return closing;
    stopped = true;
    changed({ phase: "ending", message });
    // Release microphone synchronously, before any network or provider wait.
    releaseMedia();
    closing = closeOnServer().catch(() => {
      changed({ message: "Your microphone is off. Call closure could not be confirmed." });
    }).finally(() => changed({ phase: "ended" }));
    return closing;
  }
  async function play() {
    try { await audio.play(); if (!stopped) changed({ audioBlocked: false }); }
    catch { if (!stopped) changed({ audioBlocked: true }); }
  }
  async function reserve() {
    const deadline = Date.now() + 60_000;
    while (!stopped) {
      const response = await request({ action: "reserve", callId });
      if (response && typeof response === "object" && "kind" in response && response.kind === "reserved") {
        const parsed = parseHostedVoiceControlRequest({
          action: "close", callId,
          attemptId: "attemptId" in response ? response.attemptId : null,
          leaseGeneration: "leaseGeneration" in response ? response.leaseGeneration : null,
        });
        identity = { callId, attemptId: parsed.attemptId, leaseGeneration: parsed.leaseGeneration };
        // A permission prompt or reservation may resolve after the member ends.
        if (stopped) await closeOnServer();
        return;
      }
      if (Date.now() >= deadline) throw new Error("Voice startup timed out.");
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
  async function connect(sdp: string) {
    const deadline = Date.now() + 60_000;
    while (!stopped) {
      const response = parseHostedVoiceControlResponse(await request({ action: "connect", ...identity, sdp }));
      if (stopped) return;
      if (response.kind === "connected") {
        await peer!.setRemoteDescription({ type: "answer", sdp: response.sdp });
        return;
      }
      if (response.kind !== "not_ready" || Date.now() >= deadline) throw new Error("Voice connection unavailable.");
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
  function readEvent(event: MessageEvent) {
    if (stopped || typeof event.data !== "string") return;
    let value: unknown;
    try { value = JSON.parse(event.data); } catch { return; }
    if (!value || typeof value !== "object" || !("type" in value)) return;
    if (value.type === "session.closed") void close("Call ended.");
    if (value.type === "session.output_transcript.delta" && "delta" in value && typeof value.delta === "string") {
      changed({ transcript: (state.transcript + value.delta).slice(-8_000) });
    }
  }
  async function start() {
    changed({});
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === "undefined") {
        throw new Error("Voice is not supported.");
      }
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (stopped) { releaseMedia(); return; }
      peer = new RTCPeerConnection();
      for (const track of stream.getAudioTracks()) {
        peer.addTrack(track, stream);
        track.onended = () => { if (!stopped) void close("Microphone disconnected."); };
      }
      peer.ontrack = (event) => {
        if (stopped) return;
        remoteStream = event.streams[0] ?? new MediaStream([event.track]);
        audio.srcObject = remoteStream;
        void play();
      };
      peer.onconnectionstatechange = () => {
        if (stopped) return;
        if (peer?.connectionState === "connected") {
          clearTimeout(connectionTimer);
          changed({ phase: "connected" });
        } else if (peer?.connectionState === "failed" || peer?.connectionState === "disconnected") {
          void close("Connection lost. Start a new call when you are ready.");
        }
      };
      events = peer.createDataChannel("oai-events");
      events.onmessage = readEvent;
      events.onclose = () => { if (!stopped) void close("Connection closed."); };
      await reserve();
      if (stopped) return;
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      if (!offer.sdp) throw new Error("Voice offer unavailable.");
      // One offer and call id survive readiness retries; never create another paid call.
      await connect(offer.sdp);
      if (!stopped && peer.connectionState !== "connected") {
        connectionTimer = setTimeout(() => { void close("Could not connect audio. Try another call."); }, 20_000);
      }
    } catch (error) {
      if (stopped) return;
      await close();
      changed({ phase: "error", message: describeVoiceError(error) });
    }
  }
  return {
    start, close, play,
    mute() {
      if (stopped || state.phase !== "connected") return;
      const muted = !state.muted;
      for (const track of stream?.getAudioTracks() ?? []) track.enabled = !muted;
      changed({ muted });
    },
  };
}

function describeVoiceError(error: unknown): string {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "Allow microphone access in your browser, then start a new call.";
  }
  if (error instanceof HostedOnboardingApiError) {
    if (error.code === "VOICE_ACCESS_REQUIRED") return error.message;
    if (error.code?.includes("AUTH") || error.code?.includes("SESSION")) return "Sign in again to start a call.";
  }
  if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === "undefined") {
    return "Voice needs a browser with microphone support. Try a current version of Safari or Chrome.";
  }
  return "Could not start the call. Your microphone is off. Try again.";
}
