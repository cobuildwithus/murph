"use client";

import { useState } from "react";

import { Button } from "@/src/components/ui/button";
import { requestHostedOnboardingJson } from "@/src/components/hosted-onboarding/client-api";

import { toErrorMessage } from "./hosted-settings-sync-helpers";

interface HostedBillingPortalResponse {
  url: string;
}

export function HostedBillingSettingsAction() {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isOpeningPortal, setIsOpeningPortal] = useState(false);

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
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <Button type="button" onClick={() => void handleManageSubscription()} disabled={isOpeningPortal}>
        {isOpeningPortal ? "Opening Stripe..." : "Manage subscription"}
      </Button>
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
