"use client";

import { MinusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { requestHostedOnboardingJson } from "@/src/components/hosted-onboarding/client-api";
import { Button } from "@/src/components/ui/button";
import { PaymentButton } from "@/src/components/ui/payment-button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";
import { getHostedBillingPlanDefinition } from "@/src/lib/hosted-onboarding/billing-plans";
import type { HostedBillingPlanUpgradeResult } from "@/src/lib/hosted-onboarding/billing-plan-change-service";

import { PlanFeatureCard } from "./plan-feature-card";
import { toErrorMessage } from "./hosted-settings-sync-helpers";

type BillingConfirmation = "upgrade" | "start-pulse" | "switch-to-pulse";
type StartPaidPulseStatus = "billing_pending" | "idle" | "submitting";

interface HostedBillingPortalResponse {
  url: string;
}

interface HostedPulseTrialStartPaidResponse {
  billingPlanCode: "launch_monthly";
  paymentUrl?: string;
  status: "billing_pending" | "payment_required" | "started";
}

interface HostedBillingPlanSwitchToPulseResponse {
  effectiveAt: string;
  scheduledBillingPlanCode: "launch_monthly";
  status: "already_scheduled" | "scheduled";
}

const pulsePlan = getHostedBillingPlanDefinition("launch_monthly");
const edgePlan = getHostedBillingPlanDefinition("launch_edge_monthly");
const pulsePriceLabel = `$${pulsePlan.recurringAmountUsdCents / 100}`;
const edgePriceLabel = `$${edgePlan.recurringAmountUsdCents / 100}`;

const EDGE_FEATURES = [
  "Everything in Pulse",
  "More usage on latest AI models",
  "Longer experiment context",
  "Deeper research and analysis",
];

const PULSE_FEATURES = [
  "Run experiments, see what changed",
  "Sync your health data",
  "Private before/after outcomes",
  "Chat via iMessage, Telegram, or email",
  "Guided experiment setup",
  "Access to frontier AI models",
];

const EDGE_ONLY_FEATURES = [
  "More usage on latest AI models",
  "Longer experiment context",
  "Deeper research and analysis",
];

export function HostedBillingSettingsAction(props: {
  currentPeriodEnd?: string | null;
  helperText?: string | null;
  showStartPaidPulse?: boolean;
  showSwitchToPulse?: boolean;
  showUpgrade?: boolean;
}) {
  const router = useRouter();
  const [manageOpen, setManageOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<BillingConfirmation | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isOpeningPortal, setIsOpeningPortal] = useState(false);
  const [startPaidPulseStatus, setStartPaidPulseStatus] =
    useState<StartPaidPulseStatus>("idle");

  function openConfirmation(flow: BillingConfirmation) {
    setManageOpen(false);
    setErrorMessage(null);
    setStartPaidPulseStatus("idle");
    setConfirmation(flow);
  }

  function closeConfirmation() {
    setConfirmation(null);
    setErrorMessage(null);
    setStartPaidPulseStatus("idle");
  }

  function handlePaymentSuccess() {
    setConfirmation(null);
    router.refresh();
  }

  function handlePaymentError(error: unknown, fallback: string) {
    setErrorMessage(toErrorMessage(error, fallback));
  }

  async function handleOpenPortal() {
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

  async function doUpgrade() {
    const response = await requestHostedOnboardingJson<HostedBillingPlanUpgradeResult>({
      method: "POST",
      payload: { targetPlanCode: "launch_edge_monthly" },
      url: "/api/settings/billing/upgrade-plan",
    });

    if (response.status === "pending_payment") {
      window.location.assign(response.billingPortalUrl);
    }
  }

  async function doStartPaidPulse() {
    if (startPaidPulseStatus === "submitting") {
      return;
    }

    setErrorMessage(null);
    setStartPaidPulseStatus("submitting");

    try {
      const response = await requestHostedOnboardingJson<HostedPulseTrialStartPaidResponse>({
        method: "POST",
        url: "/api/settings/billing/start-paid-pulse",
      });

      if (response.status === "payment_required") {
        if (!response.paymentUrl) {
          throw new Error("Payment link missing.");
        }
        setStartPaidPulseStatus("idle");
        window.location.assign(response.paymentUrl);
        return;
      }

      if (response.status === "billing_pending") {
        setStartPaidPulseStatus("billing_pending");
        router.refresh();
        return;
      }

      setStartPaidPulseStatus("idle");
      handlePaymentSuccess();
    } catch (error) {
      setStartPaidPulseStatus("idle");
      handlePaymentError(error, "Could not start Pulse right now.");
    }
  }

  async function doSwitchToPulse() {
    await requestHostedOnboardingJson<HostedBillingPlanSwitchToPulseResponse>({
      method: "POST",
      url: "/api/settings/billing/switch-to-pulse",
    });
  }

  return (
    <>
      <div className="flex flex-col items-end gap-3">
        <Button
          type="button"
          variant="ghost"
          onClick={() => setManageOpen(true)}
        >
          Manage subscription
        </Button>
        {props.helperText ? (
          <p className="max-w-xs text-right text-xs leading-tight text-muted-foreground">
            {props.helperText}
          </p>
        ) : null}
      </div>

      <Dialog open={manageOpen} onOpenChange={setManageOpen}>
        <DialogContent className="max-w-md gap-6 rounded-2xl border border-[#c4a882]/25 bg-[#fffcf6] p-6 text-[#2d3436] ring-[#c4a882]/25 md:p-7">
          <DialogHeader className="pr-10">
            <DialogTitle className="font-serif text-2xl/7 font-semibold tracking-normal text-[#2d3436]">
              Manage subscription
            </DialogTitle>
            <DialogDescription className="text-sm leading-6 text-[#736a58]">
              Change your plan or manage billing.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2">
            {props.showUpgrade === true ? (
              <Button
                type="button"
                size="xl"
                onClick={() => openConfirmation("upgrade")}
                className="w-full"
              >
                Upgrade to Edge
              </Button>
            ) : null}
            {props.showStartPaidPulse === true ? (
              <Button
                type="button"
                size="xl"
                onClick={() => openConfirmation("start-pulse")}
                className="w-full"
              >
                Start Pulse plan
              </Button>
            ) : null}
            {props.showSwitchToPulse === true ? (
              <Button
                type="button"
                size="xl"
                variant="secondary"
                onClick={() => openConfirmation("switch-to-pulse")}
                className="w-full"
              >
                Switch to Pulse
              </Button>
            ) : null}
            <Button
              type="button"
              size="xl"
              variant="ghost"
              onClick={() => void handleOpenPortal()}
              disabled={isOpeningPortal}
              className="w-full"
            >
              {isOpeningPortal ? "Opening Stripe..." : "Billing and invoices"}
            </Button>
          </div>

          {errorMessage ? (
            <p
              role="alert"
              aria-live="polite"
              className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive [overflow-wrap:anywhere]"
            >
              {errorMessage}
            </p>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmation === "upgrade"}
        onOpenChange={(open) => { if (!open) closeConfirmation(); }}
      >
        <DialogContent className="max-w-md gap-6 rounded-2xl border border-[#c4a882]/25 bg-[#fffcf6] p-6 text-[#2d3436] ring-[#c4a882]/25 md:p-7">
          <DialogHeader className="pr-10">
            <DialogTitle className="font-serif text-2xl/7 font-semibold tracking-normal text-[#2d3436]">
              Upgrade to Edge
            </DialogTitle>
            <DialogDescription className="text-sm leading-6 text-[#736a58]">
              For when you want the full picture.
            </DialogDescription>
          </DialogHeader>

          <PlanFeatureCard price={edgePriceLabel} features={EDGE_FEATURES} />

          {errorMessage ? (
            <p
              role="alert"
              className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive [overflow-wrap:anywhere]"
            >
              {errorMessage}
            </p>
          ) : null}

          <div className="flex flex-col gap-2">
            <PaymentButton
              size="xl"
              className="w-full"
              idleLabel="Upgrade to Edge"
              onClick={doUpgrade}
              onSuccess={handlePaymentSuccess}
              onError={(error) => handlePaymentError(error, "Could not upgrade your plan right now.")}
            />
            <Button
              type="button"
              size="xl"
              variant="ghost"
              onClick={closeConfirmation}
              className="w-full"
            >
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmation === "start-pulse"}
        onOpenChange={(open) => { if (!open) closeConfirmation(); }}
      >
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

          {errorMessage ? (
            <p
              role="alert"
              className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive [overflow-wrap:anywhere]"
            >
              {errorMessage}
            </p>
          ) : null}
          {startPaidPulseStatus === "billing_pending" ? (
            <p
              role="status"
              aria-live="polite"
              className="rounded-lg border border-[#c4a882]/25 bg-white/50 p-3 text-sm text-[#736a58]"
            >
              Billing is still finishing. Check again shortly.
            </p>
          ) : null}
          {startPaidPulseStatus === "submitting" ? (
            <p role="status" aria-live="polite" className="sr-only">
              Starting Pulse billing.
            </p>
          ) : null}

          <div className="flex flex-col gap-2">
            <Button
              type="button"
              size="xl"
              onClick={() => void doStartPaidPulse()}
              disabled={startPaidPulseStatus === "submitting"}
              className="w-full"
            >
              {startPaidPulseStatus === "submitting"
                ? "Starting..."
                : startPaidPulseStatus === "billing_pending"
                  ? "Check status"
                  : "Start Pulse"}
            </Button>
            <Button
              type="button"
              size="xl"
              variant="ghost"
              onClick={closeConfirmation}
              disabled={startPaidPulseStatus === "submitting"}
              className="w-full"
            >
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmation === "switch-to-pulse"}
        onOpenChange={(open) => { if (!open) closeConfirmation(); }}
      >
        <DialogContent className="max-w-md gap-6 rounded-2xl border border-[#c4a882]/25 bg-[#fffcf6] p-6 text-[#2d3436] ring-[#c4a882]/25 md:p-7">
          <DialogHeader className="pr-10">
            <DialogTitle className="font-serif text-2xl/7 font-semibold tracking-normal text-[#2d3436]">
              Switch to Pulse
            </DialogTitle>
            <DialogDescription className="text-sm leading-6 text-[#736a58]">
              You keep Edge through {formatBillingDate(props.currentPeriodEnd)}, then
              Pulse at {pulsePriceLabel}/mo.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-lg border border-[#c4a882]/25 px-5 py-4">
            <div className="flex items-baseline gap-1">
              <span className="font-serif text-3xl font-semibold tracking-tight text-[#2d3436]">
                {pulsePriceLabel}
              </span>
              <span className="text-sm text-[#736a58]">/ month</span>
            </div>
            <p className="mt-1 text-xs text-[#736a58]">
              Down from {edgePriceLabel}/mo
            </p>
            <ul className="mt-4 flex flex-col gap-2.5">
              {EDGE_ONLY_FEATURES.map((feature) => (
                <li key={feature} className="flex items-start gap-2.5 text-sm text-[#736a58]">
                  <span
                    aria-hidden
                    className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-destructive/10"
                  >
                    <MinusIcon className="size-3 text-destructive/70" strokeWidth={2.5} />
                  </span>
                  {feature}
                </li>
              ))}
            </ul>
          </div>

          {errorMessage ? (
            <p
              role="alert"
              className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive [overflow-wrap:anywhere]"
            >
              {errorMessage}
            </p>
          ) : null}

          <div className="flex flex-col gap-2">
            <PaymentButton
              size="xl"
              className="w-full"
              idleLabel="Confirm switch"
              onClick={doSwitchToPulse}
              onSuccess={handlePaymentSuccess}
              onError={(error) => handlePaymentError(error, "Could not schedule your plan switch right now.")}
            />
            <Button
              type="button"
              size="xl"
              variant="ghost"
              onClick={closeConfirmation}
              className="w-full"
            >
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function formatBillingDate(value: string | null | undefined): string {
  if (!value) {
    return "your next renewal";
  }

  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return "your next renewal";
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(date);
}
