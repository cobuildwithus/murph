"use client";

import { useMemo } from "react";

import { ResultsTab } from "@/src/components/experiments/experiment-detail/results-tab";
import { useExperimentStartContactContext } from "@/src/components/experiments/experiment-detail/start-experiment-contact-context";
import { BrowserVaultProvider, useBrowserVault } from "@/src/lib/browser-vault/context";
import { resolveBrowserVaultExperimentRun } from "@/src/lib/browser-vault/experiment-run";
import type { ExperimentResultsPublicProjection } from "@/src/lib/health-commons/experiment-projections";

export function ResultsTabClient({
  protocol,
}: {
  protocol: ExperimentResultsPublicProjection;
}) {
  return (
    <BrowserVaultProvider>
      <ResultsTabInner protocol={protocol} />
    </BrowserVaultProvider>
  );
}

function ResultsTabInner({
  protocol,
}: {
  protocol: ExperimentResultsPublicProjection;
}) {
  const browserVault = useBrowserVault();
  const startContact = useExperimentStartContactContext();
  const privateRun = useMemo(
    () => resolveBrowserVaultExperimentRun({
      client: browserVault.client,
      protocol,
    }),
    [browserVault.client, protocol],
  );
  const experiment = useMemo(
    () => ({
      status: privateRun?.status ?? ("upcoming" as const),
      day: privateRun?.day,
      completionPercent: privateRun?.completionPercent,
      dateRange: privateRun?.dateRange,
      analysisAvailableOn: privateRun?.analysisAvailableOn,
      signals: privateRun?.signals ?? [],
      trends: privateRun?.trends ?? [],
      timeline: privateRun?.timeline ?? [],
      schedule: privateRun?.schedule,
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
      initialContactChannels={startContact.initialContactChannels}
      murphPhoneNumber={startContact.murphPhoneNumber}
      privateRunError={browserVault.error}
      privateRunStatus={browserVault.status}
      onPrivateRunRetry={browserVault.refresh}
    />
  );
}
