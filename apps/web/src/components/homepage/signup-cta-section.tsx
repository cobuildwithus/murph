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
    <section className="bg-[#ede3d0] px-6 py-8 sm:px-10 lg:px-16 lg:py-10">
      <div className="mx-auto max-w-[1080px]">
        <div className="overflow-hidden rounded-[2rem] border border-[#c4a882]/15 bg-[#2a2520] px-6 py-12 shadow-[0_22px_70px_rgba(42,37,32,0.14)] sm:px-10 sm:py-14 lg:px-14 lg:py-16">
          <div className="mx-auto flex max-w-[700px] flex-col items-center text-center">
            <span className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-[#c4a882]/85">
              {signupCta.eyebrow}
            </span>
            <h2 className="mx-auto mt-4 max-w-[12ch] font-serif text-[clamp(1.9rem,3.5vw,2.85rem)] font-semibold leading-[1.02] tracking-[-0.04em] text-[#f5f0e8]">
              {signupCta.title}
            </h2>
            {signupCta.body ? (
              <p className="mx-auto mt-4 max-w-[33ch] text-[0.9375rem] leading-[1.75] text-pretty text-[#f5f0e8]/58 sm:text-base">
                {signupCta.body}
              </p>
            ) : null}

            <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5 text-[0.8125rem] text-[#f5f0e8]/52">
              {signupCta.metaItems.map((item) => (
                <span
                  key={item}
                  className="rounded-full border border-[#f5f0e8]/10 bg-[#f5f0e8]/[0.03] px-3.5 py-1.5"
                >
                  {item}
                </span>
              ))}
            </div>

            <div className="mt-8 flex justify-center">
              <LandingAuthActions
                authenticated={authenticated}
                context="footer"
                showSignIn={false}
                signupLabel={signupCta.signupLabel}
              />
            </div>

            {signupCta.note ? (
              <p className="mt-4 text-[0.8125rem] leading-[1.6] text-[#f5f0e8]/48">
                {signupCta.note}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
