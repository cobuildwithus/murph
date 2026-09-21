"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_LIVE_VOICE, type LiveVoice } from "@/src/lib/live-voice/voices";
import { LiveVoiceSession, type VoiceSnapshot } from "./live-voice-session";

export type UseLiveVoiceOptions = { endpoint: string; voice?: LiveVoice };

/** One call per mounted hook; microphone acquisition starts only on toggle. */
export function useLiveVoice({ endpoint, voice = DEFAULT_LIVE_VOICE }: UseLiveVoiceOptions) {
  const [snapshot, setSnapshot] = useState<VoiceSnapshot>({ state: "idle" });
  const session = useRef<LiveVoiceSession | null>(null);
  useEffect(() => {
    const dispose = () => session.current?.dispose();
    const pageHidden = () => { dispose(); setSnapshot({ state: "idle" }); };
    window.addEventListener("pagehide", pageHidden);
    return () => { window.removeEventListener("pagehide", pageHidden); dispose(); };
  }, []);

  const toggle = useCallback(() => {
    if (snapshot.state === "idle" || snapshot.state === "error") {
      session.current?.dispose();
      session.current = new LiveVoiceSession(setSnapshot, endpoint, voice);
      void session.current.start();
    } else session.current?.togglePause();
  }, [snapshot.state, endpoint, voice]);
  const end = useCallback(() => session.current?.end(), []);
  return { snapshot, toggle, end, canChangeVoice: snapshot.state === "idle" || snapshot.state === "error" };
}
