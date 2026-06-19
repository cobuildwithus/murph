import { LandingAuthActions } from "@/app/auth-controls";
import Image from "next/image";

export function HeroSection({ authenticated }: { authenticated: boolean }) {
  return (
    <section className="relative min-h-svh overflow-hidden bg-[#3a3028]">
      <Image
        preload
        fill
        sizes="100vw"
        src="/hero.jpg"
        alt=""
        style={{ objectFit: "cover", objectPosition: "80% center" }}
        className="sm:[object-position:center]"
      />
      <div className="absolute inset-0 bg-[#1a1612]/25" />
      <div className="absolute inset-0 bg-gradient-to-t from-[#1a1612]/50 via-[#1a1612]/10 to-transparent" />

      <div className="relative z-10 flex min-h-svh flex-col justify-end px-5 pb-14 sm:px-10 sm:pb-18 lg:px-16 lg:pb-24">
        <div className="max-w-[560px]">
          <h1 className="font-serif text-[clamp(2.25rem,5.2vw,4.5rem)] font-semibold leading-[1.15] sm:leading-[1.05] tracking-[-0.04em] text-balance text-white">
            <span className="block lg:whitespace-nowrap">Stop guessing what</span>
            <span className="block text-[#d4b87a] lg:whitespace-nowrap">
              makes you healthier.
            </span>
          </h1>

          <p className="mt-6 max-w-[420px] text-base leading-[1.75] text-pretty text-white/75">
            Murph is your personal health assistant. Sync your biomarkers, run a
            real experiment, and see the actual before-and-after — so you change
            what works, not what&apos;s trending.
          </p>

          <div className="mt-8">
            <LandingAuthActions
              authLabel="Run your first experiment"
              authenticated={authenticated}
              context="hero"
              preloadAuthPanel
            />
          </div>
        </div>
      </div>
    </section>
  );
}
