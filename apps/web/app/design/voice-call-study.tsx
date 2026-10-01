"use client";

import { VoiceCallPanel } from "@/src/components/voice/voice-call-panel";
import { INITIAL_VOICE_CALL_STATE, type VoiceCallState } from "@/src/components/voice/browser-voice-call";

const noAction = () => undefined;
const actions = { onStart: noAction, onEnd: noAction, onMute: noAction, onPlay: noAction };
const states: Record<string, Partial<VoiceCallState>> = {
  idle: {},
  connecting: { phase: "starting" },
  listening: { phase: "connected", inputLevel: 0.35 },
  speaking: { phase: "connected", outputLevel: 0.5 },
  muted: { phase: "connected", muted: true,
    transcript: "I can help you think that through. What would you like to focus on first?" },
  playback: { phase: "connected", audioBlocked: true },
  ending: { phase: "ending" },
  permission: { phase: "error", message: "Allow microphone access in your browser, then start a new call." },
};

export function VoiceCallStudy() {
  return <div id="voice-call" data-design-section="voice-call">
    {Object.entries(states).map(([name, state]) => <div key={name} data-voice-state={name} inert>
      <VoiceCallPanel state={{ ...INITIAL_VOICE_CALL_STATE, ...state }} {...actions} />
    </div>)}
  </div>;
}
