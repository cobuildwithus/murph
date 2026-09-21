"use client";

import { LoaderCircle, Play, Square } from "lucide-react";
import { useId } from "react";
import { VoiceOrb, type VoiceOrbPalette } from "../voice-orb/voice-orb";
import type { VoiceSnapshot, VoiceState } from "./live-voice-session";

export type LiveVoiceControlProps = VoiceSnapshot & {
  size?: number;
  palette?: VoiceOrbPalette;
  className?: string;
  onToggle?: () => void;
  onEnd?: () => void;
};

const labels: Record<VoiceState, string> = {
  idle: "Click to talk", connecting: "Connecting…", live: "Listening · click to pause",
  pausing: "Pausing…", paused: "Paused · click to resume", resuming: "Resuming…",
  ending: "Ending conversation…", error: "Click to try again",
};

/** Shared presentation for the live control and inert design studies. */
export function LiveVoiceControl({ state, error, inputLevel = 0, outputLevel = 0, size = 144, palette, className = "", onToggle, onEnd }: LiveVoiceControlProps) {
  const statusId = useId();
  const busy = ["connecting", "pausing", "resuming", "ending"].includes(state);
  const canEnd = !["idle", "error", "ending"].includes(state);
  const active = state === "live";
  const input = active ? inputLevel : 0;
  const output = active ? outputLevel : 0;
  const userSpeaking = input > 0.04;
  const speaker = userSpeaking ? "user" : output > 0.04 ? "assistant" : "none";
  // Speech amplitude is often low; lift quiet syllables into a visible sweep.
  const inputMotion = Math.sqrt(Math.min(1, input * 3));
  const outputMotion = Math.sqrt(Math.min(1, output * 3));
  const energy = Math.min(1, outputMotion * 1.2 + inputMotion * 0.8);
  const speed = 0.18 + inputMotion * 1.8 + outputMotion * 3.2;
  const action = active ? "Pause conversation" : state === "paused" ? "Resume conversation" : "Start conversation";

  return (
    <div className={`flex w-full max-w-xs flex-col items-center gap-5 ${className}`}>
      <button
        type="button"
        aria-label={busy ? labels[state] : action}
        aria-describedby={statusId}
        disabled={busy}
        onClick={onToggle}
        data-speaker={speaker}
        style={{ width: size, height: size }}
        className="relative grid shrink-0 cursor-pointer place-items-center rounded-full border-0 bg-transparent focus-visible:outline-2 focus-visible:outline-offset-8 focus-visible:outline-ring disabled:cursor-wait"
      >
        <span
          className="pointer-events-none absolute inset-0 rounded-full transition-transform duration-300 ease-out motion-reduce:transition-none motion-reduce:transform-none!"
          style={{ transform: `scale(${userSpeaking ? 0.8 - input * 0.04 : 1 + outputMotion * 0.06})` }}
        >
          <VoiceOrb size="100%" palette={palette} energy={energy} speed={speed} paused={busy || state === "paused" || state === "error"} />
        </span>
        {busy ? <LoaderCircle aria-hidden="true" className="relative size-5 text-white motion-safe:animate-spin" /> : null}
        {state === "paused" ? <Play aria-hidden="true" className="relative size-5 fill-white/60 text-white" /> : null}
      </button>
      <div className="min-h-24 text-center">
        <p id={statusId} role="status" className="text-sm text-muted-foreground">{labels[state]}</p>
        {error ? <p role="alert" className="mt-3 text-sm leading-relaxed text-destructive">{error}</p> : null}
        {canEnd ? (
          <button type="button" onClick={onEnd} className="mx-auto mt-2 flex min-h-11 cursor-pointer items-center gap-2 rounded px-3 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
            <Square aria-hidden="true" className="size-3" />{state === "connecting" ? "Cancel" : "End conversation"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
