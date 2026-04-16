const STEPS = [
  {
    accent: "bg-[#f5f0e8]/90",
    badge: "bg-[#d4c4a8]/40 text-[#5a4d3a]",
    desc: "Link your Oura or Whoop. Murph reads your sleep, HRV, heart rate, and recovery data automatically.",
    n: "01",
    title: "Connect your wearable",
  },
  {
    accent: "bg-[#e8ede0]/90",
    badge: "bg-[#7a8c6e]/25 text-[#3d5028]",
    desc: "Sleep, recovery, nutrition, supplements, and more. Each experiment shows expected outcomes and the research behind it.",
    n: "02",
    title: "Browse the library",
  },
  {
    accent: "bg-[#f0ebe0]/90",
    badge: "bg-[#c4a882]/30 text-[#5a4d3a]",
    desc: "7 days of baseline so you know what’s real, then 2–4 weeks of protocol. Murph texts reminders and logs sessions.",
    n: "03",
    title: "Run your experiment",
  },
  {
    accent: "bg-[#e0e8d8]/90",
    badge: "bg-[#5a6e32]/20 text-[#3d5028]",
    desc: "Baseline vs experiment. Your HRV, sleep, heart rate — what moved, whether it matters, and what to try next.",
    n: "04",
    title: "See what changed",
  },
] as const;

export function HowItWorksSection() {
  return (
    <section
      id="how"
      className="bg-[#2a2520] px-6 py-14 sm:px-10 lg:px-16 lg:py-20"
    >
      <div className="mx-auto max-w-[1080px]">
        <span className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-[#c4a882]">
          How it works
        </span>
        <h2 className="mt-5 max-w-[24ch] font-serif text-[clamp(1.75rem,3.5vw,2.75rem)] font-semibold leading-[1.1] tracking-[-0.03em] text-[#f5f0e8]">
          Connect, browse, experiment, learn.
        </h2>
        <p className="mt-5 max-w-[48ch] text-base leading-[1.7] text-pretty text-[#f5f0e8]/55">
          A web dashboard to browse experiments and track results. A chat
          assistant that guides you through them daily via iMessage, Telegram,
          or email.
        </p>

        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step) => (
            <div key={step.n} className={`rounded-2xl p-7 ${step.accent}`}>
              <span
                className={`inline-flex size-8 items-center justify-center rounded-full font-mono text-[11px] font-semibold ${step.badge}`}
              >
                {step.n}
              </span>
              <h3 className="mt-4 font-serif text-[1.1875rem] font-semibold text-[#2d3436]">
                {step.title}
              </h3>
              <p className="mt-2.5 text-sm leading-[1.75] text-[#736a58]">
                {step.desc}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
