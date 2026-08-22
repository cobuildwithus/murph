import type { ReactNode } from "react";
import { Check } from "lucide-react";

import type {
  ExperimentNextStep,
  ExperimentRunProjection,
  ExperimentSchedule,
} from "@/src/types/experiments";
import { countScheduleCellOccurrences } from "@/src/lib/experiments/schedule-occurrences";

interface ExperimentSummaryTilesProps {
  experiment: ExperimentSummaryTilesExperiment;
}

interface ExperimentSummaryTilesExperiment {
  baselineDays: number;
  dateRange?: string;
  day?: number;
  durationDays?: number;
  nextStep?: ExperimentNextStep;
  privateRun?: Pick<
    ExperimentRunProjection,
    "baselineDays" | "durationDays" | "timingKnown"
  >;
  schedule?: ExperimentSchedule;
}

interface SummaryDatum {
  key: "baseline" | "experiment" | "next" | "adherence";
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

function getSummaryData(experiment: ExperimentSummaryTilesExperiment): SummaryDatum[] {
  const { day, dateRange, nextStep, schedule } = experiment;
  const hasSavedTiming = experiment.privateRun?.timingKnown === true;
  const baselineDays = hasSavedTiming
    ? experiment.privateRun?.baselineDays ?? 0
    : experiment.baselineDays;
  const durationDays = hasSavedTiming
    ? experiment.privateRun?.durationDays
    : experiment.durationDays;
  const inBaseline = baselineDays > 0 && day != null && day <= baselineDays;
  const tallies = tallySchedule(schedule);

  if (experiment.privateRun?.timingKnown === false) {
    return [
      {
        key: "experiment",
        label: "Experiment",
        value: "Timing unavailable",
        detail: "Original phase timing is incomplete",
      },
      {
        key: "next",
        label: "Next target",
        value: nextStep?.when ?? "—",
        detail: nextStep ? nextStep.title : "No upcoming target",
      },
      {
        key: "adherence",
        label: "Adherence",
        value: tallies && tallies.total > 0
          ? `${tallies.done} of ${tallies.total} done`
          : "—",
        detail: renderAdherenceDetail(tallies),
      },
    ];
  }

  const baselineCompleted = day != null && day > baselineDays;

  return [
    ...(!baselineCompleted
      ? [{
          key: "baseline" as const,
          label: "Baseline",
          value: renderBaselineValue({ baselineDays, day }),
          detail: `${baselineDays} days`,
        }]
      : []),
    {
      key: "experiment",
      label: inBaseline ? "Protocol" : "Experiment",
      value: renderExperimentValue({ baselineDays, durationDays, day, inBaseline }),
      detail: dateRange,
    },
    {
      key: "next",
      label: "Next target",
      value: nextStep?.when ?? "—",
      detail: nextStep ? nextStep.title : "No upcoming target",
    },
    {
      key: "adherence",
      label: "Adherence",
      value: tallies && tallies.total > 0
        ? `${tallies.done} of ${tallies.total} done`
        : "—",
      detail: renderAdherenceDetail(tallies),
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
  durationDays: number | undefined;
  day: number | undefined;
  inBaseline: boolean;
}): string {
  if (day == null) return durationDays ? `${durationDays}-day protocol` : "Collecting data";
  if (inBaseline) return `Starts day ${baselineDays + 1}`;
  return durationDays ? `Day ${day} of ${durationDays}` : `Day ${day}`;
}

function renderAdherenceDetail(tallies: ScheduleTallies | null): ReactNode {
  if (!tallies) return "No schedule";
  if (
    tallies.partial === 0
    && tallies.missed === 0
    && tallies.failed === 0
    && tallies.unknown === 0
    && tallies.scheduled === 0
  ) {
    if (tallies.assumed > 0) {
      return tallies.completed === 0
        ? `${tallies.done} done, all assumed`
        : `${tallies.done} done, ${tallies.assumed} assumed`;
    }
    return "On track";
  }

  return (
    <span className="flex flex-wrap gap-x-3 gap-y-1">
      {tallies.assumed > 0 && (
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-1.5 rounded-full bg-chart-4/70" />
          {tallies.assumed} assumed
        </span>
      )}
      {tallies.partial > 0 && (
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-1.5 rounded-full bg-amber-500" />
          {tallies.partial} partial
        </span>
      )}
      {tallies.missed > 0 && (
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-1.5 rounded-full bg-destructive" />
          {tallies.missed} not logged
        </span>
      )}
      {tallies.failed > 0 && (
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-1.5 rounded-full bg-destructive/70" />
          {tallies.failed} not met
        </span>
      )}
      {tallies.unknown > 0 && (
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-1.5 rounded-full bg-muted-foreground" />
          {tallies.unknown} unknown
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
  assumed: number;
  completed: number;
  done: number;
  partial: number;
  missed: number;
  failed: number;
  unknown: number;
  scheduled: number;
  total: number;
}

function tallySchedule(schedule: ExperimentSchedule | undefined): ScheduleTallies | null {
  if (!schedule) return null;

  const counts = schedule.weeks
    .flatMap((week) => week.cells)
    .reduce(
      (acc, cell) => {
        acc.completed += countScheduleCellOccurrences(cell, "completed");
        acc.assumed += countScheduleCellOccurrences(cell, "assumed");
        acc.partial += countScheduleCellOccurrences(cell, "partial");
        acc.missed += countScheduleCellOccurrences(cell, "missed");
        acc.failed += countScheduleCellOccurrences(cell, "failed");
        acc.unknown += countScheduleCellOccurrences(cell, "unknown");
        acc.scheduled += countScheduleCellOccurrences(cell, "scheduled");
        return acc;
      },
      { assumed: 0, completed: 0, partial: 0, missed: 0, failed: 0, unknown: 0, scheduled: 0 },
    );

  const done = counts.completed + counts.assumed;
  return {
    ...counts,
    done,
    total: done + counts.partial + counts.missed + counts.failed + counts.unknown + counts.scheduled,
  };
}
