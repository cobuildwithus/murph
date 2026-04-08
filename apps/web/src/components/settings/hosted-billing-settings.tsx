"use client";

import { usePrivy, useUser } from "@privy-io/react-auth";
import { useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requestHostedOnboardingJson } from "@/src/components/hosted-onboarding/client-api";

import { toErrorMessage } from "./hosted-settings-sync-helpers";

interface HostedBillingPortalResponse {
  url: string;
}

export function HostedBillingSettings() {
  return <HostedBillingSettingsInner />;
}

function HostedBillingSettingsInner() {
  const { authenticated, ready } = usePrivy();
  const { user } = useUser();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isOpeningPortal, setIsOpeningPortal] = useState(false);

  const canManageBilling = ready && authenticated && Boolean(user);
  const isLoadingAuthenticatedUser = ready && authenticated && !user;

  async function handleManageSubscription() {
    setErrorMessage(null);

    if (!ready) {
      setErrorMessage("Still loading — try again in a moment.");
      return;
    }

    if (!authenticated) {
      setErrorMessage("Please sign in first to manage billing.");
      return;
    }

    if (!user) {
      setErrorMessage("Still loading your account — try again in a moment.");
      return;
    }

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
    <Card className="border-stone-200/80 shadow-sm transition-shadow hover:shadow-md">
      <CardHeader className="space-y-2">
        <CardTitle className="text-lg font-semibold tracking-tight text-stone-900">Subscription</CardTitle>
        <CardDescription className="leading-relaxed text-stone-500">
          View or update your plan and payment details.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {errorMessage ? (
          <Alert variant="destructive">
            <AlertTitle>Unable to open billing</AlertTitle>
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        ) : null}

        {!ready || isLoadingAuthenticatedUser ? (
          <p className="text-sm leading-relaxed text-stone-500">Loading&hellip;</p>
        ) : !authenticated ? (
          <p className="text-sm leading-relaxed text-stone-500">
            Sign in to manage your subscription.
          </p>
        ) : !canManageBilling ? (
          <p className="text-sm leading-relaxed text-stone-500">Loading your account&hellip;</p>
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm leading-relaxed text-stone-500">
              Change your plan, update payment methods, or cancel.
            </p>
            <Button type="button" onClick={() => void handleManageSubscription()} disabled={isOpeningPortal} size="md">
              {isOpeningPortal ? "Opening Stripe..." : "Manage subscription"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
