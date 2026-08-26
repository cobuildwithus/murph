import Link from "next/link";
import { ArrowRight, Link2, UsersRound } from "lucide-react";

import {
  formatHostedPublicReferralRewardCompactValue,
  formatHostedPublicReferralRewardValue,
  type HostedPublicReferralReward,
} from "@/src/lib/hosted-growth/referral-program";

export function ReferralSection({
  rewards,
}: {
  rewards: readonly HostedPublicReferralReward[];
}) {
  if (rewards.length === 0) {
    return null;
  }

  const signupAvailable = rewards.some(({ id }) => id === "signup-link");
  const groupAvailable = rewards.some(({ id }) => id !== "signup-link");
  const description = signupAvailable && groupAvailable
    ? "Bring someone into Murph—or start a fresh group—and you can earn more room to keep going."
    : signupAvailable
    ? "Bring someone new into Murph and you can earn more room to keep going."
    : "Start a fresh group and you can earn more room to keep going.";

  return (
    <section className="bg-[#f3eadb] px-4 py-10 sm:px-8 sm:py-16 lg:px-16 lg:py-20">
      <div className="mx-auto grid max-w-[1200px] overflow-hidden rounded-[1.75rem] border border-[#d7bd8a]/45 bg-[#fff9ef] lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="flex flex-col justify-between bg-[#3f4c2e] px-6 py-9 sm:px-10 sm:py-11 lg:min-h-[27rem] lg:px-12">
          <div>
            <p className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-[#d4b87a]">
              Murph referrals
            </p>
            <h2 className="mt-5 font-serif text-[clamp(2rem,7.5vw,2.75rem)] font-semibold leading-[0.98] tracking-[-0.035em] text-[#fff8eb] lg:text-4xl xl:text-[2.75rem]">
              <span className="block" data-referral-headline-lead>
                Bring your people.
              </span>{" "}
              <span className="mt-1 block text-[#f4c969]">Earn more Murph.</span>
            </h2>
            <p className="mt-6 max-w-[42ch] text-[0.9375rem] leading-7 text-[#fff8eb]/75 sm:text-base">
              {description}
            </p>
          </div>

          <Link
            className="group mt-10 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-[#f4c969] px-6 py-3.5 text-[0.9375rem] font-semibold text-[#26321f] transition-colors hover:bg-[#ffda7f] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#fff8eb] sm:w-fit"
            href="/refer"
          >
            See ways to earn
            <ArrowRight
              aria-hidden="true"
              className="size-4 transition-transform group-hover:translate-x-0.5"
            />
          </Link>
        </div>

        <div className="flex flex-col bg-[#fff9ef] px-6 py-9 sm:px-10 sm:py-11 lg:px-12">
          <div>
            <p className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-[#7d6a4a]">
              Choose your way
            </p>
            <p className="mt-2 font-serif text-2xl font-semibold tracking-[-0.025em] text-[#3f4c2e]">
              Referral rewards, your way.
            </p>
          </div>

          <div className="mt-5 border-y border-[#d7bd8a]/45">
            {rewards.map((reward) => {
              const Icon = reward.id === "signup-link" ? Link2 : UsersRound;
              return (
                <article
                  className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 border-b border-[#d7bd8a]/35 py-5 last:border-b-0 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:gap-x-5"
                  key={reward.id}
                >
                  <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-[#f4c969] text-[#3f4c2e]">
                    <Icon aria-hidden="true" className="size-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold leading-6 text-[#334025] sm:text-[0.9375rem]">
                      {reward.title}
                    </p>
                  </div>
                  <div className="col-start-2 sm:col-start-auto sm:text-right">
                    <p
                      aria-label={formatHostedPublicReferralRewardValue(reward)}
                      className="inline-flex items-center gap-2 whitespace-nowrap"
                    >
                      <span
                        aria-hidden="true"
                        className="font-serif text-[1.75rem] font-semibold leading-none tracking-[-0.035em] text-[#a86f08]"
                      >
                        {formatHostedPublicReferralRewardCompactValue(reward)}
                      </span>
                      <span
                        aria-hidden="true"
                        className="text-left font-mono text-[9px] font-medium uppercase leading-[1.25] tracking-[0.08em] text-[#6f634f]"
                        data-referral-reward-unit
                      >
                        days of
                        <br />
                        Murph
                      </span>
                    </p>
                  </div>
                </article>
              );
            })}
          </div>

          <p className="mt-4 text-xs leading-5 text-[#796c55]">
            Typical Murph usage added—not calendar access. Actual capacity
            varies.
          </p>
        </div>
      </div>
    </section>
  );
}
