import type { Metadata } from "next";
import { LiveVoiceControl } from "@/src/components/live-voice/live-voice-button";

import { LiveVoicePicker } from "@/src/components/live-voice/live-voice-picker";

export const metadata: Metadata = { title: "Voice control states", robots: { index: false, follow: false } };
export default function VoiceStudies() {
  return <main className="min-h-screen bg-background p-10 text-foreground">
    <h1 className="font-serif text-3xl">Voice control</h1>
    <div className="mt-10 flex flex-wrap gap-12">
      <LiveVoicePicker voice="gleam" />
      <LiveVoicePicker voice="marin" disabled />
    </div>
    <div className="mt-16 flex flex-wrap gap-16">
      {(["idle", "connecting", "live", "paused", "ending", "error"] as const).map((state) => (
        <section key={state} className="w-64"><h2 className="mb-8 text-sm">{state}</h2><LiveVoiceControl state={state} error={state === "error" ? "Allow microphone access, then try again." : undefined} /></section>
      ))}
    </div>
  </main>;
}
