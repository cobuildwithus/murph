import Link from "next/link";
import { ArrowRight, Link2, UsersRound } from "lucide-react";

import {
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
    ? "Share your link or start a group with Murph."
    : signupAvailable
    ? "Share your personal link with someone new."
    : "Start a fresh group with Murph.";

  return (
    <section className="bg-[#f5f0e8] px-4 py-10 sm:px-8 sm:py-16 lg:px-16 lg:py-20">
      <div className="relative mx-auto max-w-[1200px] overflow-hidden rounded-[2rem] bg-[#1d271b] px-6 py-10 sm:px-10 sm:py-14 lg:px-14 lg:py-16">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(circle at 12% 12%, rgba(196,168,130,0.22) 0%, transparent 38%), radial-gradient(circle at 88% 22%, rgba(90,110,50,0.42) 0%, transparent 42%)",
          }}
        />

        <div className="relative grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(360px,0.82fr)] lg:gap-14">
          <div>
            <p className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-[#d4b87a]">
              Murph referrals
            </p>
            <h2 className="mt-4 max-w-[15ch] text-balance font-serif text-[clamp(2rem,4.6vw,3.8rem)] font-semibold leading-[0.98] tracking-[-0.045em] text-[#f5f0e8]">
              Bring your people. Earn more Murph time.
            </h2>
            <p className="mt-5 max-w-[58ch] text-[0.9375rem] leading-[1.75] text-[#f5f0e8]/72 sm:text-base">
              {description}
            </p>
            <Link
              className="group mt-7 inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#f5f0e8] px-5 py-3.5 text-[0.9375rem] font-semibold text-[#2d3436] transition-colors hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d4b87a]"
              href="/refer"
            >
              See ways to earn
              <ArrowRight
                aria-hidden="true"
                className="size-4 transition-transform group-hover:translate-x-0.5"
              />
            </Link>
          </div>

          <div className="grid gap-3">
            {rewards.map((reward) => {
              const Icon = reward.id === "signup-link" ? Link2 : UsersRound;
              return (
                <article
                  className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 rounded-2xl border border-white/12 bg-white/[0.06] p-4 backdrop-blur-sm sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:p-5"
                  key={reward.id}
                >
                  <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-2xl bg-white/10 text-[#d4b87a]">
                    <Icon aria-hidden="true" className="size-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[#f5f0e8]">
                      {reward.title}
                    </p>
                  </div>
                  <div className="col-span-2 border-t border-white/10 pt-3 sm:col-span-1 sm:max-w-[13rem] sm:border-0 sm:pt-0 sm:text-right">
                    <p className="text-pretty text-sm font-semibold leading-[1.45] text-[#f5f0e8]">
                      {formatHostedPublicReferralRewardValue(reward)}
                    </p>
                  </div>
                </article>
              );
            })}
            <p className="px-1 pt-1 text-xs leading-[1.5] text-[#f5f0e8]/55">
              Typical-use estimate. Actual capacity varies.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
