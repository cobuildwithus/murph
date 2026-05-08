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

  return (
    <div className="flex flex-col gap-4">
      {signals.length > 0 && (
        <div className="grid gap-4 md:grid-cols-3">
          {signals.map((signal) => (
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
      )}

      {trends.length > 0 && (
        <div
          className={
            schedule
              ? "grid gap-4 md:grid-cols-[1fr_340px]"
              : "flex flex-col gap-4"
          }
        >
          <div className="flex flex-col gap-4">
            {trends.map((trend) => (
              <TrendChart key={trend.label} data={trend} />
            ))}
          </div>
          {schedule && <div className="self-start"><ExperimentScheduleSidebar schedule={schedule} /></div>}
        </div>
      )}
    </div>
  );
}

function MetricCardSkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-2 rounded-xl bg-muted/50 p-5">
      <Skeleton className="h-3 w-24" />
      <div className="flex items-baseline gap-2">
        <Skeleton className="h-8 w-16" />
        <Skeleton className="h-4 w-20" />
      </div>
      <Skeleton className="h-3 w-16" />
    </div>
  );
}

function TrendChartSkeleton() {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-secondary/25 bg-card/90 p-5">
      <div className="flex items-start justify-between">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-3 w-32" />
      </div>
      <Skeleton className="h-32 w-full rounded-lg" />
      <div className="flex justify-between">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-3 w-20" />
      </div>
    </div>
  );
}

function ScheduleSidebarSkeleton() {
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-secondary/25 bg-card/90 p-5">
      <div className="flex items-center justify-between">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-3 w-24" />
      </div>
      <div className="flex flex-col gap-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="flex flex-col gap-1.5">
            <Skeleton className="h-3 w-14" />
            <div className="flex gap-1.5">
              {Array.from({ length: 7 }, (_, j) => (
                <Skeleton key={j} className="size-7 rounded-md" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ResultsSummarySkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-2">
        <MetricCardSkeleton />
        <MetricCardSkeleton />
      </div>
      <div className="grid gap-4 md:grid-cols-[1fr_340px]">
        <div className="flex flex-col gap-4">
          <TrendChartSkeleton />
          <TrendChartSkeleton />
        </div>
        <ScheduleSidebarSkeleton />
      </div>
    </div>
  );
}
