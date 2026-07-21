import { MetricCard } from "@/src/components/ui/metric-card";
import { Skeleton } from "@/src/components/ui/skeleton";
import type {
  ExperimentSchedule,
  ExperimentSignal,
  TrendData,
} from "@/src/types/experiments";
import { ExperimentScheduleSidebar } from "./experiment-schedule";
import { TrendChart } from "./trend-chart";

interface ResultsSummaryProps {
  signals: ExperimentSignal[];
  trends: TrendData[];
  schedule?: ExperimentSchedule;
}

export function ResultsSummary({ signals, trends, schedule }: ResultsSummaryProps) {
  if (signals.length === 0 && trends.length === 0) return null;

  const trendLabels = new Set(trends.map((trend) => trend.label));
  const unmatchedSignals = signals.filter((signal) => !trendLabels.has(signal.label));

  return (
    <section className="flex flex-col gap-5">
      <div className="flex max-w-2xl flex-col gap-1.5">
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Measured changes
        </span>
        <h3 className="font-serif text-xl font-semibold text-foreground sm:text-2xl">
          Before and during the experiment
        </h3>
        <p className="text-sm/6 text-muted-foreground">
          Daily measurements where available; saved window averages otherwise.
        </p>
      </div>

      <div
        className={
          schedule
            ? "grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]"
            : "flex flex-col gap-5"
        }
      >
        <div className="flex min-w-0 flex-col gap-4">
          {trends.length > 0 ? (
            <div
              className={
                schedule
                  ? "grid min-w-0 gap-4 xl:grid-cols-2"
                  : "grid min-w-0 gap-4 md:grid-cols-2"
              }
            >
              {trends.map((trend) => (
                <TrendChart
                  key={trend.label}
                  data={trend}
                  signal={signals.find((signal) => signal.label === trend.label)}
                />
              ))}
            </div>
          ) : null}

          {unmatchedSignals.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {unmatchedSignals.map((signal) => (
                <MetricCard
                  key={signal.label}
                  label={signal.label}
                  value={signal.value}
                  unit={signal.unit}
                  delta={signal.delta}
                  direction={signal.direction}
                  sentiment={signal.sentiment}
                  baseline={signal.baseline}
                  expected={signal.expected}
                />
              ))}
            </div>
          ) : null}
        </div>
        {schedule ? (
          <div className="self-start">
            <ExperimentScheduleSidebar schedule={schedule} />
          </div>
        ) : null}
      </div>
    </section>
  );
}

function TrendChartSkeleton() {
  return (
    <div className="flex flex-col gap-5 rounded-xl border border-border bg-card p-5 sm:p-6">
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-2.5 w-28" />
          <div className="flex items-end gap-2">
            <Skeleton className="h-9 w-20" />
            <Skeleton className="h-4 w-10" />
          </div>
        </div>
        <Skeleton className="h-5 w-24 rounded-full" />
      </div>
      <Skeleton className="h-28 w-full rounded-lg" />
      <div className="grid grid-cols-2 gap-4 border-t border-border/70 pt-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="ml-auto h-10 w-full" />
      </div>
    </div>
  );
}

export function ResultsSummarySkeleton() {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-2.5 w-28" />
        <Skeleton className="h-7 w-72 max-w-full" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: 4 }, (_, index) => (
          <TrendChartSkeleton key={index} />
        ))}
      </div>
    </div>
  );
}
