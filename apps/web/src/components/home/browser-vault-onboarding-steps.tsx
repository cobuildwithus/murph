"use client";

import { useMemo } from "react";
import {
  selectBrowserVaultTrackedExperiments,
  type BrowserVaultQueryClient,
} from "@murphai/query/browser-overview";

import { HomeExperiments } from "./home-experiments";
import {
  OnboardingSteps,
  type OnboardingStepsProps,
} from "./onboarding-steps";

import {
  BrowserVaultProvider,
  useBrowserVault,
} from "@/src/lib/browser-vault/context";
import {
  buildExperimentLibraryCards,
  splitHomeExperimentCards,
  type ExperimentLibraryCard,
} from "@/src/lib/experiments/library-cards";
import type { ExperimentProtocol } from "@/src/types/experiments";

export interface BrowserVaultOnboardingStepsProps extends OnboardingStepsProps {
  /**
   * Public protocols used to surface the member's own experiment runs above
   * the onboarding steps. When omitted, only the steps render.
   */
  protocols?: ExperimentProtocol[];
}

export function BrowserVaultOnboardingSteps(props: BrowserVaultOnboardingStepsProps) {
  return (
    <BrowserVaultProvider>
      <BrowserVaultOnboardingStepsContent {...props} />
    </BrowserVaultProvider>
  );
}

export function BrowserVaultOnboardingStepsContent({
  protocols,
  ...props
}: BrowserVaultOnboardingStepsProps) {
  const { client, status } = useBrowserVault();
  const hideLabsStep =
    props.hideLabsStep ||
    (status === "ready" && client ? hasBrowserVaultLabBiomarkers(client) : false);
  const { history, inProgress } = useHomeExperimentCards({ client, protocols });
  // While the vault is still decrypting we cannot know whether a run is in
  // progress; keep the experiment step hidden until then so returning members
  // do not see a "Start an experiment" flash for a run they already started.
  const vaultPending = protocols !== undefined && status === "loading";

  return (
    <>
      <HomeExperiments inProgress={inProgress} history={history} />
      <OnboardingSteps
        {...props}
        hideExperimentStep={props.hideExperimentStep || vaultPending || inProgress.length > 0}
        hideLabsStep={hideLabsStep}
      />
    </>
  );
}

function useHomeExperimentCards({
  client,
  protocols,
}: {
  client: BrowserVaultQueryClient | null;
  protocols?: ExperimentProtocol[];
}): { history: ExperimentLibraryCard[]; inProgress: ExperimentLibraryCard[] } {
  return useMemo(() => {
    if (!client || !protocols) {
      return { history: [], inProgress: [] };
    }

    return splitHomeExperimentCards(buildExperimentLibraryCards({
      client,
      protocols,
      trackedExperiments: selectBrowserVaultTrackedExperiments(client),
    }));
  }, [client, protocols]);
}

export function hasBrowserVaultLabBiomarkers(
  client: Pick<BrowserVaultQueryClient, "replica">,
): boolean {
  return client.replica.metricRows.some((row) =>
    row.sourceKind === "test-result" &&
    row.biomarkerKey !== null &&
    row.value !== null
  );
}
