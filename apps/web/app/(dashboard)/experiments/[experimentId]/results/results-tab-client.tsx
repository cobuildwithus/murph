"use client";

import { useMemo, type ReactNode } from "react";

import {
  ResultsTab,
  type ResultsTabExperiment,
} from "@/src/components/experiments/experiment-detail/results-tab";
import { useBrowserVault } from "@/src/lib/browser-vault/context";
import { resolveBrowserVaultExperimentRun } from "@/src/lib/browser-vault/experiment-run";
import type { ExperimentResultsPublicProjection } from "@/src/lib/health-commons/experiment-projections";

export function ResultsTabClient({
  protocol,
  startAction = null,
}: {
  protocol: ExperimentResultsPublicProjection;
  startAction?: ReactNode;
}) {
  const browserVault = useBrowserVault();
  const privateRun = useMemo(
    () => resolveBrowserVaultExperimentRun({
      client: browserVault.client,
      protocol,
    }),
    [browserVault.client, protocol],
  );
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
      privateRunStatus={browserVault.status}
      onPrivateRunRetry={browserVault.refresh}
      startAction={startAction}
    />
  );
}
