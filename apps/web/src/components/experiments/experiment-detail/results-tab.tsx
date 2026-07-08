import type { ReactNode } from "react";

import type { BrowserVaultStatus } from "@/src/lib/browser-vault/context";
import { formatIsoDate } from "@/src/lib/browser-vault/display";
import type { ExperimentStartContactChannels } from "@/src/lib/experiments/start-experiment-contact";
import type {
  ExperimentConclusionSection,
  ExperimentRunContextEntry,
  ExperimentRunProjection,
  ExperimentSchedule as ExperimentScheduleModel,
  ExperimentSignal,
  ExperimentStatus,
  TimelineEvent,
  TrendData,
} from "@/src/types/experiments";
import { Button } from "@/src/components/ui/button";
import { ConclusionCard } from "@/src/components/conclusion-card";
import { ExperimentSummaryTiles } from "./experiment-summary-tiles";
import { ResultsSummary, ResultsSummarySkeleton } from "./results-summary";
import { StartExperimentButton } from "./start-experiment-button";

interface ResultsTabProps {
  experiment: ResultsTabExperiment;
  initialContactChannels?: Partial<ExperimentStartContactChannels> | null;
  murphPhoneNumber?: string | null;
  onPrivateRunRetry?: () => Promise<void>;
  privateRunError: string | null;
  privateRunStatus: BrowserVaultStatus;
  startAction?: ReactNode;
}

export interface ResultsTabExperiment {
  analysisAvailableOn?: string;
  baselineDays: number;
  conclusions?: ExperimentConclusionSection[];
  dateRange?: string;
  day?: number;
  durationDays: number;
  nextStep?: ExperimentRunProjection["nextStep"];
  privateRun?: ExperimentRunProjection;
  schedule?: ExperimentScheduleModel;
  sessionContext?: ExperimentRunContextEntry[];
  signals: ExperimentSignal[];
  status: ExperimentStatus;
  summary?: string;
  summaryDetail?: string;
  timeline: TimelineEvent[];
  title: string;
  trends: TrendData[];
}

export function ResultsTab({
  experiment,
  initialContactChannels,
  murphPhoneNumber,
  onPrivateRunRetry,
  privateRunError,
  privateRunStatus,
  startAction,
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
        <div className="flex flex-col gap-4">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Loading your private run
          </p>
          <ResultsSummarySkeleton />
        </div>
      )}

      {!hasPrivateRun && privateRunStatus === "error" && (
        <ResultsEmptyState
          title="Your private results couldn't load"
          body={privateRunError ?? "We couldn't unlock your private results right now. The protocol details are still available."}
          action={onPrivateRunRetry
            ? <Button size="sm" variant="outline" onClick={() => void onPrivateRunRetry()}>Retry</Button>
            : null}
        />
      )}

      {!hasPrivateRun && (privateRunStatus === "ready" || privateRunStatus === "empty") && (
        <ResultsEmptyState
          title="Run this on yourself"
          body="You're previewing the public protocol. Start the experiment to track your own baseline, sessions, and outcomes — kept private on this device."
          action={
            startAction ?? (
              <StartExperimentButton
                initialContactChannels={initialContactChannels}
                murphPhoneNumber={murphPhoneNumber}
                protocolDays={formatProtocolDays(experiment.durationDays, experiment.baselineDays)}
                protocolTitle={experiment.title}
              />
            )
          }
        />
      )}

      {hasPrivateRun && privateRunError && (
        <ResultsEmptyState
          title="Your results loaded, but couldn't refresh"
          body={privateRunError}
          action={onPrivateRunRetry
            ? <Button size="sm" variant="outline" onClick={() => void onPrivateRunRetry()}>Retry</Button>
            : null}
        />
      )}

      {hasPrivateRun && !hasPersonalOutcomeData && (
        <ResultsEmptyState
          title={isFinished
            ? "No before-and-after comparison yet"
            : isPaused
              ? "Your experiment is paused"
              : isStopped
                ? "Your experiment was stopped"
                : "You're running this experiment"}
          body={isFinished
            ? "Your run is saved privately on this device, but there isn't enough before-and-after biomarker data to compare yet."
            : isPaused
              ? "Your run is saved privately on this device. Resume it to keep following the protocol and see outcomes here later."
              : isStopped
                ? "This experiment was stopped before there was enough data to compare before and after."
                : "Outcome cards will appear here once there's enough measured data to compare."}
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

      {hasPrivateRun && isRunnable ? (
        <ExperimentSummaryTiles experiment={experiment} />
      ) : null}

      <ResultsSummary
        signals={experiment.signals}
        trends={experiment.trends}
        schedule={experiment.schedule}
      />

      {hasPrivateRun && experiment.sessionContext && experiment.sessionContext.length > 0 && (
        <RunContextPanel entries={experiment.sessionContext} />
      )}

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

function RunContextPanel({ entries }: { entries: ExperimentRunContextEntry[] }) {
  const visibleEntries = entries.slice(-6);
  const extraCount = entries.length - visibleEntries.length;

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Worth knowing
          </span>
          <h3 className="font-serif text-xl font-semibold text-foreground">
            Other factors and notes
          </h3>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {entries.length} logged
        </span>
      </div>

      <div className="flex flex-col divide-y divide-border/50">
        {visibleEntries.map((entry) => (
          <RunContextRow key={entry.id} entry={entry} />
        ))}
      </div>

      {extraCount > 0 && (
        <p className="text-xs text-muted-foreground">
          {extraCount} earlier {extraCount === 1 ? "note" : "notes"} saved privately on this device.
        </p>
      )}
    </section>
  );
}

function RunContextRow({ entry }: { entry: ExperimentRunContextEntry }) {
  const label = entry.kind === "session" ? "Session" : "Context";
  const title = entry.kind === "session" ? "Session log" : "Context note";

  return (
    <div className="grid gap-3 py-3 first:pt-0 last:pb-0 sm:grid-cols-[92px_1fr]">
      <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {formatIsoDate(entry.date, { day: "numeric", month: "short" })}
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="font-serif text-base font-semibold text-foreground">
            {title}
          </span>
          <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
            {label}
          </span>
        </div>
        {entry.note && (
          <p className="text-sm/5 text-muted-foreground">
            {entry.note}
          </p>
        )}
        {(entry.confounders.length > 0 || entry.symptoms.length > 0) && (
          <div className="flex flex-wrap gap-1.5">
            {entry.confounders.map((confounder) => (
              <span
                key={`confounder:${confounder}`}
                className="rounded-md bg-secondary/20 px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-foreground/75"
              >
                {confounder}
              </span>
            ))}
            {entry.symptoms.map((symptom) => (
              <span
                key={`symptom:${symptom}`}
                className="rounded-md border border-border px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground"
              >
                {symptom}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function formatProtocolDays(durationDays: number, baselineDays: number): number {
  return Math.max(1, durationDays - baselineDays);
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
