"use client";

import type { BrowserVaultQueryClient } from "@murphai/query/browser-biomarkers";

import {
  BrowserVaultProvider,
  useBrowserVault,
} from "@/src/lib/browser-vault/context";
import {
  OnboardingSteps,
  type OnboardingStepsProps,
} from "./onboarding-steps";

export function BrowserVaultOnboardingSteps(props: OnboardingStepsProps) {
  return (
    <BrowserVaultProvider>
      <BrowserVaultOnboardingStepsContent {...props} />
    </BrowserVaultProvider>
  );
}

export function BrowserVaultOnboardingStepsContent(props: OnboardingStepsProps) {
  const { client, status } = useBrowserVault();
  const hideLabsStep =
    props.hideLabsStep ||
    (status === "ready" && client ? hasBrowserVaultLabBiomarkers(client) : false);

  return <OnboardingSteps {...props} hideLabsStep={hideLabsStep} />;
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
