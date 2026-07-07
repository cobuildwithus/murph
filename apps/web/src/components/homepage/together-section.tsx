import { WideFeature } from "./asks-section";
import { ChallengeCard, NewsletterCard } from "./group-chat-cards";

export function TogetherSection() {
  return (
    <section className="bg-[#f5f0e8] px-4 py-20 sm:px-8 lg:px-16 lg:py-28">
      <div className="mx-auto max-w-[1200px]">
        <div className="max-w-[720px]">
          <p className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-[#736a58]">
            Better together
          </p>
          <h2 className="mt-4 font-serif text-[clamp(2rem,4vw,3.25rem)] font-semibold leading-[1.08] tracking-[-0.03em] text-[#2d3436]">
            Do it with your people.
          </h2>
          <p className="mt-5 max-w-[62ch] text-[1rem] leading-[1.7] text-[#3a322a]">
            Habits stick when someone else is watching. Start a challenge with
            friends, or set up a weekly newsletter so the whole family knows
            how everyone is doing.
          </p>
        </div>

        <div className="mt-12 space-y-5 sm:space-y-6">
          <WideFeature
            tint="sage"
            artifactSide="right"
            eyebrow="Group challenges"
            headline="I referee health challenges with your friends."
            body="Murph is the referee. It sets fair baselines across different devices, keeps score, nudges the slackers, and calls the winner at the end."
            bubble="no shot you guys are keeping up with me this week 😤"
            artifact={
              <div className="mx-auto w-full max-w-[340px]">
                <ChallengeCard />
                <div className="mt-3 ml-auto w-fit max-w-[92%] rounded-2xl rounded-br-[6px] bg-white px-4 py-2.5 text-[0.9375rem] leading-[1.4] text-[#2d3436] shadow-[0_8px_24px_-6px_rgba(60,40,20,0.2)]">
                  Theo, bold words for a man who logged 11 minutes yesterday.
                </div>
              </div>
            }
          />

          <WideFeature
            tint="gold"
            artifactSide="left"
            eyebrow="The weekly newsletter"
            headline="I send the whole family a weekly health newsletter."
            body="Every Sunday the group gets an email recap of the week. Wins, trends, and gentle callouts. Grandparents included."
            bubble="can you send grandpa our weekly wins?"
            artifactAlign="center"
            artifact={
              <div className="mx-auto w-full max-w-[360px]">
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
