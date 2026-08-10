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
    "Your referral link does not include your phone number, email, health data, or the person you send it to. It only connects the introduction to you.",
  title: "Your link shares nothing private.",
} as const;

const DEFAULT_REWARD_PRIVACY_TRUST_POINT = {
  description:
    "Murph adds the usage and records it in Settings. When Murph can reach you in chat, you’ll also get a short confirmation with no private details.",
  title: "Rewards show up automatically.",
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

const SHARE_LINK_ONLY_CARD = {
  availabilityLabel: "Personal referral link",
  description:
    "Copy your personal link and send it to someone you’d like to bring to Murph.",
  id: "share-link-only",
  rewardLabel: "Available to Murph members",
  title: "Share your referral link",
} as const;

function buildHowItWorks(input: {
  groupAvailable: boolean;
  signupAvailable: boolean;
}) {
  const invitationDescription = input.signupAvailable && input.groupAvailable
    ? "Share your personal link anytime. For a group reward, tell Murph which option you want and wait for the go-ahead before creating the group."
    : input.signupAvailable
    ? "Copy your personal link and send it to someone who is new to Murph."
    : "Share your personal link anytime. For a group reward, tell Murph which option you want and wait for the go-ahead before creating the group.";
  const qualificationDescription = input.signupAvailable && input.groupAvailable
    ? "Someone new finishes setting up Murph, or several people take part in a real group conversation."
    : input.signupAvailable
    ? "They follow your link and finish setting up their own Murph."
    : "Someone new joins Murph in the group, or several people take part in a real group conversation.";

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
        "Once the requirements are met, Murph adds the usage automatically and records the reward in Settings.",
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
    ? "Link rewards go to your personal Murph. Group rewards go to the Murph where you started the referral."
    : input.signupAvailable
    ? "Link rewards go to your personal Murph."
    : "Group rewards go to the Murph where you started the referral.";
  const tellMurphAnswer = input.signupAvailable && input.groupAvailable
    ? "Not for your personal link. For a group reward, tell Murph which option you want and wait for the go-ahead before creating the group."
    : input.signupAvailable
    ? "No. Share your personal link whenever you like. The reward comes after someone new finishes setting up Murph and the referral qualifies."
    : "Not for your personal link. For a group reward, tell Murph which option you want and wait for the go-ahead before creating the group.";
  const usageAnswer = input.groupAvailable && !input.signupAvailable
    ? `Each rewarded group option shows an estimate of how many days it may add. The actual amount of Murph time varies with how you use Murph. Group rewards add usage; they do not extend your trial or plan dates. ${ownerDescription}`
    : `Each option shows an estimate of how many days it may add. The actual amount of Murph time varies with how you use Murph. Rewards add usage; they do not extend your trial or plan dates. ${ownerDescription}`;
  const faqs = [
    {
      answer: usageAnswer,
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
      answer: input.signupAvailable
        ? "Someone who has never had their own Murph account. They need to finish setup through your link or join the new group with their own Murph. Referring yourself or the same person twice does not count."
        : "Someone who has never had their own Murph account. For this group option, they need to join the new group with their own Murph. Referring yourself or the same person twice does not count.",
      question: "What counts as a new member?",
    });
  }
  if (input.rewards.some(({ id }) => id === "active-group")) {
    faqs.push({
      answer:
        "The group needs 15 messages from people over at least 10 minutes. At least 8 must come from at least two people besides you.",
      question: "What makes a group active?",
    });
  }
  if (input.signupAvailable) {
    faqs.push({
      answer:
        "No. Settings shows the reward without naming who joined. If Murph can reach you in chat, you’ll also get a short confirmation.",
      question: "Can I see who used my link?",
    });
  }
  faqs.push({
    answer:
      "Yes. To keep referrals fair, there are limits on how often rewards can be earned. Murph shows the options available right now.",
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
  const signupReward = rewards.find(({ id }) => id === "signup-link");
  const referralCards = [
    ...rewards
      .filter(({ id }) => id !== "signup-link")
      .map((reward) => ({
        ...reward,
        rewardLabel: formatHostedPublicReferralRewardValue(reward),
      })),
    ...(signupReward
      ? [{
          ...signupReward,
          rewardLabel: formatHostedPublicReferralRewardValue(signupReward),
        }]
      : groupAvailable
      ? [SHARE_LINK_ONLY_CARD]
      : []),
  ];
  const howItWorks = buildHowItWorks({ groupAvailable, signupAvailable });
  const faqs = buildFaqs({ groupAvailable, rewards, signupAvailable });
  const rewardPrivacyTrustPoint = groupAvailable && !signupAvailable
    ? {
        description:
          "When a group referral meets the rules, Murph adds the usage and records it in Settings. When Murph can reach you in chat, you’ll also get a short confirmation with no private details.",
        title: "Group rewards show up automatically.",
      }
    : DEFAULT_REWARD_PRIVACY_TRUST_POINT;
  const trustPoints = [
    LINK_PRIVACY_TRUST_POINT,
    rewardPrivacyTrustPoint,
    groupAvailable
      ? GROUP_PRIVACY_TRUST_POINT
      : SIGNUP_PRIVACY_TRUST_POINT,
  ];
  const heroDescription = signupAvailable && groupAvailable
    ? "Share your link or bring Murph into a new group. When someone genuinely joins in and the referral meets the rules, Murph adds extra usage automatically."
    : signupAvailable
    ? "Share your personal link. When someone new finishes setting up Murph and the referral meets the rules, Murph adds extra usage automatically."
    : "Bring Murph into a new group and get people talking. Once the group qualifies, Murph adds extra usage automatically. You can also share your personal link anytime.";
  const qualificationLead = signupAvailable && groupAvailable
    ? "A link or a brand-new group is only the start. Rewards come after someone genuinely joins in."
    : signupAvailable
    ? "Opening the link is only the start. The reward comes after someone new finishes setting up Murph and the referral meets the rules."
    : "A brand-new group is only the start. The reward comes after people genuinely join the conversation.";
  const ownerDescription = signupAvailable && groupAvailable
    ? "Link rewards go to your personal Murph. Group rewards go to the Murph where you started the referral."
    : signupAvailable
    ? "Link rewards go to your personal Murph."
    : "Group rewards go to the Murph where you started the referral. Your personal link is always ready to share.";
  const privacyLead = groupAvailable && !signupAvailable
    ? "Murph keeps only what it needs to recognize a group referral and add the reward. Sharing your personal link does not currently earn extra usage."
    : "Murph keeps only what it needs to recognize the referral and add the reward.";
  const closingDescription = groupAvailable && !signupAvailable
    ? "Share your personal link anytime. Group rewards are tracked without sharing anyone’s private information."
    : "Murph keeps track of the reward without sharing anyone’s private information.";
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

            <div className="mt-8">
              <ReferralShareAction
                authenticated={authenticated}
                identityKey={identityKey}
              />
            </div>
            <a
              className="mt-5 inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-[#f5f0e8]/76 underline decoration-[#d4b87a]/45 underline-offset-4 transition-colors hover:text-[#f5f0e8]"
              href="#how-it-works"
            >
              See how it works
              <ArrowDown aria-hidden="true" className="size-4" />
            </a>
            <p className="mt-6 max-w-[56ch] text-xs leading-[1.7] text-[#f5f0e8]/55">
              Rewards add Murph usage, not cash or extra days on your plan. Day
              estimates reflect typical use and may vary.
            </p>
          </div>

          <ReferralHeroArtifact reward={artifactReward} />
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
                Referral options
              </p>
              <h2 className="mt-4 text-balance font-serif text-[clamp(2rem,4.5vw,3.7rem)] font-semibold leading-[1] tracking-[-0.045em] text-[#2d3436]">
                Choose how to share Murph.
              </h2>
            </div>
            <p className="max-w-[40ch] text-sm leading-[1.7] text-[#5a5045] lg:text-right">
              {ownerDescription}
            </p>
          </div>

          <div className="mt-12 grid gap-5 lg:grid-cols-3">
            {referralCards.map((card, index) => {
              const Icon = card.id === "share-link-only"
                ? Link2
                : REWARD_ICONS[card.id];
              return (
                <article
                  className={`rounded-[1.75rem] border p-7 sm:p-8 ${
                    index === 0
                      ? "border-[#5a6e32]/35 bg-[#253321] text-[#f5f0e8]"
                      : "border-[#c4a882]/35 bg-[#faf7f1] text-[#2d3436]"
                  }`}
                  key={card.id}
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
                      {card.availabilityLabel}
                    </span>
                  </div>

                  <p
                    className={`mt-9 font-mono text-[0.6875rem] font-medium uppercase tracking-[0.12em] ${
                      index === 0 ? "text-[#d4b87a]" : "text-[#736a58]"
                    }`}
                  >
                    {card.rewardLabel}
                  </p>
                  <h3 className="mt-3 text-balance font-serif text-[1.8rem] font-semibold leading-[1.02] tracking-[-0.04em]">
                    {card.title}
                  </h3>
                  <p
                    className={`mt-5 text-[0.9375rem] leading-[1.72] ${
                      index === 0 ? "text-[#f5f0e8]/74" : "text-[#4a4036]"
                    }`}
                  >
                    {card.description}
                  </p>
                </article>
              );
            })}
          </div>
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
              {privacyLead}
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
              {closingDescription}
            </p>
          </div>
          <div className="shrink-0">
            <ReferralShareAction
              authenticated={authenticated}
              identityKey={identityKey}
            />
          </div>
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

function ReferralHeroArtifact({
  reward,
}: {
  reward: HostedPublicReferralReward;
}) {
  const rewardMessage = reward.id === "signup-link"
    ? `Your referral came through. ${formatHostedPublicReferralRewardValue(
      reward,
    )} — already added to your Murph.`
    : `Your group referral came through. ${formatHostedPublicReferralRewardValue(
      reward,
    )} — already added where you started it.`;
  const privacyMessage = reward.id === "signup-link"
    ? "Nothing to claim. Who joined and what they share privately with Murph stays private."
    : "Nothing to claim. Private chats and health data stay private. Messages shared in the group stay visible to that group.";

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
