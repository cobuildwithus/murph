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
            bubble="how does everyone keep up with this?"
            artifact={
              <div className="mx-auto w-full max-w-[340px]">
                <NewsletterCard />
              </div>
            }
          />
        </div>

        <p className="mt-6 max-w-[820px] text-[0.8125rem] leading-[1.65] text-[#736a58]">
          Everyone opts in when they join. Scores are adherence and change
          against your own baseline, never raw body stats.
        </p>
      </div>
    </section>
  );
}
