"use client";

import { MinusIcon } from "lucide-react";
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
import { EDGE_ONLY_FEATURES } from "@/src/lib/hosted-onboarding/plan-features";
import { cn } from "@/src/lib/utils";

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
  block?: boolean;
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
    <div className={cn("flex flex-col gap-2", props.block ? "items-stretch" : "items-start sm:items-end")}>
      <Button
        type="button"
        variant={props.block ? "secondary" : "ghost"}
        onClick={() => setConfirmationOpen(true)}
        disabled={disabled}
        className={props.block ? "w-full" : undefined}
      >
        {label}
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
                <span aria-hidden className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-destructive/10">
                  <MinusIcon className="size-3 text-destructive/70" strokeWidth={2.5} />
                </span>
                {feature}
              </li>
            ))}
          </ul>
        </div>

        {props.errorMessage ? (
          <p
            role="alert"
            className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive [overflow-wrap:anywhere]"
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
