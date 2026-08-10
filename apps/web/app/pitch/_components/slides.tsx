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
            The social layer for health experiments.
          </h1>
          <p className="mt-7 max-w-[50ch] text-[15px] leading-[1.65] text-[#e9e2d4]/65">
            Your personal health assistant. Text Murph to try health protocols with friends or public
            groups and see what actually makes you healthier.
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
          members={6}
          messages={[
            { kind: "you", text: "lowest step count this month buys dinner" },
            { kind: "friend", name: "Priya", text: "oh it is ON" },
            {
              kind: "murph",
              text: "Challenge created. 6 people joined. Connect Apple Health, Oura, or Whoop to start.",
            },
            {
              kind: "murph",
              text: "Leaderboard updates every morning. First one posts tomorrow at 8am.",
            },
          ]}
          title="Step Squad"
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
        People want to get healthier together.
        <br />
        There’s no way to try, track, and learn.
      </SlideHeading>
      <p className="mt-5 max-w-[60ch] text-base leading-[1.7] text-[#635a48]">
        A group chat or cohort can come up with a health challenge in
        five seconds: walk more, sleep better, drink less, try creatine,
        improve recovery.
      </p>

      {/* One message is easy to send; running the challenge is seven jobs */}
      <div className="mt-10 grid items-stretch gap-4 lg:grid-cols-2">
        {/* One message — easy to suggest */}
        <div className="flex flex-col rounded-2xl border border-[#c4a882]/25 bg-[#fffcf6]/90 p-6">
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#736a58]">
            One message
          </p>
          <div className="mt-4">
            <span className="inline-block max-w-[300px] rounded-2xl rounded-bl-md bg-[#ece3d2] px-4 py-2.5 text-[14px] leading-[1.45] text-[#2d3436]">
              let&rsquo;s do a 30-day step challenge
            </span>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {["i'm in", "down", "let's do it"].map((reaction) => (
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
            Easy to suggest
          </p>
        </div>

        {/* Seven jobs — hard to run */}
        <div className="flex flex-col rounded-2xl border border-[#c4a882]/30 bg-[#ebe4d4] p-6">
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#736a58]">
            Seven jobs
          </p>
          <ul className="mt-4 flex flex-col gap-2">
            {[
              "Set the rules",
              "Pick the metric",
              "Connect everyone's devices",
              "Handle mixed wearables",
              "Remind the group",
              "Keep score",
              "Figure out what changed",
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
        Ideas are instant. Getting healthy is hard work.
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
        The next health app is not another dashboard. It&apos;s a social loop.
      </SlideHeading>
      <p className="mt-5 max-w-[56ch] text-base leading-[1.7] text-[#e9e2d4]/70">
        Health apps are great at measurement. They are still weak at
        motivation.
      </p>
      <p className="mt-3 max-w-[56ch] text-base leading-[1.7] text-[#e9e2d4]/70">
        Murph turns health data into a social loop: a challenge, shared
        progress, and a reason to show up tomorrow — right in the
        messaging apps you already use.
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

        {/* Right — the challenge: a progress board, not just a ranking */}
        <div className="rounded-2xl border border-[#7a8c6e]/40 bg-[#7a8c6e]/[0.1] p-6">
          <div className="flex items-center justify-between gap-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#9fb389]">
              30-day sleep challenge
            </p>
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#e9e2d4]/55">
              Day 12 of 30
            </span>
          </div>

          {/* Group progress — everyone is moving, not just the winner */}
          <p className="mt-4 font-mono text-[9px] uppercase tracking-[0.12em] text-[#e9e2d4]/45">
            Group progress
          </p>
          <div className="mt-2 grid grid-cols-3 gap-1.5">
            {[
              { label: "people active", value: "21" },
              { label: "improved", value: "17 of 21" },
              { label: "avg improvement", value: "+6%" },
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

          {/* Progress board — checking in and improving, not ranked */}
          <p className="mt-4 font-mono text-[9px] uppercase tracking-[0.12em] text-[#e9e2d4]/45">
            Progress board
          </p>
          <div className="mt-2 flex flex-col gap-1.5">
            {[
              { name: "Priya", delta: "+12%", down: false, you: false },
              { name: "You", delta: "+8%", down: false, you: true },
              { name: "Sam", delta: "−2%", down: true, you: false },
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
              Stake
            </span>
            Last place buys dinner
          </p>
        </div>
      </div>

      <p className="mt-8 font-serif text-[clamp(1.3rem,2.4vw,1.8rem)] italic leading-[1.3] text-[#f5f0e8]">
        Charts measure health. Challenges build habits.
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
        AI understands.
        <br />
        Friends motivate.
        <br />
        Murph builds the habit.
      </SlideHeading>
      <p className="mt-5 max-w-[62ch] text-base leading-[1.7] text-[#635a48]">
        Millions of people now have health data, and they are already
        asking AI what it means. But measurement and advice do not change
        behavior on their own. Murph adds the missing loop: friends,
        challenges, reminders, leaderboards, and outcomes.
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
          label="Strava users proving fitness is social"
          source="Strava"
          value="180M+"
        />
      </div>
      <p className="mt-8 max-w-[64ch] text-[15px] leading-[1.6] text-[#736a58]">
        The data exists. The social surface exists.{" "}
        <span className="font-medium text-[#2d3436]">
          AI is finally good enough to run the rest.
        </span>
      </p>
    </Slide>
  );
}

/* ━━━ 04 · PRODUCT ━━━ */

// The four steps of the challenge loop. Each is a button on the slide;
// clicking one reveals a small mock of what that step looks like.
const PRODUCT_STEPS = [
  {
    title: "Start or join a challenge",
    detail: "Create one with friends or join a cohort.",
    panelLabel: "It starts with one message in the group chat",
    panel: (
      <div className="flex max-w-[440px] flex-col gap-1.5">
        <span className="self-end rounded-2xl rounded-br-md bg-[#2d3436] px-3.5 py-2 text-[13px] leading-[1.4] text-[#f5f0e8]">
          lowest step count this month buys dinner
        </span>
        <span className="self-start rounded-2xl rounded-bl-md bg-[#fffcf6] px-3.5 py-2 text-[13px] leading-[1.4] text-[#635a48]">
          oh it&rsquo;s ON
        </span>
        <span className="self-start rounded-2xl rounded-bl-md bg-[#e4e8df] px-3.5 py-2 text-[13px] leading-[1.4] text-[#3d5028]">
          Challenge created. 6 friends joined.
        </span>
      </div>
    ),
  },
  {
    title: "Build your baseline",
    detail: "Connect your wearable; Murph learns your starting point.",
    panelLabel: "Six friends, six devices, one challenge",
    panel: (
      <div className="grid max-w-[560px] gap-x-12 sm:grid-cols-2">
        {[
          { name: "Priya", device: "Oura" },
          { name: "Marco", device: "Whoop" },
          { name: "Dana", device: "Apple Watch" },
          { name: "Sam", device: "Garmin" },
          { name: "Will", device: "Fitbit" },
          { name: "Alex", device: "Manual" },
        ].map((member) => (
          <div
            key={member.name}
            className="flex items-center gap-2.5 border-b border-[#c4a882]/20 py-2"
          >
            <span
              aria-hidden="true"
              className="size-1.5 shrink-0 rounded-full bg-[#7a8c6e]"
            />
            <span className="flex-1 text-[13px] font-medium text-[#2d3436]">
              {member.name}
            </span>
            <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-[#736a58]">
              {member.device}
            </span>
          </div>
        ))}
      </div>
    ),
  },
  {
    title: "Murph runs it",
    detail: "Rules, reminders, check-ins, and leaderboards.",
    panelLabel: "A live leaderboard the whole way through",
    panel: (
      <div className="max-w-[460px]">
        <div className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.1em]">
          <span className="text-[#5a6e32]">Baseline 7d ✓</span>
          <span className="text-[#c4a882]">·</span>
          <span className="font-semibold text-[#2d3436]">Active, day 12</span>
          <span className="text-[#c4a882]">·</span>
          <span className="text-[#736a58]/55">Analysis</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#d4c4a8]/45">
          <div className="h-full w-[58%] rounded-full bg-[#5a6e32]" />
        </div>
        <div className="mt-4 flex flex-col gap-1.5">
          {[
            { rank: "1", name: "Priya", delta: "+14%" },
            { rank: "2", name: "You", delta: "+9%" },
            { rank: "3", name: "Marco", delta: "+6%" },
          ].map((row, index) => (
            <div
              key={row.name}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 ${
                index === 0 ? "bg-[#5a6e32]/[0.1]" : "bg-[#fffcf6]/70"
              }`}
            >
              <span className="font-serif text-[15px] font-semibold tabular-nums text-[#2d3436]">
                {row.rank}
              </span>
              <span className="flex-1 text-[13px] font-medium text-[#2d3436]">
                {row.name}
              </span>
              <span className="font-serif text-[15px] font-semibold tabular-nums text-[#5a6e32]">
                {row.delta}
              </span>
            </div>
          ))}
        </div>
      </div>
    ),
  },
  {
    title: "Results update your vault",
    detail: "Each person sees what changed, and the protocol gets smarter.",
    panelLabel: "Priya's results · 30-day sleep challenge",
    panel: (
      <div className="grid max-w-[880px] gap-5 lg:grid-cols-[minmax(0,1fr)_28px_minmax(0,0.82fr)] lg:items-center">
        {/* This challenge — Priya's results */}
        <div>
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: "Sleep score", value: "86", unit: "", change: "+14%" },
              { label: "Deep sleep", value: "1h42m", unit: "", change: "+18%" },
              { label: "Resting HR", value: "58", unit: "bpm", change: "−4%" },
            ].map((metric) => (
              <div
                key={metric.label}
                className="rounded-lg border border-[#c4a882]/20 bg-[#fffcf6]/80 px-3 py-3"
              >
                <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-[#736a58]">
                  {metric.label}
                </p>
                <p className="mt-1.5 font-serif text-[1.2rem] font-semibold leading-none tracking-[-0.02em] text-[#2d3436]">
                  {metric.value}
                  {metric.unit ? (
                    <span className="ml-0.5 text-[0.7rem] font-normal text-[#736a58]">
                      {metric.unit}
                    </span>
                  ) : null}
                </p>
                <p className="mt-1.5 text-[11px] font-medium text-[#5a6e32]">
                  {metric.change}
                </p>
              </div>
            ))}
          </div>
          <div className="mt-2 rounded-lg border border-[#c4a882]/20 bg-[#fffcf6]/80 px-4 py-3">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-[#736a58]">
                Sleep score · 30d
              </span>
              <div className="flex items-center gap-3 text-[10px]">
                <span className="flex items-center gap-1 text-[#736a58]/60">
                  <span className="inline-block h-px w-2.5 border-t border-dashed border-[#c4a882]" />
                  Baseline
                </span>
                <span className="flex items-center gap-1 text-[#736a58]">
                  <span className="inline-block h-0.5 w-2.5 rounded-full bg-[#5a6e32]" />
                  Active
                </span>
              </div>
            </div>
            <svg
              viewBox="0 0 300 40"
              fill="none"
              className="mt-2 w-full"
              aria-hidden="true"
            >
              <path
                d="M8 28 L30 26 L50 28 L70 25 L90 26"
                stroke="#d4c4a8"
                strokeWidth="1.25"
                strokeDasharray="3 2"
                strokeLinecap="round"
              />
              <path
                d="M95 26 L115 22 L140 19 L165 15 L190 16 L215 12 L240 11 L265 8 L290 5"
                stroke="#5a6e32"
                strokeWidth="1.75"
                strokeLinecap="round"
              />
              <circle cx="290" cy="5" r="2.25" fill="#5a6e32" />
            </svg>
          </div>
        </div>

        <FlowConnector />

        {/* ...joins Priya's compounding health vault */}
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#5a6e32]">
            Priya&rsquo;s health vault
          </p>
          <div className="mt-3.5 flex flex-col">
            {[
              {
                name: "Sleep challenge",
                when: "Now",
                result: "+14% sleep score",
                current: true,
              },
              { name: "Creatine experiment", when: "Apr", result: "+6% HRV" },
              {
                name: "Blood results uploaded",
                when: "Mar",
                result: "14 biomarkers added",
              },
              { name: "Step bet", when: "Feb", result: "12k daily average" },
            ].map((entry, index, list) => (
              <div key={entry.name} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span
                    aria-hidden="true"
                    className={`size-[11px] shrink-0 rounded-full ${
                      entry.current
                        ? "bg-[#5a6e32]"
                        : "border-[1.5px] border-[#c4a882]"
                    }`}
                  />
                  {index < list.length - 1 ? (
                    <span
                      aria-hidden="true"
                      className="mt-1 w-px flex-1 bg-[#c4a882]/45"
                    />
                  ) : null}
                </div>
                <div className="flex-1 pb-4">
                  <div className="flex items-baseline justify-between gap-2">
                    <span
                      className={`text-[13px] font-medium ${
                        entry.current ? "text-[#2d3436]" : "text-[#635a48]"
                      }`}
                    >
                      {entry.name}
                    </span>
                    <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-[#736a58]">
                      {entry.when}
                    </span>
                  </div>
                  <p
                    className={`mt-0.5 text-[12px] ${
                      entry.current ? "text-[#5a6e32]" : "text-[#8a7f6a]"
                    }`}
                  >
                    {entry.result}
                  </p>
                </div>
              </div>
            ))}
          </div>
          <p className="pl-[23px] text-[12px] text-[#736a58]">
            + 4 earlier challenges
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
      <Eyebrow>The Product</Eyebrow>
      <SlideHeading>
        A personal health AI inside iMessage. Experiments on you, challenges with your friends.
      </SlideHeading>
      <p className="mt-5 max-w-[64ch] text-base leading-[1.7] text-[#635a48]">
        Add Murph to a group chat or join a cohort. Each person connects
        the wearable they already use. Murph builds a private baseline,
        runs the shared challenge, keeps score, and saves the result back
        to each person&rsquo;s health vault.
      </p>
      {/* The loop: one challenge, from kickoff to outcome */}
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

// Panel three — Will's real Finnish-sauna run, measured against his
// locked baseline. Every delta is an improvement, so all read sage.
const WILL_RESULTS = [
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
      <Eyebrow dark>Example Experiment</Eyebrow>
      <SlideHeading dark wide>
        Murph turns one protocol into
        <br />compounding health outcomes.
      </SlideHeading>
      <p className="mt-5 max-w-[64ch] text-base leading-[1.7] text-[#e9e2d4]/70">
        A challenge is what gets someone started. From there, Murph locks
        a baseline, tracks every session, measures the change, and saves
        the result to their health vault.
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

        {/* 3 — Will's real measured results, saved to his vault */}
        <div className="flex flex-col rounded-xl border border-[#7a8c6e]/45 bg-[#7a8c6e]/[0.1] p-5">
          <div className="flex items-baseline justify-between gap-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#9fb389]">
              Will&rsquo;s actual results*
            </p>
            <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-[#e9e2d4]/45">
              vs baseline
            </span>
          </div>
          <div className="mt-4 flex flex-col gap-2">
            {WILL_RESULTS.map((result) => (
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
        * Actual results from Will&rsquo;s recent sauna experiment
      </p>

      <div className="mt-6 rounded-xl border border-[#f5f0e8]/12 bg-[#f5f0e8]/[0.04] p-4 sm:flex sm:items-center sm:gap-8 sm:p-5">
        <div className="sm:max-w-[30ch]">
          <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-[#9fb389]">
            Where results pool
          </p>
          <p className="mt-2 text-[15px] leading-[1.6] text-[#f5f0e8]">
            Every completed run saves a before/after. Pooled across thousands
            of members, protocols become answerable questions.
          </p>
        </div>
        <div className="mt-4 flex-1 rounded-lg border border-[#f5f0e8]/10 bg-black/25 p-4 sm:mt-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-[#e9e2d4]/60">
              Sauna 15&ndash;20 min &middot; Men under 30
            </span>
            <span className="rounded-full bg-[#9fb389]/15 px-2 py-0.5 font-mono text-[10px] font-medium text-[#9fb389]">
              1,000+ contributed runs
            </span>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {[
              { metric: "Resting HR", value: "−2.1 bpm" },
              { metric: "HRV RMSSD", value: "+6.4 ms" },
              { metric: "Deep sleep", value: "+11 min" },
            ].map((stat) => (
              <div key={stat.metric}>
                <p className="font-mono text-[9px] uppercase tracking-[0.08em] text-[#e9e2d4]/40">
                  {stat.metric}
                </p>
                <p className="mt-1 font-serif text-[1.15rem] font-semibold leading-none text-[#f5f0e8]">
                  {stat.value}
                  <span className="ml-1.5 font-sans text-[10px] font-normal text-[#e9e2d4]/45">
                    median
                  </span>
                </p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[10px] leading-[1.4] text-[#e9e2d4]/40">
            Illustrative at scale &mdash; every completed challenge adds a run.
          </p>
        </div>
      </div>
    </Slide>
  );
}

/* ━━━ 06 · HOW IT SPREADS ━━━ */

// The two growth loops shown on the spread slide. Each renders as a
// numbered card; the final `repeat` step loops back to the first.
const SPREAD_LOOPS = [
  {
    label: "Private group loop",
    steps: [
      "One person starts a challenge",
      "They invite friends",
      "The group gets results",
    ],
    repeat: "Someone starts the next challenge",
  },
  {
    label: "Cohort loop",
    steps: [
      "A protocol page attracts users",
      "People join the cohort",
      "Outcomes improve the protocol page",
    ],
    repeat: "Better evidence attracts more users",
  },
] as const;

export function SpreadSlide() {
  return (
    <Slide index={6} tone="cream" label="How it spreads">
      <Eyebrow>How It Spreads</Eyebrow>
      <SlideHeading>
        Murph spreads through private groups and public cohorts.
      </SlideHeading>
      <p className="mt-5 max-w-[64ch] text-base leading-[1.7] text-[#635a48]">
        Murph doesn&rsquo;t only spread through friend invites. It also
        compounds through protocol pages that become public destinations.
      </p>

      {/* Two growth loops: friend invites, and protocol-page cohorts */}
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

      {/* The cohort loop's artifact: a protocol page that is a destination */}
      <div className="mt-4 flex flex-wrap items-center gap-x-8 gap-y-4 rounded-xl border border-[#5a6e32]/30 bg-[#5a6e32]/[0.06] p-5">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#5a6e32]">
            Protocol page &middot; public cohort
          </p>
          <p className="mt-1.5 font-serif text-[1.3rem] font-semibold leading-tight text-[#2d3436]">
            30-day sleep challenge
          </p>
        </div>
        <div className="flex gap-8">
          {[
            { value: "1,284", label: "runs logged" },
            { value: "+6.8%", label: "avg improvement" },
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
          Best for late-night screen users
        </span>
        <span className="ml-auto inline-flex items-center gap-1.5 rounded-xl bg-[#5a6e32] px-4 py-2.5 text-[13px] font-medium text-white">
          Join next cohort
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
        MRR doubled in the last 30 days.
      </SlideHeading>
      <p className="mt-5 max-w-[64ch] text-base leading-[1.7] text-[#635a48]">
        We shipped the personal experiment loop first. The wedge became
        obvious &mdash; people don&rsquo;t want to optimize alone, they want
        to run health challenges with friends. Group challenges shipped in
        July. Revenue has compounded every week since.
      </p>
      <div className="mt-9 grid gap-3 sm:grid-cols-3">
        {[
          {
            value: "18% w/w MRR growth",
            note: "Five-week average, and up every single week. MRR doubled in the last 30 days.",
          },
          {
            value: "+80% paying customers",
            note: "In 30 days, with zero paid acquisition.",
          },
          {
            value: "8 msgs / day / active user",
            note: "2,400 messages exchanged last week — engagement per user up 2.5x since June.",
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
          label="What our users are doing"
          title="Solo usage, every week"
        />
        <PivotCard
          highlight
          items={[
            "Six group chats live, up from one in June",
            "The most active: an eight-person group text, 107 messages to Murph last week",
            "Laughs, reactions, trash talk at the referee",
            "Voice memos back and forth with Murph",
          ]}
          label="What's running"
          title="Group challenges"
        />
      </div>
    </Slide>
  );
}

/* ━━━ 08 · COMPETITION ━━━ */
export function CompetitionSlide() {
  return (
    <Slide index={8} tone="cream" label="Competition">
      <Eyebrow>Competition</Eyebrow>
      <SlideHeading wide>
        Devices track individuals.
        <br />
        ChatGPT answers prompts.
        <br />
        Murph coordinates healthy habits.
      </SlideHeading>
      <p className="mt-5 max-w-[64ch] text-base leading-[1.7] text-[#635a48]">
        Oura and Whoop see one device. ChatGPT sees one prompt. Murph connects wearables, labs, protocols,
        and outcomes into a private health vault &mdash; then uses that
        context to run challenges with friends, cohorts, and people like
        you.
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
    <Slide index={9} tone="dark" label="The moat">
      <Eyebrow dark>The Moat</Eyebrow>
      <SlideHeading dark>
        Every challenge teaches Murph what works.
      </SlideHeading>
      <p className="mt-5 max-w-[58ch] text-base leading-[1.7] text-[#e9e2d4]/70">
        Every challenge becomes a shareable health outcome. Every outcome makes
        each protocol smarter.
      </p>

      {/* The challenge → the outcome record → the protocol page */}
      <div className="mt-9 grid gap-3 lg:grid-cols-[minmax(0,1fr)_24px_minmax(0,1fr)_24px_minmax(0,1.05fr)] lg:items-stretch">
        {/* 1 — messy mixed-device input */}
        <div className="flex flex-col rounded-xl border border-[#f5f0e8]/12 bg-[#f5f0e8]/[0.04] p-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#e9e2d4]/55">
            The challenge
          </p>
          <p className="mt-4 font-serif text-[1.3rem] font-semibold leading-tight text-[#f5f0e8]">
            30-day sleep challenge
          </p>
          <p className="mt-1 text-[12px] text-[#e9e2d4]/60">
            6 friends, 5 different wearables
          </p>
          <div className="mt-4 flex flex-wrap gap-1.5">
            {["Oura", "Whoop", "Apple Watch", "Garmin", "Fitbit", "Manual"].map(
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
            Messy real-world data
          </p>
        </div>

        <FlowConnector />

        {/* 2 — one clean structured result */}
        <div className="flex flex-col rounded-xl border border-[#f5f0e8]/12 bg-[#f5f0e8]/[0.04] p-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#e9e2d4]/55">
            Outcome record #482
          </p>
          <p className="mt-4 font-serif text-[2rem] font-semibold leading-none tracking-[-0.02em] text-[#f5f0e8]">
            4 of 6 improved
          </p>
          <p className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-[#9fb389]">
            +7% average sleep score
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
            Clean, comparable evidence
          </p>
        </div>

        <FlowConnector />

        {/* 3 — the protocol page that compounds with every run */}
        <div className="flex flex-col rounded-xl border border-[#7a8c6e]/45 bg-[#7a8c6e]/[0.1] p-5">
          <div className="flex items-center justify-between">
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#9fb389]">
              The protocol page
            </p>
            <span className="rounded-full border border-[#9fb389]/30 bg-[#9fb389]/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-[#9fb389]">
              Live
            </span>
          </div>
          <p className="mt-4 font-serif text-[1.3rem] font-semibold leading-tight text-[#f5f0e8]">
            Sleep Challenge Protocol
          </p>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="font-serif text-[2rem] font-semibold leading-none tracking-[-0.02em] text-[#f5f0e8]">
              1,284
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[#9fb389]">
              runs logged
            </span>
          </div>
          <div className="mt-4 flex flex-col gap-1.5 text-[12px]">
            <div className="flex justify-between gap-3">
              <span className="text-[#e9e2d4]/50">Avg improvement</span>
              <span className="text-[#f5f0e8]">+6.8%</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-[#e9e2d4]/50">Best for</span>
              <span className="text-[#f5f0e8]">Late-night screen users</span>
            </div>
          </div>
          <p className="mt-auto pt-5 text-[11px] leading-[1.4] text-[#9fb389]">
            Smarter with every run
          </p>
        </div>
      </div>

      {/* The loop — the protocol feeds the next challenge */}
      <div className="mt-7 flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[#e9e2d4]/70">
        <span aria-hidden="true" className="text-[14px] text-[#9fb389]">
          ↺
        </span>
        {["Challenge", "Record", "Protocol", "Next challenge"].map(
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

// Sponsor cohort examples, shown as chips on the sponsor card.
const SPONSOR_EXAMPLES = [
  "XYZ Prebiotic Cohort",
  "30-Day Recovery Challenge",
  "Step Count Challenge",
  "Sleep Consistency Cohort",
] as const;

// The full-width usage rail beneath the two buyer cards. Each item is
// an overage Murph charges for on top of included usage.
const USAGE_OVERAGES = [
  "Extra challenge runs",
  "Large groups",
  "Advanced analysis",
  "Sponsor-grade verification",
  "Outcome reports",
] as const;

export function BusinessModelSlide() {
  return (
    <Slide index={10} tone="cream" label="Business model">
      <Eyebrow>Business Model</Eyebrow>
      <SlideHeading wide>
        Members subscribe.
        <br />
        Sponsors fund cohorts.
        <br />
        Usage protects margins.
      </SlideHeading>
      <p className="mt-5 max-w-[64ch] text-base leading-[1.7] text-[#635a48]">
        Plus and Edge include normal cohort usage. Heavy users, large groups,
        advanced analyses, and sponsor-grade reporting pay for more.
      </p>

      {/* Two buyers — members and sponsors */}
      <div className="mt-10 grid items-stretch gap-4 lg:grid-cols-2">
        {/* Member plans */}
        <div className="flex flex-col rounded-xl border border-[#c4a882]/25 bg-[#fffcf6]/90 p-6">
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#5a6e32]">
            Member plans
          </p>
          <div className="mt-4 flex flex-col">
            {[
              { tier: "Plus", price: "$8 / mo" },
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
            Includes cohorts, challenges, health vaults, baselines, and AI
            insights.
          </p>
        </div>

        {/* Sponsored cohorts */}
        <div className="flex flex-col rounded-xl border border-[#c4a882]/25 bg-[#fffcf6]/90 p-6">
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#5a6e32]">
            Sponsored cohorts
          </p>
          <p className="mt-3 font-serif text-[1.3rem] font-semibold leading-tight text-[#2d3436]">
            Brands, employers, insurers
          </p>
          <p className="mt-2.5 text-[14px] leading-[1.55] text-[#635a48]">
            Sponsors fund product, habit, and rewards-based cohorts. Murph runs
            and verifies them.
          </p>
          <div className="mt-auto flex flex-wrap gap-1.5 pt-5">
            {SPONSOR_EXAMPLES.map((example) => (
              <span
                key={example}
                className="rounded-md border border-[#c4a882]/30 bg-[#f5f0e8]/60 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-[#736a58]"
              >
                {example}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* One pricing guardrail — applies to both buyers */}
      <div className="mt-4 rounded-xl border border-[#5a6e32]/30 bg-[#5a6e32]/[0.06] p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#5a6e32]">
            Included usage + overages
          </p>
          <p className="text-[13px] leading-[1.55] text-[#3d5028]">
            Applies to both member plans and sponsor campaigns.
          </p>
        </div>
        <div className="mt-4 flex flex-wrap gap-1.5">
          {USAGE_OVERAGES.map((item) => (
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
        Built by founders who ship social coordination products.
      </SlideHeading>
      <p className="mt-5 max-w-[60ch] text-base leading-[1.7] text-[#e9e2d4]/70">
        Will and Wojciech have worked together since 2021, building
        community coordination products that make people show up and
        participate.
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
                "Run 25 group challenges across iMessage, WhatsApp, and Telegram, starting from the six live now",
                "Measure how many groups finish and how many start a second challenge",
                "Launch templates for steps, sleep, alcohol, workouts, and recovery",
                "Ship shareable results and the first structured group experiment dataset",
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
          We&rsquo;re raising a pre-seed to make health improvement effortless.
        </h2>
      </div>
      {/* The trajectory: today's wedge, the network it builds, the vision */}
      <div className="mt-10 overflow-hidden rounded-2xl border border-[#f5f0e8]/15">
        <div className="grid divide-y divide-[#f5f0e8]/10 sm:grid-cols-2 sm:divide-x lg:grid-cols-4 lg:divide-y-0">
          <div className="bg-[#f5f0e8]/[0.04] p-6">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#e9e2d4]/50">
              Today
            </p>
            <p className="mt-3 text-[14px] leading-[1.6] text-[#e9e2d4]/80">
              Private group-chat challenges. The first is live now.
            </p>
          </div>
          <div className="bg-[#f5f0e8]/[0.04] p-6">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#e9e2d4]/50">
              Next
            </p>
            <p className="mt-3 text-[14px] leading-[1.6] text-[#e9e2d4]/80">
              Public cohorts around protocols: sleep, steps, alcohol,
              recovery, supplements.
            </p>
          </div>
          <div className="bg-[#f5f0e8]/[0.04] p-6">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#e9e2d4]/50">
              At scale
            </p>
            <p className="mt-3 text-[14px] leading-[1.6] text-[#e9e2d4]/80">
              Matched benchmarks and shared evidence: what works, for
              whom, on which biomarkers, and under what conditions.
            </p>
          </div>
          <div className="bg-[#7a8c6e]/[0.16] p-6">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#9fb389]">
              End state
            </p>
            <p className="mt-3 font-serif text-[1.4rem] font-semibold leading-[1.2] text-[#f5f0e8]">
              Where the world runs its health experiments.
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
