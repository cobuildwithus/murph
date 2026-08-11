import Image from "next/image";

import type { MurphHeadshotSrc } from "./murph-headshot-avatar";
import {
  PhoneMock,
  type ExperimentResult,
  type PhoneMessage,
} from "./phone-mock";

type Persona = {
  avatarAlt: string;
  avatarSrc: string;
  eyebrow: string;
  messages: ReadonlyArray<PhoneMessage>;
  priorMessages: ReadonlyArray<PhoneMessage>;
  result: ExperimentResult;
  tagline: string;
};

const PERSONAS: ReadonlyArray<Persona> = [
  {
    avatarAlt: "",
    avatarSrc: "/personas/sleeper-avatar.avif",
    eyebrow: "The poor sleeper",
    priorMessages: [
      {
        from: "user",
        text: "How’s the magnesium experiment looking?",
      },
    ],
    messages: [
      {
        from: "murph",
        text: "Night 9 of magnesium glycinate. Deep sleep is up 18% vs your two-week baseline.",
      },
      {
        from: "user",
        text: "Could just be the cooler weather though?",
      },
      {
        from: "murph",
        text: "Your mattress temp’s held steady according to 8 Sleep, so probably not. The jump lines up with the magnesium nights. 5 days left to see if the pattern holds.",
      },
    ],
    result: {
      eyebrow: "Day 9 · Magnesium",
      stats: [
        { label: "Deep sleep", value: "1h 42m", delta: "+18%" },
        { label: "HRV", value: "52.1", unit: "ms", delta: "+12%" },
        { label: "REM", value: "1h 08m", delta: "+6%" },
      ],
      trend: {
        baseline: [
          58, 56, 60, 57, 59, 58, 61, 57, 60, 59, 56, 58, 60, 57,
        ],
        active: [59, 64, 68, 71, 75, 78, 82, 85, 84],
        label: "9 active nights",
      },
    },
    tagline: "Testing whether magnesium actually deepens sleep.",
  },
  {
    avatarAlt: "",
    avatarSrc: "/personas/athlete-avatar.avif",
    eyebrow: "The endurance athlete",
    priorMessages: [
      {
        from: "user",
        text: "Did 2 weeks of Tabata actually move anything?",
      },
      {
        from: "murph",
        text: "Pulling your interval logs and last threshold test now.",
      },
      {
        from: "user",
        text: "What are you comparing to baseline?",
      },
      {
        from: "murph",
        text: "Lactate clearance at matched effort, Zone 2 pace at matched HR, and recovery HRV the morning after each session.",
      },
      {
        from: "user",
        text: "Cool, send when you’ve got it.",
      },
    ],
    messages: [
      {
        from: "murph",
        text: "2 weeks of Tabata logged. Your lactate threshold moved from 3.8 to 4.4 mmol/L — you’re clearing lactate faster at the same pace.",
      },
      {
        from: "user",
        text: "So the Tabata’s actually working?",
      },
      {
        from: "murph",
        text: "Looks like it. Same effort, lower blood lactate, and your Zone 2 pace dropped 12s/km. Want 2 more weeks to confirm?",
      },
    ],
    result: {
      eyebrow: "Week 2 · Tabata",
      stats: [
        { label: "Lactate threshold", value: "4.4", unit: "mmol/L", delta: "from 3.8" },
        { label: "Zone 2 pace", value: "5:12", unit: "/km", delta: "−12s" },
      ],
    },
    tagline: "Finding out if Tabata moves her lactate threshold.",
  },
  {
    avatarAlt: "",
    avatarSrc: "/personas/founder-avatar.avif",
    eyebrow: "The busy founder",
    priorMessages: [
      {
        from: "user",
        text: "Energy’s been in the gutter this week. Any idea why?",
      },
      {
        from: "murph",
        text: "Looking. Coffee log + HRV side-by-side jumped out.",
      },
    ],
    messages: [
      {
        from: "murph",
        text: "Your HRV tanks on days you have coffee after 2pm — down 15% vs morning-only days.",
      },
      {
        from: "user",
        text: "Damn. I basically live on afternoon espresso.",
      },
      {
        from: "murph",
        text: "Try a 2pm cutoff for a week? Then we’ll see whether the pattern holds.",
      },
    ],
    result: {
      eyebrow: "Day 6 · Caffeine",
      comparison: {
        label: "6 day window",
        rows: [
          {
            label: "Mornings after AM coffee",
            value: "58",
            unit: "ms",
            level: 0.92,
            tone: "good",
          },
          {
            label: "Mornings after PM espresso",
            value: "48",
            unit: "ms",
            level: 0.42,
            delta: "−15%",
            tone: "warn",
          },
        ],
      },
    },
    tagline: "Tracking down what’s tanking his energy.",
  },
];

export function PersonasSection({
  murphHeadshotSrc,
}: {
  murphHeadshotSrc: MurphHeadshotSrc;
}) {
  return (
    <section className="bg-[#f5f0e8] px-4 pt-16 pb-16 sm:px-6 lg:px-8 lg:pt-24 lg:pb-24">
      <div className="mx-auto max-w-[1280px] overflow-hidden rounded-[2rem] bg-[#1f1c18] px-6 py-16 shadow-[0_30px_80px_-40px_rgba(31,28,24,0.55)] sm:rounded-[2.5rem] sm:px-10 sm:py-20 lg:px-16 lg:py-28">
        <span className="font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-[#c4a882]">
          Pick your goal
        </span>
        <h2 className="mt-5 max-w-[18ch] font-serif text-[clamp(2rem,4vw,3.25rem)] font-semibold leading-[1.05] tracking-[-0.03em] text-[#f5f0e8]">
          Everyone’s working on something.
        </h2>
        <p className="mt-5 max-w-[52ch] text-base leading-[1.7] text-pretty text-[#f5f0e8]/55">
          Ask Murph any health question. It designs an experiment for your
          body, watches your data, and texts you what actually works.
        </p>

        <div className="mt-14 grid gap-12 lg:grid-cols-3 lg:gap-10">
          {PERSONAS.map((p) => (
            <article key={p.eyebrow} className="flex flex-col gap-6">
              <header className="flex items-center gap-4">
                <div className="relative size-14 shrink-0 overflow-hidden rounded-full ring-1 ring-[#c4a882]/25">
                  <Image
                    src={p.avatarSrc}
                    alt={p.avatarAlt}
                    fill
                    sizes="56px"
                    style={{ objectFit: "cover" }}
                  />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2.5">
                    <span
                      aria-hidden="true"
                      className="inline-block h-px w-6 bg-[#c4a882]/40"
                    />
                    <span className="font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-[#c4a882]">
                      {p.eyebrow}
                    </span>
                  </div>
                  <p className="mt-2 max-w-[26ch] text-[0.9375rem] leading-[1.5] text-[#f5f0e8]/85">
                    {p.tagline}
                  </p>
                </div>
              </header>

              <div className="mx-auto w-full max-w-[300px]">
                <PhoneMock
                  conversationHeight={470}
                  messages={p.messages}
                  murphHeadshotSrc={murphHeadshotSrc}
                  priorMessages={p.priorMessages}
                  result={p.result}
                />
              </div>
            </article>
          ))}
        </div>

        <p className="mx-auto mt-10 max-w-[72ch] text-center text-xs leading-[1.6] text-[#f5f0e8]/50">
          Illustrative examples. Changes in personal data can have many causes
          and do not establish that an intervention produced the result.
        </p>
      </div>
    </section>
  );
}
