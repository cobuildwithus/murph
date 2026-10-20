"use client";

import {
  PrivateRunResultsView,
  PrivateRunRouteState,
} from "@/app/(dashboard)/experiments/runs/[experimentId]/private-run-results-client";

import {
  ResultsSummary,
  ResultsSummarySkeleton,
} from "@/src/components/experiments/experiment-detail/results-summary";

import type {
  ExperimentRunProjection,
  ExperimentSignal,
} from "@/src/types/experiments";

const DESIGN_SIGNAL: ExperimentSignal = {
  baseline: "62 ms baseline",
  delta: "+6 ms",
  direction: "up",
  expected: "Higher recovery signal",
  label: "Recovery variability",
  sentiment: "positive",
  unit: "ms",
  value: "68",
};

const DESIGN_PRIVATE_RUN: ExperimentRunProjection = {
  baselineDays: 3,
  durationDays: 10,
  id: "design-private-run",
  outcomeConfidence: "medium",
  outcomeStatus: "available",
  signals: [DESIGN_SIGNAL],
  slug: "design-private-run",
  snapshotGeneratedAt: "2026-08-01T12:00:00.000Z",
  source: "browser-vault",
  startedOn: "2026-07-20",
  status: "finished",
  statusLabel: "Completed",
  summary: "The synthetic recovery signal moved above its baseline.",
  tags: ["synthetic"],
  timeline: [],
  timingKnown: true,
  title: "Evening wind-down practice",
  trends: [],
};

function StudyState({
  children,
  label,
  state,
}: {
  children: React.ReactNode;
  label: string;
  state: string;
}) {
  return (
    <div
      className="min-w-0 space-y-4 rounded-2xl border border-border bg-background p-5 sm:p-7"
      data-design-state={state}
    >
      <p className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </p>
      {children}
    </div>
  );
}

function TransitionStudy({
  children,
  description,
  title,
  transition,
}: {
  children: React.ReactNode;
  description: string;
  title: string;
  transition: string;
}) {
  return (
    <section className="space-y-5" data-design-transition={transition}>
      <header className="max-w-3xl space-y-2">
        <h3 className="font-serif text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          {title}
        </h3>
        <p className="text-sm leading-6 text-muted-foreground sm:text-base">
          {description}
        </p>
      </header>
      {children}
    </section>
  );
}

export function BrowserVaultLoadingTransitionsStudy() {
  return (
    <div
      className="space-y-12"
      data-design-section="browser-vault-loading-transitions"
      id="browser-vault-loading-transitions"
      inert
    >
      <TransitionStudy
        description="The measured-change skeleton keeps the final summary's hierarchy and width while private metric buckets arrive."
        title="Experiment summary"
        transition="experiment-summary"
      >
        <div className="grid gap-5 xl:grid-cols-2">
          <StudyState label="Loading" state="loading">
            <ResultsSummarySkeleton />
          </StudyState>
          <StudyState label="Content" state="content">
            <ResultsSummary signals={[DESIGN_SIGNAL]} trends={[]} />
          </StudyState>
        </div>
      </TransitionStudy>

      <TransitionStudy
        description="The private run route keeps an explicit wait, recovery state, and saved result without exposing member data."
        title="Private experiment route"
        transition="private-experiment"
      >
        <div className="grid gap-5 xl:grid-cols-2">
          <StudyState label="Loading" state="loading">
            <PrivateRunRouteState error={null} loading />
          </StudyState>
          <StudyState label="Error" state="error">
            <PrivateRunRouteState
              error="This synthetic private experiment could not be opened."
              loading={false}
            />
          </StudyState>
          <StudyState label="Result" state="result">
            <PrivateRunResultsView
              error={null}
              privateRun={DESIGN_PRIVATE_RUN}
              status="ready"
            />
          </StudyState>
        </div>
      </TransitionStudy>

    </div>
  );
}
