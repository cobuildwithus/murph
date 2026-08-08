"use client";

import { useState, type ReactNode } from "react";

import { requestHostedOnboardingJson } from "@/src/components/hosted-onboarding/client-api";
import { Button } from "@/src/components/ui/button";
import type { HostedBillingPlanCode } from "@/src/lib/hosted-onboarding/billing-plans";
import { cn } from "@/src/lib/utils";

import { toErrorMessage } from "./hosted-settings-sync-helpers";

export function HostedPlanCheckoutButton(props: {
  block?: boolean;
  children?: ReactNode;
  targetPlanCode: HostedBillingPlanCode;
  variant?: "default" | "secondary";
}) {
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function startCheckout() {
    setPending(true);
    setErrorMessage(null);
    try {
      const response = await requestHostedOnboardingJson<{
        alreadyActive: boolean;
        url: string | null;
      }>({
        method: "POST",
        payload: { billingPlanCode: props.targetPlanCode },
        url: "/api/settings/billing/checkout",
      });
      if (response.url) {
        window.location.assign(response.url);
        return;
      }
      window.location.reload();
    } catch (error) {
      setPending(false);
      setErrorMessage(toErrorMessage(
        error,
        "Could not open Stripe right now.",
      ));
    }
  }

  return (
    <div className={cn(
      "flex flex-col gap-2",
      props.block ? "items-stretch" : "items-start",
    )}>
      <Button
        className={props.block ? "w-full" : undefined}
        disabled={pending}
        onClick={() => void startCheckout()}
        type="button"
        variant={props.variant ?? "default"}
      >
        {pending ? "Opening Stripe..." : props.children ?? "Choose plan"}
      </Button>
      {errorMessage ? (
        <p
          className="max-w-xs text-xs leading-tight text-destructive"
          role="alert"
        >
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}
