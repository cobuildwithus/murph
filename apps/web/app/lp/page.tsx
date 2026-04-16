import type { Metadata } from "next";

import { getHostedPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";

import { LandingAuthActions } from "./auth-controls";
import { StickyNav } from "./sticky-nav";

export const metadata: Metadata = {
  title: "Murph — Turn wearable data into answers about your body",
  description:
    "Expert-backed health experiments measured by your wearable. Pick a protocol, follow it, see what changed. Works with Oura, Whoop, and Garmin.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "Murph — Turn wearable data into answers about your body",
    description:
      "Expert-backed health experiments measured by your wearable. Pick a protocol, follow it, see what changed.",
    siteName: "Murph",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Murph — Wearable data, made useful.",
    description:
      "Expert-backed health experiments measured by your wearable.",
  },
};

export default async function LandingPage() {
  const { authenticated } = await getHostedPageAuthSnapshot();

  return (
    <main className="min-h-screen bg-[#f5f0e8] antialiased">
      <StickyNav authenticated={authenticated} />

      {/* ━━━ HERO ━━━ */}
      <section className="relative min-h-[85svh] overflow-hidden bg-[#3a3028] sm:min-h-svh">
        <img
          src="/hero.jpg"
          alt=""
          className="absolute inset-0 h-full w-full object-cover object-[80%_center] sm:object-center"
        />
        <div className="absolute inset-0 bg-[#1a1612]/25" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#1a1612]/50 via-[#1a1612]/10 to-transparent" />

        <div className="relative z-10 flex min-h-[85svh] flex-col justify-end px-6 pb-14 sm:min-h-svh sm:px-10 sm:pb-18 lg:px-16 lg:pb-24">
          <div className="max-w-[560px]">
            <h1 className="font-serif text-[clamp(2.5rem,5.2vw,4.5rem)] font-semibold leading-[0.95] tracking-[-0.04em] text-balance text-white">
              You measure
              <br />
              everything.
              <br />
              <span className="text-[#d4b87a]">Now act on it.</span>
            </h1>

            <p className="mt-6 max-w-[420px] text-base leading-[1.75] text-pretty text-white/75">
              Your wearable collects the data. Murph tells you what to
              try, measures what changed, and gives you a clear answer.
            </p>

            <div className="mt-8">
              <LandingAuthActions
                authenticated={authenticated}
                context="hero"
                showSignIn={false}
                signupLabel="See what works for your body"
              />
            </div>

            <div className="mt-8 flex items-center gap-2 text-[0.8125rem] text-white/60">
              <span>Early access &middot; $5/mo</span>
              <span className="text-white/25">&middot;</span>
              <span>Connect your Oura or Whoop in 30 seconds</span>
            </div>
          </div>
        </div>
      </section>

      {/* ━━━ HOW IT WORKS ━━━ */}
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
              A web dashboard to browse experiments and track results.
              A chat assistant that guides you through them daily
              via iMessage, Telegram, or email.
            </p>

          <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                n: "01",
                title: "Connect your wearable",
                desc: "Link your Oura or Whoop. Murph reads your sleep, HRV, heart rate, and recovery data automatically.",
                accent: "bg-[#f5f0e8]/90",
                badge: "bg-[#d4c4a8]/40 text-[#5a4d3a]",
              },
              {
                n: "02",
                title: "Browse the library",
                desc: "Sleep, recovery, nutrition, supplements, and more. Each experiment shows expected outcomes and the research behind it.",
                accent: "bg-[#e8ede0]/90",
                badge: "bg-[#7a8c6e]/25 text-[#3d5028]",
              },
              {
                n: "03",
                title: "Run your experiment",
                desc: "7 days of baseline so you know what\u2019s real, then 2\u20134 weeks of protocol. Murph texts reminders and logs sessions.",
                accent: "bg-[#f0ebe0]/90",
                badge: "bg-[#c4a882]/30 text-[#5a4d3a]",
              },
              {
                n: "04",
                title: "See what changed",
                desc: "Baseline vs experiment. Your HRV, sleep, heart rate \u2014 what moved, whether it matters, and what to try next.",
                accent: "bg-[#e0e8d8]/90",
                badge: "bg-[#5a6e32]/20 text-[#3d5028]",
              },
            ].map((step) => (
              <div
                key={step.n}
                className={`rounded-2xl p-7 ${step.accent}`}
              >
                <span className={`inline-flex size-8 items-center justify-center rounded-full font-mono text-[11px] font-semibold ${step.badge}`}>
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

      {/* ━━━ EXPERIMENTS ━━━ */}
      <section className="bg-[#ede3d0] px-6 py-16 sm:px-10 lg:px-16 lg:py-24">
        <div className="mx-auto max-w-[1080px]">
          <div className="grid gap-10 lg:grid-cols-[1fr_480px] lg:items-center lg:gap-16">
            <div>
              <span className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-[#635a48]">
                The experiments
              </span>
              <h2 className="mt-4 max-w-[20ch] font-serif text-[clamp(1.5rem,2.5vw,2rem)] font-semibold leading-[1.12] tracking-[-0.02em] text-[#2d3436]">
                40+ experiments across six domains.
              </h2>
              <p className="mt-4 max-w-[36ch] text-[0.9375rem] leading-[1.7] text-pretty text-[#635a48]">
                Each one links to published research, not random
                internet advice. Run it for 2–4 weeks, see what changed.
              </p>

              <div className="mt-8 grid grid-cols-2 gap-2.5">
                {[
                  { domain: "Sleep", examples: "deep sleep, circadian rhythm" },
                  { domain: "Recovery", examples: "HRV, resting heart rate, sauna" },
                  { domain: "Nutrition", examples: "meal timing, protein" },
                  { domain: "Supplements", examples: "magnesium, creatine, omega-3" },
                  { domain: "Exercise", examples: "zone 2, strength, mobility" },
                  { domain: "Breathwork", examples: "cold exposure, box breathing" },
                ].map(({ domain, examples }) => (
                  <div key={domain} className="rounded-xl border border-[#c4a882]/15 bg-[#f5f0e8] px-4 py-3">
                    <p className="text-sm font-semibold text-[#2d3436]">{domain}</p>
                    <p className="mt-0.5 text-[0.75rem] leading-[1.5] text-[#736a58]">{examples}</p>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.12em] text-[#635a48]">Your experiment dashboard</p>
            <div className="rounded-2xl border border-[#c4a882]/15 bg-[#fffcf6] p-6 sm:p-7">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-serif text-[1.125rem] font-semibold text-[#2d3436]">Finnish Sauna Protocol</p>
                  <p className="mt-1 text-[0.8125rem] text-[#736a58]">Recovery &middot; 21 days &middot; Day 8</p>
                </div>
                <span className="rounded-full bg-[#5a6e32]/10 px-2.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-[#5a6e32]">Active</span>
              </div>

<div className="mt-5">
                <div className="flex items-center gap-3 text-[10px]">
                  <span className="font-mono font-medium uppercase tracking-[0.1em] text-[#5a6e32]">Baseline &middot; 7d &#10003;</span>
                  <span className="font-mono font-medium uppercase tracking-[0.1em] text-[#2d3436]">Active &middot; Day 1 of 14</span>
                  <span className="ml-auto font-mono uppercase tracking-[0.1em] text-[#736a58]/40">Analysis</span>
                </div>
                <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-[#c4a882]/10">
                  <div className="w-[33%] rounded-full bg-[#5a6e32]" />
                  <div className="w-[5%] bg-[#5a6e32]/30" />
                </div>
              </div>

<div className="mt-5 rounded-xl bg-[#f5f0e8]/70 px-5 py-4">
                <span className="font-mono text-[9px] font-medium uppercase tracking-[0.12em] text-[#736a58]">Next step &middot; Today evening</span>
                <p className="mt-1.5 text-[0.9375rem] font-semibold text-[#2d3436]">Sauna session &middot; 15–20 min @ 80–100°C</p>
                <p className="mt-1 text-[0.8125rem] text-[#736a58]">Stay hydrated, replace electrolytes after &middot; Session 2 of 3 this week</p>
              </div>

<div className="mt-5 grid grid-cols-3 gap-3">
                {[
                  { label: "HRV", value: "52.1", unit: "ms", change: "+12.0%", expected: "+10–25%" },
                  { label: "Resting HR", value: "61.8", unit: "bpm", change: "-3.7%", expected: "-3–8 bpm" },
                  { label: "Deep sleep", value: "1h42m", unit: "", change: "+15.9%", expected: "+15–30%" },
                ].map((m) => (
                  <div key={m.label} className="rounded-xl border border-[#c4a882]/10 px-4 py-3.5">
                    <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-[#736a58]">{m.label}</span>
                    <p className="mt-1.5 font-serif text-[1.35rem] font-semibold leading-none tracking-tight text-[#2d3436]">
                      {m.value}{m.unit && <span className="ml-0.5 text-[0.75rem] font-normal text-[#736a58]">{m.unit}</span>}
                    </p>
                    <p className="mt-1.5 text-[0.75rem] text-[#5a6e32]">{m.change} vs baseline</p>
                  </div>
                ))}
              </div>

<div className="mt-5 rounded-xl border border-[#c4a882]/10 px-5 py-4">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-[#736a58]">HRV trend &middot; 21 days</span>
                  <div className="flex items-center gap-4">
                    <span className="flex items-center gap-1.5 text-[0.6875rem] text-[#736a58]/50">
                      <span className="inline-block h-px w-3 border-t border-dashed border-[#c4a882]" /> Baseline
                    </span>
                    <span className="flex items-center gap-1.5 text-[0.6875rem] text-[#736a58]">
                      <span className="inline-block h-0.5 w-3 rounded-full bg-[#5a6e32]" /> Active
                    </span>
                  </div>
                </div>
                <div className="mt-3">
                  <svg viewBox="0 0 380 50" fill="none" className="w-full" aria-hidden="true">
                    <rect x="0" y="0" width="120" height="50" fill="#d4c4a8" opacity="0.06" rx="3" />
                    <path d="M10 35 L30 33 L50 36 L70 32 L90 34 L110 33" stroke="#d4c4a8" strokeWidth="1.5" strokeDasharray="4 3" />
                    <path d="M120 33 L145 30 L170 27 L195 23 L220 25 L245 20 L270 18 L295 19 L320 15 L345 13 L370 11" stroke="#5a6e32" strokeWidth="2" strokeLinecap="round" />
                    <circle cx="370" cy="11" r="3" fill="#5a6e32" />
                  </svg>
                </div>
              </div>
            </div>
            </div>
          </div>
        </div>
      </section>

      {/* ━━━ CHAT & PRIVACY ━━━ */}
      <section className="bg-[#2a2520] px-6 py-16 sm:px-10 lg:px-16 lg:py-24">
        <div className="mx-auto max-w-[1080px]">
          <div className="grid gap-12 lg:grid-cols-[1fr_340px] lg:items-center lg:gap-16">
            <div>
              <span className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-[#c4a882]">
                Your daily assistant
              </span>
              <h2 className="mt-5 max-w-[20ch] font-serif text-[clamp(1.5rem,2.8vw,2rem)] font-semibold leading-[1.12] tracking-[-0.02em] text-[#f5f0e8]">
                Like texting a friend who reads the research.
              </h2>
              <p className="mt-4 max-w-[36ch] text-base leading-[1.7] text-pretty text-[#f5f0e8]/50">
                Murph reaches out when it matters for your experiment
                and stays quiet when it doesn&apos;t. No app to open.
              </p>

              <div className="mt-8 flex flex-wrap gap-2">
                {["iMessage", "Telegram", "WhatsApp", "Email"].map((ch) => (
                  <span key={ch} className="rounded-full border border-[#f5f0e8]/10 px-3.5 py-1.5 text-[0.8125rem] text-[#f5f0e8]/55">{ch}</span>
                ))}
              </div>

              <div className="mt-10 grid gap-4">
                {[
                  { title: "No data sales", desc: "Your experiments stay between you and your body." },
                  { title: "Encrypted by default", desc: "End-to-end encryption. Only you access your data." },
                  { title: "Private conversations", desc: "Your chats don\u2019t train models." },
                ].map((item) => (
                  <div key={item.title} className="flex gap-3">
                    <span className="mt-0.5 text-[0.5rem] text-[#5a6e32]">◆</span>
                    <div>
                      <p className="text-sm font-medium text-[#f5f0e8]/70">{item.title}</p>
                      <p className="mt-0.5 text-[0.8125rem] text-[#f5f0e8]/55">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

<div className="mx-auto w-full max-w-[340px]">
              <div className="overflow-hidden rounded-[2.5rem] border-[6px] border-[#f5f0e8]/10 bg-[#f5f0e8] shadow-2xl">
<div className="flex items-center justify-between bg-[#f5f0e8] px-7 pb-1 pt-3">
                  <span className="text-[0.6875rem] font-semibold text-[#2d3436]">9:41</span>
                  <div className="flex items-center gap-1">
                    <svg width="16" height="12" viewBox="0 0 16 12" fill="none" aria-hidden="true"><rect x="0" y="6" width="3" height="6" rx="0.5" fill="#2d3436"/><rect x="4.5" y="4" width="3" height="8" rx="0.5" fill="#2d3436"/><rect x="9" y="1.5" width="3" height="10.5" rx="0.5" fill="#2d3436"/><rect x="13" y="0" width="3" height="12" rx="0.5" fill="#2d3436" opacity="0.25"/></svg>
                    <svg width="16" height="11" viewBox="0 0 16 11" fill="none" aria-hidden="true"><rect x="0.5" y="0.5" width="13" height="8" rx="1" stroke="#2d3436" strokeWidth="1"/><rect x="14" y="3" width="2" height="3" rx="0.5" fill="#2d3436"/><rect x="1.5" y="1.5" width="8" height="6" rx="0.5" fill="#2d3436"/></svg>
                  </div>
                </div>

<div className="border-b border-[#c4a882]/15 bg-[#f5f0e8] px-5 pb-3 pt-1">
                  <div className="flex items-center gap-2.5">
                    <div className="flex size-8 items-center justify-center rounded-full bg-[#2a2520]">
                      <span className="text-[0.6875rem] font-semibold text-[#f5f0e8]">M</span>
                    </div>
                    <div>
                      <p className="text-[0.8125rem] font-semibold text-[#2d3436]">Murph</p>
                      <p className="text-[0.625rem] text-[#736a58]">Finnish Sauna Protocol &middot; Day 12</p>
                    </div>
                  </div>
                </div>

<div className="flex flex-col gap-2.5 px-4 py-4" style={{ minHeight: 420 }}>
                  {[
                    { from: "murph", text: "Good morning. Tonight: sauna 20 min at 80\u00b0C, then cold shower. Reminder at 8pm?" },
                    { from: "user", text: "Sure. I had 2 beers last night \u2014 did it mess anything up?" },
                    { from: "murph", text: "Your HRV dropped 23% overnight. The research median for 2 drinks is \u221218%. Your body reacts stronger than average. Worth knowing." },
                    { from: "user", text: "Wow. How\u2019s the experiment overall?" },
                    { from: "murph", text: "Still strong. HRV +12% vs baseline, deep sleep +16%. One bad night won\u2019t change the trend. 10 days left." },
                  ].map((msg, i) => (
                    <div key={i} className={`max-w-[82%] ${msg.from === "user" ? "ml-auto" : "mr-auto"}`}>
                      <div className={`rounded-2xl px-3.5 py-2.5 ${msg.from === "user" ? "rounded-br-sm bg-[#5a6e32] text-white/90" : "rounded-bl-sm bg-white text-[#2d3436]/85"}`}>
                        <p className="text-[0.8125rem] leading-[1.55]">{msg.text}</p>
                      </div>
                    </div>
                  ))}
                </div>

<div className="border-t border-[#c4a882]/15 bg-[#f5f0e8] px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 rounded-full border border-[#c4a882]/20 bg-white px-4 py-2">
                      <span className="text-[0.8125rem] text-[#736a58]/40">Message Murph...</span>
                    </div>
                    <div className="flex size-8 items-center justify-center rounded-full bg-[#5a6e32]">
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M1 7h10M8 4l3 3-3 3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ━━━ FAQ ━━━ */}
      <section id="faq" className="px-6 py-16 sm:px-10 lg:px-16 lg:py-24">
        <div className="mx-auto max-w-[1080px]">
          <div className="grid gap-10 lg:grid-cols-[280px_1fr] lg:gap-20">
            <div>
              <span className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-[#736a58]">
                FAQ
              </span>
              <h2 className="mt-4 font-serif text-[clamp(1.5rem,2.5vw,2rem)] font-semibold leading-[1.15] tracking-[-0.02em] text-[#2d3436]">
                Common questions
              </h2>
            </div>
            <div className="grid gap-x-16 gap-y-0 sm:grid-cols-2">
              {[
                ["Where do the experiments come from?", "AI analyzes published studies, clinical trials, and peer-reviewed research to build each protocol. Every experiment links to its sources so you can check the evidence yourself."],
                ["Do I need a computer?", "The web dashboard works on any device with a browser. For daily guidance, Murph texts you through iMessage, Telegram, WhatsApp, or email. You can use just the chat if you prefer."],
                ["How is this different from my wearable\u2019s app?", "Your wearable shows data. Murph gives you something to do with it \u2014 a bounded experiment with baseline measurement and a clear conclusion at the end."],
                ["Can I run multiple experiments?", "One at a time. That\u2019s what makes the results trustworthy \u2014 one variable means you know what caused the change."],
                ["What if I can\u2019t follow the protocol perfectly?", "Real life happens. Murph accounts for missed sessions in the analysis. A good experiment tolerates some noise."],
                ["What if nothing changes?", "That\u2019s useful too. Each experiment ends with a verdict: what worked, what didn\u2019t, what to try next. Knowing what doesn\u2019t work saves you from doing it forever."],
                ["Is this medical advice?", "No. Murph helps you run self-experiments using published research. It\u2019s not a substitute for medical care. Talk to your doctor about health concerns."],
                ["Can I cancel anytime?", "Yes. No contracts. $5/month, cancel whenever. Your data stays yours."],
              ].map(([q, a]) => (
                <div key={q} className="border-b border-[#c4a882]/15 py-5">
                  <p className="text-[0.9375rem] font-semibold text-[#2d3436]">{q}</p>
                  <p className="mt-1.5 text-[0.8125rem] leading-[1.65] text-[#736a58]">{a}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <footer id="pricing" className="bg-[#2a2520] px-6 sm:px-10 lg:px-16">
        <div className="mx-auto max-w-[1080px]">
          <div className="flex flex-col items-start gap-4 py-5 sm:flex-row sm:items-center sm:justify-between sm:gap-5">
            <p className="text-[0.9375rem] text-[#f5f0e8]/60">
              <span className="font-semibold text-[#f5f0e8]">$5/month.</span>{" "}
              Full library, before/after analysis, cancel anytime.
            </p>
            <LandingAuthActions
              authenticated={authenticated}
              context="footer"
              signupLabel="Start your first experiment"
            />
          </div>
          <div className="flex items-center justify-between border-t border-[#f5f0e8]/8 py-4 text-[0.8125rem] text-[#f5f0e8]/50">
            <p>Early product, improving fast &middot; Open source &middot; Apache 2.0</p>
            <a
              href="https://github.com/cobuildwithus/murph"
              target="_blank"
              rel="noreferrer"
              className="text-[#f5f0e8]/55 transition-colors hover:text-[#f5f0e8]/70"
            >
              GitHub &middot; Help us build
            </a>
          </div>
        </div>
      </footer>
    </main>
  );
}
