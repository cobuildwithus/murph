"use client";

import { useMemo } from "react";

import { ResultsTab } from "@/src/components/experiments/experiment-detail/results-tab";
import { useExperimentStartContactContext } from "@/src/components/experiments/experiment-detail/start-experiment-contact-context";
import { useBrowserVault } from "@/src/lib/browser-vault/context";
import { resolveBrowserVaultExperimentRun } from "@/src/lib/browser-vault/experiment-run";
import { composeExperimentDetail } from "@/src/lib/experiments/experiment-detail";
import type { ExperimentProtocol } from "@/src/types/experiments";

export function ResultsTabClient({
  protocol,
}: {
  protocol: ExperimentProtocol;
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
    () => composeExperimentDetail({ protocol, privateRun }),
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
