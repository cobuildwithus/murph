import Link from "next/link";
import { ArrowRight, Link2, UsersRound } from "lucide-react";

import {
  formatHostedPublicReferralRewardCompactValue,
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
    ? "Share your link or start a group with Murph."
    : signupAvailable
    ? "Share your personal link with someone new."
    : "Start a fresh group with Murph.";

  return (
    <section className="bg-[#f5f0e8] px-4 py-10 sm:px-8 sm:py-16 lg:px-16 lg:py-20">
      <div className="mx-auto grid max-w-[1200px] overflow-hidden rounded-[1.25rem] border border-[#c4a882]/25 bg-[#fffcf6] lg:grid-cols-[minmax(0,0.96fr)_minmax(0,1.04fr)]">
        <div className="flex flex-col justify-between bg-[#2d3436] px-6 py-9 sm:px-10 sm:py-12 lg:min-h-[31rem] lg:px-12 lg:py-14">
          <div>
            <p className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-[#d4b87a]">
              Murph referrals
            </p>
            <h2 className="mt-5 font-serif text-[clamp(2rem,8.5vw,3rem)] font-semibold leading-[1.02] tracking-[-0.035em] text-[#f5f0e8] lg:text-4xl xl:text-5xl">
              <span className="block" data-referral-headline-lead>
                Bring your people.
              </span>{" "}
              <span className="block">Earn more Murph time.</span>
            </h2>
            <p className="mt-5 max-w-[48ch] text-[0.9375rem] leading-7 text-[#f5f0e8]/70 sm:text-base">
              {description}
            </p>
          </div>

          <Link
            className="group mt-8 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#f5f0e8] px-6 py-3.5 text-[0.9375rem] font-semibold text-[#2d3436] transition-colors hover:bg-[#eadfce] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d4b87a] sm:w-fit"
            href="/refer"
          >
            See ways to earn
            <ArrowRight
              aria-hidden="true"
              className="size-4 transition-transform group-hover:translate-x-0.5"
            />
          </Link>
        </div>

        <div className="flex flex-col px-6 py-9 sm:px-10 sm:py-12 lg:px-12 lg:py-14">
          <p className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-[#736a58]">
            Ways to earn
          </p>

          <div className="mt-5 border-y border-[#c4a882]/30">
            {rewards.map((reward) => {
              const Icon = reward.id === "signup-link" ? Link2 : UsersRound;
              return (
                <article
                  className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-2 border-b border-[#c4a882]/25 py-5 last:border-b-0 sm:grid-cols-[auto_minmax(0,1fr)_minmax(11rem,0.9fr)] sm:gap-x-5 sm:py-6"
                  key={reward.id}
                >
                  <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-[#c4a882]/15 text-[#5a6e32]">
                    <Icon aria-hidden="true" className="size-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold leading-6 text-[#2d3436] sm:text-[0.9375rem]">
                      {reward.title}
                    </p>
                  </div>
                  <div className="col-start-2 sm:col-start-auto sm:text-right">
                    <p className="text-pretty font-serif text-[1.0625rem] font-semibold leading-[1.35] tracking-[-0.015em] text-[#2d3436] sm:text-lg">
                      {formatHostedPublicReferralRewardCompactValue(reward)}
                    </p>
                  </div>
                </article>
              );
            })}
          </div>

          <p className="mt-4 text-xs leading-5 text-[#736a58]">
            Typical Murph usage added—not calendar access. Actual capacity
            varies.
          </p>
        </div>
      </div>
    </section>
  );
}
