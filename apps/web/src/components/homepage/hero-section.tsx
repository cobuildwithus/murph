import { LandingAuthActions } from "@/app/auth-controls";
import { formatHostedLandingPricingShortSummary } from "@/src/lib/hosted-onboarding/billing-plans";
import Image from "next/image";

export function HeroSection({ authenticated }: { authenticated: boolean }) {
  const launchPricingSummary = formatHostedLandingPricingShortSummary();

  return (
    <section className="relative min-h-[85svh] overflow-hidden bg-[#3a3028] sm:min-h-svh">
      <Image
        preload
        fill
        sizes="100vw"
        src="/hero.jpg"
        alt=""
        className="absolute inset-0 h-full w-full object-cover object-[80%_center] sm:object-center"
      />
      <div className="absolute inset-0 bg-[#1a1612]/25" />
      <div className="absolute inset-0 bg-gradient-to-t from-[#1a1612]/50 via-[#1a1612]/10 to-transparent" />

      <div className="relative z-10 flex min-h-[85svh] flex-col justify-end px-4 pb-14 sm:min-h-svh sm:px-10 sm:pb-18 lg:px-16 lg:pb-24">
        <div className="max-w-[560px]">
          <h1 className="font-serif text-[clamp(2.5rem,5.2vw,4.5rem)] font-semibold leading-[0.95] tracking-[-0.04em] text-white lg:text-balance">
            <span className="block lg:whitespace-nowrap">You measure your health.</span>
            <span className="block text-[#d4b87a] lg:whitespace-nowrap">
              Now let&apos;s experiment with it.
            </span>
          </h1>

          <p className="mt-6 max-w-[420px] text-base leading-[1.75] text-pretty text-white/75">
            Murph is your personal health assistant. Sync your signals. Run an
            experiment. See what actually makes you healthier.
          </p>

          <div className="mt-8">
            <LandingAuthActions
              authLabel="See what works for your body"
              authenticated={authenticated}
              context="hero"
            />
          </div>

          <div className="mt-8 flex items-center gap-2 text-[0.8125rem] text-white/60">
            <span>Early access &middot; {launchPricingSummary}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
