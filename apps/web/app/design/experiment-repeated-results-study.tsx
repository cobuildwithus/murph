import {
  ExperimentSchedule,
  ExperimentScheduleSidebar,
} from "@/src/components/experiments/experiment-detail/experiment-schedule";
import { ResultsSummary } from "@/src/components/experiments/experiment-detail/results-summary";
import { ExperimentSummaryTiles } from "@/src/components/experiments/experiment-detail/experiment-summary-tiles";
import type { ExperimentSchedule as ExperimentScheduleModel } from "@/src/types/experiments";

const BASELINE_CELL = {
  dayLabel: "",
  kind: "baseline" as const,
};

const DESIGN_REPEATED_RESULTS_SCHEDULE: ExperimentScheduleModel = {
  cadence: "8 sets across the day",
  dose: "5 pull-ups per set",
  loggedSessions: 3,
  weeks: [{
    cells: [
      { ...BASELINE_CELL, dayLabel: "Mon" },
      { ...BASELINE_CELL, dayLabel: "Tue" },
      { ...BASELINE_CELL, dayLabel: "Wed" },
      { ...BASELINE_CELL, dayLabel: "Thu" },
      { ...BASELINE_CELL, dayLabel: "Fri" },
      {
        date: "2026-08-15",
        dayLabel: "Sat",
        detail: "3 of 8",
        isToday: true,
        kind: "partial",
        occurrences: {
          assumed: 0,
          completed: 3,
          expected: 8,
          failed: 0,
          missed: 5,
          partial: 0,
          scheduled: 0,
          unknown: 0,
        },
      },
      { ...BASELINE_CELL, dayLabel: "Sun" },
    ],
    dateRange: "Aug 10 – Aug 16",
    label: "Week 1",
  }],
};

export function ExperimentRepeatedResultsStudy() {
  return (
    <section
      className="overflow-hidden rounded-2xl border border-border bg-background"
      data-design-section="experiment-repeated-results"
      id="experiment-repeated-results"
    >
      <header className="border-b border-border bg-card/70 px-5 py-7 sm:px-8 sm:py-9">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-chart-5">
          Your Results
        </p>
        <h3 className="mt-2 max-w-2xl font-serif text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          Eight sets, one honest day.
        </h3>
        <p className="mt-3 max-w-2xl text-sm/6 text-muted-foreground">
          One calendar cell preserves the day while every planned set stays visible in adherence totals.
        </p>
      </header>

      <div className="flex flex-col gap-8 p-5 sm:p-8">
        <ExperimentSummaryTiles
          experiment={{
            baselineDays: 3,
            dateRange: "Aug 12 – Aug 25",
            day: 4,
            durationDays: 14,
            nextStep: {
              title: "Pull-up set 4 of 8",
              when: "3:30 PM",
            },
            schedule: DESIGN_REPEATED_RESULTS_SCHEDULE,
          }}
        />

        <ResultsSummary
          signals={[
            {
              label: "Repetition benchmark", value: "12", unit: "reps", statistic: "max",
              baseline: "10 reps", delta: "+2 reps", direction: "up", expected: "",
              latestResult: { date: "2026-08-15", value: "9", unit: "reps" },
            },
            {
              label: "Grip endurance", value: "41", unit: "sec", statistic: "mean",
              delta: "", direction: "neutral", expected: "",
              latestResult: { date: "2026-08-15", value: "38", unit: "sec" },
            },
          ]}
          trends={[{
            label: "Repetition benchmark", unit: "reps", startDate: "2026-08-09",
            history: [], baseline: [{ day: 1, value: 8 }, { day: 2, value: 9 }, { day: 3, value: 10 }],
            active: [{ day: 4, value: 12 }, { day: 5, value: 10 }, { day: 7, value: 9 }],
            baselineAvg: 10, currentValue: 12, statistic: "max", delta: "+2 reps",
          }]}
        />

        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_18rem]">
          <ExperimentSchedule schedule={DESIGN_REPEATED_RESULTS_SCHEDULE} />
          <ExperimentScheduleSidebar schedule={DESIGN_REPEATED_RESULTS_SCHEDULE} />
        </div>
      </div>
    </section>
  );
}
