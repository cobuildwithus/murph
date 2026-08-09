"use client";

import { useMemo } from "react";
import {
  selectBrowserVaultTrackedExperiments,
  type BrowserVaultQueryClient,
} from "@murphai/query/browser-overview";

import { BrowserVaultUnavailableAlert } from "./browser-vault-unavailable-alert";
import { HomeExperiments } from "./home-experiments";
import {
  OnboardingSteps,
  type OnboardingStepsProps,
} from "./onboarding-steps";

import { useBrowserVault } from "@/src/lib/browser-vault/context";
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

export function BrowserVaultOnboardingStepsContent({
  protocols,
  ...props
}: BrowserVaultOnboardingStepsProps) {
  const { client, error, refresh, status } = useBrowserVault();
  const vaultUnavailable = status === "error" && client === null;
  const hideLabsStep =
    props.hideLabsStep ||
    (status === "ready" && client ? hasBrowserVaultLabBiomarkers(client) : false);
  const { history, inProgress } = useHomeExperimentCards({ client, protocols });
  const hasAnyExperimentRun = inProgress.length > 0 || history.length > 0;
  // While the vault is still decrypting we cannot know whether a run is in
  // progress; keep the experiment step hidden until then so returning members
  // do not see a "Start an experiment" flash for a run they already started.
  const vaultPending = protocols !== undefined && status === "loading";

  if (vaultUnavailable) {
    return (
      <>
        <BrowserVaultUnavailableAlert
          message={error}
          onRetry={() => void refresh()}
        />
        <OnboardingSteps
          {...props}
          hideExperimentStep
          hideLabsStep
        />
      </>
    );
  }

  return (
    <>
      <HomeExperiments inProgress={inProgress} history={history} />
      <OnboardingSteps
        {...props}
        hideExperimentStep={props.hideExperimentStep || vaultPending || hasAnyExperimentRun}
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
