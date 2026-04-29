import type { ReactNode } from "react";

import type { BrowserVaultStatus } from "@/src/lib/browser-vault/context";
import { formatIsoDate } from "@/src/lib/browser-vault/display";
import type { Experiment } from "@/src/types/experiments";
import { Button } from "@/src/components/ui/button";
import { MetricCard } from "@/src/components/ui/metric-card";
import { ConclusionCard } from "@/src/components/conclusion-card";
import { ExperimentSchedule } from "./experiment-schedule";
import { ExperimentSummaryTiles } from "./experiment-summary-tiles";
import { TrendChart } from "./trend-chart";
import { ExperimentTimeline } from "./experiment-timeline";

interface ResultsTabProps {
  experiment: Experiment;
  onPrivateRunRetry?: () => Promise<void>;
  privateRunError: string | null;
  privateRunStatus: BrowserVaultStatus;
}

export function ResultsTab({
  experiment,
  onPrivateRunRetry,
  privateRunError,
  privateRunStatus,
}: ResultsTabProps) {
  const isActive = experiment.status === "active";
  const isPaused = experiment.status === "paused";
  const isFinished = experiment.status === "finished";
  const isStopped = experiment.status === "stopped";
  const isRunnable = isActive || isPaused;
  const hasPrivateRun = Boolean(experiment.privateRun);
  const hasPersonalOutcomeData = experiment.signals.length > 0 || experiment.trends.length > 0;

  return (
    <div className="flex flex-col gap-10">
      {!hasPrivateRun && privateRunStatus === "loading" && (
        <ResultsEmptyState
          title="Loading your private run"
          body="The public protocol is loaded. Murph is checking your encrypted browser-vault snapshot for an active or finished run linked to this protocol."
        />
      )}

      {!hasPrivateRun && privateRunStatus === "error" && (
        <ResultsEmptyState
          title="Protocol loaded, private run unavailable"
          body={privateRunError ?? "Your private experiment state could not be decrypted right now. The protocol details are still available."}
          action={onPrivateRunRetry
            ? <Button size="sm" variant="outline" onClick={() => void onPrivateRunRetry()}>Retry</Button>
            : null}
        />
      )}

      {!hasPrivateRun && (privateRunStatus === "ready" || privateRunStatus === "empty") && (
        <ResultsEmptyState
          title="No private run yet"
          body="This page is showing Health Commons protocol data. Once you start this experiment, your browser-vault run state can attach here without copying the public protocol data."
        />
      )}

      {hasPrivateRun && privateRunError && (
        <ResultsEmptyState
          title="Private run loaded, refresh unavailable"
          body={privateRunError}
          action={onPrivateRunRetry
            ? <Button size="sm" variant="outline" onClick={() => void onPrivateRunRetry()}>Retry</Button>
            : null}
        />
      )}

      {hasPrivateRun && !hasPersonalOutcomeData && (
        <ResultsEmptyState
          title={isFinished
            ? "No biomarker comparison exported yet"
            : isPaused
              ? "Private run paused"
              : isStopped
                ? "Private run stopped"
                : "Private run linked"}
          body={isFinished
            ? "This run is present in your browser vault, but the dashboard snapshot does not include enough baseline-vs-protocol biomarker data yet."
            : isPaused
              ? "This private run is still in your browser vault, but it is paused. Resume it there to continue the protocol and export outcome comparisons later."
              : isStopped
                ? "This private run remains in your browser vault, but it was stopped before a browser-vault comparison was exported to the dashboard."
                : "This private run is attached to the exact Health Commons protocol revision. Outcome cards will appear when the browser-vault snapshot includes measured comparisons."}
        />
      )}

      {isRunnable && <ExperimentSummaryTiles experiment={experiment} />}

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

      {experiment.signals.length > 0 && (
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
      )}

      {(experiment.trends.length > 0 || experiment.timeline.length > 0) && (
        <div className="grid gap-4 md:grid-cols-[1fr_340px]">
          <div className="flex flex-col gap-4">
            {experiment.trends.map((trend) => (
              <TrendChart key={trend.label} data={trend} />
            ))}
          </div>
          {experiment.timeline.length > 0 ? <ExperimentTimeline events={experiment.timeline} /> : null}
        </div>
      )}

      {experiment.schedule && <ExperimentSchedule schedule={experiment.schedule} />}

      {isRunnable && (
        <div className="flex flex-col gap-2">
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Running summary
          </span>
          <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-5">
            {experiment.summary ? (
              <>
                <p className="font-serif text-base/6 text-foreground">
                  {experiment.summary}
                </p>
                {experiment.summaryDetail && (
                  <p className="text-sm/5 text-muted-foreground">
                    {experiment.summaryDetail}
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Early days — keep logging sessions and trend signals will start showing here.
              </p>
            )}
            <p className="text-[11px] text-muted-foreground/80">
              Full conclusions{" "}
              {experiment.analysisAvailableOn
                ? `after ${formatIsoDate(experiment.analysisAvailableOn, { day: "numeric", month: "short", year: "numeric" })}`
                : "after the protocol window closes"}
              .
            </p>
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

function ResultsEmptyState({
  action,
  title,
  body,
}: {
  action?: ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="font-serif text-xl font-semibold text-foreground">
            {title}
          </h3>
          <p className="mt-2 text-sm leading-5 text-muted-foreground">
            {body}
          </p>
        </div>
        {action}
      </div>
    </div>
  );
}

