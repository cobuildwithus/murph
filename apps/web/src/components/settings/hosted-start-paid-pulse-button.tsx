"use client";

import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import { requestHostedOnboardingJson } from "@/src/components/hosted-onboarding/client-api";
import { Button } from "@/src/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";
import { getHostedBillingPlanDefinition } from "@/src/lib/hosted-onboarding/billing-plans";

import { PlanFeatureCard } from "./plan-feature-card";
import { toErrorMessage } from "./hosted-settings-sync-helpers";

interface HostedPulseTrialStartPaidResponse {
  billingPlanCode: "launch_monthly";
  paymentUrl?: string;
  status: "billing_pending" | "payment_required" | "started";
}

const pulsePlan = getHostedBillingPlanDefinition("launch_monthly");
const pulsePriceLabel = `$${pulsePlan.recurringAmountUsdCents / 100}`;

const PULSE_FEATURES = [
  "Run experiments, see what changed",
  "Sync your health data",
  "Private before/after outcomes",
  "Chat via iMessage, Telegram, or email",
  "Guided experiment setup",
  "Access to frontier AI models",
];

export function StartPaidPulseButton(props: {
  children?: ReactNode;
  disabled?: boolean;
  onPendingChange?: (pending: boolean) => void;
  presentation?: "banner" | "settings";
}) {
  const router = useRouter();
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const label = isStarting ? "Starting..." : props.children ?? "Start Pulse plan";
  const disabled = props.disabled === true || isStarting;

  async function handleStartPaidPulse() {
    setErrorMessage(null);
    setIsStarting(true);
    props.onPendingChange?.(true);

    try {
      const response = await requestHostedOnboardingJson<HostedPulseTrialStartPaidResponse>({
        method: "POST",
        url: "/api/settings/billing/start-paid-pulse",
      });

      if (response.status === "payment_required" && response.paymentUrl) {
        window.location.assign(response.paymentUrl);
        return;
      }

      setConfirmationOpen(false);
      router.refresh();
    } catch (error) {
      setErrorMessage(toErrorMessage(error, "Could not start Pulse right now."));
    } finally {
      setIsStarting(false);
      props.onPendingChange?.(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <Button
        type="button"
        variant={props.presentation === "banner" ? "unstyled" : "outline"}
        size={props.presentation === "banner" ? "unstyled" : "default"}
        className={props.presentation === "banner"
          ? "inline-flex shrink-0 items-center gap-2 self-start rounded-2xl bg-[#5a6e32] px-6 py-3 text-sm font-medium text-white transition-colors duration-200 hover:bg-[#7a8c6e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7a8c6e] focus-visible:ring-offset-2 sm:self-center"
          : undefined}
        onClick={() => setConfirmationOpen(true)}
        disabled={disabled}
      >
        {label}
        {props.presentation === "banner" ? (
          <ArrowRight className="size-4" aria-hidden="true" />
        ) : null}
      </Button>
      <p
        role={confirmationOpen || !errorMessage ? undefined : "alert"}
        aria-live="polite"
        className="min-h-[1rem] text-xs leading-tight text-destructive sm:max-w-xs sm:text-right"
      >
        {confirmationOpen ? null : errorMessage}
      </p>
      <StartPaidPulseConfirmationDialog
        errorMessage={errorMessage}
        isStarting={isStarting}
        onConfirm={() => void handleStartPaidPulse()}
        onOpenChange={setConfirmationOpen}
        open={confirmationOpen}
      />
    </div>
  );
}

function StartPaidPulseConfirmationDialog(props: {
  errorMessage: string | null;
  isStarting: boolean;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-md gap-6 rounded-2xl border border-[#c4a882]/25 bg-[#fffcf6] p-6 text-[#2d3436] ring-[#c4a882]/25 md:p-7">
        <DialogHeader className="pr-10">
          <DialogTitle className="font-serif text-2xl/7 font-semibold tracking-normal text-[#2d3436]">
            Start Pulse
          </DialogTitle>
          <DialogDescription className="text-sm leading-6 text-[#736a58]">
            Your trial ends and Pulse begins at {pulsePriceLabel}/mo.
          </DialogDescription>
        </DialogHeader>

        <PlanFeatureCard price={pulsePriceLabel} features={PULSE_FEATURES} />

        {props.errorMessage ? (
          <p
            role="alert"
            className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive"
          >
            {props.errorMessage}
          </p>
        ) : null}

        <div className="flex flex-col gap-2">
          <Button
            type="button"
            size="xl"
            onClick={props.onConfirm}
            disabled={props.isStarting}
            className="w-full"
          >
            {props.isStarting ? "Starting..." : "Start Pulse"}
          </Button>
          <Button
            type="button"
            size="xl"
            variant="ghost"
            onClick={() => props.onOpenChange(false)}
            disabled={props.isStarting}
            className="w-full"
          >
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
