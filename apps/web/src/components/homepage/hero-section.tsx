import { LandingAuthActions } from "@/app/auth-controls";

export function HeroSection({
  authenticated,
}: {
  authenticated: boolean;
}) {
  return (
    <section className="relative min-h-[85svh] overflow-hidden bg-[#3a3028] sm:min-h-svh">
      {/* eslint-disable-next-line @next/next/no-img-element */}
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
            your health.
            <br />
            <span className="text-[#d4b87a]">Now act on it.</span>
          </h1>

          <p className="mt-6 max-w-[420px] text-base leading-[1.75] text-pretty text-white/75">
            Your wearable collects the data. Murph tells you what to try,
            measures what changed, and gives you a clear answer.
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
  );
}
