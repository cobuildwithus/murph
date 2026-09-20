import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LiveVoiceButton } from "@/src/components/live-voice/live-voice-button";

export const metadata: Metadata = { title: "Voice preview", robots: { index: false, follow: false } };

export default function VoicePage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return (
    <main className="flex min-h-svh flex-col items-center justify-center bg-background px-6 py-16 text-foreground">
      <p className="mb-5 font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">Murph · voice preview</p>
      <h1 className="font-serif text-4xl tracking-tight sm:text-5xl">A little room to talk.</h1>
      <p className="mt-5 max-w-sm text-center text-sm leading-6 text-muted-foreground">Talk naturally. You can speak while it speaks.<br />Click the circle whenever you need a pause.</p>
      <div className="mt-12 flex w-full justify-center"><LiveVoiceButton /></div>
      <p className="mt-10 max-w-xs text-center text-xs leading-5 text-muted-foreground">AI voice powered by GPT-Live.<br />This preview has no access to your Murph records.</p>
    </main>
  );
}
