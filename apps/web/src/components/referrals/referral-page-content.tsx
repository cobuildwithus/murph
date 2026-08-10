import {
  ArrowDown,
  Heart,
  Link2,
  MessageCircleMore,
  UsersRound,
} from "lucide-react";
import Link from "next/link";

import {
  DEFAULT_MURPH_HEADSHOT,
  MurphHeadshotAvatar,
} from "@/src/components/homepage/murph-headshot-avatar";
import { ReferralShareAction } from "@/src/components/referrals/referral-share-action";
import {
  formatHostedPublicReferralRewardValue,
  type HostedPublicReferralReward,
  type HostedPublicReferralRewardId,
} from "@/src/lib/hosted-growth/referral-program";

const LINK_PRIVACY_TRUST_POINT = {
  description:
    "Your stable link contains no phone number, email address, health data, or recipient identity. It attributes the introduction to you, nothing more.",
  title: "The link is only a code.",
} as const;

const REWARD_PRIVACY_TRUST_POINT = {
  description:
    "Murph applies rewards automatically, and Settings history keeps the durable receipt. When an authorized Murph chat is available, Murph also sends a short confirmation without repeating anything shared privately.",
  title: "The receipt stays with you.",
} as const;

const SIGNUP_PRIVACY_TRUST_POINT = {
  description:
    "The person you invite gets their own private relationship with Murph from the first message. Their private conversations and health data are never visible to you.",
  title: "Their Murph starts private.",
} as const;

const GROUP_PRIVACY_TRUST_POINT = {
  description:
    "Private chats and health data stay private. Messages someone chooses to post in a shared group remain visible to that group.",
  title: "Private stays private.",
} as const;

const REWARD_ICONS: Record<HostedPublicReferralRewardId, typeof Link2> = {
  "active-group": MessageCircleMore,
  "new-person-group": UsersRound,
  "signup-link": Link2,
};

function buildHowItWorks(input: {
  groupAvailable: boolean;
  signupAvailable: boolean;
}) {
  const invitationDescription = input.signupAvailable && input.groupAvailable
    ? "Copy your personal link, or ask Murph to start one of the available group missions before you create the group."
    : input.signupAvailable
    ? "Copy your personal link from here or Settings, then share it with someone who is genuinely new to Murph."
    : "Ask Murph to start one of the available group missions, then wait for the confirmation before you create the fresh group.";
  const qualificationDescription = input.signupAvailable && input.groupAvailable
    ? "Your friend completes their own Murph setup, or the fresh group reaches the mission’s real-participation requirements."
    : input.signupAvailable
    ? "Your friend follows the attributed invite and completes their own ordinary Murph setup. Opening the link alone is never enough."
    : "The fresh group reaches the selected mission’s real-participation requirements after Murph has confirmed the mission.";

  return [
    {
      description: invitationDescription,
      title: "Choose how to invite",
    },
    {
      description: qualificationDescription,
      title: "They actually join in",
    },
    {
      description:
        "After qualification and rolling-limit checks pass, Murph applies the usage reward automatically. The durable receipt appears in Settings history. When an authorized Murph chat is available, Murph also sends a short confirmation.",
      title: "Usage is added",
    },
  ];
}

function buildFaqs(input: {
  groupAvailable: boolean;
  rewards: readonly HostedPublicReferralReward[];
  signupAvailable: boolean;
}) {
  const ownerDescription = input.signupAvailable && input.groupAvailable
    ? "Signup rewards go to your Murph. Mission rewards go to the personal or group Murph the mission was accepted for, where a busy room can use the rewarded Murph time faster."
    : input.signupAvailable
    ? "Signup rewards go to your personal Murph."
    : "Mission rewards go to the personal or group Murph the mission was accepted for, where a busy room can use the rewarded Murph time faster.";
  const tellMurphAnswer = input.signupAvailable && input.groupAvailable
    ? "Your personal referral link works without asking Murph first. Group missions need one extra step: tell Murph which mission you want, and wait for the confirmation before creating the fresh group."
    : input.signupAvailable
    ? "No. Your personal referral link works without asking Murph first. A genuinely new member still needs to complete ordinary Murph setup through the invite attributed to you."
    : "Yes. Tell Murph which group mission you want, and wait for the confirmation before creating the fresh group.";
  const faqs = [
    {
      answer:
        `Each option above estimates days of Murph usage. Actual capacity varies with the model, tools, media, task complexity, and response length. The reward adds usage capacity; it does not extend a trial or subscription period. ${ownerDescription}`,
      question: "How much usage do I earn?",
    },
    {
      answer: tellMurphAnswer,
      question: "Do I need to tell Murph first?",
    },
  ];

  if (
    input.signupAvailable
    || input.rewards.some(({ id }) => id === "new-person-group")
  ) {
    faqs.push({
      answer:
        "A genuinely new member must complete their own ordinary Murph setup through the attributed invite or fresh group. Self-referrals, duplicate identities, and ambiguous attribution do not qualify.",
      question: "What counts as a new member?",
    });
  }
  if (input.rewards.some(({ id }) => id === "active-group")) {
    faqs.push({
      answer:
        "The active-group mission requires a fresh group with 15 qualifying human messages, including at least 8 messages from at least two people other than the referrer, spread across at least 10 minutes.",
      question: "What makes a group active?",
    });
  }
  if (input.signupAvailable) {
    faqs.push({
      answer:
        "No. Settings history records qualifying rewards without identifying who joined. When an authorized Murph chat is available, Murph also confirms an applied reward.",
      question: "Can I see who used my link?",
    });
  }
  faqs.push({
    answer:
      "Yes. Rolling limits and eligibility checks prevent abuse, and available rewards can change. Murph shows the options available right now. Rewards add usage capacity but do not extend a trial end date.",
    question: "Are there limits?",
  });

  return faqs;
}

export function ReferralPageContent({
  authenticated,
  identityKey,
  rewards,
}: {
  authenticated: boolean;
  identityKey: string | null;
  rewards: readonly HostedPublicReferralReward[];
}) {
  if (rewards.length === 0) {
    return <ReferralUnavailableContent />;
  }

  const signupAvailable = rewards.some(({ id }) => id === "signup-link");
  const groupAvailable = rewards.some(({ id }) => id !== "signup-link");
  const howItWorks = buildHowItWorks({ groupAvailable, signupAvailable });
  const faqs = buildFaqs({ groupAvailable, rewards, signupAvailable });
  const trustPoints = [
    ...(signupAvailable ? [LINK_PRIVACY_TRUST_POINT] : []),
    REWARD_PRIVACY_TRUST_POINT,
    groupAvailable
      ? GROUP_PRIVACY_TRUST_POINT
      : SIGNUP_PRIVACY_TRUST_POINT,
  ];
  const heroDescription = signupAvailable && groupAvailable
    ? "Explore your personal link or a group mission. Murph applies a reward automatically only after that path’s eligibility, rolling-limit, and completion checks pass."
    : signupAvailable
    ? "Share your personal link. A genuinely new completed signup can earn the usage reward after Murph’s eligibility and rolling-limit checks pass."
    : "Explore a qualifying group mission. Murph adds the usage reward automatically after the mission is accepted and its participation requirements are met.";
  const qualificationLead = signupAvailable && groupAvailable
    ? "Opening a link or creating a group alone is never enough."
    : signupAvailable
    ? "Opening a link alone is never enough."
    : "Creating a group alone is never enough.";
  const ownerDescription = signupAvailable && groupAvailable
    ? "Eligible link rewards go to your personal Murph. Mission rewards go to the personal or group Murph the mission was accepted for, once Murph confirms the mission."
    : signupAvailable
    ? "Eligible link rewards go to your personal Murph after settlement checks pass."
    : "Mission rewards go to the personal or group Murph the mission was accepted for, once Murph confirms the mission.";
  const artifactReward = signupAvailable
    ? rewards.find(({ id }) => id === "signup-link")!
    : rewards[0]!;

  return (
    <main className="min-h-screen bg-[#f5f0e8] antialiased">
      <section
        className="relative isolate overflow-hidden bg-[#1d271b] px-5 pb-20 pt-32 sm:px-10 sm:pb-24 sm:pt-36 lg:px-16 lg:pb-28 lg:pt-40"
        id="refer-top"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background:
              "radial-gradient(circle at 16% 18%, rgba(196,168,130,0.22) 0%, transparent 36%), radial-gradient(circle at 82% 24%, rgba(90,110,50,0.42) 0%, transparent 42%), radial-gradient(circle at 58% 92%, rgba(196,149,106,0.13) 0%, transparent 36%)",
          }}
        />
        <div className="mx-auto grid max-w-[1160px] items-center gap-14 lg:grid-cols-[minmax(0,1.08fr)_minmax(360px,0.92fr)] lg:gap-16">
          <div>
            <p className="font-mono text-[10px] font-medium uppercase tracking-[0.13em] text-[#d4b87a]">
              Murph referrals
            </p>
            <h1 className="mt-5 max-w-[12ch] text-balance font-serif text-[clamp(2.75rem,7.5vw,5.8rem)] font-semibold leading-[0.98] tracking-[-0.045em] text-[#f5f0e8]">
              Earn more Murph time.
            </h1>
            <p className="mt-6 max-w-[58ch] text-pretty text-[1rem] leading-[1.75] text-[#f5f0e8]/75 sm:text-[1.0625rem]">
              {heroDescription}
            </p>

            {signupAvailable
              ? (
                <div className="mt-8">
                  <ReferralShareAction
                    authenticated={authenticated}
                    identityKey={identityKey}
                  />
                </div>
              )
              : null}
            <a
              className="mt-5 inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-[#f5f0e8]/76 underline decoration-[#d4b87a]/45 underline-offset-4 transition-colors hover:text-[#f5f0e8]"
              href="#how-it-works"
            >
              See how rewards qualify
              <ArrowDown aria-hidden="true" className="size-4" />
            </a>
            <p className="mt-6 max-w-[56ch] text-xs leading-[1.7] text-[#f5f0e8]/55">
              Rewards add usage capacity, not cash or extra calendar time. Day
              estimates reflect typical Murph use; actual capacity varies with
              the model, tools, media, and task complexity.
            </p>
          </div>

          <ReferralRewardReceiptPreview reward={artifactReward} />
        </div>
      </section>

      <section
        className="px-5 py-20 sm:px-10 sm:py-24 lg:px-16 lg:py-28"
        id="how-it-works"
      >
        <div className="mx-auto max-w-[1160px]">
          <div className="max-w-[700px]">
            <p className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-[#736a58]">
              How it works
            </p>
            <h2 className="mt-4 text-balance font-serif text-[clamp(2rem,4.5vw,3.7rem)] font-semibold leading-[1] tracking-[-0.045em] text-[#2d3436]">
              Real introductions. Clear rules.
            </h2>
            <p className="mt-5 max-w-[62ch] text-[1rem] leading-[1.75] text-[#3a322a]">
              Each path has its own eligibility and participation checks.{" "}
              {qualificationLead}
            </p>
          </div>

          <div className="mt-12 grid gap-10 sm:mt-14 lg:grid-cols-3 lg:gap-8">
            {howItWorks.map((step) => (
              <article
                className="border-t border-[#2d3436]/55 pt-6"
                key={step.title}
              >
                <h3 className="font-serif text-[1.55rem] font-semibold leading-[1.08] tracking-[-0.035em] text-[#2d3436]">
                  {step.title}
                </h3>
                <p className="mt-3 max-w-[44ch] text-[0.9375rem] leading-[1.72] text-[#4a4036]">
                  {step.description}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section
        className="border-y border-[#c4a882]/20 bg-[#ede5d8] px-5 py-20 sm:px-10 sm:py-24 lg:px-16 lg:py-28"
        id="ways-to-earn"
      >
        <div className="mx-auto max-w-[1160px]">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-[720px]">
              <p className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-[#736a58]">
                Ways to earn
              </p>
              <h2 className="mt-4 text-balance font-serif text-[clamp(2rem,4.5vw,3.7rem)] font-semibold leading-[1] tracking-[-0.045em] text-[#2d3436]">
                Choose a referral path.
              </h2>
            </div>
            <p className="max-w-[40ch] text-sm leading-[1.7] text-[#5a5045] lg:text-right">
              {ownerDescription}
            </p>
          </div>

          <ReferralRewardCards className="mt-12" rewards={rewards} />
        </div>
      </section>

      <section
        className="px-5 py-20 sm:px-10 sm:py-24 lg:px-16 lg:py-28"
        id="privacy"
      >
        <div className="mx-auto grid max-w-[1160px] gap-12 lg:grid-cols-[0.82fr_1.18fr] lg:gap-20">
          <div>
            <p className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-[#736a58]">
              Designed for trust
            </p>
            <h2 className="mt-4 text-balance font-serif text-[clamp(2rem,4vw,3.45rem)] font-semibold leading-[1] tracking-[-0.045em] text-[#2d3436]">
              Your referral never exposes their health.
            </h2>
            <p className="mt-5 max-w-[48ch] text-[1rem] leading-[1.75] text-[#4a4036]">
              Murph tracks only the minimum attribution needed to apply the
              reward.
            </p>
          </div>

          <div className="lg:pt-3">
            {trustPoints.map((point) => (
              <div
                className="border-t border-[#c4a882]/35 py-7 first:border-t-0 first:pt-0 lg:py-8"
                key={point.title}
              >
                <h3 className="font-serif text-[1.45rem] font-semibold leading-[1.1] tracking-[-0.03em] text-[#2d3436]">
                  {point.title}
                </h3>
                <p className="mt-3 max-w-[56ch] text-[0.9375rem] leading-[1.72] text-[#4a4036]">
                  {point.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-[#c4a882]/25 bg-[#faf7f1] px-5 py-20 sm:px-10 sm:py-24 lg:px-16 lg:py-28">
        <div className="mx-auto grid max-w-[1040px] gap-12 lg:grid-cols-[0.62fr_1fr] lg:gap-20">
          <div>
            <p className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-[#736a58]">
              Questions
            </p>
            <h2 className="mt-4 font-serif text-[clamp(2rem,4vw,3.3rem)] font-semibold leading-[1] tracking-[-0.045em] text-[#2d3436]">
              The useful details.
            </h2>
          </div>

          <div className="divide-y divide-[#c4a882]/30 border-y border-[#c4a882]/30">
            {faqs.map((faq) => (
              <details className="group py-1" key={faq.question}>
                <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-5 py-4 text-left text-[1rem] font-semibold text-[#2d3436] marker:content-none [&::-webkit-details-marker]:hidden">
                  <span>{faq.question}</span>
                  <span
                    aria-hidden="true"
                    className="text-xl font-normal text-[#736a58] transition-transform group-open:rotate-45"
                  >
                    +
                  </span>
                </summary>
                <p className="max-w-[68ch] pb-6 pr-10 text-[0.9375rem] leading-[1.75] text-[#4a4036]">
                  {faq.answer}
                </p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="relative overflow-hidden bg-[#2a2520] px-5 py-16 sm:px-10 sm:py-20 lg:px-16">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(circle at 30% 60%, rgba(160,122,78,0.22) 0%, transparent 50%), radial-gradient(circle at 72% 32%, rgba(90,110,50,0.18) 0%, transparent 42%)",
          }}
        />
        <div className="relative mx-auto flex max-w-[1160px] flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="font-serif text-[clamp(1.9rem,3.6vw,3rem)] font-semibold leading-[1.05] tracking-[-0.04em] text-[#f5f0e8]">
              <span className="block">Health is hard.</span>
              <span className="block">Bring someone with you.</span>
            </h2>
            <p className="mt-3 max-w-[46ch] text-[0.9375rem] leading-[1.7] text-[#f5f0e8]/70">
              Murph handles attribution and privacy. Qualifying rewards are
              applied automatically.
            </p>
          </div>
          {signupAvailable
            ? (
              <div className="shrink-0">
                <ReferralShareAction
                  authenticated={authenticated}
                  identityKey={identityKey}
                />
              </div>
            )
            : (
              <a
                className="inline-flex min-h-12 shrink-0 items-center justify-center rounded-xl bg-[#f5f0e8] px-5 py-3.5 text-[0.9375rem] font-semibold text-[#2d3436] transition-colors hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d4b87a]"
                href="#ways-to-earn"
              >
                See available missions
              </a>
            )}
        </div>
      </section>
    </main>
  );
}

function ReferralUnavailableContent() {
  return (
    <main className="min-h-screen bg-[#f5f0e8] antialiased">
      <section className="relative isolate flex min-h-[78vh] items-center overflow-hidden bg-[#1d271b] px-5 pb-20 pt-32 sm:px-10 sm:pb-24 sm:pt-36 lg:px-16 lg:pb-28 lg:pt-40">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background:
              "radial-gradient(circle at 16% 18%, rgba(196,168,130,0.22) 0%, transparent 36%), radial-gradient(circle at 82% 24%, rgba(90,110,50,0.35) 0%, transparent 42%)",
          }}
        />
        <div className="mx-auto grid w-full max-w-[1160px] items-center gap-12 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-20">
          <div>
            <p className="font-mono text-[10px] font-medium uppercase tracking-[0.13em] text-[#d4b87a]">
              Murph referrals
            </p>
            <h1 className="mt-5 max-w-[13ch] text-balance font-serif text-[clamp(2.75rem,7.5vw,5.8rem)] font-semibold leading-[0.98] tracking-[-0.045em] text-[#f5f0e8]">
              Referral rewards are temporarily unavailable.
            </h1>
            <p className="mt-6 max-w-[58ch] text-pretty text-[1rem] leading-[1.75] text-[#f5f0e8]/75 sm:text-[1.0625rem]">
              There are no referral rewards available right now. If you’re
              already a member, your stable link remains in Settings. Rewards
              are paused, so no usage reward is currently promised. Check back
              here for current options.
            </p>
            <Link
              className="mt-8 inline-flex min-h-12 items-center justify-center rounded-xl bg-[#f5f0e8] px-5 py-3.5 text-[0.9375rem] font-semibold text-[#2d3436] transition-colors hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d4b87a]"
              href="/"
            >
              Back to Murph
            </Link>
          </div>

          <div className="border-t border-white/15 pt-7 lg:border-l lg:border-t-0 lg:pl-10 lg:pt-0">
            <MurphHeadshotAvatar
              className="size-12"
              src={DEFAULT_MURPH_HEADSHOT}
            />
            <p className="mt-5 font-serif text-[1.65rem] font-semibold leading-[1.08] tracking-[-0.035em] text-[#f5f0e8]">
              The page will update when an earning path is available again.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}

export function ReferralRewardCards({
  className,
  rewards,
}: {
  className?: string;
  rewards: readonly HostedPublicReferralReward[];
}) {
  return (
    <div className={`grid gap-5 lg:grid-cols-3 ${className ?? ""}`}>
      {rewards.map((reward, index) => {
        const Icon = REWARD_ICONS[reward.id];
        return (
          <article
            className={`rounded-[1.75rem] border p-7 sm:p-8 ${
              index === 0
                ? "border-[#5a6e32]/35 bg-[#253321] text-[#f5f0e8]"
                : "border-[#c4a882]/35 bg-[#faf7f1] text-[#2d3436]"
            }`}
            key={reward.id}
          >
            <div className="flex items-start justify-between gap-4">
              <span
                className={`inline-flex size-11 items-center justify-center rounded-2xl ${
                  index === 0
                    ? "bg-white/10 text-[#d4b87a]"
                    : "bg-[#5a6e32]/10 text-[#5a6e32]"
                }`}
              >
                <Icon aria-hidden="true" className="size-5" />
              </span>
              <span
                className={`rounded-full border px-3 py-1.5 font-mono text-[9px] font-medium uppercase tracking-[0.09em] ${
                  index === 0
                    ? "border-white/15 bg-white/[0.05] text-[#f5f0e8]/70"
                    : "border-[#c4a882]/35 bg-white/55 text-[#736a58]"
                }`}
              >
                {reward.availabilityLabel}
              </span>
            </div>

            <p
              className={`mt-9 font-mono text-[0.6875rem] font-medium uppercase tracking-[0.12em] ${
                index === 0 ? "text-[#d4b87a]" : "text-[#736a58]"
              }`}
            >
              {formatHostedPublicReferralRewardValue(reward)}
            </p>
            <h3 className="mt-3 text-balance font-serif text-[1.8rem] font-semibold leading-[1.02] tracking-[-0.04em]">
              {reward.title}
            </h3>
            <p
              className={`mt-5 text-[0.9375rem] leading-[1.72] ${
                index === 0 ? "text-[#f5f0e8]/74" : "text-[#4a4036]"
              }`}
            >
              {reward.description}
            </p>
          </article>
        );
      })}
    </div>
  );
}

export function ReferralRewardReceiptPreview({
  reward,
}: {
  reward: HostedPublicReferralReward;
}) {
  const rewardMessage = reward.id === "signup-link"
    ? `Your referral came through. ${formatHostedPublicReferralRewardValue(
      reward,
    )} — already added to your Murph.`
    : `Your group mission is complete. ${formatHostedPublicReferralRewardValue(
      reward,
    )} — already added to the Murph it was accepted for.`;
  const privacyMessage = reward.id === "signup-link"
    ? "No claim needed. Who joined and what they share privately with Murph stays private."
    : "No claim needed. Private chats and health data stay private. Shared-group messages remain visible to that group.";

  return (
    <div aria-hidden="true" className="relative mx-auto w-full max-w-[470px]">
      <div className="absolute -left-5 top-12 hidden h-28 w-28 rounded-full border border-[#d4b87a]/25 sm:block" />
      <div className="absolute -right-8 -top-7 h-40 w-40 rounded-full bg-[#5a6e32]/20 blur-3xl" />
      <div className="relative rotate-[1.2deg] rounded-[2rem] border border-white/12 bg-[#f5f0e8] p-5 shadow-[0_30px_90px_-45px_rgba(0,0,0,0.85)] sm:p-6">
        <div className="flex items-center gap-3 border-b border-[#c4a882]/25 pb-4">
          <MurphHeadshotAvatar
            className="size-10"
            src={DEFAULT_MURPH_HEADSHOT}
          />
          <div>
            <p className="text-sm font-semibold text-[#2d3436]">Murph</p>
            <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-[#736a58]">
              example · chat available
            </p>
          </div>
        </div>

        <div className="relative mt-7 w-fit max-w-[88%] rounded-2xl rounded-tl-[6px] bg-white px-4 py-3.5 text-[0.9375rem] leading-[1.55] text-[#2d3436] ring-1 ring-[#c4a882]/15">
          {rewardMessage}
          <span className="absolute -right-2.5 -top-3.5 flex size-7 items-center justify-center rounded-full bg-[#5a6e32] ring-2 ring-[#f5f0e8]">
            <Heart className="size-3.5 fill-current text-[#f5f0e8]" />
          </span>
        </div>

        <div className="mt-2.5 w-fit max-w-[88%] rounded-2xl rounded-tl-[6px] bg-white px-4 py-3.5 text-[0.9375rem] leading-[1.55] text-[#2d3436] ring-1 ring-[#c4a882]/15">
          {privacyMessage}
        </div>
      </div>
    </div>
  );
}
