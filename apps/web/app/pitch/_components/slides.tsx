/* eslint-disable @next/next/no-img-element */
"use client";

import Link from "next/link";
import { useState } from "react";

import {
  ChevronDown,
  Eyebrow,
  Slide,
  SlideHeading,
} from "./primitives";
import { ChatMock, PositioningChart } from "./mocks";

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Pitch deck slides — one component per slide, composed in order by
   PitchDeck. Tone and index stay co-located with each slide; the
   TONES array in primitives mirrors them for the deck chrome.
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

/* ━━━ 00 · TITLE ━━━ */
// `goTo` is omitted when the slide renders outside the deck (design study).
export function TitleSlide({ goTo }: { goTo?: (index: number) => void }) {
  return (
    <Slide index={0} tone="dark" label="Title">
      <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <div className="animate-fade-up">
          <h1 className="font-serif text-[clamp(2.6rem,5.6vw,4.6rem)] font-semibold leading-[0.98] tracking-[-0.045em] text-[#f5f0e8]">
            Your personal
            <br />
            AI health team.
          </h1>
          <p className="mt-7 max-w-[50ch] text-[15px] leading-[1.65] text-[#e9e2d4]/65">
            Murph learns from your wearables, bloodwork, and history, then
            texts you first to help you follow through.
          </p>
          <button
            type="button"
            onClick={() => goTo?.(1)}
            className="mt-10 inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-[#e9e2d4]/55 transition-colors hover:text-[#e9e2d4]"
          >
            <span>Scroll or use arrow keys</span>
            <ChevronDown />
          </button>
        </div>
        <ChatMock
          sentBubble="blue"
          subtitle="Texts you first"
          messages={[
            {
              kind: "murph",
              text: "Your deep sleep dropped three nights in a row, each time you trained after 8pm. Finish by 7 this week?",
            },
            { kind: "you", text: "ok let's try it" },
            {
              kind: "murph",
              text: "Done. Your vitamin D was low on your last bloodwork too, so I reordered the D3 you liked.",
            },
          ]}
          title="Murph"
        />
      </div>
    </Slide>
  );
}

/* ━━━ 01 · PROBLEM ━━━ */
const PROBLEM_COLUMNS = [
  {
    label: "What most people get",
    items: [
      "A yearly physical",
      "A dashboard they stop checking",
      "Bloodwork with no follow-up",
      "Generic advice",
    ],
    muted: true,
  },
  {
    label: "What a health team does",
    items: [
      "Watches your data every day",
      "Reads your bloodwork",
      "Finds the few changes that matter",
      "Books the appointments",
      "Keeps you accountable",
    ],
    muted: false,
  },
] as const;

export function ProblemSlide() {
  return (
    <Slide index={1} tone="cream" label="The problem">
      <Eyebrow>The Problem</Eyebrow>
      <SlideHeading wide>Healthcare is reactive.</SlideHeading>
      <p className="mt-5 max-w-[40ch] font-serif text-[clamp(1.3rem,2.3vw,1.75rem)] leading-[1.3] text-[#635a48]">
        Most people only get help once something breaks.
      </p>
      <div className="mt-12 grid gap-10 sm:grid-cols-2">
        {PROBLEM_COLUMNS.map((column) => (
          <div key={column.label} className="border-t border-[#c4a882]/40 pt-5">
            <p
              className={`font-mono text-[10px] uppercase tracking-[0.12em] ${
                column.muted ? "text-[#736a58]" : "text-[#5a6e32]"
              }`}
            >
              {column.label}
            </p>
            <ul className="mt-4 flex flex-col gap-2.5">
              {column.items.map((item) => (
                <li
                  key={item}
                  className={`text-[17px] leading-[1.4] ${
                    column.muted ? "text-[#8a7f6a]" : "text-[#2d3436]"
                  }`}
                >
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <p className="mt-12 font-serif text-[clamp(1.3rem,2.4vw,1.8rem)] italic leading-[1.3] text-[#2d3436]">
        Everyone deserves a health team. Almost no one has one.
      </p>
    </Slide>
  );
}

/* ━━━ 02 · INSIGHT ━━━ */
export function InsightSlide() {
  return (
    <Slide index={2} tone="dark" label="The insight">
      <Eyebrow dark>The Insight</Eyebrow>
      <SlideHeading dark>
        Data doesn&apos;t make people healthier. Follow-through does.
      </SlideHeading>
      <p className="mt-5 max-w-[56ch] text-base leading-[1.7] text-[#e9e2d4]/70">
        Most of what matters is simple: sleep, diet, and exercise. Health
        apps measure it. Murph gets you to do it.
      </p>

      {/* The contrast: numbers nobody acts on vs. friends who keep score */}
      <div className="mt-12 grid gap-12 sm:grid-cols-2">
        <div className="border-t border-[#f5f0e8]/15 pt-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#e9e2d4]/45">
            A dashboard
          </p>
          <div className="mt-5 flex gap-10">
            {[
              { label: "Sleep", value: "82" },
              { label: "HRV", value: "48" },
              { label: "Recovery", value: "66%" },
            ].map((metric) => (
              <div key={metric.label}>
                <p className="font-serif text-[2.4rem] font-semibold leading-none text-[#e9e2d4]/35">
                  {metric.value}
                </p>
                <p className="mt-2 font-mono text-[9px] uppercase tracking-[0.12em] text-[#e9e2d4]/35">
                  {metric.label}
                </p>
              </div>
            ))}
          </div>
          <p className="mt-6 text-[14px] text-[#e9e2d4]/45">
            Numbers, and no reason to act on them.
          </p>
        </div>

        <div className="border-t border-[#9fb389]/50 pt-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#9fb389]">
            A sleep challenge with friends
          </p>
          <div className="mt-4 flex flex-col">
            {[
              { name: "Priya", delta: "+12%", down: false },
              { name: "You", delta: "+8%", down: false },
              { name: "Sam", delta: "−2%", down: true },
            ].map((row) => (
              <div
                key={row.name}
                className="flex items-baseline justify-between border-b border-[#f5f0e8]/10 py-2.5"
              >
                <span className="text-[16px] text-[#f5f0e8]">{row.name}</span>
                <span
                  className={`font-serif text-[1.4rem] font-semibold tabular-nums ${
                    row.down ? "text-[#e9e2d4]/40" : "text-[#9fb389]"
                  }`}
                >
                  {row.delta}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-4 text-[14px] text-[#e9e2d4]/70">
            Last place buys dinner.
          </p>
        </div>
      </div>
    </Slide>
  );
}

/* ━━━ 03 · WHY NOW / MARKET ━━━ */
const WHY_NOW_STATS = [
  { value: "611M", label: "Wearables shipped globally in 2025", source: "IDC" },
  { value: "1 in 3", label: "U.S. adults used AI for health information", source: "KFF" },
  {
    value: "500K+",
    label: "Function Health members paying $365/yr for bloodwork",
    source: "Function Health",
  },
] as const;

export function WhyNowSlide() {
  return (
    <Slide index={3} tone="cream" label="Why now and market">
      <Eyebrow>Why Now</Eyebrow>
      <SlideHeading>
        Wearables measure.
        <br />
        Bloodwork is cheap.
        <br />
        AI understands.
        <br />
        Murph makes it stick.
      </SlideHeading>
      <div className="mt-14 grid gap-10 sm:grid-cols-3">
        {WHY_NOW_STATS.map((stat) => (
          <div key={stat.value} className="border-t border-[#c4a882]/40 pt-5">
            <p className="font-serif text-[clamp(2.8rem,5.4vw,4.4rem)] font-semibold leading-none tracking-[-0.04em] text-[#2d3436]">
              {stat.value}
            </p>
            <p className="mt-3 max-w-[26ch] text-[15px] leading-[1.5] text-[#635a48]">
              {stat.label}
            </p>
            <p className="mt-2 font-mono text-[9px] uppercase tracking-[0.12em] text-[#736a58]/70">
              Source: {stat.source}
            </p>
          </div>
        ))}
      </div>
    </Slide>
  );
}

/* ━━━ 04 · PRODUCT ━━━ */
const PRODUCT_POINTS = [
  {
    title: "Texts you first",
    detail: "Spots what matters in your wearables and bloodwork.",
  },
  {
    title: "Handles the busywork",
    detail: "Books appointments and reorders supplements.",
  },
  {
    title: "Brings in your friends",
    detail: "Runs challenges in your group chats.",
  },
] as const;

export function ProductSlide() {
  return (
    <Slide index={4} tone="sand" label="The product">
      <div className="grid items-center gap-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
        <div>
          <Eyebrow>The Product</Eyebrow>
          <SlideHeading>Your health team, inside iMessage.</SlideHeading>
          <div className="mt-10 flex flex-col">
            {PRODUCT_POINTS.map((point) => (
              <div
                key={point.title}
                className="border-t border-[#c4a882]/40 py-4"
              >
                <p className="font-serif text-[1.45rem] font-semibold leading-tight text-[#2d3436]">
                  {point.title}
                </p>
                <p className="mt-1 text-[15px] leading-[1.5] text-[#635a48]">
                  {point.detail}
                </p>
              </div>
            ))}
          </div>
        </div>
        <ChatMock
          sentBubble="blue"
          subtitle="Texts you first"
          messages={[
            {
              kind: "murph",
              text: "Your deep sleep dropped three nights in a row, each time you trained after 8pm. Try finishing by 7 this week?",
            },
            { kind: "you", text: "ok. also can you book my physical" },
            {
              kind: "murph",
              text: "Booked for Tuesday at 9am. I'll send your last bloodwork ahead of time.",
            },
          ]}
          title="Murph"
        />
      </div>
    </Slide>
  );
}

/* ━━━ 05 · EXAMPLE EXPERIMENT ━━━ */

// Will's real Finnish-sauna run, measured against his locked baseline.
const WILL_RESULTS = [
  { label: "Resting heart rate", value: "−2 bpm", from: "47.8 → 45.8" },
  { label: "HRV", value: "+8.7 ms", from: "60.7 → 69.4" },
  { label: "Deep sleep", value: "+1.8 min", from: "105.2 → 106.9" },
] as const;

// What the same protocol looks like once many members' runs pool.
const POOLED_RESULTS = [
  { label: "Resting heart rate", value: "−2.1 bpm" },
  { label: "HRV", value: "+6.4 ms" },
  { label: "Deep sleep", value: "+11 min" },
] as const;

export function ExperimentSlide() {
  return (
    <Slide index={5} tone="dark" label="Example experiment">
      <Eyebrow dark>Example Experiment</Eyebrow>
      <SlideHeading dark wide>
        One person&rsquo;s result.
        <br />
        Then everyone&rsquo;s.
      </SlideHeading>

      {/* Will's actual run */}
      <p className="mt-10 font-mono text-[10px] uppercase tracking-[0.12em] text-[#9fb389]">
        Will&rsquo;s actual results &middot; Finnish sauna, 3&times; a week for 21 days
      </p>
      <div className="mt-4 grid gap-8 sm:grid-cols-3">
        {WILL_RESULTS.map((result) => (
          <div key={result.label} className="border-t border-[#9fb389]/40 pt-4">
            <p className="font-serif text-[clamp(2rem,3.6vw,2.8rem)] font-semibold leading-none tracking-[-0.03em] text-[#f5f0e8]">
              {result.value}
            </p>
            <p className="mt-2 text-[14px] text-[#e9e2d4]/70">
              {result.label}
            </p>
            <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.1em] text-[#e9e2d4]/40">
              {result.from}
            </p>
          </div>
        ))}
      </div>

      {/* The same protocol, pooled across members */}
      <p className="mt-12 font-mono text-[10px] uppercase tracking-[0.12em] text-[#e9e2d4]/55">
        Pooled across 1,000+ members&rsquo; runs &middot; illustrative
      </p>
      <div className="mt-4 grid gap-8 sm:grid-cols-3">
        {POOLED_RESULTS.map((result) => (
          <div key={result.label} className="border-t border-[#f5f0e8]/15 pt-4">
            <p className="font-serif text-[1.6rem] font-semibold leading-none text-[#e9e2d4]/80">
              {result.value}
            </p>
            <p className="mt-2 text-[14px] text-[#e9e2d4]/50">
              {result.label}, median
            </p>
          </div>
        ))}
      </div>
    </Slide>
  );
}

/* ━━━ 06 · HOW IT SPREADS ━━━ */

// The two growth loops shown on the spread slide. The final `repeat`
// step loops back to the first.
const SPREAD_LOOPS = [
  {
    label: "Private groups",
    steps: [
      "One person adds Murph",
      "The whole chat joins",
      "Someone starts the next challenge",
    ],
  },
  {
    label: "Public cohorts",
    steps: [
      "A protocol page attracts people",
      "They join the next cohort",
      "Their results make the page better",
    ],
  },
] as const;

export function SpreadSlide() {
  return (
    <Slide index={6} tone="cream" label="How it spreads">
      <Eyebrow>How It Spreads</Eyebrow>
      <SlideHeading>Two loops. Both compound.</SlideHeading>
      <div className="mt-12 grid gap-12 sm:grid-cols-2">
        {SPREAD_LOOPS.map((loop) => (
          <div key={loop.label} className="border-t border-[#c4a882]/40 pt-5">
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#5a6e32]">
              {loop.label}
            </p>
            <ol className="mt-5 flex flex-col gap-4">
              {loop.steps.map((step, index) => (
                <li key={step} className="flex items-baseline gap-4">
                  <span className="font-serif text-[1.1rem] font-semibold tabular-nums text-[#c4a882]">
                    {index + 1}
                  </span>
                  <span className="font-serif text-[1.45rem] leading-[1.25] text-[#2d3436]">
                    {step}
                  </span>
                </li>
              ))}
            </ol>
            <p className="mt-5 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[#5a6e32]">
              <span aria-hidden="true" className="text-[14px]">
                &#8635;
              </span>
              Repeat
            </p>
          </div>
        ))}
      </div>
    </Slide>
  );
}

/* ━━━ 07 · EARLY VALIDATION ━━━ */

// Monthly revenue, April to August 2026, in whole dollars.
const MONTHLY_REVENUE = [
  { month: "Apr", value: 1 },
  { month: "May", value: 87 },
  { month: "Jun", value: 98 },
  { month: "Jul", value: 260 },
  { month: "Aug", value: 431 },
] as const;

const PROGRESS_STATS = [
  { value: "23", label: "paying customers" },
  { value: "65", label: "monthly active users" },
  { value: "11", label: "active group chats, up from one in June" },
] as const;

export function ValidationSlide() {
  const peak = Math.max(...MONTHLY_REVENUE.map((row) => row.value));
  return (
    <Slide index={7} tone="sand" label="Progress">
      <Eyebrow>Progress</Eyebrow>
      <SlideHeading>Live since July. Revenue up every month.</SlideHeading>
      <p className="mt-5 max-w-[64ch] text-base leading-[1.7] text-[#635a48]">
        All organic. No paid acquisition.
      </p>
      <div className="mt-12 grid items-end gap-12 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        {/* Monthly revenue — one bar per month, the latest in full sage */}
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#736a58]">
            Monthly revenue, 2026
          </p>
          <div className="mt-6 flex h-[240px] items-end gap-4">
            {MONTHLY_REVENUE.map((row, index) => {
              const latest = index === MONTHLY_REVENUE.length - 1;
              return (
                <div
                  key={row.month}
                  className="flex h-full flex-1 flex-col justify-end"
                >
                  <p
                    className={`font-serif font-semibold tabular-nums leading-none tracking-[-0.02em] ${
                      latest
                        ? "text-[2rem] text-[#2d3436]"
                        : "text-[1.05rem] text-[#736a58]"
                    }`}
                  >
                    ${row.value}
                  </p>
                  <div
                    className={`mt-2 rounded-t-md ${
                      latest ? "bg-[#5a6e32]" : "bg-[#7a8c6e]/45"
                    }`}
                    style={{ height: `${Math.max((row.value / peak) * 170, 3)}px` }}
                  />
                  <p className="mt-2.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[#736a58]">
                    {row.month}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        {/* Supporting numbers, stacked */}
        <div className="flex flex-col">
          {PROGRESS_STATS.map((stat) => (
            <div
              key={stat.label}
              className="flex items-baseline gap-4 border-t border-[#c4a882]/40 py-4"
            >
              <span className="w-[2.4ch] font-serif text-[2.6rem] font-semibold leading-none tabular-nums tracking-[-0.03em] text-[#2d3436]">
                {stat.value}
              </span>
              <span className="text-[15px] leading-[1.4] text-[#635a48]">
                {stat.label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </Slide>
  );
}

/* ━━━ 08 · COMPETITION ━━━ */
export function CompetitionSlide() {
  return (
    <Slide index={8} tone="cream" label="Competition">
      <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,0.9fr)]">
        <div>
          <Eyebrow>Competition</Eyebrow>
          <SlideHeading>
            Devices track.
            <br />
            Labs test.
            <br />
            ChatGPT answers.
            <br />
            Murph gets you to act.
          </SlideHeading>
          <p className="mt-5 max-w-[40ch] text-base leading-[1.7] text-[#635a48]">
            Each owns one piece and waits for you to open an app. Murph
            connects them all and texts you first.
          </p>
        </div>
        <PositioningChart />
      </div>
    </Slide>
  );
}

/* ━━━ 09 · MOAT ━━━ */

// Challenge → outcome record → protocol page, left to right.
const MOAT_STAGES = [
  {
    label: "A challenge",
    value: "6 friends",
    detail: "30-day sleep challenge, five different wearables",
  },
  {
    label: "An outcome",
    value: "4 of 6",
    detail: "improved their sleep score, with adherence and confounders logged",
  },
  {
    label: "A protocol",
    value: "1,284 runs",
    detail: "on one sleep protocol, smarter with every run",
  },
] as const;

export function MoatSlide() {
  return (
    <Slide index={9} tone="dark" label="The moat">
      <Eyebrow dark>The Moat</Eyebrow>
      <SlideHeading dark>
        Every challenge teaches Murph what works.
      </SlideHeading>
      <div className="mt-14 grid gap-10 sm:grid-cols-3">
        {MOAT_STAGES.map((stage, index) => (
          <div
            key={stage.label}
            className={`border-t pt-5 ${
              index === MOAT_STAGES.length - 1
                ? "border-[#9fb389]/60"
                : "border-[#f5f0e8]/15"
            }`}
          >
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#9fb389]">
              {stage.label}
            </p>
            <p className="mt-4 font-serif text-[clamp(2rem,3.6vw,2.8rem)] font-semibold leading-none tracking-[-0.03em] text-[#f5f0e8]">
              {stage.value}
            </p>
            <p className="mt-3 max-w-[26ch] text-[14px] leading-[1.5] text-[#e9e2d4]/60">
              {stage.detail}
            </p>
          </div>
        ))}
      </div>
      <p className="mt-12 font-serif text-[clamp(1.2rem,2.2vw,1.6rem)] italic leading-[1.3] text-[#e9e2d4]/80">
        More members, better answers, more members.
      </p>
    </Slide>
  );
}

/* ━━━ 10 · BUSINESS MODEL ━━━ */

const PLANS = [
  { tier: "Group", price: "$4", detail: "Your wearable, scored in any challenge" },
  { tier: "Plus", price: "$8", detail: "Your full health team" },
  { tier: "Edge", price: "$20", detail: "Heavier use, better models" },
] as const;

export function BusinessModelSlide() {
  return (
    <Slide index={10} tone="cream" label="Business model">
      <Eyebrow>Business Model</Eyebrow>
      <SlideHeading wide>
        Members subscribe.
        <br />
        Blood testing grows the basket.
      </SlideHeading>
      <div className="mt-12 grid gap-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)]">
        {/* Member plans */}
        <div>
          {PLANS.map((plan) => (
            <div
              key={plan.tier}
              className="flex items-baseline gap-5 border-t border-[#c4a882]/40 py-4"
            >
              <span className="w-[4.5ch] font-serif text-[2rem] font-semibold leading-none tabular-nums text-[#5a6e32]">
                {plan.price}
              </span>
              <span className="flex-1">
                <span className="font-serif text-[1.2rem] font-semibold text-[#2d3436]">
                  {plan.tier}
                </span>
                <span className="ml-3 text-[14px] text-[#736a58]">
                  {plan.detail}
                </span>
              </span>
            </div>
          ))}
          <p className="border-t border-[#c4a882]/40 pt-4 text-[14px] leading-[1.5] text-[#736a58]">
            Per month. Plus group sponsorships and brand-funded cohorts.
          </p>
        </div>

        {/* Bottoms-up US market */}
        <div className="border-t border-[#5a6e32]/50 pt-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#5a6e32]">
            Bottoms-up US market
          </p>
          <p className="mt-3 font-serif text-[clamp(3.2rem,6vw,4.8rem)] font-semibold leading-none tracking-[-0.04em] text-[#2d3436]">
            $3.7B
          </p>
          <p className="mt-5 text-[15px] leading-[1.6] text-[#635a48]">
            107M US wearable users &times; $24 a year = $2.6B
            <br />
            + 3% buying $350 a year of blood testing = $1.1B
          </p>
        </div>
      </div>
    </Slide>
  );
}

/* ━━━ 11 · TEAM / ROADMAP ━━━ */
const TEAM_STATS = [
  { label: "products to product-market fit", value: "5" },
  { label: "monthly active users at MomentRanks", value: "250K+" },
  { label: "allocated to builders", value: "$200K+" },
  { label: "grassroots fundraising", value: "$100K+" },
] as const;

// Per-founder achievements, revealed when a founder card is selected.
const FOUNDERS = [
  {
    name: "Will",
    role: "Co-founder & CEO",
    image: "/team/will.png",
    github: "https://github.com/rocketman-21",
    achievements: [
      "Co-founded MomentRanks, 250k+ MAUs, raised ~$6M",
      "Freelance web-dev business at 15/yo w/10+ BTC in revenue",
      "Built a crypto gambling site at 14 — 1k+ users, millions of bets",
      "Won a 2 BTC challenge from CEO at Blockchain.com for a 3-platform integration in 8 days as an intern",
      "Worked at BitPay through high school — offered a full-time role after graduating",
      "Computer Science, Georgia Tech · National Merit Semifinalist",
    ],
  },
  {
    name: "Wojciech",
    role: "Co-founder & Product",
    image: "/team/wojciech.webp",
    github: "https://github.com/wkocjan",
    linkedin: "https://www.linkedin.com/in/kocjan/",
    achievements: [
      "Founded iGol.pl at 15, still ~100K monthly visits 25 years later",
      "Built frontend for three products at Morpho, the #2 DeFi lending protocol",
      "Built the MVP that secured a London fintech its FCA license",
      "Co-founded a creative studio in Poland, leading 5-7 developers across 10+ projects",
      "Built products at ustwo, the Apple Design Award-winning studio",
      "MSc in Computer Science · 20+ years building software",
    ],
  },
] as const;

export function TeamSlide() {
  const [activeFounder, setActiveFounder] = useState<string | null>(null);
  const active = FOUNDERS.find((founder) => founder.name === activeFounder);
  return (
    <Slide index={11} tone="dark" label="Team and roadmap">
      <Eyebrow dark>Team &amp; Roadmap</Eyebrow>
      <SlideHeading dark>
        Built by founders who ship social coordination products.
      </SlideHeading>
      <p className="mt-5 max-w-[60ch] text-base leading-[1.7] text-[#e9e2d4]/70">
        Working together since 2021 on products that get people to show
        up.
      </p>
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {FOUNDERS.map((founder) => (
          <FounderCard
            key={founder.name}
            name={founder.name}
            role={founder.role}
            image={founder.image}
            active={activeFounder === founder.name}
            onSelect={() =>
              setActiveFounder((current) =>
                current === founder.name ? null : founder.name,
              )
            }
          />
        ))}
      </div>
      {active ? (
        <FounderAchievements
          founder={active}
          onClose={() => setActiveFounder(null)}
        />
      ) : (
        <div className="mt-10 grid grid-cols-2 gap-8 sm:grid-cols-4">
          {TEAM_STATS.map((stat) => (
            <div key={stat.label} className="border-t border-[#f5f0e8]/15 pt-4">
              <p className="font-serif text-[2.2rem] font-semibold leading-none tracking-[-0.03em] text-[#f5f0e8]">
                {stat.value}
              </p>
              <p className="mt-2 text-[13px] leading-[1.4] text-[#e9e2d4]/60">
                {stat.label}
              </p>
            </div>
          ))}
        </div>
      )}
    </Slide>
  );
}

/* ━━━ 12 · THE ASK ━━━ */
const ASK_STAGES = [
  { label: "Today", text: "A personal health team in iMessage, plus group challenges." },
  { label: "Next", text: "Blood testing, provider booking, and public cohorts." },
  { label: "At scale", text: "Shared evidence on what works, for whom, and why." },
  { label: "End state", text: "Everyone has a health team that knows what works." },
] as const;

export function AskSlide() {
  return (
    <Slide index={12} tone="dark" label="The ask">
      <div className="mx-auto max-w-[760px] text-center">
        <Eyebrow dark>The Ask</Eyebrow>
        <h2 className="mx-auto mt-6 max-w-[20ch] font-serif text-[clamp(2.2rem,4.6vw,3.6rem)] font-semibold leading-[1.08] tracking-[-0.035em] text-[#f5f0e8]">
          We&rsquo;re raising a pre-seed to give everyone a health team.
        </h2>
      </div>
      {/* The trajectory: today's product, the network it builds, the vision */}
      <div className="mt-14 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
        {ASK_STAGES.map((stage, index) => {
          const last = index === ASK_STAGES.length - 1;
          return (
            <div
              key={stage.label}
              className={`border-t pt-4 ${
                last ? "border-[#9fb389]/60" : "border-[#f5f0e8]/15"
              }`}
            >
              <p
                className={`font-mono text-[10px] uppercase tracking-[0.14em] ${
                  last ? "text-[#9fb389]" : "text-[#e9e2d4]/50"
                }`}
              >
                {stage.label}
              </p>
              <p
                className={
                  last
                    ? "mt-3 font-serif text-[1.35rem] font-semibold leading-[1.2] text-[#f5f0e8]"
                    : "mt-3 text-[15px] leading-[1.55] text-[#e9e2d4]/75"
                }
              >
                {stage.text}
              </p>
            </div>
          );
        })}
      </div>
      <p className="mt-8 text-center text-[13px] leading-[1.6] text-[#e9e2d4]/55">
        Funding to date:{" "}
        <span className="font-medium text-[#f5f0e8]">
          $50K SAFE from Balaji Srinivasan
        </span>
      </p>
      <div className="mt-7 flex flex-wrap items-center justify-center gap-4">
        <Link
          href="/"
          className="rounded-2xl bg-[#5a6e32] px-6 py-3.5 text-sm font-medium text-white transition-colors hover:bg-[#7a8c6e]"
        >
          See it live
        </Link>
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[#e9e2d4]/45">
          withmurph.ai
        </span>
      </div>
    </Slide>
  );
}

// Slide 10: a clickable founder card. Selecting it swaps the team
// stats below for that founder's achievements.
function FounderCard({
  name,
  role,
  image,
  active,
  onSelect,
}: {
  name: string;
  role: string;
  image: string;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={`flex items-center gap-4 rounded-xl border p-4 text-left transition-colors ${
        active
          ? "border-[#9fb389]/55 bg-[#7a8c6e]/[0.16]"
          : "border-[#f5f0e8]/12 bg-[#f5f0e8]/[0.04] hover:border-[#f5f0e8]/25 hover:bg-[#f5f0e8]/[0.07]"
      }`}
    >
      <div className="size-24 shrink-0 overflow-hidden rounded-full border border-[#f5f0e8]/10">
        <img src={image} alt={name} className="h-full w-full object-cover" />
      </div>
      <div>
        <p className="font-serif text-[1.15rem] font-semibold leading-tight text-[#f5f0e8]">
          {name}
        </p>
        <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-[#9fb389]">
          {role}
        </p>
        <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[#e9e2d4]/40">
          {active ? "Hide achievements" : "View achievements →"}
        </p>
      </div>
    </button>
  );
}

// Strips protocol and www from a profile URL for a compact link label.
function profileHandle(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
}

// Slide 10: the panel that replaces the team stats while a founder is
// selected, listing that founder's achievements and profile links.
function FounderAchievements({
  founder,
  onClose,
}: {
  founder: {
    name: string;
    github: string;
    linkedin?: string;
    achievements: readonly string[];
  };
  onClose: () => void;
}) {
  const links = [
    founder.github,
    ...(founder.linkedin ? [founder.linkedin] : []),
  ];
  return (
    <div className="mt-7 rounded-xl border border-[#7a8c6e]/40 bg-[#7a8c6e]/[0.1] p-6">
      <div className="flex items-center justify-between gap-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#9fb389]">
          {founder.name} &middot; Achievements
        </p>
        <button
          type="button"
          onClick={onClose}
          className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#e9e2d4]/45 transition-colors hover:text-[#e9e2d4]/80"
        >
          Back to team stats
        </button>
      </div>
      <ul className="mt-4 grid gap-2.5 sm:grid-cols-2">
        {founder.achievements.map((achievement) => (
          <li
            key={achievement}
            className="flex gap-3 text-[15px] leading-[1.5] text-[#e9e2d4]/85"
          >
            <span className="mt-0.5 text-[#9fb389]">&rarr;</span>
            <span>{achievement}</span>
          </li>
        ))}
      </ul>
      <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2">
        {links.map((href) => (
          <a
            key={href}
            href={href}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 font-mono text-[11px] text-[#9fb389] transition-colors hover:text-[#f5f0e8]"
          >
            {profileHandle(href)}
            <span aria-hidden="true">↗</span>
          </a>
        ))}
      </div>
    </div>
  );
}
