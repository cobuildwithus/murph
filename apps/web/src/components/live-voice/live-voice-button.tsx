"use client";

import { LoaderCircle, Mic, Pause, Play, Square } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { LiveVoiceSession, type VoiceSnapshot, type VoiceState } from "./live-voice-session";

const labels: Record<VoiceState, string> = {
  idle: "Click to talk", connecting: "Connecting…", live: "Listening · click to pause",
  pausing: "Pausing…", paused: "Paused · click to resume", resuming: "Resuming…",
  ending: "Ending conversation…", error: "Click to try again",
};

/** Drop into a page; endpoint must create a GPT-Live WebRTC session server-side. */
export function LiveVoiceButton({ endpoint = "/api/live-voice/session" }: { endpoint?: string }) {
  const [snapshot, setSnapshot] = useState<VoiceSnapshot>({ state: "idle" });
  const session = useRef<LiveVoiceSession | null>(null);
  useEffect(() => {
    const dispose = () => session.current?.dispose();
    const pageHidden = () => { dispose(); setSnapshot({ state: "idle" }); };
    window.addEventListener("pagehide", pageHidden);
    return () => { window.removeEventListener("pagehide", pageHidden); dispose(); };
  }, []);

  function toggle() {
    if (snapshot.state === "idle" || snapshot.state === "error") {
      session.current?.dispose();
      session.current = new LiveVoiceSession(setSnapshot, endpoint);
      void session.current.start();
    } else session.current?.togglePause();
  }
  return <LiveVoiceControl {...snapshot} onToggle={toggle} onEnd={() => session.current?.end()} />;
}

/** Shared presentation for the live control and inert design studies. */
export function LiveVoiceControl({ state, error, onToggle, onEnd }: VoiceSnapshot & { onToggle?: () => void; onEnd?: () => void }) {
  const statusId = useId();
  const busy = ["connecting", "pausing", "resuming", "ending"].includes(state);
  const canEnd = !["idle", "error", "ending"].includes(state);
  const active = state === "live";
  const Icon = busy ? LoaderCircle : active ? Pause : state === "paused" ? Play : Mic;
  const action = active ? "Pause conversation" : state === "paused" ? "Resume conversation" : "Start conversation";

  return (
    <div className="flex w-full max-w-xs flex-col items-center gap-5">
      <button
        type="button"
        aria-label={busy ? labels[state] : action}
        aria-describedby={statusId}
        disabled={busy}
        onClick={onToggle}
        className={`grid size-20 shrink-0 cursor-pointer place-items-center rounded-full border transition-[background-color,transform,outline-color] duration-200 focus-visible:outline-2 focus-visible:outline-offset-8 focus-visible:outline-ring active:scale-95 disabled:cursor-wait motion-reduce:transition-none ${active ? "border-primary bg-primary text-primary-foreground outline-4 outline-offset-4 outline-primary/15" : "border-border bg-foreground text-background hover:bg-foreground/85"}`}
      >
        <Icon aria-hidden="true" className={`size-6 ${busy ? "motion-safe:animate-spin" : ""}`} strokeWidth={1.8} />
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
