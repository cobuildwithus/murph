"use client";

import { useMemo } from "react";

import { ResearchTab } from "@/src/components/experiments/experiment-detail/research-tab";
import { useBrowserVault } from "@/src/lib/browser-vault/context";
import { resolveBrowserVaultExperimentRun } from "@/src/lib/browser-vault/experiment-run";
import { composeExperimentDetail } from "@/src/lib/experiments/experiment-detail";
import type { ExperimentProtocol } from "@/src/types/experiments";

export function ResearchTabClient({
  protocol,
}: {
  protocol: ExperimentProtocol;
}) {
  const browserVault = useBrowserVault();
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

  return <ResearchTab experiment={experiment} />;
}
