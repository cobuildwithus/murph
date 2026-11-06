"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/src/components/hosted-onboarding/auth-dialog-provider";
import { createBrowserVoiceCall, INITIAL_VOICE_CALL_STATE } from "./browser-voice-call";
import { VoiceCallPanel } from "./voice-call-panel";

export function VoiceCall({ signedIn }: { signedIn: boolean }) {
  const { openAuthDialog } = useAuth();
  const [state, setState] = useState(INITIAL_VOICE_CALL_STATE);
  const audio = useRef<HTMLAudioElement>(null);
  const current = useRef<ReturnType<typeof createBrowserVoiceCall> | null>(null);
  useEffect(() => {
    const end = () => {
      const call = current.current;
      current.current = null;
      void call?.close();
      if (call) setState((previous) => ({ ...previous, phase: "ended", message: "Call ended." }));
    };
    window.addEventListener("pagehide", end);
    return () => { window.removeEventListener("pagehide", end); end(); };
  }, []);
  const start = () => {
    if (!signedIn) { openAuthDialog(); return; }
    if (!audio.current) return;
    if (current.current && state.phase !== "ended" && state.phase !== "error") return;
    const previous = current.current;
    current.current = null;
    void previous?.close();
    const call = createBrowserVoiceCall(audio.current, (next) => {
      if (current.current === call) setState(next);
    });
    current.current = call;
    void call.start();
  };
  return <>
    <audio ref={audio} autoPlay />
    <VoiceCallPanel state={state} signedIn={signedIn} onStart={start}
      onEnd={() => { void current.current?.close(); }}
      onMute={() => current.current?.mute()}
      onPlay={() => { void current.current?.play(); }} />
  </>;
}
