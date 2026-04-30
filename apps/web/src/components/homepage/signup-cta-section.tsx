import { LandingAuthActions } from "@/app/auth-controls";

import type { HomepageSignupCta } from "./types";

export function SignupCtaSection({
  authenticated,
  signupCta,
}: {
  authenticated: boolean;
  signupCta: HomepageSignupCta;
}) {
  return (
    <section id="pricing" className="relative overflow-hidden bg-[#2a2520] px-6 py-20 sm:px-10 sm:py-24 lg:px-16 lg:py-28">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 30% 60%, rgba(160,122,78,0.22) 0%, transparent 50%), radial-gradient(circle at 70% 35%, rgba(140,104,64,0.15) 0%, transparent 40%), radial-gradient(circle at 55% 85%, rgba(196,149,106,0.12) 0%, transparent 38%)",
        }}
      />
      <div className="relative mx-auto flex max-w-[700px] flex-col items-center text-center">
        <span className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-[#c4a882]">
          {signupCta.eyebrow}
        </span>
        <h2 className="mx-auto mt-4 max-w-[22ch] text-balance font-serif text-[clamp(1.9rem,3.5vw,2.85rem)] font-semibold leading-[1.02] tracking-[-0.04em] text-[#f5f0e8]">
          {signupCta.title}
        </h2>
        {signupCta.body ? (
          <p className="mx-auto mt-4 max-w-[33ch] text-[0.9375rem] leading-[1.75] text-pretty text-[#f5f0e8]/72 sm:text-base">
            {signupCta.body}
          </p>
        ) : null}

        <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5 text-[0.8125rem] text-[#f5f0e8]/70">
          {signupCta.metaItems.map((item) => (
            <span
              key={item}
              className="rounded-full border border-[#f5f0e8]/15 bg-[#f5f0e8]/[0.05] px-3.5 py-1.5"
            >
              {item}
            </span>
          ))}
        </div>

        <div className="mt-8 flex justify-center">
          <LandingAuthActions
            authLabel={signupCta.signupLabel}
            authenticated={authenticated}
            context="footer"
            signupLabel={signupCta.signupLabel}
          />
        </div>

        {signupCta.note ? (
          <p className="mt-4 text-[0.8125rem] leading-[1.6] text-[#f5f0e8]/65">
            {signupCta.note}
          </p>
        ) : null}
      </div>
    </section>
  );
}
