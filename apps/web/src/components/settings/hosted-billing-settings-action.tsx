"use client";

import { useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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
    <div className="space-y-4">
      {errorMessage ? (
        <Alert variant="destructive">
          <AlertTitle>Unable to open billing</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Button type="button" onClick={() => void handleManageSubscription()} disabled={isOpeningPortal} size="md">
          {isOpeningPortal ? "Opening Stripe..." : "Manage subscription"}
        </Button>
      </div>
    </div>
  );
}
