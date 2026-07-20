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
  durationDays?: number;
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
  const savedOutcomeStatus = experiment.privateRun?.outcomeStatus;

  return (
    <div className="flex flex-col gap-10">
      <header className="flex max-w-3xl flex-col gap-2">
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Private experiment
        </span>
        <h2 className="font-serif text-2xl/8 font-semibold text-foreground">
          Your results
        </h2>
        <p className="text-sm/6 text-muted-foreground sm:text-base/7">
          Your progress, measurements, and conclusions for this experiment stay private in your vault.
        </p>
      </header>

      {!hasPrivateRun && privateRunStatus === "loading" && (
        <div
          aria-busy="true"
          aria-live="polite"
          className="flex flex-col gap-4"
          role="status"
        >
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Loading your results
          </p>
          <ResultsSummarySkeleton />
        </div>
      )}

      {!hasPrivateRun && privateRunStatus === "error" && (
        <ResultsEmptyState
          alert
          title="Your results couldn't load"
          body={privateRunError ?? "We couldn't unlock your private results right now. The protocol details are still available."}
          action={onPrivateRunRetry
            ? <Button size="sm" variant="outline" onClick={() => void onPrivateRunRetry()}>Retry</Button>
            : null}
        />
      )}

      {!hasPrivateRun && (privateRunStatus === "ready" || privateRunStatus === "empty") && (
        <ResultsEmptyState
          title="No results for this protocol yet"
          body="Start this experiment to create a private baseline and outcome summary in your vault."
          action={
            startAction ?? (
              <StartExperimentButton
                initialContactChannels={initialContactChannels}
                murphPhoneNumber={murphPhoneNumber}
                protocolDays={formatProtocolDays(
                  experiment.durationDays ?? experiment.baselineDays + 1,
                  experiment.baselineDays,
                )}
                protocolTitle={experiment.title}
              />
            )
          }
        />
      )}

      {hasPrivateRun && privateRunError && (
        <ResultsEmptyState
          alert
          title="Showing saved results"
          body={`Refresh failed. ${privateRunError}`}
          action={onPrivateRunRetry
            ? <Button size="sm" variant="outline" onClick={() => void onPrivateRunRetry()}>Retry</Button>
            : null}
        />
      )}

      {hasPrivateRun && !hasPersonalOutcomeData && !isStopped && (
        <ResultsEmptyState
          title={isFinished
            ? savedOutcomeStatus === "pending"
              ? "Your saved analysis is still pending"
              : savedOutcomeStatus === "unavailable"
                ? "Your saved analysis isn't available in this snapshot"
                : "Run complete, but there isn't enough data for a clear comparison"
            : isPaused
              ? "Your experiment is paused"
              : "You're running this experiment"}
          body={isFinished
            ? savedOutcomeStatus === "pending"
              ? "Your completed run is safely recorded in your vault. Its canonical outcome analysis has not been saved yet."
              : savedOutcomeStatus === "unavailable"
                ? "Your completed run is safely recorded, but its referenced canonical outcome could not be loaded from this private snapshot."
                : savedOutcomeStatus === "available"
                  ? "Your canonical saved analysis is shown below, but it did not include comparable metric windows to chart."
                  : "Your run is saved privately in your vault, but it does not have a canonical saved outcome to render."
            : isPaused
              ? "Your run is saved privately in your vault. Resume it to keep following the protocol and see outcomes here later."
              : "Outcome cards will appear here once there's enough measured data to compare."}
        />
      )}

      {hasPrivateRun && isStopped && (
        <ResultsEmptyState
          title="Your experiment was stopped"
          body={hasPersonalOutcomeData
            ? "This run ended before the full protocol window. Measurements below are partial context, not a completed before-and-after result."
            : "This run stopped before there was enough data to compare."}
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
                Early days. Keep logging sessions and trend signals will start showing here.
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
          {extraCount} earlier {extraCount === 1 ? "note" : "notes"} saved privately in your vault.
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
  alert = false,
  title,
  body,
}: {
  action?: ReactNode;
  alert?: boolean;
  title: string;
  body: string;
}) {
  return (
    <div
      className="rounded-xl border border-border bg-card p-6"
      role={alert ? "alert" : undefined}
    >
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
