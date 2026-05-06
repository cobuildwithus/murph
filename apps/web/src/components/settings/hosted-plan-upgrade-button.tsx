"use client";

import { ArrowRight, ReceiptText } from "lucide-react";
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
import type { HostedBillingPlanUpgradeResult } from "@/src/lib/hosted-onboarding/billing-plan-change-service";

import { toErrorMessage } from "./hosted-settings-sync-helpers";

const pulsePlan = getHostedBillingPlanDefinition("launch_monthly");
const edgePlan = getHostedBillingPlanDefinition("launch_edge_monthly");
const pulsePriceLabel = formatHostedBillingPlanMonthlyPrice(pulsePlan.recurringAmountUsdCents);
const edgePriceLabel = formatHostedBillingPlanMonthlyPrice(edgePlan.recurringAmountUsdCents);

export function UpgradeToEdgeButton(props: {
  children?: ReactNode;
  disabled?: boolean;
  onPendingChange?: (pending: boolean) => void;
  presentation?: "banner" | "settings";
}) {
  const presentation = props.presentation ?? "settings";
  const router = useRouter();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isUpgrading, setIsUpgrading] = useState(false);
  const [confirmationOpen, setConfirmationOpen] = useState(false);

  async function handleUpgrade() {
    setErrorMessage(null);
    setIsUpgrading(true);
    props.onPendingChange?.(true);

    try {
      const response = await requestHostedOnboardingJson<HostedBillingPlanUpgradeResult>({
        method: "POST",
        payload: {
          targetPlanCode: "launch_edge_monthly",
        },
        url: "/api/settings/billing/upgrade-plan",
      });

      if (response.status === "pending_payment") {
        window.location.assign(response.billingPortalUrl);
        return;
      }

      router.refresh();
    } catch (error) {
      setErrorMessage(toErrorMessage(error, "Could not upgrade your plan right now."));
    } finally {
      setIsUpgrading(false);
      props.onPendingChange?.(false);
    }
  }

  const label = isUpgrading ? "Upgrading..." : props.children ?? "Upgrade to Edge";
  const disabled = props.disabled === true || isUpgrading;

  if (presentation === "banner") {
    return (
      <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
        <Button
          type="button"
          variant="unstyled"
          size="unstyled"
          onClick={() => setConfirmationOpen(true)}
          disabled={disabled}
          className="inline-flex items-center gap-2 self-start rounded-2xl bg-[#5a6e32] px-6 py-3 text-sm font-medium text-white transition-colors duration-200 hover:bg-[#7a8c6e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7a8c6e] focus-visible:ring-offset-2 sm:self-center"
        >
          {label}
          <ArrowRight className="size-4" aria-hidden="true" />
        </Button>
        <p
          role="alert"
          aria-live="polite"
          className="min-h-[1rem] max-w-48 text-xs leading-tight text-destructive sm:text-right"
        >
          {errorMessage}
        </p>
        <EdgeUpgradeConfirmationDialog
          errorMessage={errorMessage}
          isUpgrading={isUpgrading}
          onConfirm={() => void handleUpgrade()}
          onOpenChange={setConfirmationOpen}
          open={confirmationOpen}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <Button type="button" onClick={() => setConfirmationOpen(true)} disabled={disabled}>
        {label}
      </Button>
      <p
        role="alert"
        aria-live="polite"
        className="min-h-[1rem] text-xs leading-tight text-destructive sm:max-w-xs sm:text-right"
      >
        {errorMessage}
      </p>
      <EdgeUpgradeConfirmationDialog
        errorMessage={errorMessage}
        isUpgrading={isUpgrading}
        onConfirm={() => void handleUpgrade()}
        onOpenChange={setConfirmationOpen}
        open={confirmationOpen}
      />
    </div>
  );
}

function EdgeUpgradeConfirmationDialog(props: {
  errorMessage: string | null;
  isUpgrading: boolean;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-md gap-6 rounded-2xl border border-[#c4a882]/25 bg-[#fffcf6] p-6 text-[#2d3436] ring-[#c4a882]/25 md:p-7">
        <DialogHeader className="gap-3 pr-10">
          <div className="flex size-10 items-center justify-center rounded-full border border-[#c4a882]/30 bg-[#c4a882]/15 text-[#5a6e32]">
            <ReceiptText className="size-5" aria-hidden="true" />
          </div>
          <div className="space-y-2">
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#736a58]">
              Billing change
            </p>
            <DialogTitle className="font-serif text-2xl/7 font-semibold tracking-normal text-[#2d3436]">
              Confirm Edge upgrade
            </DialogTitle>
            <DialogDescription className="text-sm leading-6 text-[#736a58]">
              Edge is {edgePriceLabel}/month. Your current Pulse plan is {pulsePriceLabel}/month.
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="border-y border-[#c4a882]/25 py-2">
          <PlanPriceRow label="Current" name="Pulse" price={pulsePriceLabel} />
          <div className="mx-1 flex items-center gap-3 py-1 text-[#736a58]">
            <div className="h-px min-w-0 flex-1 bg-[#c4a882]/25" />
            <ArrowRight className="size-4" aria-hidden="true" />
            <div className="h-px min-w-0 flex-1 bg-[#c4a882]/25" />
          </div>
          <PlanPriceRow emphasized label="New" name="Edge" price={edgePriceLabel} />
        </div>

        <p className="text-sm leading-6 text-[#736a58]">
          Edge adds more usage, longer context, and deeper analysis. Stripe may invoice a prorated
          amount today for the rest of your current billing period.
        </p>

        {props.errorMessage ? (
          <p
            role="alert"
            className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive"
          >
            {props.errorMessage}
          </p>
        ) : null}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={() => props.onOpenChange(false)}
            disabled={props.isUpgrading}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={props.onConfirm}
            disabled={props.isUpgrading}
            className="rounded-2xl bg-[#5a6e32] px-5 text-white hover:bg-[#7a8c6e]"
          >
            {props.isUpgrading ? "Upgrading..." : "Confirm upgrade"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PlanPriceRow(props: {
  emphasized?: boolean;
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
      <p
        className={
          props.emphasized
            ? "shrink-0 font-serif text-3xl/8 font-semibold tracking-normal text-[#5a6e32]"
            : "shrink-0 font-serif text-3xl/8 font-semibold tracking-normal text-[#2d3436]"
        }
      >
        {props.price}
        <span className="ml-1 font-sans text-sm font-normal text-[#736a58]">/mo</span>
      </p>
    </div>
  );
}

function formatHostedBillingPlanMonthlyPrice(amountUsdCents: number): string {
  return `$${amountUsdCents / 100}`;
}
