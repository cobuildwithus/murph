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
import {
  ChatMock,
  FlowConnector,
  MurphLoop,
  PivotCard,
  PositioningChart,
  StatCard,
} from "./mocks";

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Pitch deck slides — one component per slide, composed in order by
   PitchDeck. Tone and index stay co-located with each slide; the
   TONES array in primitives mirrors them for the deck chrome.
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

/* ━━━ 00 · TITLE ━━━ */
export function TitleSlide({ goTo }: { goTo: (index: number) => void }) {
  return (
    <Slide index={0} tone="dark" label="Title">
      <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <div className="animate-fade-up">
          <Eyebrow dark>Murph · Pitch Deck</Eyebrow>
          <h1 className="mt-6 max-w-[15ch] font-serif text-[clamp(2.3rem,5.4vw,4.2rem)] font-semibold leading-[1.03] tracking-[-0.04em] text-[#f5f0e8]">
            The personal health assistant that remembers.
          </h1>
          <p className="mt-7 max-w-[50ch] text-[15px] leading-[1.65] text-[#e9e2d4]/65">
            Start with one real health need. Murph helps now, remembers only
            the context that matters, and gets more personal over time.
          </p>
          <button
            type="button"
            onClick={() => goTo(1)}
            className="mt-10 inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-[#e9e2d4]/55 transition-colors hover:text-[#e9e2d4]"
          >
            <span>Scroll or use arrow keys</span>
            <ChevronDown />
          </button>
        </div>
        <ChatMock
          sentBubble="blue"
          members={2}
          messages={[
            {
              kind: "you",
              text: "I want to get stronger, but I never stick to a plan",
            },
            {
              kind: "murph",
              text: "Let’s make it fit your life. How many days can you realistically train?",
            },
            {
              kind: "you",
              text: "three, usually after work",
            },
            {
              kind: "murph",
              text: "Got it. I’ll remember that and build around it. Want a simple first week?",
            },
          ]}
          title="Murph"
        />
      </div>
    </Slide>
  );
}

/* ━━━ 01 · PROBLEM ━━━ */
export function ProblemSlide() {
  return (
    <Slide index={1} tone="cream" label="The problem">
      <Eyebrow>The Problem</Eyebrow>
      <SlideHeading wide>
        Health is fragmented.
        <br />
        Follow-through is personal.
      </SlideHeading>
      <p className="mt-5 max-w-[60ch] text-base leading-[1.7] text-[#635a48]">
        Questions, records, wearable signals, goals, routines, appointments,
        and advice live in different places. The member has to reconstruct
        the story and carry the plan alone.
      </p>

      {/* One intention is easy to state; useful follow-through spans seven jobs */}
      <div className="mt-10 grid items-stretch gap-4 lg:grid-cols-2">
        {/* One message — easy to suggest */}
        <div className="flex flex-col rounded-2xl border border-[#c4a882]/25 bg-[#fffcf6]/90 p-6">
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#736a58]">
            One intention
          </p>
          <div className="mt-4">
            <span className="inline-block max-w-[300px] rounded-2xl rounded-bl-md bg-[#ece3d2] px-4 py-2.5 text-[14px] leading-[1.45] text-[#2d3436]">
              I want to get my sleep back on track
            </span>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {["less scrolling", "earlier bed", "more energy"].map((reaction) => (
                <span
                  key={reaction}
                  className="rounded-full bg-[#5a6e32]/10 px-3 py-1 text-[12px] text-[#5a6e32]"
                >
                  {reaction}
                </span>
              ))}
            </div>
          </div>
          <p className="mt-auto pt-8 font-mono text-[11px] uppercase tracking-[0.12em] text-[#736a58]">
            Easy to say
          </p>
        </div>

        {/* Seven jobs needed to turn intent into help */}
        <div className="flex flex-col rounded-2xl border border-[#c4a882]/30 bg-[#ebe4d4] p-6">
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#736a58]">
            Seven jobs
          </p>
          <ul className="mt-4 flex flex-col gap-2">
            {[
              "Understand the routine",
              "Read the available data",
              "Choose one useful action",
              "Fit it to real constraints",
              "Remember what matters",
              "Check in at the right time",
              "Review what changed",
            ].map((job, index) => (
              <li key={job} className="flex items-center gap-2.5">
                <span
                  aria-hidden="true"
                  className="font-mono text-[11px] tabular-nums text-[#b0a085]"
                >
                  {index + 1}
                </span>
                <span
                  aria-hidden="true"
                  className="size-4 shrink-0 rounded-[5px] border-[1.5px] border-[#c4a882]"
                />
                <span className="text-[14px] leading-[1.4] text-[#5f5746]">
                  {job}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-auto pt-6 font-mono text-[11px] uppercase tracking-[0.12em] text-[#8b5d3f]">
            Hard to run
          </p>
        </div>
      </div>

      <p className="mt-7 max-w-[44ch] font-serif text-[clamp(1.3rem,2.4vw,1.8rem)] italic leading-[1.3] text-[#2d3436]">
        The data exists. The context and follow-through do not.
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
        The next health app is not another dashboard. It&apos;s a relationship that remembers.
      </SlideHeading>
      <p className="mt-5 max-w-[56ch] text-base leading-[1.7] text-[#e9e2d4]/70">
        Health apps measure well. General models reason well. Both still miss
        the member&apos;s whole picture across time.
      </p>
      <p className="mt-3 max-w-[56ch] text-base leading-[1.7] text-[#e9e2d4]/70">
        Murph helps in the messaging apps people already use, remembers
        relevant context with member control, and uses it to make the next
        answer or action more personal.
      </p>

      {/* The contrast: inert dashboard vs motivating challenge */}
      <div className="mt-10 grid items-stretch gap-4 lg:grid-cols-2">
        {/* Left — the dashboard: dense, cold, easy to ignore */}
        <div className="rounded-2xl border border-[#f5f0e8]/10 bg-[#f5f0e8]/[0.03] p-6">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#e9e2d4]/45">
            The dashboard
          </p>
          <div className="mt-4 grid grid-cols-3 gap-1.5">
            {[
              { label: "Sleep", value: "82" },
              { label: "HRV", value: "48ms" },
              { label: "Recovery", value: "66%" },
              { label: "Rest HR", value: "59" },
              { label: "Steps", value: "8.2k" },
              { label: "Readiness", value: "74" },
            ].map((metric) => (
              <div
                key={metric.label}
                className="rounded-md bg-[#f5f0e8]/[0.03] px-2.5 py-2"
              >
                <p className="font-mono text-[8px] uppercase tracking-[0.1em] text-[#e9e2d4]/40">
                  {metric.label}
                </p>
                <p className="mt-0.5 font-serif text-[15px] font-semibold text-[#e9e2d4]/75">
                  {metric.value}
                </p>
                <svg
                  viewBox="0 0 60 14"
                  fill="none"
                  className="mt-1 w-full"
                  aria-hidden="true"
                >
                  <path
                    d="M2 10 L12 8 L22 11 L32 7 L42 9 L52 6 L58 8"
                    stroke="#e9e2d4"
                    strokeOpacity="0.22"
                    strokeWidth="1"
                    strokeLinecap="round"
                  />
                </svg>
              </div>
            ))}
          </div>
          <p className="mt-4 text-[13px] leading-[1.5] text-[#e9e2d4]/45">
            More numbers, and no reason to act on them.
          </p>
        </div>

        {/* Right: remembered context changes the next recommendation */}
        <div className="rounded-2xl border border-[#7a8c6e]/40 bg-[#7a8c6e]/[0.1] p-6">
          <div className="flex items-center justify-between gap-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#9fb389]">
              Your health thread
            </p>
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#e9e2d4]/55">
              Week 3
            </span>
          </div>

          {/* Group progress — everyone is moving, not just the winner */}
          <p className="mt-4 font-mono text-[9px] uppercase tracking-[0.12em] text-[#e9e2d4]/45">
            Useful context
          </p>
          <div className="mt-2 grid grid-cols-3 gap-1.5">
            {[
              { label: "connected sources", value: "3" },
              { label: "known constraints", value: "4" },
              { label: "current priority", value: "1" },
            ].map((stat) => (
              <div
                key={stat.label}
                className="rounded-md bg-[#f5f0e8]/[0.04] px-2.5 py-2"
              >
                <p className="font-serif text-[15px] font-semibold leading-none tabular-nums text-[#f5f0e8]">
                  {stat.value}
                </p>
                <p className="mt-1 font-mono text-[8px] uppercase tracking-[0.08em] text-[#e9e2d4]/45">
                  {stat.label}
                </p>
              </div>
            ))}
          </div>

          {/* A few pieces of context that change the help */}
          <p className="mt-4 font-mono text-[9px] uppercase tracking-[0.12em] text-[#e9e2d4]/45">
            What Murph remembers
          </p>
          <div className="mt-2 flex flex-col gap-1.5">
            {[
              { name: "Training window", delta: "After work", down: false, you: false },
              { name: "Past blocker", delta: "Travel", down: false, you: true },
              { name: "Check-in style", delta: "Quiet", down: false, you: false },
            ].map((row) => (
              <div
                key={row.name}
                className={`flex items-center gap-3 rounded-lg px-3 py-1.5 ${
                  row.you ? "bg-[#9fb389]/15" : "bg-[#f5f0e8]/[0.04]"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`size-1.5 rounded-full ${
                    row.down ? "bg-[#e9e2d4]/30" : "bg-[#9fb389]"
                  }`}
                />
                <span className="flex-1 text-[13px] font-medium text-[#f5f0e8]">
                  {row.name}
                </span>
                <span
                  className={`font-serif text-[14px] font-semibold tabular-nums ${
                    row.down ? "text-[#e9e2d4]/45" : "text-[#9fb389]"
                  }`}
                >
                  {row.delta}
                </span>
              </div>
            ))}
          </div>

          <p className="mt-4 flex items-center gap-2 text-[12px] text-[#e9e2d4]/75">
            <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-[#9fb389]">
              Next
            </span>
            Build a realistic first week
          </p>
        </div>
      </div>

      <p className="mt-8 font-serif text-[clamp(1.3rem,2.4vw,1.8rem)] italic leading-[1.3] text-[#f5f0e8]">
        Dashboards show data. Context changes the help.
      </p>
    </Slide>
  );
}

/* ━━━ 03 · WHY NOW / MARKET ━━━ */
export function WhyNowSlide() {
  return (
    <Slide index={3} tone="cream" label="Why now and market">
      <Eyebrow>Why Now</Eyebrow>
      <SlideHeading>
        Wearables measure.
        <br />
        Models reason.
        <br />
        Murph remembers.
        <br />
        The help gets personal.
      </SlideHeading>
      <p className="mt-5 max-w-[62ch] text-base leading-[1.7] text-[#635a48]">
        Millions of people have health data, and capable models can already
        interpret it. The missing layer is durable, member-controlled context
        plus the ability to help act and follow through.
      </p>
      <div className="mt-10 grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Wearables shipped globally in 2025"
          source="IDC"
          value="611M"
        />
        <StatCard
          label="U.S. adults used AI for health information"
          source="KFF"
          value="1 in 3"
        />
        <StatCard
          label="Strava users show health already has a social surface"
          source="Strava"
          value="180M+"
        />
      </div>
      <p className="mt-8 max-w-[64ch] text-[15px] leading-[1.6] text-[#736a58]">
        The wedge is one high-intent health thread.{" "}
        <span className="font-medium text-[#2d3436]">
          Remembered context can expand that thread into a broader relationship.
        </span>
      </p>
    </Slide>
  );
}

/* ━━━ 04 · PRODUCT ━━━ */

// The private first-thread wedge, shown end to end. Each step is a button on
// the slide; clicking one reveals a small mock of that step.
const PRODUCT_STEPS = [
  {
    title: "Text one real need",
    detail: "Start with a question, decision, task, data point, or goal.",
    panelLabel: "One high-intent health thread",
    panel: (
      <div className="flex max-w-[440px] flex-col gap-1.5">
        <span className="self-end rounded-2xl rounded-br-md bg-[#2d3436] px-3.5 py-2 text-[13px] leading-[1.4] text-[#f5f0e8]">
          I want to get stronger, but I never stick to a plan
        </span>
        <span className="self-start rounded-2xl rounded-bl-md bg-[#e4e8df] px-3.5 py-2 text-[13px] leading-[1.4] text-[#3d5028]">
          How many days can you realistically train each week?
        </span>
        <span className="self-end rounded-2xl rounded-br-md bg-[#2d3436] px-3.5 py-2 text-[13px] leading-[1.4] text-[#f5f0e8]">
          Three, usually after work
        </span>
      </div>
    ),
  },
  {
    title: "Use the lightest tool",
    detail: "Answer, interpret, plan, act, support, or run an experiment.",
    panelLabel: "The product adapts to the need",
    panel: (
      <div className="grid max-w-[560px] grid-cols-2 gap-2 sm:grid-cols-3">
        {[
          { label: "Answer", selected: false },
          { label: "Interpret", selected: false },
          { label: "Simple plan", selected: true },
          { label: "Take action", selected: false },
          { label: "Add support", selected: false },
          { label: "Experiment", selected: false },
        ].map((tool) => (
          <div
            key={tool.label}
            className={`rounded-lg border px-3 py-3 ${
              tool.selected
                ? "border-[#5a6e32]/40 bg-[#5a6e32]/10"
                : "border-[#c4a882]/25 bg-[#fffcf6]/70"
            }`}
          >
            <p className="text-[13px] font-medium text-[#2d3436]">
              {tool.label}
            </p>
            <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.1em] text-[#736a58]">
              {tool.selected ? "Useful now" : "Available"}
            </p>
          </div>
        ))}
      </div>
    ),
  },
  {
    title: "Keep useful context",
    detail: "Attribute it, let the member inspect and correct it.",
    panelLabel: "Context stays legible and member-controlled",
    panel: (
      <div className="max-w-[460px]">
        <div className="flex flex-col gap-1.5">
          {[
            { label: "Training window", value: "After work" },
            { label: "Realistic cadence", value: "3 days" },
            { label: "Past blocker", value: "Travel" },
          ].map((row) => (
            <div
              key={row.label}
              className="flex items-center gap-3 rounded-lg bg-[#fffcf6]/70 px-3 py-2.5"
            >
              <span className="flex-1 text-[13px] text-[#635a48]">
                {row.label}
              </span>
              <span className="text-[13px] font-medium text-[#2d3436]">
                {row.value}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-3 font-mono text-[9px] uppercase tracking-[0.1em] text-[#5a6e32]">
          Source: member messages &middot; inspect &middot; correct &middot; decline
        </p>
      </div>
    ),
  },
  {
    title: "Make later help smarter",
    detail: "Retrieve prior context only when it can improve the next step.",
    panelLabel: "Illustrative later thread",
    panel: (
      <div className="grid max-w-[760px] gap-5 lg:grid-cols-[minmax(0,0.72fr)_28px_minmax(0,1fr)] lg:items-center">
        <div className="rounded-lg border border-[#c4a882]/20 bg-[#fffcf6]/80 px-4 py-4">
          <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-[#736a58]">
            Remembered from the first thread
          </p>
          <p className="mt-2 font-serif text-[1.25rem] font-semibold leading-tight text-[#2d3436]">
            Three sessions, after work
          </p>
          <p className="mt-1 text-[12px] leading-[1.5] text-[#736a58]">
            Travel made consistency harder.
          </p>
        </div>

        <FlowConnector />

        <div className="rounded-lg border border-[#5a6e32]/30 bg-[#5a6e32]/[0.08] px-4 py-4">
          <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-[#5a6e32]">
            A later travel week
          </p>
          <p className="mt-2 text-[13px] leading-[1.55] text-[#2d3436]">
            You said travel broke the last plan. Keep the same three-session
            rhythm, but switch to two short hotel workouts and one weekend
            session?
          </p>
        </div>
      </div>
    ),
  },
];

export function ProductSlide() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <Slide index={4} tone="sand" label="The product">
      <Eyebrow>The Wedge</Eyebrow>
      <SlideHeading>
        One useful health thread is the wedge into a broader relationship.
      </SlideHeading>
      <p className="mt-5 max-w-[64ch] text-base leading-[1.7] text-[#635a48]">
        Direct signup starts privately and stays broad. The focused first
        thread is an onboarding method, not a product boundary: help now,
        retain only useful context, and make later help more personal.
      </p>
      {/* The loop: one private thread, from need to reusable context */}
      <div className="mt-12 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
        {PRODUCT_STEPS.map((step, index) => {
          const active = open === index;
          return (
            <button
              key={step.title}
              type="button"
              onClick={() => setOpen(active ? null : index)}
              aria-expanded={active}
              className="group text-left"
            >
              <div className="flex items-center justify-between">
                <span
                  className={`flex size-9 items-center justify-center rounded-full font-mono text-[12px] font-semibold transition-colors ${
                    active
                      ? "bg-[#5a6e32] text-[#f5f0e8]"
                      : "bg-[#5a6e32]/12 text-[#5a6e32]"
                  }`}
                >
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span
                  className={`text-[#5a6e32] transition-all ${
                    active
                      ? "rotate-180 opacity-100"
                      : "opacity-35 group-hover:opacity-80"
                  }`}
                >
                  <ChevronDown />
                </span>
              </div>
              <p
                className={`mt-4 font-serif text-[1.35rem] font-semibold leading-[1.2] transition-colors ${
                  active ? "text-[#5a6e32]" : "text-[#2d3436]"
                }`}
              >
                {step.title}
              </p>
              <p className="mt-1.5 text-[14px] leading-[1.55] text-[#635a48]">
                {step.detail}
              </p>
            </button>
          );
        })}
      </div>
      {open !== null ? (
        <div className="mt-10 border-t border-[#c4a882]/25 pt-8">
          <div key={open} className="animate-fade-up">
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#736a58]">
              {PRODUCT_STEPS[open].panelLabel}
            </p>
            <div className="mt-4">{PRODUCT_STEPS[open].panel}</div>
          </div>
        </div>
      ) : null}
    </Slide>
  );
}

/* ━━━ 05 · EXAMPLE EXPERIMENT ━━━ */

// Panel one — the protocol being run, as label/value spec rows.
const PROTOCOL_SPEC = [
  { label: "Cadence", value: "3× / week" },
  { label: "Length", value: "21 days" },
  { label: "Session", value: "15–20 min" },
  { label: "Baseline", value: "7 days" },
] as const;

// Panel three: a recent Finnish-sauna run measured against its locked
// baseline. Every delta is an improvement, so all read sage.
const SAUNA_RESULTS = [
  {
    label: "Resting heart rate",
    value: "45.8",
    unit: "bpm",
    delta: "↓ 2 bpm",
    from: "from 47.8",
  },
  {
    label: "HRV rMSSD",
    value: "69.4",
    unit: "ms",
    delta: "↑ 8.7 ms",
    from: "from 60.7",
  },
  {
    label: "Deep sleep",
    value: "106.9",
    unit: "min",
    delta: "↑ 1.8 min",
    from: "from 105.2",
  },
] as const;

export function ExperimentSlide() {
  return (
    <Slide index={5} tone="dark" label="Example experiment">
      <Eyebrow dark>When Uncertainty Is The Problem</Eyebrow>
      <SlideHeading dark wide>
        Murph can turn one protocol into
        <br />a bounded personal experiment.
      </SlideHeading>
      <p className="mt-5 max-w-[64ch] text-base leading-[1.7] text-[#e9e2d4]/70">
        Experiments are useful when uncertainty is the problem. Murph can
        lock a baseline, track the protocol, measure the change, and save the
        result without making an experiment the required starting point.
      </p>

      {/* The run, end to end: protocol → adherence → measured result */}
      <div className="mt-9 grid gap-3 lg:grid-cols-[minmax(0,0.92fr)_24px_minmax(0,0.92fr)_24px_minmax(0,1.16fr)] lg:items-stretch">
        {/* 1 — the protocol being run */}
        <div className="flex flex-col rounded-xl border border-[#f5f0e8]/12 bg-[#f5f0e8]/[0.04] p-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#e9e2d4]/55">
            The protocol
          </p>
          <p className="mt-4 font-serif text-[1.3rem] font-semibold leading-tight text-[#f5f0e8]">
            Finnish dry sauna
          </p>
          <div className="mt-3 flex flex-col">
            {PROTOCOL_SPEC.map((row, index, rows) => (
              <div
                key={row.label}
                className={`flex items-center justify-between py-2.5 ${
                  index < rows.length - 1
                    ? "border-b border-[#f5f0e8]/10"
                    : ""
                }`}
              >
                <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-[#e9e2d4]/45">
                  {row.label}
                </span>
                <span className="text-[13px] font-medium text-[#f5f0e8]">
                  {row.value}
                </span>
              </div>
            ))}
          </div>
        </div>

        <FlowConnector />

        {/* 2 — the run: baseline locked, every session tracked */}
        <div className="flex flex-col rounded-xl border border-[#f5f0e8]/12 bg-[#f5f0e8]/[0.04] p-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#e9e2d4]/55">
            During the run
          </p>

          {/* Phase progress — baseline locked, protocol active */}
          <div className="mt-4 flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.1em]">
            <span className="text-[#9fb389]">Baseline ✓</span>
            <span className="text-[#e9e2d4]/25">·</span>
            <span className="font-semibold text-[#f5f0e8]">Active, day 16</span>
            <span className="text-[#e9e2d4]/25">·</span>
            <span className="text-[#e9e2d4]/35">Analysis</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#f5f0e8]/10">
            <div className="h-full w-[76%] rounded-full bg-[#9fb389]" />
          </div>

          {/* Adherence — one segment per scheduled session */}
          <div className="mt-5 flex items-center justify-between">
            <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-[#e9e2d4]/45">
              Adherence
            </span>
            <span className="text-[12px] text-[#e9e2d4]/70">
              6 of 9 sessions
            </span>
          </div>
          <div className="mt-2 flex gap-1.5">
            {Array.from({ length: 9 }, (_, index) => (
              <span
                key={index}
                aria-hidden="true"
                className={`h-2 flex-1 rounded-full ${
                  index < 6 ? "bg-[#9fb389]" : "bg-[#f5f0e8]/12"
                }`}
              />
            ))}
          </div>
        </div>

        <FlowConnector />

        {/* 3: recent measured results, saved to the member's vault */}
        <div className="flex flex-col rounded-xl border border-[#7a8c6e]/45 bg-[#7a8c6e]/[0.1] p-5">
          <div className="flex items-baseline justify-between gap-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#9fb389]">
              Recent member results*
            </p>
            <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-[#e9e2d4]/45">
              vs baseline
            </span>
          </div>
          <div className="mt-4 flex flex-col gap-2">
            {SAUNA_RESULTS.map((result) => (
              <div
                key={result.label}
                className="rounded-lg bg-[#f5f0e8]/[0.05] px-3.5 py-3"
              >
                <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-[#e9e2d4]/50">
                  {result.label}
                </p>
                <div className="mt-1.5 flex items-center justify-between gap-3">
                  <span className="flex items-baseline gap-1.5">
                    <span className="font-serif text-[1.75rem] font-semibold leading-none text-[#f5f0e8]">
                      {result.value}
                    </span>
                    <span className="text-[11px] text-[#e9e2d4]/50">
                      {result.unit}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="inline-flex items-center rounded-full bg-[#9fb389]/15 px-2 py-0.5 font-mono text-[10px] font-medium text-[#9fb389]">
                      {result.delta}
                    </span>
                    <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-[#e9e2d4]/40">
                      {result.from}
                    </span>
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <p className="mt-4 text-[12px] leading-[1.5] text-[#e9e2d4]/45">
        * Actual results from a recent sauna experiment
      </p>

      <p className="mt-8 font-serif text-[clamp(1.3rem,2.4vw,1.8rem)] italic leading-[1.3] text-[#f5f0e8]">
        An experiment ends. The useful context remains.
      </p>
    </Slide>
  );
}

/* ━━━ 06 · HOW VALUE COMPOUNDS ━━━ */

// The two value loops shown on this slide. Each renders as a numbered
// card; the final `repeat` step loops back to the first.
const SPREAD_LOOPS = [
  {
    label: "Retention hypothesis",
    steps: [
      "One useful thread reveals relevant context",
      "Murph remembers it with member control",
      "Later help uses it when it matters",
    ],
    repeat: "If later help is better, members should keep returning",
  },
  {
    label: "Invitation hypothesis",
    steps: [
      "A member chooses friend or group support",
      "Murph runs one scoped challenge",
      "Results return to each private vault",
    ],
    repeat: "If support helps, members may invite people they trust",
  },
] as const;

export function SpreadSlide() {
  return (
    <Slide index={6} tone="cream" label="Growth path">
      <Eyebrow>Growth Path To Prove</Eyebrow>
      <SlideHeading>
        Retention starts with better help. Distribution may start with trust.
      </SlideHeading>
      <p className="mt-5 max-w-[64ch] text-base leading-[1.7] text-[#635a48]">
        The private context loop is the core growth thesis. Optional friend
        support and public protocols may create trusted invitations. Neither
        retention nor a repeatable acquisition loop has been proven yet.
      </p>

      {/* The private context loop and an optional social-support loop */}
      <div className="mt-10 grid gap-4 lg:grid-cols-2">
        {SPREAD_LOOPS.map((loop) => (
          <div
            key={loop.label}
            className="rounded-xl border border-[#c4a882]/25 bg-[#fffcf6]/90 p-6"
          >
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#5a6e32]">
              {loop.label}
            </p>
            <ol className="mt-4 flex flex-col gap-3">
              {loop.steps.map((step, index) => (
                <li key={step} className="flex items-start gap-3">
                  <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-[#5a6e32]/12 font-mono text-[11px] font-semibold text-[#5a6e32]">
                    {index + 1}
                  </span>
                  <span className="text-[15px] leading-[1.5] text-[#2d3436]">
                    {step}
                  </span>
                </li>
              ))}
            </ol>
            <p className="mt-4 flex items-start gap-3 rounded-lg bg-[#5a6e32]/[0.08] px-3.5 py-3">
              <span aria-hidden="true" className="text-[#5a6e32]">
                &#8635;
              </span>
              <span className="text-[14px] leading-[1.5] text-[#3d5028]">
                {loop.repeat}
              </span>
            </p>
          </div>
        ))}
      </div>

      {/* Health Commons remains a useful protocol surface, not a traction claim */}
      <div className="mt-4 flex flex-wrap items-center gap-x-8 gap-y-4 rounded-xl border border-[#5a6e32]/30 bg-[#5a6e32]/[0.06] p-5">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#5a6e32]">
            Protocol page &middot; Health Commons
          </p>
          <p className="mt-1.5 font-serif text-[1.3rem] font-semibold leading-tight text-[#2d3436]">
            30-day sleep challenge
          </p>
        </div>
        <div className="flex gap-8">
          {[
            { value: "Rev. 3", label: "protocol version" },
            { value: "30 days", label: "suggested run" },
          ].map((stat) => (
            <div key={stat.label}>
              <p className="font-serif text-[1.5rem] font-semibold leading-none tracking-[-0.02em] text-[#2d3436]">
                {stat.value}
              </p>
              <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.1em] text-[#736a58]">
                {stat.label}
              </p>
            </div>
          ))}
        </div>
        <span className="rounded-md bg-[#5a6e32]/12 px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.1em] text-[#5a6e32]">
          Aggregate outcomes require explicit contribution
        </span>
        <span className="ml-auto inline-flex items-center gap-1.5 rounded-xl bg-[#5a6e32] px-4 py-2.5 text-[13px] font-medium text-white">
          Review protocol
          <span aria-hidden="true">&rarr;</span>
        </span>
      </div>
    </Slide>
  );
}

/* ━━━ 07 · EARLY VALIDATION ━━━ */
export function ValidationSlide() {
  return (
    <Slide index={7} tone="sand" label="Progress">
      <Eyebrow>Progress</Eyebrow>
      <SlideHeading>
        The product is live.
        <br />
        The new positioning still needs proof.
      </SlideHeading>
      <p className="mt-5 max-w-[64ch] text-base leading-[1.7] text-[#635a48]">
        We first sold Murph around personal experiments, then shipped private
        assistance, data connections, plans, actions, outcomes, and group
        support. Founder-connected usage proves the product works end to end;
        it does not yet prove pull, retention, or the longitudinal-context
        strategy.
      </p>
      <div className="mt-9 grid gap-3 sm:grid-cols-3">
        {[
          {
            value: "8 paid, founder-connected",
            note: "Private beta since May 4, with zero organic signups. Payment is real; pull is not proven",
          },
          {
            value: "24 msgs / week / user*",
            note: "Earlier snapshot across 7 weekly active users, not a current growth or retention rate",
          },
          {
            value: "1 group challenge tested",
            note: "A shipped capability, not evidence that groups define the product",
          },
        ].map((card) => (
          <div
            key={card.value}
            className="rounded-xl border border-[#c4a882]/30 bg-[#fffcf6] p-5"
          >
            <p className="font-serif text-[1.45rem] font-semibold leading-tight tracking-[-0.02em] text-[#2d3436]">
              {card.value}
            </p>
            <p className="mt-2 text-[13px] leading-[1.5] text-[#736a58]">
              {card.note}
            </p>
          </div>
        ))}
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <PivotCard
          items={[
            "Running health experiments",
            "Tracking calories",
            "Managing pain",
            "Researching supplements",
          ]}
          label="What members already ask Murph"
          title="Broad private usage"
        />
        <PivotCard
          highlight
          items={[
            "One sleep challenge among three family members",
            "Multiple messages per member, every day",
            "Laughs, reactions, and friendly competition",
            "Voice memos back and forth with Murph",
          ]}
          label="One capability tested"
          title="Optional social support"
        />
      </div>
      <p className="mt-6 text-[15px] font-medium leading-[1.6] text-[#5a6e32]">
        * Earlier beta snapshot. Next: prove first-thread clarity and the first
        moment when remembered context improves the help.
      </p>
    </Slide>
  );
}

/* ━━━ 08 · COMPETITION ━━━ */
export function CompetitionSlide() {
  return (
    <Slide index={8} tone="cream" label="Competition">
      <Eyebrow>Competition</Eyebrow>
      <SlideHeading wide>
        General models supply reasoning.
        <br />
        Murph builds the health continuity.
      </SlideHeading>
      <p className="mt-5 max-w-[64ch] text-base leading-[1.7] text-[#635a48]">
        Devices see slices of the person. General AI can reason, but usually
        lacks durable canonical health context. Murph&apos;s product is the
        attributable, member-controlled continuity across authorized data,
        goals, constraints, actions, and outcomes.
      </p>
      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)] lg:items-start lg:gap-10">
        <MurphLoop />
        <PositioningChart />
      </div>
    </Slide>
  );
}

/* ━━━ 09 · MOAT ━━━ */
export function MoatSlide() {
  return (
    <Slide index={9} tone="dark" label="Moat thesis">
      <Eyebrow dark>Moat Thesis</Eyebrow>
      <SlideHeading dark>
        The durable asset is useful context, not a model wrapper.
      </SlideHeading>
      <p className="mt-5 max-w-[58ch] text-base leading-[1.7] text-[#e9e2d4]/70">
        If Murph repeatedly turns interactions and sources into attributable,
        correction-ready context, then retrieves it when it changes a later
        answer or action, value should compound. That advantage is the thesis;
        retention evidence still has to prove it.
      </p>

      {/* One health thread becomes reusable context for later help */}
      <div className="mt-9 grid gap-3 lg:grid-cols-[minmax(0,1fr)_24px_minmax(0,1fr)_24px_minmax(0,1.05fr)] lg:items-stretch">
        {/* 1: a useful health interaction with mixed-source input */}
        <div className="flex flex-col rounded-xl border border-[#f5f0e8]/12 bg-[#f5f0e8]/[0.04] p-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#e9e2d4]/55">
            Illustrative health thread
          </p>
          <p className="mt-4 font-serif text-[1.3rem] font-semibold leading-tight text-[#f5f0e8]">
            Improve sleep consistency
          </p>
          <p className="mt-1 text-[12px] text-[#e9e2d4]/60">
            One member, six relevant sources
          </p>
          <div className="mt-4 flex flex-wrap gap-1.5">
            {["Oura", "Calendar", "Journal", "Labs", "Workouts", "Messages"].map(
              (device) => (
                <span
                  key={device}
                  className="rounded-md border border-[#f5f0e8]/15 bg-[#f5f0e8]/[0.05] px-2 py-1 font-mono text-[9px] uppercase tracking-[0.08em] text-[#e9e2d4]/70"
                >
                  {device}
                </span>
              ),
            )}
          </div>
          <p className="mt-auto pt-5 text-[11px] leading-[1.4] text-[#e9e2d4]/45">
            Messy real-world context
          </p>
        </div>

        <FlowConnector />

        {/* 2: one attributed, correction-ready result */}
        <div className="flex flex-col rounded-xl border border-[#f5f0e8]/12 bg-[#f5f0e8]/[0.04] p-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#e9e2d4]/55">
            Illustrative context
          </p>
          <p className="mt-4 font-serif text-[2rem] font-semibold leading-none tracking-[-0.02em] text-[#f5f0e8]">
            Sleep score +7%
          </p>
          <p className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-[#9fb389]">
            27 of 30 nights completed
          </p>
          <div className="mt-4 flex flex-col gap-1.5 text-[12px]">
            <div className="flex justify-between gap-3">
              <span className="text-[#e9e2d4]/50">Adherence</span>
              <span className="text-[#f5f0e8]">27 / 30 nights</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-[#e9e2d4]/50">Flagged</span>
              <span className="text-[#f5f0e8]">Alcohol, travel</span>
            </div>
          </div>
          <p className="mt-auto pt-5 text-[11px] leading-[1.4] text-[#e9e2d4]/45">
            Private, attributable evidence
          </p>
        </div>

        <FlowConnector />

        {/* 3: prior context retrieved during a later decision */}
        <div className="flex flex-col rounded-xl border border-[#7a8c6e]/45 bg-[#7a8c6e]/[0.1] p-5">
          <div className="flex items-center justify-between">
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#9fb389]">
              Later help
            </p>
            <span className="rounded-full border border-[#9fb389]/30 bg-[#9fb389]/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-[#9fb389]">
              Personal
            </span>
          </div>
          <p className="mt-4 font-serif text-[1.3rem] font-semibold leading-tight text-[#f5f0e8]">
            The next sleep decision
          </p>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="font-serif text-[2rem] font-semibold leading-none tracking-[-0.02em] text-[#f5f0e8]">
              Prior
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[#9fb389]">
              result retrieved
            </span>
          </div>
          <div className="mt-4 flex flex-col gap-1.5 text-[12px]">
            <div className="flex justify-between gap-3">
              <span className="text-[#e9e2d4]/50">What helped</span>
              <span className="text-[#f5f0e8]">Earlier wind-down</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-[#e9e2d4]/50">Known constraint</span>
              <span className="text-[#f5f0e8]">Late work nights</span>
            </div>
          </div>
          <p className="mt-auto pt-5 text-[11px] leading-[1.4] text-[#9fb389]">
            Context reused when it matters
          </p>
        </div>
      </div>

      {/* The loop: present value produces context for better later help */}
      <div className="mt-7 flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[#e9e2d4]/70">
        <span aria-hidden="true" className="text-[14px] text-[#9fb389]">
          ↺
        </span>
        {["Thread", "Context", "Later help", "Better fit"].map(
          (step, index, steps) => (
            <span key={step} className="flex items-center gap-2">
              <span>{step}</span>
              {index < steps.length - 1 ? (
                <span aria-hidden="true" className="text-[#9fb389]/50">
                  &rarr;
                </span>
              ) : null}
            </span>
          ),
        )}
      </div>
    </Slide>
  );
}

/* ━━━ 10 · BUSINESS MODEL ━━━ */

// The few business-model questions that matter before expansion.
const BUSINESS_MODEL_QUESTIONS = [
  "Which plan retains?",
  "Which usage drives cost?",
  "Who pays for groups?",
  "What expands willingness to pay?",
] as const;

// Evidence gates that come before adding more pricing complexity.
const NEXT_BUSINESS_PROOFS = [
  "First useful value",
  "Context reused later",
  "Organic acquisition",
  "Retention by plan",
] as const;

export function BusinessModelSlide() {
  return (
    <Slide index={10} tone="cream" label="Business model">
      <Eyebrow>Business Model</Eyebrow>
      <SlideHeading wide>
        Members pay today.
        <br />
        The scalable model is still being learned.
      </SlideHeading>
      <p className="mt-5 max-w-[64ch] text-base leading-[1.7] text-[#635a48]">
        Eight founder-connected people pay for Pulse or Edge. That proves
        checkout, not pricing power, retention, or a repeatable buyer. Keep
        the model simple until those signals are real.
      </p>

      {/* Current plans and the questions that matter before expansion */}
      <div className="mt-10 grid items-stretch gap-4 lg:grid-cols-2">
        {/* Member plans */}
        <div className="flex flex-col rounded-xl border border-[#c4a882]/25 bg-[#fffcf6]/90 p-6">
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#5a6e32]">
            Member plans
          </p>
          <div className="mt-4 flex flex-col">
            {[
              { tier: "Pulse", price: "$8 / mo" },
              { tier: "Edge", price: "$20 / mo" },
            ].map((row, index, rows) => (
              <div
                key={row.tier}
                className={`flex items-baseline justify-between gap-3 py-3 ${
                  index < rows.length - 1
                    ? "border-b border-[#c4a882]/20"
                    : ""
                }`}
              >
                <span className="font-serif text-[1.3rem] font-semibold leading-none tracking-[-0.01em] text-[#2d3436]">
                  {row.tier}
                </span>
                <span className="font-serif text-[1.1rem] font-semibold tabular-nums text-[#5a6e32]">
                  {row.price}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-auto pt-5 text-[14px] leading-[1.55] text-[#635a48]">
            Includes the private assistant, health vault, connected context,
            plans, experiments, and optional group support.
          </p>
        </div>

        {/* Open business-model questions */}
        <div className="flex flex-col rounded-xl border border-[#c4a882]/25 bg-[#fffcf6]/90 p-6">
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#5a6e32]">
            Open questions
          </p>
          <p className="mt-3 font-serif text-[1.3rem] font-semibold leading-tight text-[#2d3436]">
            Expansion follows evidence
          </p>
          <p className="mt-2.5 text-[14px] leading-[1.55] text-[#635a48]">
            Group payers, usage-based tiers, and other expansion paths remain
            hypotheses. The next step is learning which direct member value
            retains and supports healthy economics.
          </p>
          <div className="mt-auto flex flex-wrap gap-1.5 pt-5">
            {BUSINESS_MODEL_QUESTIONS.map((question) => (
              <span
                key={question}
                className="rounded-md border border-[#c4a882]/30 bg-[#f5f0e8]/60 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-[#736a58]"
              >
                {question}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Evidence gates before pricing expansion */}
      <div className="mt-4 rounded-xl border border-[#5a6e32]/30 bg-[#5a6e32]/[0.06] p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#5a6e32]">
            Before expansion
          </p>
          <p className="text-[13px] leading-[1.55] text-[#3d5028]">
            Prove direct member pull and retention.
          </p>
        </div>
        <div className="mt-4 flex flex-wrap gap-1.5">
          {NEXT_BUSINESS_PROOFS.map((item) => (
            <span
              key={item}
              className="rounded-md bg-[#5a6e32]/12 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-[#5a6e32]"
            >
              {item}
            </span>
          ))}
        </div>
      </div>
    </Slide>
  );
}

/* ━━━ 11 · TEAM / ROADMAP ━━━ */
const TEAM_STATS = [
  { label: "products to product-market fit", value: "5" },
  { label: "monthly active users", value: "50K+" },
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
      "Founded iGol.pl, one of Poland's most popular football sites",
      "Built the MVP that secured a London fintech its FCA license",
      "Co-founded a creative studio in Poland, leading 5-7 developers across 10+ projects",
      "Built TeamBuddy, a Slack app for remote team building and social connection",
      "Built products at ustwo, the Apple Design Award-winning studio",
      "MSc in Computer Science · 18 years building software",
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
        Founders who have scaled consumer products and shipped together since 2021.
      </SlideHeading>
      <p className="mt-5 max-w-[60ch] text-base leading-[1.7] text-[#e9e2d4]/70">
        The founding team has worked together since 2021, building products
        that help people act, coordinate, and follow through.
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
        <>
          <div className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {TEAM_STATS.map((stat) => (
              <div
                key={stat.label}
                className="rounded-xl border border-[#f5f0e8]/12 bg-[#f5f0e8]/[0.04] p-4"
              >
                <p className="font-serif text-[1.6rem] font-semibold leading-none tracking-[-0.02em] text-[#f5f0e8]">
                  {stat.value}
                </p>
                <p className="mt-1.5 text-[12px] leading-[1.4] text-[#e9e2d4]/60">
                  {stat.label}
                </p>
              </div>
            ))}
          </div>
          <div className="mt-8">
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#9fb389]">
              Next 90 days
            </p>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {[
                "Prove new members understand Murph as a broad private health assistant",
                "Measure first useful value and the first later reuse of remembered context",
                "Improve authorized data connections, context retrieval, and member controls",
                "Test when private accountability, friend support, or an experiment is the right primitive",
              ].map((item) => (
                <li
                  key={item}
                  className="flex gap-3 text-[15px] leading-[1.5] text-[#e9e2d4]/80"
                >
                  <span className="mt-0.5 text-[#9fb389]">&rarr;</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </Slide>
  );
}

/* ━━━ 12 · THE ASK ━━━ */
export function AskSlide() {
  return (
    <Slide index={12} tone="dark" label="The ask">
      <div className="mx-auto max-w-[760px] text-center">
        <Eyebrow dark>The Ask</Eyebrow>
        <h2 className="mx-auto mt-6 max-w-[20ch] font-serif text-[clamp(2.2rem,4.6vw,3.6rem)] font-semibold leading-[1.08] tracking-[-0.035em] text-[#f5f0e8]">
          We&rsquo;re raising a pre-seed to prove pull, retention, and the context advantage.
        </h2>
        <p className="mx-auto mt-5 max-w-[62ch] text-[15px] leading-[1.65] text-[#e9e2d4]/65">
          This round funds the next proof: acquire beyond the founder network,
          improve context retrieval and controls, and measure whether better
          later help retains.
        </p>
      </div>
      {/* The trajectory: shipped product, evidence gates, and the vision */}
      <div className="mt-10 overflow-hidden rounded-2xl border border-[#f5f0e8]/15">
        <div className="grid divide-y divide-[#f5f0e8]/10 sm:grid-cols-2 sm:divide-x lg:grid-cols-4 lg:divide-y-0">
          <div className="bg-[#f5f0e8]/[0.04] p-6">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#e9e2d4]/50">
              Today
            </p>
            <p className="mt-3 text-[14px] leading-[1.6] text-[#e9e2d4]/80">
              A broad private health assistant with eight paid,
              founder-connected members.
            </p>
          </div>
          <div className="bg-[#f5f0e8]/[0.04] p-6">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#e9e2d4]/50">
              Demand
            </p>
            <p className="mt-3 text-[14px] leading-[1.6] text-[#e9e2d4]/80">
              Acquire direct signups beyond the network and deliver one useful
              first thread.
            </p>
          </div>
          <div className="bg-[#f5f0e8]/[0.04] p-6">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#e9e2d4]/50">
              Retention
            </p>
            <p className="mt-3 text-[14px] leading-[1.6] text-[#e9e2d4]/80">
              Show that remembered context improves later help enough to keep
              the relationship.
            </p>
          </div>
          <div className="bg-[#7a8c6e]/[0.16] p-6">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#9fb389]">
              End state
            </p>
            <p className="mt-3 font-serif text-[1.4rem] font-semibold leading-[1.2] text-[#f5f0e8]">
              Member-controlled health intelligence that knows the whole picture.
            </p>
          </div>
        </div>
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
