"use client";

import { useId } from "react";
import { Mic, MicOff, Phone, PhoneOff, Volume2 } from "lucide-react";
import { Alert, AlertDescription } from "@/src/components/ui/alert";
import { Button } from "@/src/components/ui/button";
import type { VoiceCallState } from "./browser-voice-call";

export function VoiceCallPanel({ state, signedIn = true, onStart, onEnd, onMute, onPlay }: {
  state: VoiceCallState;
  signedIn?: boolean;
  onStart: () => void;
  onEnd: () => void;
  onMute: () => void;
  onPlay: () => void;
}) {
  const titleId = useId();
  const active = state.phase === "starting" || state.phase === "connected";
  const ending = state.phase === "ending";
  const status = voiceStatus(state);
  return (
    <section aria-labelledby={titleId} className="mx-auto flex w-full max-w-2xl flex-col gap-8 py-8 sm:py-14">
      <header className="flex flex-col gap-3">
        <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Voice</p>
        <h1 id={titleId} className="font-serif text-4xl font-semibold tracking-tight">Talk with Murph</h1>
        <p className="max-w-lg text-base leading-relaxed text-muted-foreground">
          Ask a question, think something through, or pick up where you left off.
        </p>
      </header>
      <div className="flex flex-col gap-6 rounded-2xl border border-border bg-card p-6 sm:p-8">
        <div className="flex items-center gap-3" role="status" aria-live="polite">
          {state.phase === "connected" && !state.muted
            ? <Mic className="size-5 text-primary" aria-hidden />
            : <MicOff className="size-5 text-muted-foreground" aria-hidden />}
          <p className="font-medium">{status}</p>
        </div>
        {state.phase === "starting" && <p className="text-sm text-muted-foreground">Allow your microphone when asked. Getting Murph ready may take a moment.</p>}
        {state.phase === "idle" && <p className="text-sm text-muted-foreground">Your microphone stays off until you start. Calls count toward your AI usage.</p>}
        <div className="flex flex-wrap gap-3">
          {active ? <>
            <Button variant="outline" size="lg" disabled={state.phase !== "connected"} aria-pressed={state.muted} onClick={onMute}>
              {state.muted ? <Mic data-icon="inline-start" /> : <MicOff data-icon="inline-start" />}
              {state.muted ? "Unmute" : "Mute"}
            </Button>
            <Button variant="secondary" size="lg" onClick={onEnd}>
              <PhoneOff data-icon="inline-start" />End call
            </Button>
          </> : <Button size="lg" disabled={ending} onClick={onStart}>
            <Phone data-icon="inline-start" />
            {ending ? "Ending call…" : !signedIn ? "Sign in to talk" : state.phase === "idle" ? "Start call" : "Start another call"}
          </Button>}
          {state.audioBlocked && active && <Button variant="outline" size="lg" onClick={onPlay}>
            <Volume2 data-icon="inline-start" />Play audio
          </Button>}
        </div>
      </div>
      {state.message && <Alert variant={state.phase === "error" ? "destructive" : "default"}>
        <AlertDescription>{state.message}</AlertDescription>
      </Alert>}
      {state.transcript && <section aria-label="Murph's spoken answer" className="flex flex-col gap-3">
        <h2 className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Murph</h2>
        <p className="max-h-64 overflow-y-auto whitespace-pre-wrap text-base leading-relaxed">{state.transcript}</p>
      </section>}
      <p className="text-sm text-muted-foreground">Leaving this page ends the call. Work Murph has already accepted can finish after you hang up.</p>
    </section>
  );
}

function voiceStatus(state: VoiceCallState): string {
  if (state.phase === "starting") return "Connecting…";
  if (state.phase === "connected") return state.muted ? "Microphone muted" : "Microphone on";
  return state.phase === "ending" ? "Ending call…" : "Microphone off";
}
