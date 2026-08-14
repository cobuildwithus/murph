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
import {
  isBrowserVaultMetricsCapable,
  useBrowserVault,
  useBrowserVaultExperimentMetricBucketDemand,
  type BrowserVaultStatus,
} from "@/src/lib/browser-vault/context";
import { resolveBrowserVaultExperimentRunById } from "@/src/lib/browser-vault/experiment-run";

export function PrivateRunResultsClient({ experimentId }: { experimentId: string }) {
  const metricBucketsLoaded = useBrowserVaultExperimentMetricBucketDemand({ experimentId });
  const browserVault = useBrowserVault();
  const metricsClient = metricBucketsLoaded
    && isBrowserVaultMetricsCapable(browserVault.client)
    ? browserVault.client
    : null;
  const privateRun = useMemo(
    () => resolveBrowserVaultExperimentRunById({
      client: metricsClient,
      experimentId,
    }),
    [experimentId, metricsClient],
  );

  if (!privateRun) {
    return (
      <PrivateRunRouteState
        error={browserVault.error}
        loading={browserVault.status === "loading"
          || (browserVault.status === "ready" && !metricBucketsLoaded)}
        onRetry={browserVault.refresh}
      />
    );
  }

  return (
    <PrivateRunResultsView
      error={browserVault.error}
      onRetry={browserVault.refresh}
      privateRun={privateRun}
      status={browserVault.status}
    />
  );
}

export function PrivateRunResultsView({
  error,
  onRetry,
  privateRun,
  status,
}: {
  error: string | null;
  onRetry: () => Promise<void>;
  privateRun: NonNullable<ReturnType<typeof resolveBrowserVaultExperimentRunById>>;
  status: BrowserVaultStatus;
}) {
  const experiment: ResultsTabExperiment = {
    analysisAvailableOn: privateRun.analysisAvailableOn,
    baselineDays: privateRun.baselineDays ?? 0,
    conclusions: privateRun.conclusions,
    dateRange: privateRun.dateRange,
    day: privateRun.day,
    durationDays: privateRun.durationDays,
    nextStep: privateRun.nextStep,
    outcomeConfidence: privateRun.outcomeConfidence,
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
    <div className="flex w-full flex-col gap-8 sm:gap-10">
      <header className="flex flex-col gap-3 border-b border-border pb-6 sm:pb-8">
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Private experiment report
        </span>
        <h1 className="font-serif text-3xl font-semibold tracking-tight text-foreground sm:text-4xl lg:text-5xl">
          {privateRun.title}
        </h1>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <span>{privateRun.statusLabel}</span>
          {startedLabel ? (
            <>
              <span aria-hidden="true" className="text-border">/</span>
              <span>{startedLabel}</span>
            </>
          ) : null}
          <span aria-hidden="true" className="text-border">/</span>
          <span>Saved privately in your vault</span>
        </div>
      </header>

      <ResultsTab
        experiment={experiment}
        onPrivateRunRetry={onRetry}
        privateRunError={error}
        privateRunStatus={status}
        showFinishedOutcomeSummary={false}
        showHeader={false}
      />
    </div>
  );
}

export function PrivateRunRouteState({
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
