import type { Metadata } from "next";

import { HostedPhoneAuth } from "@/src/components/hosted-onboarding/hosted-phone-auth";
import { resolveHostedPrivyClientAppId, resolveHostedSignupPhoneNumber } from "@/src/lib/hosted-onboarding/landing";
import { hasHostedPrivyPhoneAuthConfig } from "@/src/lib/hosted-onboarding/privy";

export const metadata: Metadata = {
  title: "Healthy Bob",
  description: "Your personal health assistant.",
};

const featureItems = [
  {
    title: "Ask in plain English",
    body: "Get help understanding your health without turning your life into a spreadsheet.",
  },
  {
    title: "Sync your wearables",
    body: "Bring in signals from tools like Oura and WHOOP so the picture stays current.",
  },
  {
    title: "Remember what helps",
    body: "Keep track of meals, routines, supplements, and other things you want to revisit later.",
  },
  {
    title: "Notice patterns over time",
    body: "See how sleep, food, movement, and symptoms connect so the next step feels obvious.",
  },
] as const;

export default function HomePage() {
  const privyAppId = resolveHostedPrivyClientAppId();
  const signupPhone = resolveHostedSignupPhoneNumber();
  const signupHref = signupPhone ? `sms:${signupPhone.smsValue}` : null;
  const phoneAuthReady = hasHostedPrivyPhoneAuthConfig() && Boolean(privyAppId);

  return (
    <main className="min-h-screen px-5 py-8 md:px-8 md:py-12">
      <div className="mx-auto max-w-6xl space-y-10">
        <header className="flex flex-wrap items-center justify-between gap-4 animate-fade-up">
          <span className="text-sm font-bold uppercase tracking-[0.12em] text-green-800">
            Healthy Bob
          </span>
          <span className="rounded-full border border-stone-200/60 bg-white/70 px-4 py-2 text-sm text-stone-500">
            Private health guidance that fits real life
          </span>
        </header>

        <section className="grid gap-5 lg:grid-cols-2">
          <div className="animate-fade-up rounded-3xl bg-white p-8 shadow-sm md:p-12" style={{ animationDelay: "0.1s" }}>
            <span className="inline-block rounded-full bg-green-50 px-3.5 py-1.5 text-sm font-semibold text-green-700">
              Your personal health assistant
            </span>
            <h1 className="mt-5 max-w-[10ch] text-5xl font-bold leading-[0.95] tracking-tighter text-stone-900 md:text-7xl">
              Your personal health assistant.
            </h1>
            <p className="mt-5 max-w-md text-lg leading-relaxed text-stone-500">
              Healthy Bob helps you understand what is happening, remember what matters, and make calmer decisions
              about your health.
            </p>
          </div>

          <section
            aria-labelledby="signup-title"
            className="animate-fade-up rounded-3xl bg-green-800 p-8 text-white shadow-md md:p-10"
            style={{ animationDelay: "0.2s" }}
          >
            <span className="inline-block rounded-full bg-white/15 px-3.5 py-1.5 text-sm font-semibold">
              Signup
            </span>
            <div className="mt-4 space-y-2">
              <h2 id="signup-title" className="text-3xl font-bold tracking-tight md:text-4xl">
                Start with your phone.
              </h2>
              <p className="leading-relaxed text-white/75">
                Verify your phone number, create your rewards wallet, and continue to payment in one clean flow.
              </p>
            </div>

            <div className="mt-6 rounded-2xl bg-white p-4 text-stone-900">
              {phoneAuthReady && privyAppId ? (
                <HostedPhoneAuth mode="public" privyAppId={privyAppId} />
              ) : (
                <p className="leading-relaxed text-stone-500">
                  Phone signup is not configured for this environment yet.
                </p>
              )}
            </div>

            {signupHref && signupPhone ? (
              <div className="mt-4 space-y-3 rounded-2xl bg-white/10 p-5">
                <strong>Prefer texting first?</strong>
                <p className="leading-relaxed text-white/65">
                  You can still start from SMS and we&apos;ll send back a secure signup link at {signupPhone.displayValue}.
                </p>
                <a
                  href={signupHref}
                  className="inline-flex items-center rounded-full bg-white px-5 py-3 font-bold text-green-800 transition-colors hover:bg-green-50"
                >
                  Text to start instead
                </a>
              </div>
            ) : null}

            <div className="mt-4 space-y-2 text-sm text-white/55">
              <span className="block">1. Verify your phone number.</span>
              <span className="block">2. Create your secure Healthy Bob account.</span>
              <span className="block">3. Provision your rewards wallet and continue to checkout.</span>
            </div>
          </section>
        </section>

        <section
          aria-label="Core features"
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
        >
          {featureItems.map((item, index) => (
            <article
              key={item.title}
              className="animate-fade-up rounded-2xl border border-stone-200/50 bg-white p-5 space-y-2"
              style={{ animationDelay: `${0.3 + index * 0.07}s` }}
            >
              <h2 className="font-semibold leading-tight text-stone-900">{item.title}</h2>
              <p className="text-sm leading-relaxed text-stone-500">{item.body}</p>
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}
