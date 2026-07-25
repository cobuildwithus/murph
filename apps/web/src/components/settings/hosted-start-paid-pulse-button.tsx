"use client";

import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import {
  HostedOnboardingApiError,
  requestHostedPulseTrialContinuation,
  requestHostedPulseTrialStartPaid,
} from "@/src/components/hosted-onboarding/client-api";
import { BillingPortalButton } from "@/src/components/settings/billing-portal-button";
import { Button } from "@/src/components/ui/button";
import { Spinner } from "@/src/components/ui/spinner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";
import { getHostedBillingPlanDefinition } from "@/src/lib/hosted-onboarding/billing-plans";
import { cn } from "@/src/lib/utils";

import { PlanFeatureCard } from "./plan-feature-card";
import { toErrorMessage } from "./hosted-settings-sync-helpers";

type StartPaidPulseStatus = "billing_pending" | "idle" | "submitting";
type PulseTrialBillingContinuationStatus =
  | "billing_pending"
  | "error"
  | "starting";

const pulsePlan = getHostedBillingPlanDefinition("launch_monthly");
const pulsePriceLabel = `$${pulsePlan.recurringAmountUsdCents / 100}`;

const PULSE_FEATURES = [
  "Run experiments, see what changed",
  "Sync your health data",
  "Private before/after outcomes",
  "Chat via iMessage, Telegram, or email",
  "Guided experiment setup",
  "Access to the most capable AI models",
];

export function StartPaidPulseButton(props: {
  block?: boolean;
  children?: ReactNode;
  disabled?: boolean;
  onPendingChange?: (pending: boolean) => void;
  presentation?: "banner" | "settings";
}) {
  const router = useRouter();
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [status, setStatus] = useState<StartPaidPulseStatus>("idle");
  const isSubmitting = status === "submitting";
  const label = isSubmitting ? "Starting..." : props.children ?? "Start Pulse plan";
  const disabled = props.disabled === true || isSubmitting;

  function setConfirmationOpenState(open: boolean) {
    setConfirmationOpen(open);
    if (!open) {
      setStatus("idle");
      setErrorMessage(null);
    }
  }

  async function handleStartPaidPulse() {
    if (isSubmitting) {
      return;
    }

    setErrorMessage(null);
    setStatus("submitting");
    props.onPendingChange?.(true);

    try {
      const result = await requestHostedPulseTrialStartPaid();
      if (result.status === "redirecting") {
        setStatus("idle");
        return;
      }

      if (result.status === "billing_pending") {
        setStatus("billing_pending");
        router.refresh();
        return;
      }

      if (result.status === "payment_required") {
        setStatus("idle");
        setErrorMessage("Your payment method is still being confirmed. Try again shortly.");
        return;
      }

      setStatus("idle");
      setConfirmationOpen(false);
      router.refresh();
    } catch (error) {
      setStatus("idle");
      setErrorMessage(toErrorMessage(error, "Could not start Pulse right now."));
    } finally {
      props.onPendingChange?.(false);
    }
  }

  return (
    <div className={cn("flex flex-col gap-2", props.block ? "items-stretch" : "items-start sm:items-end")}>
      <Button
        type="button"
        variant={props.presentation === "banner" ? "unstyled" : props.block ? "secondary" : "default"}
        size={props.presentation === "banner" ? "unstyled" : "default"}
        className={props.presentation === "banner"
          ? "inline-flex shrink-0 items-center gap-2 self-start rounded-2xl bg-[#5a6e32] px-6 py-3 text-sm font-medium text-white transition-colors duration-200 hover:bg-[#7a8c6e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7a8c6e] focus-visible:ring-offset-2 sm:self-center"
          : props.block ? "w-full" : undefined}
        onClick={() => setConfirmationOpen(true)}
        disabled={disabled}
      >
        {label}
        {props.presentation === "banner" ? (
          <ArrowRight className="size-4" aria-hidden="true" />
        ) : null}
      </Button>
      {!confirmationOpen && errorMessage ? (
        <p
          role="alert"
          aria-live="polite"
          className="text-xs leading-tight text-destructive sm:max-w-xs sm:text-right"
        >
          {errorMessage}
        </p>
      ) : null}
      <StartPaidPulseConfirmationDialog
        errorMessage={errorMessage}
        status={status}
        onConfirm={() => void handleStartPaidPulse()}
        onOpenChange={setConfirmationOpenState}
        open={confirmationOpen}
      />
    </div>
  );
}

export function PulseTrialBillingContinuation() {
  const router = useRouter();
  const started = useRef(false);
  const [status, setStatus] = useState<PulseTrialBillingContinuationStatus>("starting");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const runContinuation = useCallback(async (redirectIfPaymentRequired: boolean) => {
    setStatus("starting");
    setErrorMessage(null);

    try {
      const result = await requestHostedPulseTrialContinuation({
        redirectIfPaymentRequired,
      });
      if (result.status === "redirecting") {
        return;
      }

      if (result.status === "payment_required") {
        setStatus("error");
        setErrorMessage("Your payment method is still being confirmed.");
        return;
      }

      if (result.status === "billing_pending") {
        setStatus("billing_pending");
        return;
      }

      router.replace("/settings#subscription");
    } catch (error) {
      if (error instanceof HostedOnboardingApiError && !error.retryable) {
        router.replace("/settings#subscription");
        return;
      }
      setStatus("error");
      setErrorMessage(toErrorMessage(error, "Could not finish your Pulse update automatically."));
    }
  }, [router]);

  useEffect(() => {
    if (started.current) {
      return;
    }
    started.current = true;

    void runContinuation(false);
  }, [runContinuation]);

  useEffect(() => {
    if (status !== "billing_pending") {
      return;
    }

    const refreshTimeout = window.setTimeout(() => {
      router.replace("/settings#subscription");
    }, 2_000);

    return () => window.clearTimeout(refreshTimeout);
  }, [router, status]);

  if (status === "error") {
    return (
      <div
        role="alert"
        className="flex flex-col items-start gap-3 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between"
      >
        <p>{errorMessage}</p>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => void runContinuation(true)}
        >
          Try again
        </Button>
      </div>
    );
  }

  return (
    <p
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="flex items-center gap-2 rounded-lg border border-[#c4a882]/25 bg-[#fffcf6] p-3 text-sm text-[#736a58]"
    >
      <Spinner aria-hidden="true" />
      {status === "billing_pending"
        ? "Finishing your Pulse update. Checking billing status…"
        : "Payment method saved. Finishing your Pulse update…"}
    </p>
  );
}

function StartPaidPulseConfirmationDialog(props: {
  errorMessage: string | null;
  status: StartPaidPulseStatus;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const isSubmitting = props.status === "submitting";

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
        {props.status === "billing_pending" ? (
          // This state can outlast the confirmation window, and when it does the
          // check never clears on its own. Offer the billing page in the same
          // breath so the member has a way through instead of a wait with no end.
          <div
            role="status"
            aria-live="polite"
            className="flex flex-col gap-2 rounded-lg border border-[#c4a882]/25 bg-white/50 p-3 text-sm text-[#736a58]"
          >
            <p>
              Billing is still finishing. Check again, or open billing to finish it there.
            </p>
            <BillingPortalButton
              billingScope="member"
              variant="ghost"
              label="Open billing"
            />
          </div>
        ) : null}
        {isSubmitting ? (
          <p role="status" aria-live="polite" className="sr-only">
            Starting Pulse billing.
          </p>
        ) : null}

        <div className="flex flex-col gap-2">
          <Button
            type="button"
            size="xl"
            onClick={props.onConfirm}
            disabled={isSubmitting}
            className="w-full"
          >
            {isSubmitting
              ? "Starting..."
              : props.status === "billing_pending"
                ? "Check status"
                : "Start Pulse"}
          </Button>
          <Button
            type="button"
            size="xl"
            variant="ghost"
            onClick={() => props.onOpenChange(false)}
            disabled={isSubmitting}
            className="w-full"
          >
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
