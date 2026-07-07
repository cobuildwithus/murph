import { ChallengeCard, NewsletterCard } from "./group-chat-cards";

export function TogetherSection() {
  return (
    <section className="bg-[#f5f0e8] px-5 py-16 sm:px-10 lg:px-16 lg:py-24">
      <div className="mx-auto max-w-[1180px]">
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

        <div className="mt-10 grid gap-5 lg:grid-cols-2 lg:gap-6">
          <article className="rounded-[18px] border border-[#c4a882]/25 bg-white/45 p-4 sm:p-5">
            <p className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-[#5a6e32]">
              Group challenges
            </p>
            <div className="mt-4">
              <ChallengeCard />
            </div>
            <div className="mt-4 mr-auto max-w-[88%] rounded-[16px] bg-white px-3.5 py-2 text-[0.875rem] leading-[1.5] tracking-tight text-[#2d3436]">
              Theo, bold words for a man who logged 11 minutes yesterday.
            </div>
            <p className="mt-4 text-[0.9375rem] leading-[1.7] text-[#3a322a]">
              Murph is the referee. It sets fair baselines across different
              devices, keeps score, nudges the slackers, and calls the winner
              at the end.
            </p>
          </article>

          <article className="rounded-[18px] border border-[#c4a882]/25 bg-white/45 p-4 sm:p-5">
            <p className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-[#5a6e32]">
              The weekly newsletter
            </p>
            <div className="mt-4">
              <NewsletterCard />
            </div>
            <p className="mt-4 text-[0.9375rem] leading-[1.7] text-[#3a322a]">
              Every Sunday the group gets an email recap of the week. Wins,
              trends, and gentle callouts. Grandparents included.
            </p>
          </article>
        </div>

        <p className="mt-5 max-w-[820px] text-[0.8125rem] leading-[1.65] text-[#736a58]">
          Everyone opts in when they join. Scores are adherence and change
          against your own baseline, never raw body stats.
        </p>
      </div>
    </section>
  );
}
