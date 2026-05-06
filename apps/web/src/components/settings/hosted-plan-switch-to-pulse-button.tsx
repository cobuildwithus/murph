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

import { toErrorMessage } from "./hosted-settings-sync-helpers";

interface HostedBillingPlanSwitchToPulseResponse {
  effectiveAt: string;
  scheduledBillingPlanCode: "launch_monthly";
  status: "already_scheduled" | "scheduled";
}

const pulsePlan = getHostedBillingPlanDefinition("launch_monthly");
const edgePlan = getHostedBillingPlanDefinition("launch_edge_monthly");
const pulsePriceLabel = formatHostedBillingPlanMonthlyPrice(pulsePlan.recurringAmountUsdCents);
const edgePriceLabel = formatHostedBillingPlanMonthlyPrice(edgePlan.recurringAmountUsdCents);

export function SwitchToPulseButton(props: {
  children?: ReactNode;
  currentPeriodEnd?: string | null;
  disabled?: boolean;
  onPendingChange?: (pending: boolean) => void;
}) {
  const router = useRouter();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);
  const label = isSwitching ? "Scheduling..." : props.children ?? "Switch to Pulse";
  const disabled = props.disabled === true || isSwitching;

  async function handleSwitchToPulse() {
    setErrorMessage(null);
    setIsSwitching(true);
    props.onPendingChange?.(true);

    try {
      await requestHostedOnboardingJson<HostedBillingPlanSwitchToPulseResponse>({
        method: "POST",
        url: "/api/settings/billing/switch-to-pulse",
      });

      setConfirmationOpen(false);
      router.refresh();
    } catch (error) {
      setErrorMessage(toErrorMessage(error, "Could not schedule your plan switch right now."));
    } finally {
      setIsSwitching(false);
      props.onPendingChange?.(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <Button
        type="button"
        variant="outline"
        onClick={() => setConfirmationOpen(true)}
        disabled={disabled}
      >
        {label}
      </Button>
      <p
        role={confirmationOpen || !errorMessage ? undefined : "alert"}
        aria-live="polite"
        className="min-h-[1rem] text-xs leading-tight text-destructive sm:max-w-xs sm:text-right"
      >
        {confirmationOpen ? null : errorMessage}
      </p>
      <PulseSwitchConfirmationDialog
        currentPeriodEnd={props.currentPeriodEnd}
        errorMessage={errorMessage}
        isSwitching={isSwitching}
        onConfirm={() => void handleSwitchToPulse()}
        onOpenChange={setConfirmationOpen}
        open={confirmationOpen}
      />
    </div>
  );
}

function PulseSwitchConfirmationDialog(props: {
  currentPeriodEnd?: string | null;
  errorMessage: string | null;
  isSwitching: boolean;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const renewalDate = formatHostedBillingDate(props.currentPeriodEnd);

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-md gap-6 rounded-2xl border border-[#c4a882]/25 bg-[#fffcf6] p-6 text-[#2d3436] ring-[#c4a882]/25 md:p-7">
        <DialogHeader className="pr-10">
          <DialogTitle className="font-serif text-2xl/7 font-semibold tracking-normal text-[#2d3436]">
            Switch to Pulse
          </DialogTitle>
          <DialogDescription className="text-sm leading-6 text-[#736a58]">
            You keep Edge through {renewalDate}, then Pulse at {pulsePriceLabel}/mo.
          </DialogDescription>
        </DialogHeader>

        <div className="border-y border-[#c4a882]/25 py-2">
          <PlanPriceRow label="Current" name="Edge" price={edgePriceLabel} />
          <div className="mx-1 flex items-center gap-3 py-1 text-[#736a58]">
            <div className="h-px min-w-0 flex-1 bg-[#c4a882]/25" />
            <ArrowRight className="size-4" aria-hidden="true" />
            <div className="h-px min-w-0 flex-1 bg-[#c4a882]/25" />
          </div>
          <PlanPriceRow label="At renewal" name="Pulse" price={pulsePriceLabel} />
        </div>

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
            disabled={props.isSwitching}
            className="w-full"
          >
            {props.isSwitching ? "Scheduling..." : "Confirm switch"}
          </Button>
          <Button
            type="button"
            size="xl"
            variant="ghost"
            onClick={() => props.onOpenChange(false)}
            disabled={props.isSwitching}
            className="w-full"
          >
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PlanPriceRow(props: {
  label: string;
  name: string;
  price: string;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2">
      <div className="min-w-0">
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#736a58]">
          {props.label}
        </p>
        <p className="mt-1 text-sm font-medium text-[#2d3436]">
          {props.name}
        </p>
      </div>
      <p className="shrink-0 font-serif text-3xl/8 font-semibold tracking-normal text-[#2d3436]">
        {props.price}
        <span className="ml-1 font-sans text-sm font-normal text-[#736a58]">/mo</span>
      </p>
    </div>
  );
}

function formatHostedBillingPlanMonthlyPrice(amountUsdCents: number): string {
  return `$${amountUsdCents / 100}`;
}

function formatHostedBillingDate(value: string | null | undefined): string {
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
