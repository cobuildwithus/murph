"use client";

import { useState } from "react";

import {
  requestHostedOnboardingJson,
} from "@/src/components/hosted-onboarding/client-api";
import { Button } from "@/src/components/ui/button";
import { cn } from "@/src/lib/utils";

import { toErrorMessage } from "./hosted-settings-sync-helpers";

export function HostedFamilyStartButton(props: {
  block?: boolean;
  label: string;
  variant?: "default" | "secondary";
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  async function startCheckout() {
    setErrorMessage(null);
    setStatusMessage(null);
    setIsSubmitting(true);
    try {
      const response = await requestHostedOnboardingJson<{
        alreadyActive: boolean;
        url: string | null;
      }>({
        method: "POST",
        url: "/api/settings/billing/family/checkout",
      });
      if (response.url) {
        window.location.assign(response.url);
        return;
      }
      if (response.alreadyActive) {
        window.location.reload();
        return;
      }
      setIsSubmitting(false);
      setStatusMessage("Your Family plan is syncing with Stripe. Refresh in a moment.");
    } catch (error) {
      setIsSubmitting(false);
      setErrorMessage(toErrorMessage(error, "Could not start the Family plan right now."));
    }
  }

  return (
    <div className={cn("flex flex-col gap-2", props.block ? "items-stretch" : "items-start")}>
      <Button
        type="button"
        variant={props.variant ?? "default"}
        onClick={() => void startCheckout()}
        disabled={isSubmitting}
        className={props.block ? "w-full" : undefined}
      >
        {isSubmitting ? "Opening Stripe..." : props.label}
      </Button>
      {errorMessage ? (
        <p role="alert" className="max-w-xs text-xs leading-tight text-destructive">
          {errorMessage}
        </p>
      ) : null}
      {statusMessage ? (
        <p role="status" className="max-w-xs text-xs leading-tight text-muted-foreground">
          {statusMessage}
        </p>
      ) : null}
    </div>
  );
}
