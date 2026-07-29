import type { ReactNode } from "react";

import { ClubChallengeModes } from "@/src/components/clubs/club-challenge-modes";
import { ClubPhoneDemo } from "@/src/components/clubs/club-phone-demo";
import {
  DEFAULT_MURPH_HEADSHOT,
} from "@/src/components/homepage/murph-headshot-avatar";
import {
  buildClubPilotMailto,
  MURPH_CLUBS_EMAIL,
} from "@/src/lib/club-contact";

export function ClubsPageContent({
  animatePhoneDemo = true,
  pilotMailto = buildClubPilotMailto(),
}: {
  animatePhoneDemo?: boolean;
  pilotMailto?: string;
}) {
  return (
    <main
      className="isolate min-h-dvh bg-[#f5f0e8] antialiased"
      data-design-section="clubs-marketing-page"
      id="clubs-marketing-page"
    >
      <HeroSection
        animatePhoneDemo={animatePhoneDemo}
        pilotMailto={pilotMailto}
      />
      <ModesSection />
      <HowItWorksSection />
      <OrganizerSection />
      <MemberSection />
      <PrivacySection />
      <FaqSection />
      <FinalCtaSection pilotMailto={pilotMailto} />
    </main>
  );
}

function HeroSection({
  animatePhoneDemo,
  pilotMailto,
}: {
  animatePhoneDemo: boolean;
  pilotMailto: string;
}) {
  return (
    <section
      aria-labelledby="club-hero-title"
      className="relative overflow-hidden bg-[#2a2520] px-5 pb-20 pt-28 sm:px-10 sm:pb-24 sm:pt-32 lg:px-16 lg:pb-28 lg:pt-40"
    >
      <div className="relative mx-auto grid max-w-[1180px] items-center gap-16 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-20">
        <div>
          <SectionEyebrow dark>Early access · Murph for clubs</SectionEyebrow>
          <h1
            className="mt-8 max-w-[13ch] font-serif text-[clamp(2.75rem,6.6vw,5.4rem)] font-semibold leading-[0.97] tracking-[-0.045em] text-balance text-[#f5f0e8]"
            id="club-hero-title"
          >
            You run the club. <span className="italic text-[#c4a882]">Murph runs the challenge.</span>
          </h1>
          <p className="mt-8 max-w-[55ch] text-[1rem] leading-[1.75] text-pretty text-[#f5f0e8]/66 sm:text-[1.125rem]">
            Launch one shared goal, split the club into teams, or let everyone
            compete. Members join from one link. In an early pilot, Murph helps
            keep score, send updates, and handle the busywork.
          </p>
          <div className="mt-9 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
            <a
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-[#f5f0e8] px-6 text-[0.9375rem] font-semibold text-[#2a2520] transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#c4a882]"
              href={pilotMailto}
            >
              Plan a pilot
              <span aria-hidden="true">→</span>
            </a>
            <a
              className="inline-flex min-h-11 items-center text-[0.875rem] text-[#f5f0e8]/60 underline decoration-[#c4a882]/45 underline-offset-4 transition-colors hover:text-[#f5f0e8]"
              href={`mailto:${MURPH_CLUBS_EMAIL}`}
            >
              {MURPH_CLUBS_EMAIL}
            </a>
          </div>
          <p className="mt-8 font-mono text-[9px] uppercase tracking-[0.16em] text-[#f5f0e8]/60 sm:text-[10px]">
            Run clubs · gyms · studios · fitness communities
          </p>
        </div>

        <div className="mx-auto w-full max-w-[310px] lg:translate-y-5">
          <ClubPhoneDemo
            animate={animatePhoneDemo}
            murphHeadshotSrc={DEFAULT_MURPH_HEADSHOT}
          />
        </div>
      </div>
    </section>
  );
}

function ModesSection() {
  return (
    <section
      aria-labelledby="club-modes-title"
      className="bg-[#ebdfc6] px-5 py-20 sm:px-10 sm:py-24 lg:px-16 lg:py-28"
    >
      <div className="mx-auto max-w-[1120px]">
        <SectionEyebrow>Three ways to play</SectionEyebrow>
        <h2
          className="mt-6 max-w-[17ch] font-serif text-[clamp(2.1rem,4.8vw,4rem)] font-semibold leading-[1] tracking-[-0.04em] text-balance text-[#2d3436]"
          id="club-modes-title"
        >
          Pick the energy that fits your people.
        </h2>
        <p className="mt-6 max-w-[58ch] text-[1rem] leading-[1.7] text-pretty text-[#4d4533]">
          Some communities want a winner. Some want teams. Some want one huge
          goal everyone can move forward.
        </p>
        <ClubChallengeModes />
      </div>
    </section>
  );
}

function HowItWorksSection() {
  return (
    <section
      aria-labelledby="club-how-title"
      className="bg-[#f5f0e8] px-5 py-20 sm:px-10 sm:py-24 lg:px-16 lg:py-28"
    >
      <div className="mx-auto max-w-[1120px]">
        <div className="mx-auto max-w-[760px] text-center">
          <SectionEyebrow centered>From idea to live</SectionEyebrow>
          <h2
            className="mt-6 font-serif text-[clamp(2.1rem,4.8vw,4rem)] font-semibold leading-[1] tracking-[-0.04em] text-balance text-[#2d3436]"
            id="club-how-title"
          >
            One sentence. One link. Everyone&apos;s in.
          </h2>
          <p className="mx-auto mt-6 max-w-[58ch] text-[1rem] leading-[1.7] text-pretty text-[#635a48]">
            Start in plain language. Murph turns the idea into a challenge
            members can understand and join.
          </p>
        </div>

        <div className="mt-14 grid border-y border-[#c4a882]/30 lg:grid-cols-3 lg:divide-x lg:divide-[#c4a882]/30">
          <JourneyCard
            eyebrow="1 · Tell Murph the idea"
            body="Describe the goal the same way you would tell another organizer."
          >
            <div className="flex min-h-[235px] flex-col justify-end rounded-[1.25rem] bg-[#2a2520] p-5 sm:p-6">
              <div className="ml-auto max-w-[88%] rounded-2xl rounded-br-[6px] bg-[#5a6e32] px-4 py-3 text-[0.9375rem] leading-[1.5] text-white">
                Let&apos;s see if the club can run 3,000 miles together in August.
              </div>
              <div className="mt-3 max-w-[91%] rounded-2xl rounded-bl-[6px] bg-[#fffcf6] px-4 py-3 text-[0.9375rem] leading-[1.5] text-[#2d3436]">
                Done. August 1–31, one shared mileage goal. Want walking to
                count too?
              </div>
            </div>
          </JourneyCard>

          <JourneyCard
            eyebrow="2 · Share one link"
            body="Members join and choose the exact challenge metric they want to share."
          >
            <div className="min-h-[235px] rounded-[1.25rem] bg-[#fffcf6] p-5 ring-1 ring-black/[0.04] sm:p-6">
              <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.15em] text-[#5a6e32]">
                August miles together
              </p>
              <h3 className="mt-3 font-serif text-[1.55rem] font-semibold leading-[1.05] tracking-[-0.03em] text-[#2d3436]">
                Join the challenge
              </h3>
              <div className="mt-5 space-y-4 border-y border-[#c4a882]/20 py-4">
                <ClarityRow label="Shared">Your name and daily distance.</ClarityRow>
                <ClarityRow label="Private">Your chats, routes, and everything else.</ClarityRow>
              </div>
              <div className="mt-5 flex min-h-10 items-center justify-center rounded-full bg-[#5a6e32] text-[0.875rem] font-semibold text-white">
                Join challenge
              </div>
            </div>
          </JourneyCard>

          <JourneyCard
            eyebrow="3 · Murph keeps it moving"
            body="Progress stays current and the community hears about the moments that matter."
          >
            <div className="min-h-[235px] rounded-[1.25rem] bg-[#dfe7d3] p-5 sm:p-6">
              <div className="rounded-[1.1rem] border border-[#5a6e32]/10 bg-[#fffcf6] p-5">
                <div className="flex items-center justify-between gap-4 font-mono text-[8px] uppercase tracking-[0.14em] text-[#5a6e32]">
                  <span>Club goal</span>
                  <span>61%</span>
                </div>
                <p className="mt-4 font-serif text-[2.3rem] font-semibold leading-none tracking-[-0.05em] text-[#2d3436]">
                  1,830
                </p>
                <p className="mt-1 text-[0.8125rem] text-[#736a58]">of 3,000 miles</p>
                <div className="mt-5 h-2 overflow-hidden rounded-full bg-[#d4c4a8]/40">
                  <div className="h-full w-[61%] rounded-full bg-[#5a6e32]" />
                </div>
              </div>
              <p className="mt-4 font-serif text-[1rem] leading-[1.5] text-[#2d3436]">
                86 people are in. The club is slightly ahead of finish pace.
              </p>
            </div>
          </JourneyCard>
        </div>

        <p className="mt-9 text-center font-mono text-[9px] uppercase tracking-[0.15em] text-[#736a58]">
          No spreadsheet · no giant group chat · no new organizer app
        </p>
      </div>
    </section>
  );
}

function OrganizerSection() {
  return (
    <section
      aria-labelledby="club-organizer-title"
      className="bg-[#1a1f16] px-5 py-20 sm:px-10 sm:py-24 lg:px-16 lg:py-28"
    >
      <div className="mx-auto grid max-w-[1120px] items-center gap-14 lg:grid-cols-[0.88fr_1.12fr] lg:gap-20">
        <div>
          <SectionEyebrow dark>For organizers</SectionEyebrow>
          <h2
            className="mt-6 max-w-[14ch] font-serif text-[clamp(2.2rem,5vw,4.2rem)] font-semibold leading-[0.99] tracking-[-0.04em] text-balance text-[#f5f0e8]"
            id="club-organizer-title"
          >
            Keep the energy. Lose the admin.
          </h2>
          <p className="mt-6 max-w-[48ch] text-[1rem] leading-[1.75] text-pretty text-[#f5f0e8]/62">
            Ask Murph what is happening, change the teams, prepare an update,
            or close the challenge from a small organizer chat. Murph remembers
            the rules and handles the repetitive work.
          </p>
        </div>

        <div className="rounded-[2rem] border border-[#c4a882]/20 bg-[#f5f0e8] p-5 sm:p-8">
          <div className="flex items-center justify-between border-b border-[#c4a882]/20 pb-5">
            <div>
              <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.17em] text-[#5a6e32]">
                Organizer room
              </p>
              <p className="mt-1 font-serif text-[1.35rem] font-semibold text-[#2d3436]">
                August challenge
              </p>
            </div>
            <span className="rounded-full bg-[#5a6e32]/10 px-3 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-[#3d5028]">
              Live
            </span>
          </div>

          <div className="mt-6 space-y-3">
            <OrganizerExchange
              answer="78 of 86. Five need a connection check; three haven’t shared distance."
              request="How many people are ready to score?"
            />
            <OrganizerExchange
              answer="Drafted. It leads with the halfway milestone, names the team race, and keeps the missing-data note private."
              request="Draft the halfway update."
            />
          </div>

          <div className="mt-7 grid grid-cols-3 divide-x divide-[#c4a882]/20 rounded-[1.1rem] bg-[#fffcf6] px-2 py-4 ring-1 ring-black/[0.03]">
            <OrganizerStat label="Joined" value="86" />
            <OrganizerStat label="Scoring" value="78" />
            <OrganizerStat label="Needs help" value="8" />
          </div>
        </div>
      </div>
    </section>
  );
}

function MemberSection() {
  return (
    <section
      aria-labelledby="club-member-title"
      className="bg-[#f5f0e8] px-5 py-20 sm:px-10 sm:py-24 lg:px-16 lg:py-28"
    >
      <div className="mx-auto grid max-w-[1120px] items-center gap-14 lg:grid-cols-[1.05fr_0.95fr] lg:gap-20">
        <div className="order-2 lg:order-1">
          <div className="mx-auto max-w-[520px] rounded-[2rem] bg-[#ebdfc6] p-5 sm:p-8">
            <div className="rounded-[1.5rem] border border-[#c4a882]/20 bg-[#fffcf6] p-5 sm:p-6">
              <div className="flex items-center gap-3 border-b border-[#c4a882]/20 pb-4">
                <div className="flex size-9 items-center justify-center rounded-full bg-[#5a6e32] font-serif text-[0.875rem] font-semibold text-white">
                  M
                </div>
                <div>
                  <p className="text-[0.8125rem] font-semibold text-[#2d3436]">Your private Murph</p>
                  <p className="font-mono text-[8px] uppercase tracking-[0.12em] text-[#736a58]">
                    Only you can see this chat
                  </p>
                </div>
              </div>
              <div className="mt-5 flex flex-col gap-2.5">
                <PrivateMessage from="user">how are we doing?</PrivateMessage>
                <PrivateMessage from="murph">
                  The club is 61% to the goal and slightly ahead of pace. You&apos;ve contributed 14.2 miles.
                </PrivateMessage>
                <PrivateMessage from="user">what do i need this week?</PrivateMessage>
                <PrivateMessage from="murph">
                  Another 3.8 miles keeps you on your own pace.
                </PrivateMessage>
              </div>
            </div>
          </div>
        </div>

        <div className="order-1 lg:order-2">
          <SectionEyebrow>For every member</SectionEyebrow>
          <h2
            className="mt-6 max-w-[15ch] font-serif text-[clamp(2.2rem,5vw,4.2rem)] font-semibold leading-[0.99] tracking-[-0.04em] text-balance text-[#2d3436]"
            id="club-member-title"
          >
            One challenge. Personal support for everyone in it.
          </h2>
          <p className="mt-6 max-w-[50ch] text-[1rem] leading-[1.75] text-pretty text-[#635a48]">
            Every participant has their own private Murph. They can check their
            progress, ask what to do next, or understand a missing score without
            turning the club organizer into tech support.
          </p>
        </div>
      </div>
    </section>
  );
}

function PrivacySection() {
  return (
    <section
      aria-labelledby="club-privacy-title"
      className="bg-[#ebdfc6] px-5 py-20 sm:px-10 sm:py-24 lg:px-16 lg:py-28"
    >
      <div className="mx-auto grid max-w-[1120px] items-center gap-14 lg:grid-cols-[0.9fr_1.1fr] lg:gap-20">
        <div>
          <SectionEyebrow>Private by default</SectionEyebrow>
          <h2
            className="mt-6 max-w-[14ch] font-serif text-[clamp(2.2rem,5vw,4.2rem)] font-semibold leading-[0.99] tracking-[-0.04em] text-balance text-[#2d3436]"
            id="club-privacy-title"
          >
            Share the score. Keep the rest private.
          </h2>
          <p className="mt-6 max-w-[50ch] text-[1rem] leading-[1.75] text-pretty text-[#4d4533]">
            Members choose exactly what the challenge can use. Their private
            conversations, unrelated health history, and anything they do not
            select stay private.
          </p>
        </div>

        <div className="rounded-[2rem] border border-[#c4a882]/25 bg-[#fffcf6] p-6 sm:p-9">
          <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.17em] text-[#5a6e32]">
            Challenge permission
          </p>
          <h3 className="mt-4 font-serif text-[1.7rem] font-semibold tracking-[-0.03em] text-[#2d3436]">
            Daily running distance
          </h3>
          <p className="mt-2 max-w-[48ch] text-[0.9375rem] leading-[1.65] text-[#635a48]">
            Shares your daily running distance with this challenge. It does not
            share routes, location, private chats, or other health data.
          </p>
          <div className="mt-6 flex items-center gap-3 rounded-[1rem] bg-[#5a6e32]/8 px-4 py-4 ring-1 ring-[#5a6e32]/12">
            <span
              aria-hidden="true"
              className="flex size-6 items-center justify-center rounded-md bg-[#5a6e32] text-[0.75rem] font-semibold text-white"
            >
              ✓
            </span>
            <span className="text-[0.9375rem] font-semibold text-[#2d3436]">
              Share with this challenge
            </span>
          </div>
          <div className="mt-7 grid gap-4 border-t border-[#c4a882]/20 pt-6 sm:grid-cols-3">
            <PrivacyPoint title="The club sees">Challenge progress</PrivacyPoint>
            <PrivacyPoint title="Members choose">The metric</PrivacyPoint>
            <PrivacyPoint title="Private Murph">Stays private</PrivacyPoint>
          </div>
        </div>
      </div>
    </section>
  );
}

const FAQS = [
  {
    answer:
      "No. Each member can connect a supported health source individually, and the challenge uses only the metric they explicitly share.",
    question: "Does everyone need the same tracker?",
  },
  {
    answer:
      "No. Organizers can use a small chat with Murph as the control room. Participants join from a link and receive updates privately.",
    question: "Does everyone join one group chat?",
  },
  {
    answer:
      "Tell us the activity. Before an early pilot starts, we confirm whether its source and scoring method are supported.",
    question: "Can we track something a wearable does not measure?",
  },
  {
    answer:
      "Challenge membership, shared challenge progress, standings, and setup status; never private conversations or unrelated health history.",
    question: "What can organizers see?",
  },
] as const;

function FaqSection() {
  return (
    <section
      aria-labelledby="club-faq-title"
      className="bg-[#f5f0e8] px-5 py-20 sm:px-10 sm:py-24 lg:px-16 lg:py-28"
    >
      <div className="mx-auto max-w-[900px]">
        <SectionEyebrow centered>Questions</SectionEyebrow>
        <h2
          className="mt-6 text-center font-serif text-[clamp(2rem,4.5vw,3.5rem)] font-semibold leading-[1] tracking-[-0.04em] text-[#2d3436]"
          id="club-faq-title"
        >
          The practical stuff.
        </h2>
        <div className="mt-12 divide-y divide-[#c4a882]/25 border-y border-[#c4a882]/25">
          {FAQS.map((faq) => (
            <details key={faq.question} className="group py-1">
              <summary className="flex min-h-16 list-none cursor-pointer items-center justify-between gap-6 py-4 font-serif text-[1.1rem] font-semibold text-[#2d3436] marker:content-none sm:text-[1.25rem]">
                {faq.question}
                <span
                  aria-hidden="true"
                  className="text-[1.35rem] font-normal text-[#736a58] transition-transform group-open:rotate-45"
                >
                  +
                </span>
              </summary>
              <p className="max-w-[68ch] pb-6 pr-10 text-[0.9375rem] leading-[1.7] text-[#635a48]">
                {faq.answer}
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function FinalCtaSection({ pilotMailto }: { pilotMailto: string }) {
  return (
    <section className="bg-[#2a2520] px-5 py-20 sm:px-10 sm:py-24 lg:px-16 lg:py-28">
      <div className="mx-auto max-w-[900px] text-center">
        <SectionEyebrow centered dark>Early access</SectionEyebrow>
        <h2 className="mx-auto mt-7 max-w-[15ch] font-serif text-[clamp(2.4rem,5.5vw,4.6rem)] font-semibold leading-[0.98] tracking-[-0.045em] text-balance text-[#f5f0e8]">
          What should your club chase first?
        </h2>
        <p className="mx-auto mt-6 max-w-[58ch] text-[1rem] leading-[1.75] text-pretty text-[#f5f0e8]/62">
          Tell us what you want to run, how many people might join, and when you
          want to start. We&apos;ll help shape the challenge and run the first one
          with you.
        </p>
        <div className="mt-9 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <a
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-[#f5f0e8] px-6 text-[0.9375rem] font-semibold text-[#2a2520] transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#c4a882]"
            href={pilotMailto}
          >
            Plan a pilot
            <span aria-hidden="true">→</span>
          </a>
          <a
            className="inline-flex min-h-11 items-center text-[0.875rem] text-[#f5f0e8]/60 underline decoration-[#c4a882]/45 underline-offset-4 transition-colors hover:text-[#f5f0e8]"
            href={`mailto:${MURPH_CLUBS_EMAIL}`}
          >
            {MURPH_CLUBS_EMAIL}
          </a>
        </div>
      </div>
    </section>
  );
}

function SectionEyebrow({
  centered = false,
  children,
  dark = false,
}: {
  centered?: boolean;
  children: ReactNode;
  dark?: boolean;
}) {
  return (
    <div className={`flex items-center gap-4 ${centered ? "justify-center" : ""}`}>
      <span
        aria-hidden="true"
        className={`h-px w-10 ${dark ? "bg-[#c4a882]/60" : "bg-[#5a6e32]/60"}`}
      />
      <p
        className={`font-mono text-[9px] font-semibold uppercase tracking-[0.18em] sm:text-[10px] ${
          dark ? "text-[#c4a882]" : "text-[#3d5028]"
        }`}
      >
        {children}
      </p>
    </div>
  );
}

function JourneyCard({
  body,
  children,
  eyebrow,
}: {
  body: string;
  children: ReactNode;
  eyebrow: string;
}) {
  return (
    <article className="flex flex-col px-1 py-8 sm:px-6 lg:px-7">
      <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-[#5a6e32]">
        {eyebrow}
      </p>
      <p className="mt-3 min-h-[3.4em] text-[0.9rem] leading-[1.65] text-[#635a48]">
        {body}
      </p>
      <div className="mt-6">{children}</div>
    </article>
  );
}

function ClarityRow({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="grid grid-cols-[58px_minmax(0,1fr)] gap-3">
      <span className="font-mono text-[8px] font-semibold uppercase tracking-[0.12em] text-[#736a58]">
        {label}
      </span>
      <p className="text-[0.8125rem] leading-[1.5] text-[#2d3436]">{children}</p>
    </div>
  );
}

function OrganizerExchange({ answer, request }: { answer: string; request: string }) {
  return (
    <div className="rounded-[1.15rem] bg-[#fffcf6] p-4 ring-1 ring-black/[0.03] sm:p-5">
      <p className="ml-auto w-fit max-w-[88%] rounded-2xl rounded-br-[6px] bg-[#5a6e32] px-4 py-2.5 text-[0.875rem] leading-[1.45] text-white">
        {request}
      </p>
      <p className="mt-3 max-w-[92%] rounded-2xl rounded-bl-[6px] bg-[#f5f0e8] px-4 py-2.5 text-[0.875rem] leading-[1.5] text-[#2d3436]">
        {answer}
      </p>
    </div>
  );
}

function OrganizerStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-2 text-center">
      <p className="font-serif text-[1.55rem] font-semibold leading-none tracking-[-0.035em] text-[#2d3436]">
        {value}
      </p>
      <p className="mt-2 font-mono text-[8px] uppercase tracking-[0.12em] text-[#736a58]">
        {label}
      </p>
    </div>
  );
}

function PrivateMessage({
  children,
  from,
}: {
  children: ReactNode;
  from: "murph" | "user";
}) {
  const isUser = from === "user";
  return (
    <p
      className={`w-fit max-w-[84%] rounded-2xl px-4 py-2.5 text-[0.875rem] leading-[1.5] ${
        isUser
          ? "ml-auto rounded-br-[6px] bg-[#5a6e32] text-white"
          : "rounded-bl-[6px] bg-[#f5f0e8] text-[#2d3436]"
      }`}
    >
      {children}
    </p>
  );
}

function PrivacyPoint({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <div>
      <p className="font-mono text-[8px] font-semibold uppercase tracking-[0.13em] text-[#736a58]">
        {title}
      </p>
      <p className="mt-1.5 font-serif text-[1.05rem] font-semibold text-[#2d3436]">
        {children}
      </p>
    </div>
  );
}
