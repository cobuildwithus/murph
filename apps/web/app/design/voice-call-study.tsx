"use client";

import { VoiceCallPanel } from "@/src/components/voice/voice-call-panel";
import { INITIAL_VOICE_CALL_STATE } from "@/src/components/voice/browser-voice-call";

const noAction = () => undefined;
const actions = { onStart: noAction, onEnd: noAction, onMute: noAction, onPlay: noAction };

export function VoiceCallStudy() {
  return <div id="voice-call" data-design-section="voice-call">
    <div inert><VoiceCallPanel state={INITIAL_VOICE_CALL_STATE} {...actions} /></div>
    <div inert><VoiceCallPanel state={{ ...INITIAL_VOICE_CALL_STATE, phase: "connected", muted: true,
      transcript: "I can help you think that through. What would you like to focus on first?" }} {...actions} /></div>
    <div inert><VoiceCallPanel state={{ ...INITIAL_VOICE_CALL_STATE, phase: "error",
      message: "Allow microphone access in your browser, then start a new call." }} {...actions} /></div>
  </div>;
}
