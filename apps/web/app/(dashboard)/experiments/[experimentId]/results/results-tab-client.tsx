"use client";

import { useMemo, type ReactNode } from "react";

import {
  ResultsTab,
  type ResultsTabExperiment,
} from "@/src/components/experiments/experiment-detail/results-tab";
import {
  isBrowserVaultMetricsCapable,
  useBrowserVault,
  useBrowserVaultExperimentMetricBucketDemand,
} from "@/src/lib/browser-vault/context";
import {
  buildBrowserVaultExperimentResultLookups,
  resolveBrowserVaultExperimentRun,
} from "@/src/lib/browser-vault/experiment-run";
import type { ExperimentResultsPublicProjection } from "@/src/lib/health-commons/experiment-projections";

export function ResultsTabClient({
  protocol,
  startAction = null,
}: {
  protocol: ExperimentResultsPublicProjection;
  startAction?: ReactNode;
}) {
  const lookups = useMemo(
    () => buildBrowserVaultExperimentResultLookups(protocol),
    [protocol],
  );
  const metricBucketsLoaded = useBrowserVaultExperimentMetricBucketDemand({ lookups });
  const browserVault = useBrowserVault();
  const metricsClient = metricBucketsLoaded
    && isBrowserVaultMetricsCapable(browserVault.client)
    ? browserVault.client
    : null;
  const privateRun = useMemo(
    () => resolveBrowserVaultExperimentRun({
      client: metricsClient,
      protocol,
    }),
    [metricsClient, protocol],
  );
  const privateRunStatus = browserVault.status === "loading"
    || (browserVault.status === "ready" && !metricBucketsLoaded)
    ? "loading"
    : browserVault.status;
  const experiment = useMemo<ResultsTabExperiment>(
    () => ({
      status: privateRun?.status ?? "upcoming",
      day: privateRun?.day,
      dateRange: privateRun?.dateRange,
      analysisAvailableOn: privateRun?.analysisAvailableOn,
      signals: privateRun?.signals ?? [],
      trends: privateRun?.trends ?? [],
      timeline: privateRun?.timeline ?? [],
      schedule: privateRun?.schedule,
      sessionContext: privateRun?.sessionContext,
      privateRun: privateRun ?? undefined,
      nextStep: privateRun?.nextStep,
      outcomeConfidence: privateRun?.outcomeConfidence,
      summary: privateRun?.summary,
      summaryDetail: privateRun?.summaryDetail,
      conclusions: privateRun?.conclusions,
      baselineDays: protocol.baselineDays,
      durationDays: protocol.durationDays,
      title: protocol.title,
    }),
    [privateRun, protocol],
  );

  return (
    <ResultsTab
      experiment={experiment}
      privateRunError={browserVault.error}
      privateRunStatus={privateRunStatus}
      onPrivateRunRetry={browserVault.refresh}
      startAction={startAction}
    />
  );
}
