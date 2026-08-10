"use client";

import Image from "next/image";
import { useState } from "react";

const GH_BASE =
  "https://github.com/cobuildwithus/murph/blob/main/packages/assistant-engine/skills";

type Topic = {
  id: string;
  name: string;
  image: string;
  headline: string;
  proof: string;
  skill: string;
  handles: readonly string[];
  example: string;
  improves: readonly string[];
};

const TOPICS: readonly Topic[] = [
  {
    id: "sleep",
    name: "Sleep & light",
    image: "/design-assets/hero-morning-outdoor-light-exposure.jpeg",
    headline: "Murph helps you find what is breaking the night.",
    proof: "428 studies read · reviewed Jul 2026",
    skill: "sleep-improvement",
    handles: [
      "Reads your deep, REM, and efficiency",
      "Morning light and evening dim, for your chronotype",
      "The caffeine cutoff that fits your sleep",
      "Whether the mattress, pillow, or room CO2 is the problem",
      "Bedroom temperature and light",
      "When a pattern needs a clinician, not an experiment",
    ],
    example:
      "Waking at 3am after late screens? Murph might suggest morning sun, an earlier caffeine cutoff, and screens down before bed, then check your deep sleep after two weeks.",
    improves: ["Deep sleep", "HRV", "Morning energy"],
  },
  {
    id: "sauna",
    name: "Sauna & heat",
    image: "/design-assets/hero-finnish-sauna.jpeg",
    headline: "Murph builds a sauna plan around you.",
    proof: "340 studies read · reviewed Jul 2026",
    skill: "recovery-modalities",
    handles: [
      "Traditional or infrared, for your goal",
      "The target temperature and session length",
      "How many sessions a week to move your heart",
      "How to hydrate during, about 500 ml",
      "Which electrolytes to replace after, and when",
      "Whether a sauna hat is worth it",
      "When to skip it entirely",
    ],
    example:
      "For heart health: roughly 80 to 100°C, 15 to 20 minutes, a few times a week, water during, and electrolytes after.",
    improves: ["HRV", "Blood pressure", "Deep sleep"],
  },
  {
    id: "strength",
    name: "Strength & movement",
    image: "/design-assets/hero-at-home-static-stretching-latest.jpeg",
    headline: "Murph builds the training around your goal.",
    proof: "1,748 movements · ACSM-based",
    skill: "strength-training",
    handles: [
      "Picks movements for your goal, gear, and injuries",
      "Sets, reps, and week-to-week progression",
      "Form cues that keep each lift safe",
      "Illustrated guides for 1,655 of 1,748 movements",
      "Won't hand you what aggravates an injury",
      "Mobility work for where you're tight",
    ],
    example:
      "Building muscle at home with dumbbells? A sample 4-week squat, hinge, push, pull block, 3×8 rising to 4×10, with a form cue on every lift.",
    improves: ["Strength", "Muscle", "Mobility"],
  },
  {
    id: "food",
    name: "Eating & meal photos",
    image: "/design-assets/hero-high-protein-intake.jpeg",
    headline: "Photograph the plate. Murph reads it with you.",
    proof: "330+ studies read · reviewed Jul 2026",
    skill: "nutrition-strategy",
    handles: [
      "Logs calories, protein, and fat from a photo",
      "The glycemic load, and a swap to flatten it",
      "Your protein target for your body and goal",
      "A post-meal walk to blunt the spike",
      "Scans a supplement barcode against its evidence",
      "Where added sugar is hiding",
    ],
    example:
      "Snap dinner and Murph estimates around 620 kcal and 42g protein, flags the white rice, and suggests a short walk to flatten the spike.",
    improves: ["Blood sugar", "Body composition"],
  },
  {
    id: "cold",
    name: "Cold exposure",
    image: "/design-assets/cold-plunge-tub.jpeg",
    headline: "Murph helps you time cold so it pays off.",
    proof: "235 studies read · reviewed Jul 2026",
    skill: "recovery-modalities",
    handles: [
      "The water temperature and duration to start with",
      "Why not right after lifting, and where to put it instead",
      "When contrast beats cold on its own",
      "What it truly helps, minus the hype",
      "Breathing that keeps you safe",
      "How to build up without an ice bath on day one",
    ],
    example:
      "Lifting at 5pm? Murph moves your plunge to the morning, around 10 to 15°C for a few minutes, so it aids recovery without blunting muscle growth.",
    improves: ["Recovery", "Mood", "Alertness"],
  },
  {
    id: "red-light",
    name: "Red light therapy",
    image: "/design-assets/hero-red-light-therapy.jpeg",
    headline: "Murph helps you dial in the dose.",
    proof: "278 studies read · reviewed Jul 2026",
    skill: "recovery-modalities",
    handles: [
      "How far to sit from your specific lamp",
      "How many seconds, for the goal you have",
      "Red or near-infrared for what you're treating",
      "Which panels are worth it, by measured output",
      "The point where more light stops helping",
      "When to protect your eyes",
    ],
    example:
      "Sore knee? For your panel, Murph works out the distance and time, often near-infrared for a few minutes, and stops there, since more light does less.",
    improves: ["Skin", "Joint pain", "Recovery", "Sleep"],
  },
] as const;

function Check() {
  return (
    <span
      aria-hidden="true"
      className="mt-[0.3rem] inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-[#5a6e32]/12 text-[0.6rem] leading-none text-[#5a6e32]"
    >
      ✓
    </span>
  );
}

export function DeepCarouselSection() {
  const [active, setActive] = useState(0);
  const topic = TOPICS[active];

  return (
    <section className="bg-[#f5f0e8] px-5 py-16 sm:px-10 lg:px-16 lg:py-24">
      <div className="mx-auto max-w-[1080px]">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <span className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-[#5a6e32]">
              What deep actually looks like
            </span>
            <h2 className="mt-5 max-w-[22ch] font-serif text-[clamp(1.75rem,3.5vw,2.75rem)] font-semibold leading-[1.1] tracking-[-0.03em] text-[#2d3436]">
              Pick a topic. See everything Murph handles.
            </h2>
          </div>
          <div className="flex items-center gap-3">
            <span className="font-mono text-[11px] tracking-[0.08em] text-[#736a58]">
              {String(active + 1).padStart(2, "0")} / {String(TOPICS.length).padStart(2, "0")}
            </span>
            <button
              aria-label="Previous topic"
              className="flex size-9 items-center justify-center rounded-full border border-[#c4a882]/60 text-[#736a58] transition-colors hover:border-[#2d3436] hover:text-[#2d3436]"
              onClick={() => setActive((a) => (a - 1 + TOPICS.length) % TOPICS.length)}
              type="button"
            >
              ‹
            </button>
            <button
              aria-label="Next topic"
              className="flex size-9 items-center justify-center rounded-full border border-[#2d3436] text-[#2d3436] transition-colors hover:bg-[#2d3436] hover:text-[#f5f0e8]"
              onClick={() => setActive((a) => (a + 1) % TOPICS.length)}
              type="button"
            >
              ›
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="mt-8 flex flex-wrap gap-2">
          {TOPICS.map((t, i) => (
            <button
              className={`rounded-full px-4 py-2 text-[0.875rem] font-medium transition-colors ${
                i === active
                  ? "bg-[#2d3436] text-[#f5f0e8]"
                  : "border border-[#c4a882]/60 text-[#4a453c] hover:border-[#7a8c6e]/70"
              }`}
              key={t.id}
              onClick={() => setActive(i)}
              type="button"
            >
              {t.name}
            </button>
          ))}
        </div>

        {/* Panel */}
        <div
          className="mt-8 grid animate-panel-swap overflow-hidden rounded-2xl border border-[#c4a882]/25 bg-[#fffcf6] lg:grid-cols-[320px_1fr]"
          key={topic.id}
        >
          <div className="flex flex-col border-b border-[#c4a882]/20 lg:border-b-0 lg:border-r">
            <div className="relative aspect-[16/10] w-full overflow-hidden lg:aspect-[4/5]">
              <Image
                alt={topic.name}
                className="object-cover"
                fill
                sizes="(max-width: 1024px) 100vw, 320px"
                src={topic.image}
              />
            </div>
            <div className="flex flex-1 flex-col gap-4 p-6">
              <h3 className="font-serif text-[1.5rem] font-semibold leading-[1.12] text-[#2d3436]">
                {topic.headline}
              </h3>
              <div className="mt-auto flex flex-col gap-4">
                <p className="font-mono text-[10px] uppercase leading-[1.6] tracking-[0.1em] text-[#6f6450]">
                  {topic.proof}
                </p>
                <a
                  className="inline-flex w-fit items-center gap-2 rounded-full border border-[#2d3436]/25 px-4 py-2 text-[0.8125rem] font-medium text-[#2d3436] transition-colors hover:border-[#2d3436] hover:bg-[#2d3436] hover:text-[#f5f0e8]"
                  href={`${GH_BASE}/${topic.skill}/SKILL.md`}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                    <path d="M8 0C3.58 0 0 3.58 0 8a8 8 0 005.47 7.59c.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.42 7.42 0 014 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8 8 0 0016 8c0-4.42-3.58-8-8-8z" />
                  </svg>
                  View the skill on GitHub
                </a>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-6 p-6 lg:p-9">
            <div>
              <span className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-[#5a6e32]">
                What Murph handles here
              </span>
              <ul className="mt-4 grid gap-x-8 gap-y-3.5 sm:grid-cols-2">
                {topic.handles.map((h) => (
                  <li className="flex items-start gap-2.5" key={h}>
                    <Check />
                    <span className="text-[0.9375rem] leading-[1.45] text-[#2d3436]">
                      {h}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="border-t border-[#c4a882]/25 pt-5">
              <span className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-[#6f6450]">
                For example
              </span>
              <p className="mt-2 text-[0.9375rem] leading-[1.55] text-[#2d3436]">
                {topic.example}
              </p>
            </div>

            <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-[#c4a882]/25 pt-5">
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#736a58]">
                Moves
              </span>
              {topic.improves.map((m) => (
                <span
                  className="rounded-full border border-[#7a8c6e]/35 bg-[#5a6e32]/8 px-2.5 py-0.5 text-[0.8125rem] text-[#2d3436]"
                  key={m}
                >
                  {m}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
