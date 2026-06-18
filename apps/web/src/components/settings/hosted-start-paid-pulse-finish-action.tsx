"use client";

import { ArrowRight, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { requestHostedOnboardingJson } from "@/src/components/hosted-onboarding/client-api";
import { Button } from "@/src/components/ui/button";

import { toErrorMessage } from "./hosted-settings-sync-helpers";

interface HostedPulseTrialStartPaidResponse {
  billingPlanCode: "launch_monthly";
  paymentUrl?: string;
  status: "billing_pending" | "payment_required" | "started";
}

type FinishStatus = "billing_pending" | "idle" | "submitting";

export function HostedStartPaidPulseFinishAction() {
  const router = useRouter();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [status, setStatus] = useState<FinishStatus>("idle");

  async function finishStartPaidPulse() {
    setErrorMessage(null);
    setStatus("submitting");

    try {
      const response = await requestHostedOnboardingJson<HostedPulseTrialStartPaidResponse>({
        method: "POST",
        url: "/api/settings/billing/start-paid-pulse",
      });

      if (response.status === "payment_required") {
        if (response.paymentUrl) {
          window.location.assign(response.paymentUrl);
          return;
        }

        throw new Error("Stripe did not return a payment link.");
      }

      if (response.status === "billing_pending") {
        setStatus("billing_pending");
        router.refresh();
        return;
      }

      router.replace("/home");
      router.refresh();
    } catch (error) {
      setStatus("idle");
      setErrorMessage(toErrorMessage(error, "Could not start Pulse right now."));
    }
  }

  const isSubmitting = status === "submitting";

  return (
    <div className="flex max-w-sm flex-col items-start gap-3">
      <Button
        type="button"
        size="xl"
        onClick={() => void finishStartPaidPulse()}
        disabled={isSubmitting}
      >
        {isSubmitting ? "Finishing..." : status === "billing_pending" ? "Check status" : "Finish starting Pulse"}
        {isSubmitting ? (
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <ArrowRight className="size-4" aria-hidden="true" />
        )}
      </Button>
      {isSubmitting ? (
        <p role="status" className="sr-only">
          Starting Pulse billing.
        </p>
      ) : null}
      {status === "billing_pending" ? (
        <p role="status" className="text-sm leading-6 text-muted-foreground">
          Billing is still finishing. Check again shortly.
        </p>
      ) : null}
      {errorMessage ? (
        <p
          role="alert"
          aria-live="polite"
          className="text-sm leading-6 text-destructive [overflow-wrap:anywhere]"
        >
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}
