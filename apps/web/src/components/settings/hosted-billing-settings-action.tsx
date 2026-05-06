"use client";

import { useState } from "react";

import { Button } from "@/src/components/ui/button";
import { requestHostedOnboardingJson } from "@/src/components/hosted-onboarding/client-api";

import { toErrorMessage } from "./hosted-settings-sync-helpers";
import { UpgradeToEdgeButton } from "./hosted-plan-upgrade-button";
import { SwitchToPulseButton } from "./hosted-plan-switch-to-pulse-button";

interface HostedBillingPortalResponse {
  url: string;
}

export function HostedBillingSettingsAction(props: {
  currentPeriodEnd?: string | null;
  helperText?: string | null;
  showSwitchToPulse?: boolean;
  showUpgrade?: boolean;
}) {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSwitchToPulsePending, setIsSwitchToPulsePending] = useState(false);
  const [isUpgradePending, setIsUpgradePending] = useState(false);
  const [isOpeningPortal, setIsOpeningPortal] = useState(false);
  const isBillingActionPending = isSwitchToPulsePending || isUpgradePending || isOpeningPortal;

  async function handleManageSubscription() {
    setErrorMessage(null);
    setIsOpeningPortal(true);

    try {
      const response = await requestHostedOnboardingJson<HostedBillingPortalResponse>({
        method: "POST",
        url: "/api/settings/billing/portal",
      });

      window.location.assign(response.url);
    } catch (error) {
      setErrorMessage(toErrorMessage(error, "Could not open billing right now."));
    } finally {
      setIsOpeningPortal(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-3 sm:items-end">
      <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-start">
        {props.showUpgrade === true ? (
          <UpgradeToEdgeButton
            disabled={isBillingActionPending}
            onPendingChange={setIsUpgradePending}
          />
        ) : null}
        {props.showSwitchToPulse === true ? (
          <SwitchToPulseButton
            currentPeriodEnd={props.currentPeriodEnd}
            disabled={isBillingActionPending}
            onPendingChange={setIsSwitchToPulsePending}
          />
        ) : null}
        <Button
          type="button"
          variant="outline"
          onClick={() => void handleManageSubscription()}
          disabled={isBillingActionPending}
        >
          {isOpeningPortal ? "Opening Stripe..." : "Manage subscription"}
        </Button>
      </div>
      {props.helperText ? (
        <p className="text-xs leading-tight text-muted-foreground sm:max-w-xs sm:text-right">
          {props.helperText}
        </p>
      ) : null}
      <p
        role="alert"
        aria-live="polite"
        className="min-h-[1rem] text-xs leading-tight text-destructive sm:max-w-xs sm:text-right"
      >
        {errorMessage}
      </p>
    </div>
  );
}
