import type { Experiment } from "@/src/types/experiments";
import { MetricCard } from "@/src/components/ui/metric-card";
import { NextStepCard } from "@/src/components/next-step-card";
import { ConclusionCard } from "@/src/components/conclusion-card";
import { ExperimentProgress } from "./experiment-progress";
import { TrendChart } from "./trend-chart";
import { ExperimentTimeline } from "./experiment-timeline";

interface ResultsTabProps {
  experiment: Experiment;
}

export function ResultsTab({ experiment }: ResultsTabProps) {
  const isActive = experiment.status === "active";
  const isFinished = experiment.status === "finished";

  return (
    <div className="flex flex-col gap-10">
      {isActive && (
        <ExperimentProgress
          baselineDays={experiment.baselineDays}
          baselineComplete
          activeDay={experiment.day ?? 1}
          activeTotalDays={experiment.durationDays - experiment.baselineDays}
          overallPercent={experiment.completionPercent ?? 0}
        />
      )}

      {isActive && experiment.nextStep && (
        <NextStepCard
          title={experiment.nextStep.title}
          when={experiment.nextStep.when}
          instructions={experiment.nextStep.instructions}
          context={experiment.nextStep.context}
          nextSession={experiment.nextStep.nextSession}
        />
      )}

      {isFinished && experiment.summary && (
        <div className="rounded-xl border border-border bg-card p-6">
          <h3 className="font-serif text-xl font-semibold text-foreground">
            {experiment.summary}
          </h3>
          <p className="mt-2 text-sm leading-5 text-muted-foreground">
            {experiment.summaryDetail}
          </p>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        {experiment.signals.map((signal) => (
          <MetricCard
            key={signal.label}
            label={signal.label}
            value={signal.value}
            unit={signal.unit}
            delta={signal.delta}
            direction={signal.direction}
            baseline={signal.baseline}
            expected={signal.expected}
          />
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-[1fr_340px]">
        <div className="flex flex-col gap-4">
          {experiment.trends.map((trend) => (
            <TrendChart key={trend.label} data={trend} />
          ))}
        </div>
        <ExperimentTimeline events={experiment.timeline} />
      </div>

      {isActive && (
        <div className="flex flex-col gap-2">
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Conclusions
          </span>
          <div className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
            Available after experiment ends on Apr 5
          </div>
        </div>
      )}

      {isFinished && experiment.conclusions && (
        <div className="flex flex-col gap-3">
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Conclusions
          </span>
          {experiment.conclusions.map((section) => (
            <ConclusionCard
              key={section.title}
              title={section.title}
              variant={section.variant}
              items={section.items}
            />
          ))}
        </div>
      )}
    </div>
  );
}
