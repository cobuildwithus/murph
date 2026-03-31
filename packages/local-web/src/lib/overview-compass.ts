import type { OverviewExperiment, ReadyOverview, OverviewWeeklyStat } from "./overview";

export interface OverviewCompassRow {
  label: string;
  text: string;
}

export function buildOverviewCompass(overview: ReadyOverview): OverviewCompassRow[] {
  const comparableStats = overview.weeklyStats
    .filter((stat) => stat.deltaPercent !== null)
    .sort((left, right) => Math.abs(right.deltaPercent ?? 0) - Math.abs(left.deltaPercent ?? 0));
  const biggestShift = comparableStats[0] ?? null;
  const steadyStats = comparableStats
    .filter((stat) => stat !== biggestShift && Math.abs(stat.deltaPercent ?? 0) <= 5)
    .slice(0, 2);
  const activeExperiments = filterActiveExperiments(overview.experiments);
  const topGoal = overview.currentProfile?.topGoals[0] ?? null;
  const recentJournal = overview.recentJournals?.[0] ?? null;
  const recentExperiment = activeExperiments[0] ?? null;

  return [
    {
      label: "What changed",
      text: describePrimaryShift(biggestShift),
    },
    {
      label: "What stayed steady",
      text: describeSteadySignals(steadyStats, comparableStats.length),
    },
    {
      label: "Likely context",
      text: describeContext({
        experiment: recentExperiment,
        journalSummary: recentJournal?.summary ?? null,
        profileSummary: overview.currentProfile?.summary ?? null,
      }),
    },
    {
      label: "Worth trying",
      text: describeWorthTrying({
        activeExperiments,
        topGoalTitle: topGoal?.title ?? null,
      }),
    },
    {
      label: "Leave alone",
      text: describeLeaveAlone({
        activeExperimentCount: activeExperiments.length,
        biggestShift,
      }),
    },
  ];
}

export function buildInvestigationSurfaceNote(experiments: readonly OverviewExperiment[]): string {
  const activeExperiments = filterActiveExperiments(experiments);
  if (activeExperiments.length > 1) {
    return "More than one active investigation makes signal harder to read.";
  }

  if (activeExperiments.length === 1) {
    return "Keep the current investigation simple long enough to learn something from it.";
  }

  return "Use investigations to test one lightweight change at a time.";
}

function describePrimaryShift(stat: OverviewWeeklyStat | null): string {
  if (!stat || stat.deltaPercent === null) {
    return "Not enough prior-week data yet to call a meaningful shift.";
  }

  const absoluteDelta = Math.abs(stat.deltaPercent);
  const statSummary = summarizeWeeklyStat(stat);

  if (absoluteDelta < 8) {
    return `${statSummary}. It is the biggest visible move, but it is still modest.`;
  }

  return `${statSummary}.`;
}

function describeSteadySignals(
  steadyStats: readonly OverviewWeeklyStat[],
  comparableCount: number,
): string {
  if (steadyStats.length > 0) {
    const labels = steadyStats.map((stat) => humanizeToken(stat.stream));
    const joined =
      labels.length === 1
        ? labels[0]
        : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;

    return `${joined} stayed within ordinary week-to-week range.`;
  }

  if (comparableCount > 1) {
    return "Most of the visible movement is concentrated in one area. The rest does not look especially dramatic yet.";
  }

  return "Let another week fill in before looking for stable baselines.";
}

function describeContext(input: {
  experiment: OverviewExperiment | null;
  journalSummary: string | null;
  profileSummary: string | null;
}): string {
  if (input.journalSummary) {
    return `Recent notes: ${ensureSentence(input.journalSummary)}`;
  }

  if (input.experiment?.summary) {
    return `${input.experiment.title}: ${ensureSentence(input.experiment.summary)}`;
  }

  if (input.profileSummary) {
    return ensureSentence(input.profileSummary);
  }

  return "Read the week in the context of sleep, meals, stress, illness, work, travel, and other real-life shifts rather than treating one metric as the whole story.";
}

function describeWorthTrying(input: {
  activeExperiments: readonly OverviewExperiment[];
  topGoalTitle: string | null;
}): string {
  if (input.activeExperiments.length > 1) {
    return "Keep one investigation in focus before adding another.";
  }

  if (input.activeExperiments.length === 1) {
    return `Stay with ${input.activeExperiments[0]?.title ?? "the current investigation"} long enough to get a cleaner read before stacking anything else.`;
  }

  if (input.topGoalTitle) {
    return `Keep ${input.topGoalTitle} as the main anchor instead of browsing for extra protocols.`;
  }

  return "If you change anything next week, make it one lightweight, reversible change.";
}

function describeLeaveAlone(input: {
  activeExperimentCount: number;
  biggestShift: OverviewWeeklyStat | null;
}): string {
  if (input.activeExperimentCount > 1) {
    return "Do not add a new experiment until the current ones settle down enough to read.";
  }

  if (!input.biggestShift || input.biggestShift.deltaPercent === null) {
    return "Skip reacting to thin data. Let the week fill in first.";
  }

  if (Math.abs(input.biggestShift.deltaPercent) < 8) {
    return "This mostly looks like normal week-to-week variation, so it is probably not worth optimizing right now.";
  }

  return "No need to chase every metric at once. Keep the rest of the week simple unless something clearly needs attention.";
}

function summarizeWeeklyStat(stat: OverviewWeeklyStat): string {
  const formattedValue = stat.currentWeekAvg === null ? "—" : formatNumber(stat.currentWeekAvg);
  const unit = stat.unit ? ` ${stat.unit}` : "";
  const deltaPercent = stat.deltaPercent ?? 0;
  const direction = deltaPercent >= 0 ? "up" : "down";
  const delta = `${Math.abs(deltaPercent).toFixed(1)}%`;

  return `${humanizeToken(stat.stream)} averaged ${formattedValue}${unit} this week, ${direction} ${delta} versus last week`;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function humanizeToken(value: string): string {
  return value
    .split(/[_-]+/u)
    .filter((part) => part.length > 0)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function ensureSentence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  return /[.!?]$/u.test(trimmed) ? trimmed : `${trimmed}.`;
}

export function filterActiveExperiments(
  experiments: readonly OverviewExperiment[],
): OverviewExperiment[] {
  return experiments.filter(isActiveExperiment);
}

function isActiveExperiment(experiment: OverviewExperiment): boolean {
  return experiment.status?.trim().toLowerCase() === "active";
}
