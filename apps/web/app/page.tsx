import type { Metadata } from "next";

import { HostedPhoneAuth } from "@/src/components/hosted-onboarding/hosted-phone-auth";
import {
  resolveHostedInstallScriptUrl,
  resolveHostedPrivyClientAppId,
  resolveHostedSignupPhoneNumber,
} from "@/src/lib/hosted-onboarding/landing";
import { hasHostedPrivyPhoneAuthConfig } from "@/src/lib/hosted-onboarding/privy";

export const metadata: Metadata = {
  title: "Murph — Health guidance that fits your real life",
  description: "Track meals, sync wearables, spot patterns, and get answers about your health in plain English. Murph is open source under GPL 3.0.",
};

const GITHUB_REPO_URL = "https://github.com/cobuildwithus/murph";

const capabilities = [
  {
    title: "Any chat app",
    body: "Talk to Murph on iMessage, Telegram, or email. No app to download.",
  },
  {
    title: "Wearable sync",
    body: "Pulls sleep, activity, and recovery data from Oura and WHOOP automatically, and can import Garmin snapshot exports.",
  },
  {
    title: "Persistent memory",
    body: "Remembers your meals, routines, supplements, and goals across every conversation.",
  },
  {
    title: "Pattern detection",
    body: "Connects how you sleep, eat, and move so you can see what actually works.",
  },
  {
    title: "Plain English",
    body: "Ask any health question. No jargon, no searching — just a clear, grounded answer.",
  },
  {
    title: "Always private",
    body: "Local mode keeps your data on your device. Hosted runs use encrypted cloud snapshots. Nothing is sold or shared.",
  },
] as const;

const conversations = [
  {
    messages: [
      { from: "user", text: "I've been sleeping terribly this week. What's going on?" },
      { from: "bob", text: "Your Oura data shows your average deep sleep dropped from 1h 42m to 53m since Monday. You also started a new magnesium brand on Sunday — that timing lines up. Want to try switching back and I'll track the difference?" },
    ],
  },
  {
    messages: [
      { from: "user", text: "Log breakfast: two eggs, sourdough toast, black coffee" },
      { from: "bob", text: "Logged. That's about 380 cal, 24g protein. You've been consistent with high-protein mornings this week — your afternoon energy scores are up 15% vs. last month when you were skipping breakfast." },
    ],
  },
  {
    messages: [
      { from: "user", text: "What should I eat before my 6pm run?" },
      { from: "bob", text: "Based on your past runs, you perform best with a light carb snack 90 min before. A banana with a tablespoon of peanut butter has worked well for you — your last three runs after that combo averaged 8:12/mi vs. 8:45/mi fasted." },
    ],
  },
] as const;

const integrations = [
  "iMessage", "Telegram", "Email", "Oura", "WHOOP", "Garmin exports",
] as const;

const faqItems = [
  {
    question: "Do I need to download an app?",
    answer: "No. Murph works through iMessage, Telegram, or email — tools you already have.",
  },
  {
    question: "How does wearable syncing work?",
    answer: "You connect Oura or WHOOP once for ongoing sync. Garmin data is currently supported through snapshot imports rather than a live account connection.",
  },
  {
    question: "Is my health data private?",
    answer: "Yes. Local mode keeps your data on your device, and hosted runs use encrypted cloud snapshots. We never sell or share your health information with third parties.",
  },
  {
    question: "What can I ask Murph?",
    answer: "Anything about your health. Log meals, ask about supplement timing, check sleep trends, get pre-workout food suggestions — all in plain English.",
  },
  {
    question: "How much does it cost?",
    answer: "Sign up is free to start. We'll walk you through pricing during onboarding.",
  },
] as const;

export default function HomePage() {
  const installScriptUrl = resolveHostedInstallScriptUrl();
  const installCommandUrl = installScriptUrl ?? "https://YOUR_DOMAIN/install.sh";
  const privyAppId = resolveHostedPrivyClientAppId();
  const signupPhone = resolveHostedSignupPhoneNumber();
  const signupHref = signupPhone ? `sms:${signupPhone.smsValue}` : null;
  const phoneAuthReady = hasHostedPrivyPhoneAuthConfig() && Boolean(privyAppId);

  return (
    <main className="min-h-screen">
      {/* Nav */}
      <header className="mx-auto flex max-w-7xl items-center gap-4 px-6 pt-10 md:px-12 lg:px-16">
        <span className="animate-fade-up text-sm font-bold uppercase tracking-[0.2em] text-olive">
          Murph
        </span>
        <span className="h-px w-10 bg-stone-300" aria-hidden="true" />
        <span className="animate-fade-up text-sm tracking-wide text-stone-400">
          Your personal health assistant
        </span>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-7xl px-6 pb-20 pt-16 md:px-12 md:pb-28 md:pt-24 lg:px-16">
        <div className="grid items-start gap-12 lg:grid-cols-[1fr_400px] lg:gap-16 xl:grid-cols-[1fr_440px] xl:gap-24">
          <div className="animate-fade-up [animation-delay:0.1s]">
            <h1 className="text-[clamp(2.75rem,6.5vw,5.5rem)] font-bold leading-[0.92] tracking-[-0.04em] text-stone-900">
              Your personal health assistant.
            </h1>
            <p className="mt-8 max-w-lg text-lg leading-relaxed text-stone-400 md:text-xl md:leading-relaxed">
              Murph meets you where you already are — iMessage, Telegram,
              or email. Ask questions, track meals, and spot patterns without
              downloading another app.
            </p>
            <div className="mt-6 flex max-w-2xl flex-wrap items-center gap-3 rounded-lg border border-stone-200 bg-white/80 px-4 py-3 text-sm text-stone-500">
              <span className="rounded bg-olive/10 px-2.5 py-1 font-semibold uppercase tracking-[0.14em] text-olive">
                Open source
              </span>
              <p className="leading-relaxed">
                Murph is licensed under GPL 3.0.
              </p>
              <a
                href={GITHUB_REPO_URL}
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-olive transition-colors hover:text-stone-900"
              >
                View the GitHub repo
              </a>
            </div>
          </div>

          <div className="animate-fade-up [animation-delay:0.2s]">
            <section
              aria-labelledby="signup-title"
              className="rounded-lg bg-olive p-7 text-white md:p-9"
            >
              <h2
                id="signup-title"
                className="text-2xl font-bold tracking-tight md:text-3xl"
              >
                Sign up with your phone.
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-white/60">
                Takes about a minute. We verify your number, set up your
                account, and you&apos;re in.
              </p>

              <div className="mt-5 rounded bg-white p-4 text-stone-900">
                {phoneAuthReady && privyAppId ? (
                  <HostedPhoneAuth mode="public" privyAppId={privyAppId} />
                ) : (
                  <p className="text-sm leading-relaxed text-stone-500">
                    Phone signup is not configured for this environment yet.
                  </p>
                )}
              </div>

              {signupHref && signupPhone ? (
                <div className="mt-4 space-y-2 border-t border-white/15 pt-4">
                  <strong className="text-sm">Prefer texting?</strong>
                  <p className="text-sm leading-relaxed text-white/50">
                    Text {signupPhone.displayValue} and we&apos;ll send you a
                    signup link.
                  </p>
                  <a
                    href={signupHref}
                    className="inline-flex items-center rounded bg-white px-5 py-2.5 text-sm font-bold text-olive transition-colors hover:bg-cream-dark"
                  >
                    Text to start
                  </a>
                </div>
              ) : null}
            </section>
          </div>
        </div>
      </section>

      {/* Works with */}
      <section className="border-t border-stone-200">
        <div className="mx-auto max-w-7xl px-6 py-12 md:px-12 lg:px-16">
          <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
            <p className="text-sm font-semibold uppercase tracking-[0.15em] text-olive">
              Works with
            </p>
            {integrations.map((name) => (
              <span
                key={name}
                className="border border-stone-200 px-4 py-2 text-sm font-medium text-stone-500"
              >
                {name}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* What it does — capability grid */}
      <section className="border-t border-stone-200">
        <div className="mx-auto max-w-7xl px-6 py-20 md:px-12 md:py-24 lg:px-16">
          <p className="mb-12 text-sm font-semibold uppercase tracking-[0.15em] text-olive">
            What it does
          </p>
          <div className="grid gap-px bg-stone-200 sm:grid-cols-2 lg:grid-cols-3">
            {capabilities.map((item) => (
              <article key={item.title} className="bg-cream p-6 md:p-8">
                <h3 className="text-lg font-semibold text-stone-900">
                  {item.title}
                </h3>
                <p className="mt-2 leading-relaxed text-stone-400">
                  {item.body}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Example conversations */}
      <section className="border-t border-stone-200 bg-olive">
        <div className="mx-auto max-w-7xl px-6 py-20 md:px-12 md:py-24 lg:px-16">
          <p className="mb-4 text-sm font-semibold uppercase tracking-[0.15em] text-white/40">
            See it in action
          </p>
          <h2 className="mb-12 max-w-md text-3xl font-bold tracking-tight text-white md:text-4xl">
            Real questions, real answers.
          </h2>
          <div className="grid gap-6 lg:grid-cols-3">
            {conversations.map((convo, index) => (
              <div
                key={index}
                className="space-y-3 rounded-lg bg-white/5 p-5 backdrop-blur-sm md:p-6"
              >
                {convo.messages.map((msg, msgIndex) => (
                  <div
                    key={msgIndex}
                    className={
                      msg.from === "user"
                        ? "ml-8 rounded rounded-br-none bg-white/15 p-3 text-sm leading-relaxed text-white"
                        : "mr-8 rounded rounded-bl-none bg-white p-3 text-sm leading-relaxed text-stone-700"
                    }
                  >
                    {msg.text}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Quick Start */}
      <section className="border-t border-stone-200">
        <div className="mx-auto max-w-7xl px-6 py-20 md:px-12 md:py-24 lg:px-16">
          <p className="mb-4 text-sm font-semibold uppercase tracking-[0.15em] text-olive">
            Quick start
          </p>
          <h2 className="mb-10 max-w-md text-3xl font-bold tracking-tight text-stone-900 md:text-4xl">
            Up and running in one command.
          </h2>
          <div className="overflow-hidden rounded-lg border border-stone-800 bg-stone-900">
            {/* Terminal chrome */}
            <div className="flex items-center gap-2 border-b border-stone-800 px-4 py-3">
              <span className="h-3 w-3 rounded-full bg-red-400/80" />
              <span className="h-3 w-3 rounded-full bg-amber-400/80" />
              <span className="h-3 w-3 rounded-full bg-green-400/80" />
              <span className="ml-4 text-xs text-stone-500">terminal</span>
            </div>
            {/* Terminal body */}
            <div className="space-y-4 p-6 font-mono text-sm leading-relaxed md:p-8">
              <p className="text-stone-500"># Install Murph and launch setup</p>
              <p className="break-all">
                <span className="text-olive-light">$</span>{" "}
                <span className="text-white">
                  curl -fsSL --proto &apos;=https&apos; --tlsv1.2 {installCommandUrl} | bash
                </span>
              </p>
              <div className="border-t border-stone-800 pt-4">
                <p className="text-stone-500"># Start chatting</p>
                <p>
                  <span className="text-olive-light">$</span>{" "}
                  <span className="text-white">murph chat</span>
                </p>
              </div>
            </div>
          </div>
          <p className="mt-4 text-sm text-stone-400">
            Works on macOS and Linux. The installer detects local checkouts,
            bootstraps Node 22 when needed, and then hands off to Murph&apos;s
            own setup flow for parsers, shims, vault bootstrap, and interactive
            onboarding.
          </p>
          <p className="mt-3 text-sm text-stone-400">
            Prefer to inspect it first?{" "}
            <a
              href="/install.sh"
              className="font-medium text-olive transition-colors hover:text-stone-900"
            >
              View the raw installer
            </a>
            .
          </p>
        </div>
      </section>

      {/* FAQ */}
      <section className="border-t border-stone-200">
        <div className="mx-auto max-w-7xl px-6 py-20 md:px-12 md:py-24 lg:px-16">
          <p className="mb-4 text-sm font-semibold uppercase tracking-[0.15em] text-olive">
            FAQ
          </p>
          <h2 className="mb-12 text-3xl font-bold tracking-tight text-stone-900 md:text-4xl">
            Common questions.
          </h2>
          <div className="grid gap-px bg-stone-200 lg:grid-cols-2">
            {faqItems.map((item) => (
              <div key={item.question} className="bg-cream p-6 md:p-8">
                <h3 className="font-semibold text-stone-900">
                  {item.question}
                </h3>
                <p className="mt-2 leading-relaxed text-stone-400">
                  {item.answer}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="border-t border-stone-200 bg-olive">
        <div className="mx-auto max-w-7xl px-6 py-20 text-center text-white md:px-12 md:py-28 lg:px-16">
          <h2 className="text-3xl font-bold tracking-tight md:text-5xl">
            Start using Murph today.
          </h2>
          <p className="mx-auto mt-4 max-w-lg text-lg leading-relaxed text-white/60">
            Sign up with your phone number. No app to download, no account to
            configure. Just text and go.
          </p>
          <div className="mt-8">
            <a
              href="#signup-title"
              className="inline-flex rounded bg-white px-7 py-3.5 font-bold text-olive transition-colors hover:bg-cream-dark"
            >
              Get started free
            </a>
          </div>
        </div>
      </section>

      {/* Trust strip */}
      <div className="overflow-hidden border-t border-stone-200">
        <div className="animate-marquee flex whitespace-nowrap py-4">
          {Array.from({ length: 2 }).map((_, repeat) => (
            <div key={repeat} className="flex shrink-0 items-center gap-10 px-5">
              {[
                "Works on iMessage, Telegram, and email",
                "Syncs with Oura and WHOOP, imports Garmin exports",
                "Plain English — no jargon",
                "Encrypted cloud snapshots for hosted runs",
              ].map((text) => (
                <span
                  key={`${repeat}-${text}`}
                  className="flex items-center gap-3 text-sm text-stone-400"
                >
                  <span className="h-1 w-1 bg-olive/40" aria-hidden="true" />
                  {text}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
