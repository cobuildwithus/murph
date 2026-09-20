"use client";

import { useId } from "react";
import { LIVE_VOICES, type LiveVoice } from "@/src/lib/live-voice/voices";

export function LiveVoicePicker({ voice, disabled = false, onChange }: {
  voice: LiveVoice;
  disabled?: boolean;
  onChange?: (voice: LiveVoice) => void;
}) {
  const inputName = useId();
  const selected = LIVE_VOICES.find((option) => option.id === voice)!;
  return (
    <div className="w-full max-w-md">
      <div aria-label="Voice groups" className="mb-4 flex justify-center gap-1">
        {(["female", "male"] as const).map((group) => (
          <button
            key={group}
            type="button"
            aria-pressed={selected.group === group}
            disabled={disabled}
            onClick={() => { if (selected.group !== group) onChange?.(group === "female" ? "gleam" : "meridian"); }}
            className={`min-h-11 cursor-pointer rounded-full px-5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-default ${selected.group === group ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted"}`}
          >
            {group === "female" ? "Female · 4" : "Male · 6"}
          </button>
        ))}
      </div>
      <fieldset disabled={disabled} className="grid grid-cols-2 gap-2">
        <legend className="sr-only">{selected.group === "female" ? "Female voices" : "Male voices"}</legend>
        {LIVE_VOICES.filter((option) => option.group === selected.group).map((option) => (
          <label key={option.id} className={`relative flex min-h-20 cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring ${disabled ? "cursor-default" : "hover:border-primary/60"} ${voice === option.id ? "border-primary bg-primary/5" : "border-border"}`}>
            <input type="radio" name={inputName} value={option.id} checked={voice === option.id} onChange={() => onChange?.(option.id)} className="size-4 shrink-0 accent-primary" />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-foreground">{option.name}</span>
              <span className="mt-1 block text-xs text-muted-foreground">{option.accent}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <p className="mt-4 min-h-5 text-center text-xs text-muted-foreground">
        {disabled ? "End the conversation to change voices." : "Pick a voice, then click the circle to talk."}
      </p>
    </div>
  );
}
