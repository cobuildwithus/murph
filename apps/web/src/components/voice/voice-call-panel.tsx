"use client";

import { useId } from "react";
import { LoaderCircle, MicOff, Square, Volume2 } from "lucide-react";
import { Alert, AlertDescription } from "@/src/components/ui/alert";
import { VoiceOrb } from "@/src/components/voice-orb/voice-orb";
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
  const statusId = useId();
  const connected = state.phase === "connected";
  const starting = state.phase === "starting";
  return (
    <section aria-labelledby={titleId} className="mx-auto flex w-full max-w-2xl flex-col items-center gap-8 py-8 sm:py-14">
      <header className="flex flex-col items-center gap-4 text-center">
        <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Voice</p>
        <h1 id={titleId} className="font-serif text-4xl font-semibold tracking-tight">Talk with Murph</h1>
        <p className="max-w-sm text-sm leading-6 text-muted-foreground">
          Ask a question, think something through, or pick up where you left off.
        </p>
      </header>
      <div className="flex w-full flex-col items-center gap-6 py-4">
        <VoiceCallOrb state={state} signedIn={signedIn} statusId={statusId} onStart={onStart} onMute={onMute} />
        <div className="min-h-24 text-center">
          <p id={statusId} role="status" aria-live="polite" className="text-sm font-medium">{voiceStatus(state)}</p>
          <p className="mt-2 text-sm text-muted-foreground">{voiceHint(state, signedIn)}</p>
          {(starting || connected) && <button type="button" onClick={onEnd}
            className="mx-auto mt-2 flex min-h-11 cursor-pointer items-center gap-2 rounded px-3 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
            <Square aria-hidden className="size-3" />{starting ? "Cancel" : "End call"}
          </button>}
          {state.audioBlocked && connected && <button type="button" onClick={onPlay}
            className="mx-auto flex min-h-11 cursor-pointer items-center gap-2 rounded px-3 text-sm text-foreground underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring">
            <Volume2 aria-hidden className="size-4" />Play audio
          </button>}
        </div>
      </div>
      {state.message && <Alert variant={state.phase === "error" ? "destructive" : "default"}>
        <AlertDescription>{state.message}</AlertDescription>
      </Alert>}
      {state.transcript && <section aria-label="Murph's spoken answer" className="flex w-full flex-col gap-3">
        <h2 className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Murph</h2>
        <p className="max-h-64 overflow-y-auto whitespace-pre-wrap text-base leading-relaxed">{state.transcript}</p>
      </section>}
      <p className="max-w-sm text-center text-xs leading-5 text-muted-foreground">
        Calls count toward your AI usage until they end, including while muted.
        Leaving this page ends the call. Work Murph has already accepted can finish after you hang up.
      </p>
    </section>
  );
}

function VoiceCallOrb({ state, signedIn, statusId, onStart, onMute }: {
  state: VoiceCallState;
  signedIn: boolean;
  statusId: string;
  onStart: () => void;
  onMute: () => void;
}) {
  const connected = state.phase === "connected";
  const starting = state.phase === "starting";
  const busy = starting || state.phase === "ending";
  const input = connected && !state.muted ? state.inputLevel ?? 0 : 0;
  const output = connected && !state.audioBlocked ? state.outputLevel ?? 0 : 0;
  const userSpeaking = input > 0.04;
  const inputMotion = Math.sqrt(Math.min(1, input * 3));
  const outputMotion = Math.sqrt(Math.min(1, output * 3));
  const action = voiceAction(state, signedIn);
  return (
    <button
      type="button"
      aria-describedby={statusId}
      aria-pressed={connected ? state.muted : undefined}
      disabled={busy}
      onClick={connected ? onMute : onStart}
      data-speaker={userSpeaking ? "user" : output > 0.04 ? "assistant" : "none"}
      className="relative grid size-48 shrink-0 cursor-pointer place-items-center rounded-full border-0 bg-transparent focus-visible:outline-2 focus-visible:outline-offset-8 focus-visible:outline-ring disabled:cursor-wait sm:size-56"
    >
      <span className="sr-only">{action}</span>
      <span
        className="pointer-events-none absolute inset-0 rounded-full transition-transform duration-300 ease-out motion-reduce:transition-none motion-reduce:transform-none!"
        style={{ transform: `scale(${userSpeaking ? 0.8 - input * 0.04 : 1 + outputMotion * 0.06})` }}
      >
        <VoiceOrb size="100%" energy={Math.min(1, outputMotion * 1.2 + inputMotion * 0.8)}
          speed={0.18 + inputMotion * 1.8 + outputMotion * 3.2}
          paused={busy || state.phase === "error"} />
      </span>
      {busy && <LoaderCircle aria-hidden className="relative size-5 text-white motion-safe:animate-spin" />}
      {connected && state.muted && <MicOff aria-hidden className="relative size-5 text-white" />}
    </button>
  );
}

function voiceAction(state: VoiceCallState, signedIn: boolean): string {
  if (state.phase === "connected") return state.muted ? "Unmute microphone" : "Mute microphone";
  if (state.phase === "starting") return "Connecting…";
  if (state.phase === "ending") return "Ending call…";
  if (!signedIn) return "Sign in to talk";
  return state.phase === "idle" ? "Start call" : "Start another call";
}

function voiceStatus(state: VoiceCallState): string {
  if (state.phase === "starting") return "Connecting…";
  if (state.phase === "connected") return state.muted ? "Microphone muted" : "Microphone on";
  return state.phase === "ending" ? "Ending call…" : "Microphone off";
}

function voiceHint(state: VoiceCallState, signedIn: boolean): string {
  if (state.phase === "starting") return "Allow your microphone when asked. Getting Murph ready may take a moment.";
  if (state.phase === "ending") return "Your microphone is off.";
  if (state.phase === "connected") return state.muted ? "Tap the circle to unmute." : "Talk naturally. Tap the circle to mute.";
  return signedIn ? "Tap the circle to talk." : "Sign in to start a conversation.";
}
