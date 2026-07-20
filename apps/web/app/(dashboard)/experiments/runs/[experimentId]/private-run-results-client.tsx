"use client";

import Link from "next/link";
import { useMemo } from "react";

import {
  ResultsTab,
  type ResultsTabExperiment,
} from "@/src/components/experiments/experiment-detail/results-tab";
import { ResultsSummarySkeleton } from "@/src/components/experiments/experiment-detail/results-summary";
import { Button } from "@/src/components/ui/button";
import { formatIsoDate } from "@/src/lib/browser-vault/display";
import { useBrowserVault } from "@/src/lib/browser-vault/context";
import { resolveBrowserVaultExperimentRunById } from "@/src/lib/browser-vault/experiment-run";

export function PrivateRunResultsClient({ experimentId }: { experimentId: string }) {
  const browserVault = useBrowserVault();
  const privateRun = useMemo(
    () => resolveBrowserVaultExperimentRunById({
      client: browserVault.client,
      experimentId,
    }),
    [browserVault.client, experimentId],
  );

  if (!privateRun) {
    return (
      <PrivateRunRouteState
        error={browserVault.error}
        loading={browserVault.status === "loading"}
        onRetry={browserVault.refresh}
      />
    );
  }

  const experiment: ResultsTabExperiment = {
    analysisAvailableOn: privateRun.analysisAvailableOn,
    baselineDays: privateRun.baselineDays ?? 0,
    conclusions: privateRun.conclusions,
    dateRange: privateRun.dateRange,
    day: privateRun.day,
    durationDays: privateRun.durationDays,
    nextStep: privateRun.nextStep,
    privateRun,
    schedule: privateRun.schedule,
    sessionContext: privateRun.sessionContext,
    signals: privateRun.signals,
    status: privateRun.status,
    summary: privateRun.summary,
    summaryDetail: privateRun.summaryDetail,
    timeline: privateRun.timeline,
    title: privateRun.title,
    trends: privateRun.trends,
  };
  const startedLabel = privateRun.startedOn
    ? `Started ${formatIsoDate(privateRun.startedOn)}`
    : null;

  return (
    <div className="flex flex-col gap-10">
      <header className="flex max-w-3xl flex-col gap-3">
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Private vault
        </span>
        <h1 className="font-serif text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          {privateRun.title}
        </h1>
        <p className="text-sm text-muted-foreground">
          {[privateRun.statusLabel, startedLabel].filter(Boolean).join(" · ")}
        </p>
      </header>

      <ResultsTab
        experiment={experiment}
        onPrivateRunRetry={browserVault.refresh}
        privateRunError={browserVault.error}
        privateRunStatus={browserVault.status}
      />
    </div>
  );
}

function PrivateRunRouteState({
  error,
  loading,
  onRetry,
}: {
  error: string | null;
  loading: boolean;
  onRetry: () => Promise<void>;
}) {
  if (loading) {
    return (
      <div aria-busy="true" className="flex max-w-3xl flex-col gap-5" role="status">
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Private experiment
        </span>
        <h1 className="font-serif text-3xl font-semibold text-foreground">
          Loading your experiment
        </h1>
        <ResultsSummarySkeleton />
      </div>
    );
  }

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        Private experiment
      </span>
      <h1 className="font-serif text-3xl font-semibold text-foreground">
        {error ? "Your experiment couldn't load" : "Experiment not found"}
      </h1>
      <p className="max-w-2xl text-sm/6 text-muted-foreground sm:text-base/7">
        {error
          ? error
          : "This private run is not available in the current vault snapshot."}
      </p>
      <div className="flex flex-wrap gap-3">
        {error ? (
          <Button variant="outline" onClick={() => void onRetry()}>
            Retry
          </Button>
        ) : null}
        <Button render={<Link href="/home" />} nativeButton={false}>
          Back to home
        </Button>
      </div>
    </div>
  );
}
