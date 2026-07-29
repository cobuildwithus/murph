"use client";

import { useState } from "react";

const MODES = [
  {
    description:
      "Every contribution moves the same goal forward. No one has to finish first to matter.",
    example: "Run 10,000 miles as a club.",
    id: "together",
    label: "All together",
  },
  {
    description:
      "Divide the club however you want. Murph keeps every team’s score current and easy to understand.",
    example: "Morning crew vs. evening crew.",
    id: "teams",
    label: "Team vs. team",
  },
  {
    description:
      "A simple individual competition with clear standings, fair rules, and a real finish.",
    example: "Most workouts this month.",
    id: "race",
    label: "Head to head",
  },
] as const;

type ModeId = (typeof MODES)[number]["id"];

export function ClubChallengeModes() {
  const [activeMode, setActiveMode] = useState<ModeId>("together");
  const active = MODES.find((mode) => mode.id === activeMode) ?? MODES[0];

  return (
    <div className="mt-12 grid gap-8 lg:grid-cols-[0.82fr_1.18fr] lg:items-stretch lg:gap-12">
      <div className="flex flex-col justify-center gap-2">
        {MODES.map((mode) => {
          const selected = mode.id === activeMode;
          return (
            <button
              key={mode.id}
              aria-pressed={selected}
              className={`border-l-2 px-5 py-5 text-left transition-colors sm:px-6 ${
                selected
                  ? "border-[#5a6e32] bg-[#fffcf6]/55"
                  : "border-transparent hover:border-[#c4a882]/70 hover:bg-[#fffcf6]/30"
              }`}
              onClick={() => setActiveMode(mode.id)}
              type="button"
            >
              <span
                className={`font-mono text-[9px] font-semibold uppercase tracking-[0.18em] ${
                  selected ? "text-[#5a6e32]" : "text-[#736a58]"
                }`}
              >
                {mode.label}
              </span>
              <span className="mt-2 block font-serif text-[1.25rem] font-semibold leading-[1.15] tracking-[-0.02em] text-[#2d3436] sm:text-[1.4rem]">
                {mode.example}
              </span>
              <span className="mt-2 block max-w-[42ch] text-[0.875rem] leading-[1.6] text-[#635a48]">
                {mode.description}
              </span>
            </button>
          );
        })}
      </div>

      <div className="relative overflow-hidden rounded-[2rem] border border-[#c4a882]/18 bg-[#2a2520] p-5 sm:p-8">
        <div className="relative flex min-h-[360px] items-center justify-center sm:min-h-[430px]">
          <div key={active.id} className="animate-panel-swap w-full max-w-[520px]">
            {active.id === "together" ? <TogetherPreview /> : null}
            {active.id === "teams" ? <TeamsPreview /> : null}
            {active.id === "race" ? <RacePreview /> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function TogetherPreview() {
  return (
    <div className="rounded-[1.75rem] border border-[#c4a882]/20 bg-[#fffcf6] p-6 sm:p-8">
      <div className="flex items-center justify-between gap-4">
        <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-[#5a6e32]">
          August miles together
        </p>
        <span className="rounded-full bg-[#5a6e32]/10 px-3 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-[#3d5028]">
          Day 19 of 31
        </span>
      </div>
      <p className="mt-8 font-serif text-[clamp(2.75rem,8vw,5rem)] font-semibold leading-none tracking-[-0.055em] text-[#2d3436]">
        6,842
      </p>
      <p className="mt-2 text-[0.9375rem] text-[#736a58]">of 10,000 miles</p>
      <div className="mt-7 h-3 overflow-hidden rounded-full bg-[#d4c4a8]/35">
        <div className="h-full w-[68.42%] rounded-full bg-[#5a6e32]" />
      </div>
      <div className="mt-4 flex flex-col items-start gap-2 font-mono text-[9px] uppercase tracking-[0.12em] text-[#736a58] min-[420px]:flex-row min-[420px]:items-center min-[420px]:justify-between">
        <span>78 people contributing</span>
        <span>12 days left</span>
      </div>
      <p className="mt-7 border-t border-[#c4a882]/20 pt-5 font-serif text-[1.125rem] leading-[1.45] text-[#2d3436]">
        Every mile counts. The club is 8% ahead of finish pace.
      </p>
    </div>
  );
}

const TEAMS = [
  { label: "Morning crew", level: 0.82, score: "82%" },
  { label: "Evening crew", level: 0.78, score: "78%" },
  { label: "Weekend crew", level: 0.73, score: "73%" },
] as const;

function TeamsPreview() {
  return (
    <div className="rounded-[1.75rem] border border-[#c4a882]/20 bg-[#fffcf6] p-6 sm:p-8">
      <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-[#5a6e32]">
        Club team challenge
      </p>
      <h3 className="mt-4 font-serif text-[2rem] font-semibold leading-[1.05] tracking-[-0.035em] text-[#2d3436] sm:text-[2.5rem]">
        Three crews. One month.
      </h3>
      <div className="mt-8 space-y-5">
        {TEAMS.map((team, index) => (
          <div key={team.label}>
            <div className="flex items-baseline justify-between gap-4">
              <div className="flex items-baseline gap-3">
                <span className="font-mono text-[9px] text-[#736a58]">
                  0{index + 1}
                </span>
                <span className="font-serif text-[1.125rem] font-semibold text-[#2d3436]">
                  {team.label}
                </span>
              </div>
              <span className="font-mono text-[10px] font-semibold text-[#5a6e32]">
                {team.score}
              </span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#d4c4a8]/35">
              <div
                className="h-full rounded-full bg-[#5a6e32]"
                style={{ width: `${team.level * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
      <p className="mt-7 border-t border-[#c4a882]/20 pt-5 text-[0.875rem] leading-[1.6] text-[#635a48]">
        Scored by average goal progress, so a larger roster does not win by default.
      </p>
    </div>
  );
}

const RACERS = [
  { detail: "18 workouts", initials: "MA", name: "Maya" },
  { detail: "16 workouts", initials: "JO", name: "Jordan" },
  { detail: "15 workouts", initials: "TH", name: "Theo" },
] as const;

function RacePreview() {
  return (
    <div className="rounded-[1.75rem] border border-[#c4a882]/20 bg-[#fffcf6] p-6 sm:p-8">
      <div className="flex items-center justify-between gap-4">
        <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-[#5a6e32]">
          July workout race
        </p>
        <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-[#736a58]">
          6 days left
        </span>
      </div>
      <h3 className="mt-4 font-serif text-[2rem] font-semibold leading-[1.05] tracking-[-0.035em] text-[#2d3436] sm:text-[2.5rem]">
        The finish is getting close.
      </h3>
      <div className="mt-7 divide-y divide-[#c4a882]/20">
        {RACERS.map((racer, index) => (
          <div key={racer.name} className="flex items-center gap-2.5 py-4 first:pt-0 last:pb-0 sm:gap-4">
            <span className="w-4 font-mono text-[10px] text-[#736a58] sm:w-5">
              {index + 1}
            </span>
            <span className="flex size-9 items-center justify-center rounded-full sm:size-10 bg-[#5a6e32]/12 font-mono text-[9px] font-semibold text-[#3d5028]">
              {racer.initials}
            </span>
            <span className="min-w-0 flex-1 truncate font-serif text-[1.05rem] font-semibold text-[#2d3436] sm:text-[1.125rem]">
              {racer.name}
            </span>
            <span className="font-mono text-[10px] text-[#5a6e32]">
              {racer.detail}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-7 border-t border-[#c4a882]/20 pt-5 text-[0.875rem] leading-[1.6] text-[#635a48]">
        Clear standings, one agreed metric, and no mystery about how the winner is called.
      </p>
    </div>
  );
}
