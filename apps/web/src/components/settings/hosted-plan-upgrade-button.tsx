"use client";

import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import {
  HostedOnboardingApiError,
  requestHostedOnboardingJson,
} from "@/src/components/hosted-onboarding/client-api";
import { BillingPortalButton } from "@/src/components/settings/billing-portal-button";
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
  "Murph remembers more of your history",
  "Deeper research and analysis",
];

type EdgeUpgradeRecovery = "billing" | "retry" | null;

const EDGE_UPGRADE_BILLING_RECOVERY_CODES = new Set([
  "HOSTED_BILLING_PLAN_UPGRADE_APPLIED_INVOICE_VOIDED",
  "HOSTED_BILLING_PLAN_UPGRADE_COLLECTION_TIMED_OUT",
  "HOSTED_BILLING_PLAN_UPGRADE_FINANCIAL_STATE_BLOCKED",
  "HOSTED_BILLING_PLAN_UPGRADE_INVOICE_FAILED",
  "HOSTED_BILLING_PLAN_UPGRADE_INVOICE_UNCOLLECTIBLE",
]);

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
  const [processing, setProcessing] = useState(false);
  const [recovery, setRecovery] = useState<EdgeUpgradeRecovery>(null);
  const [confirmationOpen, setConfirmationOpen] = useState(false);

  async function handleUpgrade() {
    setErrorMessage(null);
    setProcessing(false);
    setRecovery(null);
    setIsUpgrading(true);
    props.onPendingChange?.(true);
    let redirecting = false;

    try {
      const response = await requestHostedOnboardingJson<HostedBillingPlanUpgradeResult>({
        method: "POST",
        payload: {
          targetPlanCode: "launch_edge_monthly",
        },
        url: "/api/settings/billing/upgrade-plan",
      });

      if (response.status === "processing") {
        setProcessing(true);
        return;
      }

      if (response.status === "payment_required") {
        if (!isHostedStripePaymentActionUrl(response.paymentUrl)) {
          setErrorMessage(
            "Stripe did not return a safe payment page. Open billing to continue.",
          );
          setRecovery("billing");
          return;
        }
        window.location.assign(response.paymentUrl);
        redirecting = true;
        return;
      }

      setConfirmationOpen(false);
      router.refresh();
    } catch (error) {
      setErrorMessage(toErrorMessage(error, "Could not upgrade your plan right now."));
      setRecovery(resolveEdgeUpgradeRecovery(error));
    } finally {
      if (!redirecting) {
        setIsUpgrading(false);
        props.onPendingChange?.(false);
      }
    }
  }

  function setConfirmationOpenState(open: boolean) {
    setConfirmationOpen(open);
    if (!open) {
      setErrorMessage(null);
      setProcessing(false);
      setRecovery(null);
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
          processing={processing}
          recovery={recovery}
          onConfirm={() => void handleUpgrade()}
          onOpenChange={setConfirmationOpenState}
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
        processing={processing}
        recovery={recovery}
        onConfirm={() => void handleUpgrade()}
        onOpenChange={setConfirmationOpenState}
        open={confirmationOpen}
      />
    </div>
  );
}

function EdgeUpgradeConfirmationDialog(props: {
  errorMessage: string | null;
  isUpgrading: boolean;
  processing: boolean;
  recovery: EdgeUpgradeRecovery;
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
        {props.processing ? (
          <p
            role="status"
            aria-live="polite"
            className="rounded-lg border border-[#c4a882]/25 bg-white/50 p-3 text-sm text-[#736a58]"
          >
            Stripe is still processing this invoice. Check the status again shortly.
          </p>
        ) : null}

        <div className="flex flex-col gap-2">
          {props.errorMessage && props.recovery === "billing" ? (
            <BillingPortalButton
              billingScope="member"
              block
              label="Open billing"
              variant="secondary"
            />
          ) : !props.errorMessage || props.recovery === "retry" ? (
            <Button
              type="button"
              size="xl"
              onClick={props.onConfirm}
              disabled={props.isUpgrading}
              className="w-full"
            >
              {props.isUpgrading
                ? "Upgrading..."
                : props.processing
                  ? "Check status"
                  : props.recovery === "retry"
                    ? "Try again"
                    : "Upgrade to Edge"}
            </Button>
          ) : null}
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

function resolveEdgeUpgradeRecovery(error: unknown): EdgeUpgradeRecovery {
  if (!(error instanceof HostedOnboardingApiError)) {
    return "retry";
  }
  if (error.retryable) {
    return "retry";
  }
  return error.code &&
      EDGE_UPGRADE_BILLING_RECOVERY_CODES.has(error.code)
    ? "billing"
    : null;
}

function isHostedStripePaymentActionUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (
      parsed.origin === "https://billing.stripe.com" ||
      parsed.origin === "https://invoice.stripe.com"
    ) &&
      parsed.username === "" &&
      parsed.password === "";
  } catch {
    return false;
  }
}
