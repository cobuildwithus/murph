"use client";

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
import type { HostedBillingPlanUpgradeResult } from "@/src/lib/hosted-onboarding/billing-plan-change-service";
import {
  formatHostedBillingPrice,
  getHostedBillingPlanDefinition,
  type HostedBillingPlanCode,
} from "@/src/lib/hosted-onboarding/billing-plans";
import type { HostedBillingPlanSwitchResult } from "@/src/lib/hosted-onboarding/billing-plan-switch-to-pulse-service";
import { cn } from "@/src/lib/utils";

import { toErrorMessage } from "./hosted-settings-sync-helpers";

export function HostedPlanChangeButton(props: {
  block?: boolean;
  children?: ReactNode;
  currentPeriodEnd?: string | null;
  disabled?: boolean;
  targetPlanCode: HostedBillingPlanCode;
} & (
  | {
    expectedCurrentPlanCode: HostedBillingPlanCode;
    mode: "upgrade";
  }
  | {
    expectedCurrentPlanCode?: never;
    mode: "schedule";
  }
) & {
  primary?: boolean;
}) {
  const router = useRouter();
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const plan = getHostedBillingPlanDefinition(props.targetPlanCode);
  const verb = props.mode === "schedule" ? "Switch" : "Upgrade";
  const label = pending
    ? props.mode === "schedule" ? "Scheduling..." : "Opening Stripe..."
    : props.children ?? `${verb} to ${plan.displayName}`;

  async function handleConfirm() {
    setErrorMessage(null);
    setPending(true);

    try {
      const payload = {
        ...(props.mode === "upgrade" && props.expectedCurrentPlanCode
          ? { expectedCurrentPlanCode: props.expectedCurrentPlanCode }
          : {}),
        targetPlanCode: props.targetPlanCode,
      };
      if (props.mode === "schedule") {
        await requestHostedOnboardingJson<HostedBillingPlanSwitchResult>({
          method: "POST",
          payload,
          url: "/api/settings/billing/switch-plan",
        });
      } else {
        const response =
          await requestHostedOnboardingJson<HostedBillingPlanUpgradeResult>({
            method: "POST",
            payload,
            url: "/api/settings/billing/upgrade-plan",
          });
        if (response.status === "pending_payment") {
          window.location.assign(response.paymentUrl);
          return;
        }
      }

      setConfirmationOpen(false);
      router.refresh();
      setPending(false);
    } catch (error) {
      setErrorMessage(toErrorMessage(
        error,
        `Could not ${props.mode === "schedule" ? "schedule" : "make"} this plan change right now.`,
      ));
      setPending(false);
    }
  }

  return (
    <div className={cn(
      "flex flex-col gap-2",
      props.block ? "items-stretch" : "items-start sm:items-end",
    )}>
      <Button
        type="button"
        variant={
          props.primary ? "default" : props.block ? "secondary" : "default"
        }
        onClick={props.mode === "schedule"
          ? () => setConfirmationOpen(true)
          : () => void handleConfirm()}
        disabled={props.disabled === true || pending}
        className={props.block ? "w-full" : undefined}
      >
        {label}
      </Button>
      {props.mode === "upgrade" && errorMessage ? (
        <p
          role="alert"
          aria-live="polite"
          className="text-xs leading-tight text-destructive sm:max-w-xs sm:text-right"
        >
          {errorMessage}
        </p>
      ) : null}
      {props.mode === "schedule" ? (
        <Dialog open={confirmationOpen} onOpenChange={setConfirmationOpen}>
          <DialogContent className="max-w-md gap-6 rounded-2xl border border-[#c4a882]/25 bg-[#fffcf6] p-6 text-[#2d3436] ring-[#c4a882]/25 md:p-7">
            <HostedPlanChangeConfirmationContent
              currentPeriodEnd={props.currentPeriodEnd}
              errorMessage={errorMessage}
              onClose={() => setConfirmationOpen(false)}
              onConfirm={() => void handleConfirm()}
              pending={pending}
              targetPlanCode={props.targetPlanCode}
            />
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

export function HostedPlanChangeConfirmationContent(props: {
  currentPeriodEnd?: string | null;
  errorMessage: string | null;
  onClose: () => void;
  onConfirm: () => void;
  pending: boolean;
  targetPlanCode: HostedBillingPlanCode;
}) {
  const plan = getHostedBillingPlanDefinition(props.targetPlanCode);
  const price = formatHostedBillingPrice(
    plan.recurringAmountUsdCents,
  );
  const effectiveDate = formatHostedBillingDate(props.currentPeriodEnd);

  return (
    <>
      <DialogHeader className="pr-10">
        <DialogTitle className="font-serif text-2xl/7 font-semibold tracking-normal text-[#2d3436]">
          Switch to {plan.displayName}
        </DialogTitle>
        <DialogDescription className="text-sm leading-6 text-[#736a58]">
          Your current plan continues through {effectiveDate}. Then {plan.displayName} starts at {price}/month.
        </DialogDescription>
      </DialogHeader>

      <div className="rounded-xl border border-[#c4a882]/25 bg-white/55 px-5 py-4">
        <p className="font-serif text-3xl font-semibold tracking-tight text-[#2d3436]">
          {price}
          <span className="ml-1 font-sans text-sm font-normal text-[#736a58]">
            / month
          </span>
        </p>
        {props.targetPlanCode === "launch_group_monthly" ? (
          <p className="mt-2 text-sm leading-6 text-[#736a58]">
            For confirmed group members who want wearable syncing, group
            participation, and lighter private Murph usage.
          </p>
        ) : null}
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
          disabled={props.pending}
          className="w-full"
        >
          {props.pending ? "Scheduling..." : "Confirm switch"}
        </Button>
        <Button
          type="button"
          size="xl"
          variant="ghost"
          onClick={props.onClose}
          disabled={props.pending}
          className="w-full"
        >
          Cancel
        </Button>
      </div>
    </>
  );
}

function formatHostedBillingDate(value: string | null | undefined): string {
  if (!value) {
    return "your current billing period";
  }

  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return "your current billing period";
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(date);
}
