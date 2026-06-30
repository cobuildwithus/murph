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
import type { HostedBillingPlanUpgradeResult } from "@/src/lib/hosted-onboarding/billing-plan-change-service";
import { cn } from "@/src/lib/utils";

import { PlanFeatureCard } from "./plan-feature-card";
import { toErrorMessage } from "./hosted-settings-sync-helpers";

const edgePlan = getHostedBillingPlanDefinition("launch_edge_monthly");
const edgePriceLabel = formatHostedBillingPlanMonthlyPrice(edgePlan.recurringAmountUsdCents);

const EDGE_FEATURES = [
  "Everything in Pulse",
  "More usage on latest AI models",
  "Longer experiment context",
  "Deeper research and analysis",
];

export function UpgradeToEdgeButton(props: {
  block?: boolean;
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
    <div className={cn("flex flex-col gap-2", props.block ? "items-stretch" : "items-start sm:items-end")}>
      <Button
        type="button"
        variant={props.block ? "secondary" : "default"}
        onClick={() => setConfirmationOpen(true)}
        disabled={disabled}
        className={props.block ? "w-full" : undefined}
      >
        {label}
      </Button>
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
        <DialogHeader className="pr-10">
          <DialogTitle className="font-serif text-2xl/7 font-semibold tracking-normal text-[#2d3436]">
            Upgrade to Edge
          </DialogTitle>
          <DialogDescription className="text-sm leading-6 text-[#736a58]">
            For when you want the full picture.
          </DialogDescription>
        </DialogHeader>

        <PlanFeatureCard price={edgePriceLabel} features={EDGE_FEATURES} />

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
            disabled={props.isUpgrading}
            className="w-full"
          >
            {props.isUpgrading ? "Upgrading..." : "Upgrade to Edge"}
          </Button>
          <Button
            type="button"
            size="xl"
            variant="ghost"
            onClick={() => props.onOpenChange(false)}
            disabled={props.isUpgrading}
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
