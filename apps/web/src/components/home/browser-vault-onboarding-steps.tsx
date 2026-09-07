"use client";

import type { BrowserVaultCoreCapableQueryClient } from "@murphai/query/browser-replica-client";

import { BrowserVaultUnavailableAlert } from "./browser-vault-unavailable-alert";
import { OnboardingSteps, type OnboardingStepsProps } from "./onboarding-steps";

import { useBrowserVault } from "@/src/lib/browser-vault/context";

export function BrowserVaultOnboardingStepsContent(props: OnboardingStepsProps) {
  const { client, error, status } = useBrowserVault();
  const vaultUnavailable = status === "error" && client === null;
  const hideLabsStep = props.hideLabsStep || vaultUnavailable || (
    status === "ready" && client ? hasBrowserVaultLabBiomarkers(client) : false
  );

  return (
    <>
      {vaultUnavailable ? <BrowserVaultUnavailableAlert message={error} /> : null}
      <OnboardingSteps
        {...props}
        hideLabsStep={hideLabsStep}
        showEmptyState={props.showEmptyState !== false && (status === "ready" || status === "empty")}
      />
    </>
  );
}

export function hasBrowserVaultLabBiomarkers(
  client: BrowserVaultCoreCapableQueryClient,
): boolean {
  return client.replica.hasLabBiomarkers;
}
