"use client";

import { useState } from "react";
import { Input } from "@/src/components/ui/input";
import { CategoryFilter } from "@/src/components/experiments/category-filter";
import { ExperimentHeroCard } from "@/src/components/experiments/experiment-hero-card";
import { ExperimentBrowseCard } from "@/src/components/experiments/experiment-browse-card";

const RECOMMENDED = [
  {
    id: "finnish-sauna",
    title: "Finnish Sauna Protocol",
    category: "Recovery",
    image: "/design-assets/hero-sauna.png",
    matchPercent: 92,
    durationDays: 21,
    studyCount: 8,
  },
  {
    id: "cold-exposure",
    title: "Deliberate Cold Exposure",
    category: "Recovery",
    image: "/design-assets/hero-02.png",
    matchPercent: 87,
    durationDays: 14,
    studyCount: 6,
  },
];

const BROWSE_ALL = [
  {
    id: "finnish-sauna-finished",
    title: "Finnish Sauna (Completed)",
    category: "Recovery",
    image: "/design-assets/hero-sauna.png",
    matchPercent: 92,
    durationDays: 21,
    studyCount: 8,
  },
  {
    id: "magnesium-glycinate",
    title: "Magnesium Glycinate",
    category: "Supplements",
    image: "/design-assets/hero-04.png",
    matchPercent: 68,
    durationDays: 28,
    studyCount: 5,
  },
  {
    id: "zone2-cardio",
    title: "Zone 2 Cardio Base",
    category: "Exercise",
    image: "/design-assets/hero-sauna.png",
    matchPercent: 61,
    durationDays: 42,
    studyCount: 12,
  },
  {
    id: "wim-hof",
    title: "Wim Hof Method",
    category: "Breathwork",
    image: "/design-assets/hero-02.png",
    matchPercent: 55,
    durationDays: 30,
    studyCount: 3,
  },
  {
    id: "time-restricted-eating",
    title: "Time-Restricted Eating",
    category: "Nutrition",
    image: "/design-assets/hero-03.png",
    matchPercent: 48,
    durationDays: 30,
    studyCount: 7,
  },
  {
    id: "creatine",
    title: "Creatine Monohydrate",
    category: "Supplements",
    image: "/design-assets/hero-04.png",
    matchPercent: 44,
    durationDays: 60,
    studyCount: 15,
  },
  {
    id: "strength-training",
    title: "Strength Training 3x",
    category: "Exercise",
    image: "/design-assets/hero-sauna.png",
    matchPercent: 40,
    durationDays: 42,
    studyCount: 20,
  },
  {
    id: "no-screens",
    title: "No Screens After 9pm",
    category: "Sleep",
    image: "/design-assets/hero-02.png",
    matchPercent: 38,
    durationDays: 14,
    studyCount: 2,
  },
];

export default function ExperimentsPage() {
  const [category, setCategory] = useState("All");

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Library · 24 experiments
          </span>
          <h1 className="font-serif text-3xl font-semibold tracking-tight text-foreground">
            Experiments
          </h1>
        </div>
        <Input
          placeholder="Search experiments..."
          className="w-full sm:w-64"
        />
      </div>

      <CategoryFilter value={category} onChange={setCategory} />

      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Recommended for you
          </span>
          <span className="text-xs text-muted-foreground">
            Based on your profile data
          </span>
        </div>
        <div className="grid gap-5 md:grid-cols-2">
          {RECOMMENDED.map((exp) => (
            <ExperimentHeroCard key={exp.id} {...exp} />
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Browse all
          </span>
          <span className="text-xs text-muted-foreground">
            24 experiments
          </span>
        </div>
        <div className="grid gap-x-5 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
          {BROWSE_ALL.map((exp) => (
            <ExperimentBrowseCard key={exp.id} {...exp} />
          ))}
        </div>
      </section>
    </div>
  );
}
