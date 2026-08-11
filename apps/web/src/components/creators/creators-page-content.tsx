import {
  ArrowRight,
  Check,
  CircleDollarSign,
  LockKeyhole,
  UsersRound,
} from "lucide-react";
import type { ReactNode } from "react";

import { buildCreatorProgramMailto } from "@/src/lib/creator-program-contact";

const KNOWLEDGE_INPUTS = [
  "Podcast and newsletter archive",
  "Protocols and toolkits",
  "Course or coaching method",
  "Research and citations",
] as const;

const PROGRAM_STEPS = [
  {
    label: "Your body of work",
    detail: "The health guidance, sources, claims, and boundaries you approve.",
  },
  {
    label: "Personal guidance",
    detail:
      "Murph helps each person apply it to their schedule, goals, and health context.",
  },
  {
    label: "A community program",
    detail: "Shared starts, milestones, creator updates, and aggregate progress.",
  },
] as const;

const ADAPTATIONS = [
  {
    context: "Before school",
    time: "7:10 AM",
    action: "Ten minutes outside after waking",
  },
  {
    context: "After a night shift",
    time: "11:40 AM",
    action: "Outdoor light after the main sleep period",
  },
  {
    context: "Travel day",
    time: "Minimum version",
    action: "Five minutes outdoors before the first long indoor block",
  },
] as const;

const CREATOR_VALUE = [
  {
    number: "01",
    title: "Activate your archive",
    body:
      "Turn years of episodes, books, newsletters, courses, and protocols into a guided health experience.",
  },
  {
    number: "02",
    title: "Personalize at scale",
    body:
      "Give each member answers and adaptations grounded in your approved work without coaching every person yourself.",
  },
  {
    number: "03",
    title: "Strengthen your membership",
    body:
      "Run cohorts, launches, challenges, and shared milestones that give people a reason to participate.",
  },
  {
    number: "04",
    title: "Learn what people use",
    body:
      "See aggregate starts, retention, and completion without seeing anyone’s private health information.",
  },
  {
    number: "05",
    title: "Open a new revenue line",
    body:
      "Founding partners can earn from qualified participation, separately from existing referral rewards.",
  },
] as const;

const EXAMPLE_PROGRAMS = [
  {
    type: "Science educator",
    title: "Fourteen-Day Sleep Toolkit",
    body:
      "Turn a research-backed toolkit into personal timing guidance, private check-ins, and one shared cohort.",
  },
  {
    type: "Performance coach",
    title: "Foundational Fitness Cycle",
    body:
      "Turn a training framework into progressive sessions, workout support, and community milestones.",
  },
  {
    type: "Women’s health educator",
    title: "Stronger Through Midlife",
    body:
      "Turn women-specific training and recovery education into a reviewed, stage-aware member experience.",
  },
  {
    type: "Nutrition educator",
    title: "Thirty Days of Protein",
    body:
      "Turn a nutrition method into meal support, simple tracking, and an aggregate consistency goal without public body rankings.",
  },
] as const;

const PRIMARY_ACTION_CLASS =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-[#f5f0e8] px-6 py-3.5 text-[0.9375rem] font-semibold text-[#1a1f16] transition-colors hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#d4b87a]";

export function CreatorsPageContent({
  creatorMailto = buildCreatorProgramMailto(),
}: {
  creatorMailto?: string;
}) {
  return (
    <main
      className="isolate min-h-dvh overflow-hidden bg-[#f5f0e8] antialiased"
      data-design-section="creators-marketing-page"
      id="creators-marketing-page"
    >
      <HeroSection creatorMailto={creatorMailto} />
      <KnowledgeToPracticeSection />
      <PersonalAdaptationSection />
      <CommunitySection />
      <CreatorValueSection />
      <CreatorControlSection />
      <EarningsSection />
      <ExamplesSection />
      <FoundingPartnerSection creatorMailto={creatorMailto} />
    </main>
  );
}

function HeroSection({ creatorMailto }: { creatorMailto: string }) {
  return (
    <section
      aria-labelledby="creators-hero-title"
      className="relative min-h-[94svh] overflow-hidden bg-[#1a1f16] px-5 pb-20 pt-32 sm:px-10 sm:pb-24 sm:pt-36 lg:px-16 lg:pb-28 lg:pt-40"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-[18rem] top-[10%] size-[42rem] rounded-full border border-[#c4a882]/10 bg-[#5a6e32]/10"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-24 bottom-0 h-px w-[44%] bg-[#c4a882]/25"
      />

      <div className="relative mx-auto grid max-w-[1180px] items-center gap-16 lg:grid-cols-[minmax(0,1.02fr)_minmax(360px,0.98fr)] lg:gap-20">
        <div>
          <SectionEyebrow dark>Murph for health experts & creators</SectionEyebrow>
          <h1
            className="mt-7 max-w-[13ch] text-balance font-serif text-[clamp(3.1rem,7vw,6.5rem)] font-semibold leading-[0.92] tracking-[-0.055em] text-[#f5f0e8]"
            id="creators-hero-title"
          >
            Give every member a personal health guide grounded in your work.
          </h1>
          <p className="mt-8 max-w-[60ch] text-pretty text-[1rem] leading-[1.75] text-[#f5f0e8]/68 sm:text-[1.125rem]">
            Murph turns your podcasts, protocols, courses, and coaching into a
            reviewed health experience—helping each person apply your guidance
            privately while the whole community moves through it together.
          </p>
          <div className="mt-9 flex flex-col items-start gap-5 sm:flex-row sm:items-center">
            <a className={PRIMARY_ACTION_CLASS} href={creatorMailto}>
              Explore a partnership
              <ArrowRight aria-hidden="true" className="size-4" />
            </a>
            <a
              className="inline-flex min-h-11 items-center text-sm font-semibold text-[#f5f0e8]/68 underline decoration-[#c4a882]/50 underline-offset-4 transition-colors hover:text-[#f5f0e8]"
              href="#creator-experience"
            >
              See how Murph works
            </a>
          </div>
          <p className="mt-8 font-mono text-[9px] font-medium uppercase tracking-[0.15em] text-[#f5f0e8]/48 sm:text-[10px]">
            Built with the Murph team · No code · Your content stays yours
          </p>
        </div>

        <LivingProgramPreview />
      </div>
    </section>
  );
}

function LivingProgramPreview() {
  return (
    <div
      aria-label="Illustrative health program showing approved creator knowledge, a private member adaptation, and aggregate community participation"
      className="relative mx-auto w-full max-w-[520px]"
      role="img"
    >
      <div className="border-y border-[#c4a882]/20 py-5">
        <div className="flex items-center justify-between gap-4 font-mono text-[9px] uppercase tracking-[0.14em] text-[#d4b87a]">
          <span>Illustrative health program</span>
          <span>Version 1.0</span>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          {KNOWLEDGE_INPUTS.map((input) => (
            <span
              className="rounded-full border border-[#c4a882]/15 px-3 py-2 text-[0.75rem] text-[#f5f0e8]/58"
              key={input}
            >
              {input}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-6 bg-[#fffcf6] p-6 sm:p-8">
        <div className="flex items-start justify-between gap-6 border-b border-[#c4a882]/20 pb-5">
          <div>
            <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.15em] text-[#5a6e32]">
              Morning Light Month
            </p>
            <h2 className="mt-2 font-serif text-[2rem] font-semibold leading-none tracking-[-0.04em] text-[#2d3436]">
              Day 8 of 30
            </h2>
          </div>
          <div className="text-right">
            <p className="font-serif text-[1.8rem] font-semibold leading-none tracking-[-0.04em] text-[#2d3436]">
              12,840
            </p>
            <p className="mt-2 text-[0.72rem] text-[#736a58]">participating</p>
          </div>
        </div>

        <div className="mt-6 space-y-3">
          <div className="ml-auto max-w-[82%] rounded-2xl rounded-br-[5px] bg-[#5a6e32] px-4 py-3 text-[0.875rem] leading-[1.55] text-white">
            I work nights. When should I get outside?
          </div>
          <div className="max-w-[91%] rounded-2xl rounded-bl-[5px] bg-[#ede5d8] px-4 py-3 text-[0.875rem] leading-[1.55] text-[#2d3436]">
            Your waking schedule shifts the timing. Start after your main sleep
            period rather than forcing a morning clock time. When do you usually
            wake on workdays?
          </div>
        </div>

        <div className="mt-7 grid grid-cols-3 gap-4 border-t border-[#c4a882]/20 pt-5">
          <ProgramStat label="Active this week" value="8,910" />
          <ProgramStat label="Practiced today" value="68%" />
          <ProgramStat label="Approved sources" value="14" />
        </div>
      </div>
    </div>
  );
}

function ProgramStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-serif text-[1.35rem] font-semibold leading-none tracking-[-0.03em] text-[#2d3436]">
        {value}
      </p>
      <p className="mt-2 text-[0.68rem] leading-[1.4] text-[#736a58]">{label}</p>
    </div>
  );
}

function KnowledgeToPracticeSection() {
  return (
    <section
      aria-labelledby="knowledge-practice-title"
      className="bg-[#f5f0e8] px-5 py-20 sm:px-10 sm:py-24 lg:px-16 lg:py-32"
      id="creator-experience"
    >
      <div className="mx-auto max-w-[1120px]">
        <div className="max-w-[850px]">
          <SectionEyebrow>From health content to health action</SectionEyebrow>
          <h2
            className="mt-6 text-balance font-serif text-[clamp(2.5rem,5.5vw,5rem)] font-semibold leading-[0.96] tracking-[-0.05em] text-[#2d3436]"
            id="knowledge-practice-title"
          >
            Turn years of health knowledge into guidance people can actually follow.
          </h2>
          <p className="mt-7 max-w-[64ch] text-[1rem] leading-[1.75] text-[#5a5045]">
            Your audience already asks what to do first, how to adapt it, and
            how to stay consistent. Murph answers from the sources and
            boundaries you approve, then supports the follow-through after the
            episode, post, or course ends.
          </p>
        </div>

        <div className="mt-16 border-y border-[#c4a882]/30 lg:grid lg:grid-cols-3 lg:divide-x lg:divide-[#c4a882]/30">
          {PROGRAM_STEPS.map((step, index) => (
            <article className="py-8 lg:px-8 lg:py-10 first:lg:pl-0 last:lg:pr-0" key={step.label}>
              <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.15em] text-[#5a6e32]">
                0{index + 1}
              </p>
              <h3 className="mt-5 font-serif text-[1.75rem] font-semibold leading-[1.05] tracking-[-0.035em] text-[#2d3436]">
                {step.label}
              </h3>
              <p className="mt-4 max-w-[36ch] text-[0.9375rem] leading-[1.7] text-[#635a48]">
                {step.detail}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function PersonalAdaptationSection() {
  return (
    <section
      aria-labelledby="personal-adaptation-title"
      className="bg-[#ebdfc6] px-5 py-20 sm:px-10 sm:py-24 lg:px-16 lg:py-32"
    >
      <div className="mx-auto max-w-[1120px]">
        <div className="grid gap-10 lg:grid-cols-[0.88fr_1.12fr] lg:items-end lg:gap-20">
          <div>
            <SectionEyebrow>Personal without 1:1 coaching</SectionEyebrow>
            <h2
              className="mt-6 text-balance font-serif text-[clamp(2.3rem,5vw,4.5rem)] font-semibold leading-[0.98] tracking-[-0.05em] text-[#2d3436]"
              id="personal-adaptation-title"
            >
              The same health program, adapted to each person’s life.
            </h2>
          </div>
          <p className="max-w-[54ch] text-[1rem] leading-[1.75] text-[#4d4533] lg:pb-1">
            Murph uses each member’s schedule, goals, prior actions, questions,
            and authorized health data while staying inside the principles and
            adaptation boundaries you approve.
          </p>
        </div>

        <div className="mt-14 grid gap-px overflow-hidden border border-[#c4a882]/35 bg-[#c4a882]/35 lg:grid-cols-3">
          {ADAPTATIONS.map((adaptation) => (
            <article className="bg-[#fffcf6] p-7 sm:p-9" key={adaptation.context}>
              <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.15em] text-[#5a6e32]">
                {adaptation.context}
              </p>
              <p className="mt-7 font-serif text-[2.3rem] font-semibold leading-none tracking-[-0.05em] text-[#2d3436]">
                {adaptation.time}
              </p>
              <p className="mt-5 text-[0.9375rem] leading-[1.7] text-[#635a48]">
                {adaptation.action}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function CommunitySection() {
  return (
    <section
      aria-labelledby="community-practice-title"
      className="bg-[#1d271b] px-5 py-20 sm:px-10 sm:py-24 lg:px-16 lg:py-32"
    >
      <div className="mx-auto grid max-w-[1120px] items-center gap-16 lg:grid-cols-[minmax(0,0.92fr)_minmax(360px,1.08fr)] lg:gap-24">
        <div>
          <SectionEyebrow dark>Your community in action</SectionEyebrow>
          <h2
            className="mt-6 text-balance font-serif text-[clamp(2.4rem,5vw,4.8rem)] font-semibold leading-[0.97] tracking-[-0.05em] text-[#f5f0e8]"
            id="community-practice-title"
          >
            Bring your community together around a shared health program.
          </h2>
          <p className="mt-7 max-w-[54ch] text-[1rem] leading-[1.75] text-[#f5f0e8]/64">
            Run one launch, cohort, challenge, or seasonal reset. Each member
            gets private support while the community sees only the shared
            milestones and aggregate progress you choose to make visible.
          </p>
          <div className="mt-9 grid gap-6 border-t border-[#c4a882]/20 pt-8 sm:grid-cols-2">
            <BoundaryNote
              title="Private member support"
              body="Questions, schedule, health data, progress, and personal adaptation."
            />
            <BoundaryNote
              title="Community-wide progress"
              body="Shared starts, milestones, creator updates, and aggregate participation."
            />
          </div>
        </div>

        <CommunityPulse />
      </div>
    </section>
  );
}

function CommunityPulse() {
  const dots = Array.from({ length: 48 }, (_, index) => index);

  return (
    <div
      aria-label="Illustrative aggregate community progress for Morning Light Month"
      className="relative mx-auto flex aspect-square w-full max-w-[520px] items-center justify-center rounded-full border border-[#c4a882]/15"
      role="img"
    >
      <div className="absolute inset-[11%] rounded-full border border-dashed border-[#c4a882]/20" />
      <div className="absolute inset-[22%] rounded-full border border-[#c4a882]/15" />
      <div className="absolute inset-0 grid grid-cols-8 place-items-center gap-2 p-[8%] sm:gap-3">
        {dots.map((dot) => (
          <span
            aria-hidden="true"
            className={`size-2 rounded-full sm:size-2.5 ${
              dot % 5 === 0 || dot % 7 === 0
                ? "bg-[#d4b87a]"
                : dot % 3 === 0
                ? "bg-[#7a8c6e]"
                : "bg-[#f5f0e8]/20"
            }`}
            key={dot}
          />
        ))}
      </div>
      <div className="relative z-10 w-[58%] bg-[#1d271b] px-4 py-8 text-center">
        <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.15em] text-[#d4b87a]">
          Week two
        </p>
        <p className="mt-4 font-serif text-[clamp(2.5rem,7vw,4.8rem)] font-semibold leading-none tracking-[-0.06em] text-[#f5f0e8]">
          84,216
        </p>
        <p className="mt-3 text-[0.8rem] leading-[1.5] text-[#f5f0e8]/58">
          aggregate minutes outdoors
        </p>
        <p className="mt-6 border-t border-[#c4a882]/20 pt-5 font-mono text-[8px] uppercase tracking-[0.14em] text-[#f5f0e8]/44">
          Next milestone · 100,000
        </p>
      </div>
    </div>
  );
}

function BoundaryNote({ body, title }: { body: string; title: string }) {
  return (
    <div>
      <h3 className="font-serif text-[1.35rem] font-semibold leading-[1.1] tracking-[-0.03em] text-[#f5f0e8]">
        {title}
      </h3>
      <p className="mt-3 text-[0.875rem] leading-[1.65] text-[#f5f0e8]/56">
        {body}
      </p>
    </div>
  );
}

function CreatorValueSection() {
  return (
    <section
      aria-labelledby="creator-value-title"
      className="bg-[#f5f0e8] px-5 py-20 sm:px-10 sm:py-24 lg:px-16 lg:py-32"
    >
      <div className="mx-auto max-w-[1120px]">
        <div className="max-w-[790px]">
          <SectionEyebrow>Why health leaders build with Murph</SectionEyebrow>
          <h2
            className="mt-6 text-balance font-serif text-[clamp(2.4rem,5vw,4.7rem)] font-semibold leading-[0.98] tracking-[-0.05em] text-[#2d3436]"
            id="creator-value-title"
          >
            Scale the work without watering it down.
          </h2>
        </div>

        <div className="mt-14 border-y border-[#c4a882]/30">
          {CREATOR_VALUE.map((value) => (
            <article
              className="grid gap-4 border-t border-[#c4a882]/25 py-8 first:border-t-0 md:grid-cols-[70px_minmax(0,0.8fr)_minmax(0,1.2fr)] md:items-baseline md:gap-8 lg:py-10"
              key={value.number}
            >
              <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.15em] text-[#5a6e32]">
                {value.number}
              </p>
              <h3 className="font-serif text-[1.7rem] font-semibold leading-[1.08] tracking-[-0.035em] text-[#2d3436]">
                {value.title}
              </h3>
              <p className="max-w-[52ch] text-[0.9375rem] leading-[1.72] text-[#635a48]">
                {value.body}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function CreatorControlSection() {
  const reviewRows = [
    ["Approved sources", "14"],
    ["Core guidance", "6"],
    ["Permitted adaptations", "4"],
    ["Excluded claims", "3"],
    ["Current version", "1.0"],
  ] as const;

  return (
    <section
      aria-labelledby="creator-control-title"
      className="bg-[#ede5d8] px-5 py-20 sm:px-10 sm:py-24 lg:px-16 lg:py-32"
    >
      <div className="mx-auto grid max-w-[1080px] items-start gap-14 lg:grid-cols-[minmax(0,0.9fr)_minmax(380px,1.1fr)] lg:gap-24">
        <div>
          <SectionEyebrow>Scientific and brand control</SectionEyebrow>
          <h2
            className="mt-6 text-balance font-serif text-[clamp(2.35rem,5vw,4.5rem)] font-semibold leading-[0.98] tracking-[-0.05em] text-[#2d3436]"
            id="creator-control-title"
          >
            Your sources, standards, and name stay intact.
          </h2>
          <p className="mt-7 max-w-[54ch] text-[1rem] leading-[1.75] text-[#5a5045]">
            You approve the health guidance, sources, permitted adaptations,
            excluded claims, public presentation, and member journey before
            launch. Material changes create a reviewed new version rather than
            silently rewriting what people joined.
          </p>
          <ul className="mt-8 space-y-4">
            <ControlPromise>You retain ownership of your original content.</ControlPromise>
            <ControlPromise>You approve the member-facing health guidance before launch.</ControlPromise>
            <ControlPromise>Creators receive aggregate program reporting only.</ControlPromise>
            <ControlPromise>Private messages and personal health data stay private.</ControlPromise>
            <ControlPromise>Murph’s safety, consent, and evidence rules remain in force.</ControlPromise>
          </ul>
        </div>

        <div className="border border-[#c4a882]/35 bg-[#fffcf6] p-7 sm:p-9">
          <div className="flex items-center justify-between gap-5 border-b border-[#c4a882]/25 pb-6">
            <div>
              <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.15em] text-[#5a6e32]">
                Health program review
              </p>
              <p className="mt-2 font-serif text-[1.7rem] font-semibold tracking-[-0.035em] text-[#2d3436]">
                Morning Light Month
              </p>
            </div>
            <LockKeyhole aria-hidden="true" className="size-6 text-[#5a6e32]" strokeWidth={1.6} />
          </div>
          <dl className="divide-y divide-[#c4a882]/20">
            {reviewRows.map(([label, value]) => (
              <div className="flex items-center justify-between gap-6 py-5" key={label}>
                <dt className="text-[0.875rem] text-[#635a48]">{label}</dt>
                <dd className="font-serif text-[1.25rem] font-semibold text-[#2d3436]">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
          <p className="border-t border-[#c4a882]/25 pt-5 text-[0.75rem] leading-[1.6] text-[#736a58]">
            Illustrative review brief. Founding programs are built and reviewed
            directly with the Murph team; no self-serve publishing system is
            implied.
          </p>
        </div>
      </div>
    </section>
  );
}

function ControlPromise({ children }: { children: ReactNode }) {
  return (
    <li className="flex items-start gap-3 text-[0.9375rem] leading-[1.65] text-[#4d4533]">
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-[#5a6e32]/10 text-[#5a6e32]">
        <Check aria-hidden="true" className="size-3" strokeWidth={2.4} />
      </span>
      <span>{children}</span>
    </li>
  );
}

function EarningsSection() {
  return (
    <section
      aria-labelledby="creator-earnings-title"
      className="bg-[#dfe7d3] px-5 py-20 sm:px-10 sm:py-24 lg:px-16 lg:py-28"
    >
      <div className="mx-auto max-w-[1060px]">
        <div className="grid gap-10 lg:grid-cols-[0.78fr_1.22fr] lg:items-end lg:gap-20">
          <div>
            <SectionEyebrow>Creator economics</SectionEyebrow>
            <h2
              className="mt-6 text-balance font-serif text-[clamp(2.3rem,4.8vw,4.3rem)] font-semibold leading-[0.98] tracking-[-0.05em] text-[#2d3436]"
              id="creator-earnings-title"
            >
              Earn when your health program creates real participation.
            </h2>
          </div>
          <p className="max-w-[54ch] text-[1rem] leading-[1.75] text-[#4d4533]">
            Founding creator rewards are tied to qualified, retained
            participation—not impressions, clicks, or empty signups. Exact
            qualifications, caps, and payment terms are agreed before launch.
          </p>
        </div>

        <div className="mt-14 grid gap-px overflow-hidden border border-[#5a6e32]/15 bg-[#5a6e32]/15 md:grid-cols-2">
          <EarningDefinition
            icon={<UsersRound aria-hidden="true" className="size-5" strokeWidth={1.8} />}
            title="Referral reward"
          >
            Recognizes the person who introduced a new participant to Murph.
          </EarningDefinition>
          <EarningDefinition
            icon={<CircleDollarSign aria-hidden="true" className="size-5" strokeWidth={1.8} />}
            title="Creator reward"
          >
            Recognizes the person who created the health experience that
            produced qualified, retained participation.
          </EarningDefinition>
        </div>
        <p className="mt-7 max-w-[72ch] text-[0.8125rem] leading-[1.65] text-[#5a5045]">
          Selected founding creators may also receive a separate paid launch
          partnership. Creator rewards do not provide access to participant
          accounts or private health information, and no amount of income is
          guaranteed.
        </p>
      </div>
    </section>
  );
}

function EarningDefinition({
  children,
  icon,
  title,
}: {
  children: ReactNode;
  icon: ReactNode;
  title: string;
}) {
  return (
    <article className="bg-[#fffcf6] p-7 sm:p-9">
      <span className="flex size-10 items-center justify-center rounded-full bg-[#5a6e32]/10 text-[#5a6e32]">
        {icon}
      </span>
      <h3 className="mt-6 font-serif text-[1.75rem] font-semibold leading-[1.05] tracking-[-0.035em] text-[#2d3436]">
        {title}
      </h3>
      <p className="mt-4 max-w-[42ch] text-[0.9375rem] leading-[1.7] text-[#635a48]">
        {children}
      </p>
    </article>
  );
}

function ExamplesSection() {
  return (
    <section
      aria-labelledby="creator-examples-title"
      className="bg-[#f5f0e8] px-5 py-20 sm:px-10 sm:py-24 lg:px-16 lg:py-32"
    >
      <div className="mx-auto max-w-[1120px]">
        <div className="max-w-[820px]">
          <SectionEyebrow>What could your health expertise become?</SectionEyebrow>
          <h2
            className="mt-6 text-balance font-serif text-[clamp(2.35rem,5vw,4.6rem)] font-semibold leading-[0.98] tracking-[-0.05em] text-[#2d3436]"
            id="creator-examples-title"
          >
            Start with the health outcome your audience already trusts you to help with.
          </h2>
        </div>

        <div className="mt-14 grid gap-px overflow-hidden border border-[#c4a882]/30 bg-[#c4a882]/30 md:grid-cols-2">
          {EXAMPLE_PROGRAMS.map((program) => (
            <article className="min-h-64 bg-[#fffcf6] p-7 sm:p-9" key={program.title}>
              <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.15em] text-[#5a6e32]">
                Illustrative · {program.type}
              </p>
              <h3 className="mt-8 max-w-[14ch] font-serif text-[2rem] font-semibold leading-[1.02] tracking-[-0.04em] text-[#2d3436]">
                {program.title}
              </h3>
              <p className="mt-5 max-w-[42ch] text-[0.9375rem] leading-[1.72] text-[#635a48]">
                {program.body}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function FoundingPartnerSection({ creatorMailto }: { creatorMailto: string }) {
  return (
    <section className="relative overflow-hidden bg-[#2a2520] px-5 py-20 sm:px-10 sm:py-24 lg:px-16 lg:py-32">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-56 right-[8%] size-[34rem] rounded-full border border-[#c4a882]/10 bg-[#5a6e32]/10"
      />
      <div className="relative mx-auto grid max-w-[1080px] items-end gap-12 lg:grid-cols-[1fr_auto] lg:gap-20">
        <div>
          <SectionEyebrow dark>Founding health partnerships</SectionEyebrow>
          <h2 className="mt-6 max-w-[16ch] text-balance font-serif text-[clamp(2.6rem,5.5vw,5rem)] font-semibold leading-[0.95] tracking-[-0.055em] text-[#f5f0e8]">
            Bring us the health work your audience already trusts.
          </h2>
          <p className="mt-7 max-w-[62ch] text-[1rem] leading-[1.75] text-[#f5f0e8]/65">
            We’ll choose one valuable part of your podcast, course, protocol,
            book, or coaching system, turn it into a guided member experience,
            pilot it with a small cohort, and help you launch it to the wider
            community.
          </p>
        </div>
        <a className={PRIMARY_ACTION_CLASS} href={creatorMailto}>
          Explore a partnership
          <ArrowRight aria-hidden="true" className="size-4" />
        </a>
      </div>
      <div className="relative mx-auto mt-12 flex max-w-[1080px] flex-wrap gap-x-7 gap-y-3 border-t border-[#c4a882]/20 pt-7 font-mono text-[8px] uppercase tracking-[0.14em] text-[#f5f0e8]/45 sm:text-[9px]">
        <span>Creator-owned content</span>
        <span>Reviewed health guidance</span>
        <span>Private member data</span>
        <span>Aggregate program insight</span>
      </div>
    </section>
  );
}

function SectionEyebrow({
  children,
  dark = false,
}: {
  children: ReactNode;
  dark?: boolean;
}) {
  return (
    <p
      className={`font-mono text-[9px] font-semibold uppercase tracking-[0.16em] sm:text-[10px] ${
        dark ? "text-[#d4b87a]" : "text-[#5a6e32]"
      }`}
    >
      {children}
    </p>
  );
}
