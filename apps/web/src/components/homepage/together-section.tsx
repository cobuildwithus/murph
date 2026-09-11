import { FeatureCard } from "./asks-section";
import { ChallengeCard, NewsletterCard } from "./group-chat-cards";
import {
  DEFAULT_MURPH_HEADSHOT,
  MurphHeadshotAvatar,
} from "./murph-headshot-avatar";

export function TogetherSection() {
  return (
    <section className="bg-[#f5f0e8] px-4 pt-20 pb-10 sm:px-8 sm:pt-20 sm:pb-20 lg:px-16 lg:pt-28 lg:pb-28">
      <div className="mx-auto max-w-[1200px]">
        <div className="max-w-[900px]">
          <h2 className="font-serif text-[2.5rem] font-semibold leading-[1.02] tracking-[-0.045em] text-balance text-[#2d3436] sm:text-[clamp(3rem,6vw,5.25rem)]">
            Do it with your people.
          </h2>
        </div>

        <div className="mt-10 grid gap-12 sm:mt-14 sm:gap-16 lg:grid-cols-2 lg:gap-20">
          <FeatureCard
            tint="sage"
            layout="wide"
            headline="I referee health challenges with your friends."
            bubble="no shot you guys are keeping up with me this week 😤"
            artifact={
              <div className="mx-auto w-full max-w-[390px]">
                <ChallengeCard />
                <div className="mt-3 flex items-end gap-1.5">
                  <MurphHeadshotAvatar
                    src={DEFAULT_MURPH_HEADSHOT}
                    className="mb-0.5 size-[22px] shrink-0"
                  />
                  <div className="min-w-0">
                    <p className="mb-0.5 pl-1 font-mono text-[9px] tracking-[0.08em] text-[#d7e59b]">
                      Murph
                    </p>
                    <div className="w-fit rounded-2xl rounded-bl-[6px] bg-white px-4 py-2.5 text-[0.9375rem] leading-[1.4] text-[#2d3436] shadow-[0_8px_24px_-6px_rgba(60,40,20,0.2)]">
                      Theo, bold words for a man who logged 11 minutes yesterday.
                    </div>
                  </div>
                </div>
              </div>
            }
          />

          <FeatureCard
            layout="reverse"
            headline="I send the whole family a weekly health newsletter."
            bubble="can you send grandpa our weekly wins?"
            artifact={
              <div className="mx-auto w-full max-w-[440px] px-5 py-3">
                <div className="relative">
                  <div
                    aria-hidden="true"
                    className="absolute inset-0 -translate-y-2 translate-x-3 rotate-[1.8deg] rounded-[18px] bg-white/40 ring-1 ring-[#c4a882]/15"
                  />
                  <div className="relative">
                    <NewsletterCard />
                  </div>
                </div>
                <div className="mt-3.5 flex items-end gap-1.5">
                  <span
                    aria-hidden="true"
                    className="mb-0.5 flex size-[22px] shrink-0 items-center justify-center rounded-full bg-[#8a6428]/25 text-[10px] font-semibold text-[#6b4d1e]"
                  >
                    G
                  </span>
                  <div>
                    <p className="mb-0.5 pl-1 font-mono text-[9px] tracking-[0.08em] text-[#736a58]">
                      Grandpa
                    </p>
                    <div className="w-fit rounded-2xl rounded-bl-[6px] bg-white px-4 py-2.5 text-[0.9375rem] leading-[1.4] text-[#2d3436] shadow-[0_8px_24px_-6px_rgba(60,40,20,0.2)]">
                      so proud of you kids
                    </div>
                  </div>
                </div>
              </div>
            }
          />
        </div>
      </div>
    </section>
  );
}
