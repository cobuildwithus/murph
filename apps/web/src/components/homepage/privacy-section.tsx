import type React from "react";

const privacyFeatures = [
  {
    label: "No data sales",
    body: "We do not sell your health data or turn it into an ad-targeting business. Your information stays under your control.",
  },
  {
    label: "Local transcription",
    body: "Audio is transcribed on your device with a local Whisper model. Your voice never leaves your machine.",
  },
  {
    label: "Private web search",
    body: "Web lookups go through Brave Search — no tracking, no ad profiling, no data harvesting.",
  },
  {
    label: "Venice AI inference",
    body: (
      <>
        Cloud inference runs through{" "}
        <a href="https://venice.ai" target="_blank" rel="noreferrer" className="underline transition-colors hover:text-white">Venice AI</a>
        {" "}with zero data logging. Your conversations don&apos;t train anyone&apos;s model.
      </>
    ),
  },
  {
    label: "Bring your own model",
    body: "Running locally? Plug in your own LLM. Your prompts stay on your hardware with zero third-party calls.",
  },
  {
    label: "Encrypted by default",
    body: "Hosted runs use encrypted cloud snapshots. Everything is locked down so only you can access it.",
  },
] satisfies { label: string; body: React.ReactNode }[];

export function PrivacySection() {
  return (
    <section className="border-t border-stone-800 bg-stone-900">
      <div className="mx-auto max-w-7xl px-6 py-20 md:px-12 md:py-24 lg:px-16">
        <div className="mb-12 max-w-2xl">
          <p className="mb-4 text-sm font-semibold uppercase tracking-[0.15em] text-olive-light">
            Built for privacy
          </p>
          <h2 className="text-3xl font-bold tracking-tight text-white md:text-4xl">
            Your health data stays yours.
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-stone-400">
            Most health apps monetize your data. Murph is built the other
            way around — local-first processing where possible, encrypted
            infrastructure for hosted runs, and privacy-first defaults.
          </p>
        </div>
        <div className="grid gap-px bg-stone-800 sm:grid-cols-2 lg:grid-cols-3">
          {privacyFeatures.map((item) => (
            <article key={item.label} className="bg-stone-900 p-6 md:p-8">
              <h3 className="text-lg font-semibold text-white">
                {item.label}
              </h3>
              <p className="mt-2 leading-relaxed text-stone-400">
                {item.body}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
