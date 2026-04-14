import { ActiveExperimentBanner } from "@/src/components/overview/active-experiment-banner";
import { ProfileStats } from "@/src/components/overview/profile-stats";
import { HealthDomainCard } from "@/src/components/overview/health-domain-card";
import type { HealthDomain, ActiveExperiment, ProfileStats as ProfileStatsType } from "@/src/types/experiments";

const ACTIVE_EXPERIMENT: ActiveExperiment = {
  id: "finnish-sauna",
  title: "Zone 2 RHR Reset",
  day: 14,
  totalDays: 28,
};

const STATS: ProfileStatsType = {
  completed: 2,
  daysTracked: 47,
};

const DOMAINS: HealthDomain[] = [
  {
    title: "Sleep & Recovery",
    description:
      "Deep sleep and HRV below your potential. Experiments here tend to show results fast.",
    score: 42,
    status: "biggest-opportunity",
    statusLabel: "Biggest opportunity",
    secondaryInfo: "3 experiments available",
  },
  {
    title: "Cardiovascular & Fitness",
    description:
      "RHR decent but flat. Zone 2 experiment running — early signs look promising.",
    score: 64,
    status: "experiment-active",
    statusLabel: "Experiment active",
    secondaryInfo: "Zone 2 RHR Reset · Day 14",
  },
  {
    title: "Nutrition & Meal Timing",
    description:
      "Earlier Last Meal worked well. Nothing urgent to change.",
    score: 78,
    status: "stable",
    statusLabel: "Stable",
    secondaryInfo: "✓ Last experiment improved RHR",
  },
  {
    title: "Stress & Calm",
    description:
      "HRV patterns suggest elevated baseline stress. Worth exploring breathwork or NSDR.",
    score: 35,
    status: "worth-attention",
    statusLabel: "Worth attention",
    secondaryInfo: "4 experiments available",
  },
  {
    title: "Exercise & Movement",
    description:
      "Consistent lifting habit. Zone 2 cardio now running as an experiment.",
    score: 68,
    status: "solid",
    statusLabel: "Solid",
    secondaryInfo: "2 experiments available",
  },
  {
    title: "Supplements",
    description:
      "No experiments run yet. Magnesium glycinate is a popular starting point.",
    score: null,
    status: "not-started",
    statusLabel: "Not started",
    secondaryInfo: "5 experiments available",
  },
  {
    title: "Light & Circadian",
    description:
      "Morning sunlight and evening dimming. Hard to measure directly but affects everything else.",
    score: null,
    status: "not-started",
    statusLabel: "Not started",
    secondaryInfo: "2 experiments available",
  },
  {
    title: "Breathwork & Cold",
    description:
      "Cold exposure and breathwork protocols. Strong HRV and recovery signals when it works.",
    score: null,
    status: "not-started",
    statusLabel: "Not started",
    secondaryInfo: "3 experiments available",
  },
];

export default function OverviewPage() {
  return (
    <div className="flex flex-col gap-8">
      <div>
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Your health profile
        </span>
        <h1 className="font-serif text-3xl font-semibold tracking-tight text-foreground">
          Where you are today
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Based on your last 30 days of Oura data
        </p>
      </div>

      <div className="flex items-stretch gap-4">
        <div className="flex-1">
          <ActiveExperimentBanner {...ACTIVE_EXPERIMENT} />
        </div>
        <ProfileStats {...STATS} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {DOMAINS.map((domain) => (
          <HealthDomainCard key={domain.title} {...domain} />
        ))}
      </div>
    </div>
  );
}
