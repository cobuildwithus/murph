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
      setErrorMessage("We are still loading your Privy session. Try again in a moment.");
      return;
    }

    if (!authenticated) {
      setErrorMessage("Sign in with your hosted account before you manage billing.");
      return;
    }

    if (!user) {
      setErrorMessage("We are still loading your account details. Try again in a moment.");
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
      setErrorMessage(toErrorMessage(error, "We could not open Stripe billing yet."));
    } finally {
      setIsOpeningPortal(false);
    }
  }

  return (
    <Card className="shadow-sm">
      <CardHeader className="space-y-2">
        <CardTitle className="text-2xl font-semibold tracking-tight text-stone-900">Subscription</CardTitle>
        <CardDescription className="leading-relaxed text-stone-500">
          Manage your Murph subscription in Stripe without leaving this account.
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
          <p className="text-sm leading-relaxed text-stone-500">Checking your Privy session before we show billing.</p>
        ) : !authenticated ? (
          <p className="text-sm leading-relaxed text-stone-500">
            Sign in with your hosted account to manage the subscription attached to this invite.
          </p>
        ) : !canManageBilling ? (
          <p className="text-sm leading-relaxed text-stone-500">Loading your hosted profile before we show billing.</p>
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm leading-relaxed text-stone-500">
              Stripe handles plan changes, payment method updates, and cancellation in one place.
            </p>
            <Button type="button" onClick={() => void handleManageSubscription()} disabled={isOpeningPortal}>
              {isOpeningPortal ? "Opening Stripe..." : "Manage subscription"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
