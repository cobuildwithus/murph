import type { ReactNode } from "react";
import { Check } from "lucide-react";

import type { Experiment } from "@/src/types/experiments";

interface ExperimentSummaryTilesProps {
  experiment: Experiment;
}

interface SummaryDatum {
  key: "baseline" | "experiment" | "next" | "sessions";
  label: string;
  value: ReactNode;
  detail?: ReactNode;
}

export function ExperimentSummaryTiles({ experiment }: ExperimentSummaryTilesProps) {
  const data = getSummaryData(experiment);

  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-5 lg:grid-cols-4 lg:divide-x lg:divide-border/50">
      {data.map((datum) => (
        <div
          key={datum.key}
          className="flex flex-col gap-1 lg:px-6 lg:first:pl-0 lg:last:pr-0"
        >
          <dt className="font-mono text-[10px] uppercase tracking-widest text-chart-5">
            {datum.label}
          </dt>
          <dd className="text-sm font-semibold text-foreground">{datum.value}</dd>
          {datum.detail && (
            <dd className="text-[12px] text-muted-foreground">{datum.detail}</dd>
          )}
        </div>
      ))}
    </dl>
  );
}

function getSummaryData(experiment: Experiment): SummaryDatum[] {
  const { baselineDays, durationDays, day, dateRange, nextStep, schedule } = experiment;
  const inBaseline = baselineDays > 0 && day != null && day <= baselineDays;
  const tallies = tallySchedule(schedule);

  return [
    {
      key: "baseline",
      label: "Baseline",
      value: renderBaselineValue({ baselineDays, day }),
      detail: `${baselineDays} days`,
    },
    {
      key: "experiment",
      label: inBaseline ? "Protocol" : "Experiment",
      value: renderExperimentValue({ baselineDays, durationDays, day, inBaseline }),
      detail: dateRange,
    },
    {
      key: "next",
      label: "Next session",
      value: nextStep?.when ?? "—",
      detail: nextStep ? nextStep.title : "No upcoming session",
    },
    {
      key: "sessions",
      label: "Sessions",
      value: tallies && tallies.total > 0
        ? `${tallies.completed} of ${tallies.total} done`
        : "—",
      detail: renderSessionsDetail(tallies),
    },
  ];
}

function renderBaselineValue({
  baselineDays,
  day,
}: {
  baselineDays: number;
  day: number | undefined;
}): ReactNode {
  if (day == null) return "Not started";
  if (day > baselineDays) {
    return (
      <span className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="inline-flex size-5 items-center justify-center rounded-full bg-ring/15 text-ring"
        >
          <Check className="size-3" strokeWidth={3} />
        </span>
        Completed
      </span>
    );
  }
  return `Day ${day} of ${baselineDays}`;
}

function renderExperimentValue({
  baselineDays,
  durationDays,
  day,
  inBaseline,
}: {
  baselineDays: number;
  durationDays: number;
  day: number | undefined;
  inBaseline: boolean;
}): string {
  if (day == null) return `${durationDays}-day protocol`;
  if (inBaseline) return `Starts day ${baselineDays + 1}`;
  return `Day ${day} of ${durationDays}`;
}

function renderSessionsDetail(tallies: ScheduleTallies | null): ReactNode {
  if (!tallies) return "No schedule";
  if (
    tallies.partial === 0
    && tallies.missed === 0
    && tallies.skipped === 0
    && tallies.scheduled === 0
  ) {
    return "On track";
  }

  return (
    <span className="flex flex-wrap gap-x-3 gap-y-1">
      {tallies.partial > 0 && (
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-1.5 rounded-full bg-amber-500" />
          {tallies.partial} partial
        </span>
      )}
      {tallies.missed > 0 && (
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-1.5 rounded-full bg-destructive" />
          {tallies.missed} missed
        </span>
      )}
      {tallies.skipped > 0 && (
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-1.5 rounded-full bg-muted-foreground" />
          {tallies.skipped} skipped
        </span>
      )}
      {tallies.scheduled > 0 && (
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-1.5 rounded-full border border-ring/50" />
          {tallies.scheduled} scheduled
        </span>
      )}
    </span>
  );
}

interface ScheduleTallies {
  completed: number;
  partial: number;
  missed: number;
  skipped: number;
  scheduled: number;
  total: number;
}

function tallySchedule(schedule: Experiment["schedule"]): ScheduleTallies | null {
  if (!schedule) return null;

  const counts = schedule.weeks
    .flatMap((week) => week.cells)
    .reduce(
      (acc, cell) => {
        if (cell.kind === "completed") acc.completed += 1;
        if (cell.kind === "partial") acc.partial += 1;
        if (cell.kind === "missed") acc.missed += 1;
        if (cell.kind === "skipped") acc.skipped += 1;
        if (cell.kind === "scheduled") acc.scheduled += 1;
        return acc;
      },
      { completed: 0, partial: 0, missed: 0, skipped: 0, scheduled: 0 },
    );

  return {
    ...counts,
    total: counts.completed + counts.partial + counts.missed + counts.skipped + counts.scheduled,
  };
}
