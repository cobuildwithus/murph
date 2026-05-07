"use client";

import { useMemo } from "react";

import {
  ResultsSummary,
  ResultsSummarySkeleton,
} from "@/src/components/experiments/experiment-detail/results-summary";
import {
  BrowserVaultProvider,
  useBrowserVault,
} from "@/src/lib/browser-vault/context";
import { resolveBrowserVaultExperimentRun } from "@/src/lib/browser-vault/experiment-run";
import type { ExperimentResultsPublicProjection } from "@/src/lib/health-commons/experiment-projections";

export function ActiveRunSummaryClient({
  protocol,
}: {
  protocol: ExperimentResultsPublicProjection;
}) {
  return (
    <BrowserVaultProvider>
      <ActiveRunSummaryInner protocol={protocol} />
    </BrowserVaultProvider>
  );
}

function ActiveRunSummaryInner({
  protocol,
}: {
  protocol: ExperimentResultsPublicProjection;
}) {
  const browserVault = useBrowserVault();
  const privateRun = useMemo(
    () =>
      resolveBrowserVaultExperimentRun({
        client: browserVault.client,
        protocol,
      }),
    [browserVault.client, protocol],
  );

  if (browserVault.status === "loading") {
    return <ResultsSummarySkeleton />;
  }

  if (!privateRun) return null;

  const isActive =
    privateRun.status === "active" || privateRun.status === "paused";
  if (!isActive) return null;

  const hasData =
    privateRun.signals.length > 0 || privateRun.trends.length > 0;
  if (!hasData) return null;

  return (
    <ResultsSummary
      signals={privateRun.signals}
      trends={privateRun.trends}
      schedule={privateRun.schedule}
    />
  );
}
