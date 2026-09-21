import type { Metadata } from "next";
import { LiveVoiceControl, LiveVoicePicker, VoiceOrb } from "@/src/components/live-voice";

export const metadata: Metadata = { title: "Voice control states", robots: { index: false, follow: false } };
export default function VoiceStudies() {
  return <main id="live-voice-components" className="min-h-screen bg-background px-6 py-10 sm:p-10 text-foreground">
    <h1 className="font-serif text-3xl">Voice control</h1>
    <section className="mt-10 flex flex-wrap items-center gap-8" aria-label="Reusable orb examples">
      <VoiceOrb size={72} palette="sage" />
      <VoiceOrb size={112} palette="ember" />
      <LiveVoiceControl state="idle" size={80} palette="sage" />
    </section>
    <div className="mt-10 flex flex-wrap gap-12">
      <LiveVoicePicker voice="willow" />
      <LiveVoicePicker voice="marin" disabled />
    </div>
    <div className="mt-16 flex flex-wrap gap-16">
      {(["idle", "connecting", "live", "paused", "ending", "error"] as const).map((state) => (
        <section key={state} className="w-64"><h2 className="mb-8 text-sm">{state}</h2><LiveVoiceControl state={state} error={state === "error" ? "Allow microphone access, then try again." : undefined} /></section>
      ))}
      <section className="w-64"><h2 className="mb-8 text-sm">User speaking</h2><LiveVoiceControl state="live" inputLevel={0.65} /></section>
      <section className="w-64"><h2 className="mb-8 text-sm">Assistant speaking</h2><LiveVoiceControl state="live" outputLevel={0.65} /></section>
    </div>
  </main>;
}
