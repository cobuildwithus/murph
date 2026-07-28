"use client";

import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import {
  requestHostedOnboardingJson,
} from "@/src/components/hosted-onboarding/client-api";
import { ContactSupportAction } from "@/src/components/support/contact-support-action";
import { BillingPortalButton } from "@/src/components/settings/billing-portal-button";
import { Button } from "@/src/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";
import {
  formatHostedBillingPrice,
  getHostedBillingPlanDefinition,
} from "@/src/lib/hosted-onboarding/billing-plans";
import type { HostedBillingPlanUpgradeResult } from "@/src/lib/hosted-onboarding/billing-plan-change-service";
import { cn } from "@/src/lib/utils";

import { PlanFeatureCard } from "./plan-feature-card";
import {
  resolveHostedBillingErrorAction,
  toErrorMessage,
  type HostedBillingErrorAction,
} from "./hosted-settings-sync-helpers";

type HostedImmediateUpgradeTarget =
  | "launch_monthly"
  | "launch_edge_monthly";

const UPGRADE_PRESENTATION = {
  launch_monthly: {
    description: "For more regular one-on-one Murph use.",
    features: [
      "Everything in Group",
      "More private Murph usage",
      "Run more experiments and deeper analysis",
      "Wearable syncing and group activity stay on",
    ],
  },
  launch_edge_monthly: {
    description: "For when you want the full picture.",
    features: [
      "Everything in Pulse",
      "More usage on latest AI models",
      "Murph remembers more of your history",
      "Deeper research and analysis",
    ],
  },
} as const satisfies Record<
  HostedImmediateUpgradeTarget,
  { description: string; features: readonly string[] }
>;

type PlanUpgradeRecovery = HostedBillingErrorAction | null;

const PLAN_UPGRADE_BILLING_RECOVERY_CODES = new Set([
  "HOSTED_BILLING_PLAN_UPGRADE_APPLIED_INVOICE_VOIDED",
  "HOSTED_BILLING_PLAN_UPGRADE_COLLECTION_TIMED_OUT",
  "HOSTED_BILLING_PLAN_UPGRADE_FINANCIAL_STATE_BLOCKED",
  "HOSTED_BILLING_PLAN_UPGRADE_INVOICE_FAILED",
  "HOSTED_BILLING_PLAN_UPGRADE_INVOICE_UNCOLLECTIBLE",
]);
const PLAN_UPGRADE_SUPPORT_RECOVERY_CODES = new Set([
  "HOSTED_BILLING_STRIPE_PLAN_CHANGE_PROVIDER_REJECTED",
]);

export function UpgradeToPulseButton(
  props: Omit<HostedPlanUpgradeButtonProps, "targetPlanCode">,
) {
  return (
    <HostedPlanUpgradeButton
      {...props}
      targetPlanCode="launch_monthly"
    />
  );
}

export function UpgradeToEdgeButton(
  props: Omit<HostedPlanUpgradeButtonProps, "targetPlanCode">,
) {
  return (
    <HostedPlanUpgradeButton
      {...props}
      targetPlanCode="launch_edge_monthly"
    />
  );
}

interface HostedPlanUpgradeButtonProps {
  block?: boolean;
  children?: ReactNode;
  disabled?: boolean;
  onPendingChange?: (pending: boolean) => void;
  presentation?: "banner" | "settings";
  targetPlanCode: HostedImmediateUpgradeTarget;
}

function HostedPlanUpgradeButton(props: HostedPlanUpgradeButtonProps) {
  const targetPlan = getHostedBillingPlanDefinition(props.targetPlanCode);
  const presentation = props.presentation ?? "settings";
  const router = useRouter();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isUpgrading, setIsUpgrading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [recovery, setRecovery] = useState<PlanUpgradeRecovery>(null);
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
          targetPlanCode: props.targetPlanCode,
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
      setErrorMessage(
        toErrorMessage(
          error,
          `Could not upgrade to ${targetPlan.displayName} right now.`,
        ),
      );
      setRecovery(resolvePlanUpgradeRecovery(error));
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

  const label = isUpgrading
    ? "Upgrading..."
    : props.children ?? `Upgrade to ${targetPlan.displayName}`;
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
        <PlanUpgradeConfirmationDialog
          errorMessage={errorMessage}
          isUpgrading={isUpgrading}
          processing={processing}
          recovery={recovery}
          onConfirm={() => void handleUpgrade()}
          onOpenChange={setConfirmationOpenState}
          open={confirmationOpen}
          targetPlanCode={props.targetPlanCode}
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
      <PlanUpgradeConfirmationDialog
        errorMessage={errorMessage}
        isUpgrading={isUpgrading}
        processing={processing}
        recovery={recovery}
        onConfirm={() => void handleUpgrade()}
        onOpenChange={setConfirmationOpenState}
        open={confirmationOpen}
        targetPlanCode={props.targetPlanCode}
      />
    </div>
  );
}

function PlanUpgradeConfirmationDialog(props: {
  errorMessage: string | null;
  isUpgrading: boolean;
  processing: boolean;
  recovery: PlanUpgradeRecovery;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  targetPlanCode: HostedImmediateUpgradeTarget;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-md gap-6 rounded-2xl border border-[#c4a882]/25 bg-[#fffcf6] p-6 text-[#2d3436] ring-[#c4a882]/25 md:p-7">
        <PlanUpgradeConfirmationContent
          errorMessage={props.errorMessage}
          isUpgrading={props.isUpgrading}
          processing={props.processing}
          recovery={props.recovery}
          onCancel={() => props.onOpenChange(false)}
          onConfirm={props.onConfirm}
          targetPlanCode={props.targetPlanCode}
        />
      </DialogContent>
    </Dialog>
  );
}

export function EdgeUpgradeConfirmationContent(props: {
  errorMessage: string | null;
  isUpgrading: boolean;
  processing: boolean;
  recovery: PlanUpgradeRecovery;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <PlanUpgradeConfirmationContent
      {...props}
      targetPlanCode="launch_edge_monthly"
    />
  );
}

function PlanUpgradeConfirmationContent(props: {
  errorMessage: string | null;
  isUpgrading: boolean;
  processing: boolean;
  recovery: PlanUpgradeRecovery;
  onCancel: () => void;
  onConfirm: () => void;
  targetPlanCode: HostedImmediateUpgradeTarget;
}) {
  const targetPlan = getHostedBillingPlanDefinition(props.targetPlanCode);
  const presentation = UPGRADE_PRESENTATION[props.targetPlanCode];
  const priceLabel = formatHostedBillingPrice(
    targetPlan.recurringAmountUsdCents,
  );

  return (
    <>
      <DialogHeader className="pr-10">
        <DialogTitle className="font-serif text-2xl/7 font-semibold tracking-normal text-[#2d3436]">
          Upgrade to {targetPlan.displayName}
        </DialogTitle>
        <DialogDescription className="text-sm leading-6 text-[#736a58]">
          {presentation.description}
        </DialogDescription>
      </DialogHeader>

      <PlanFeatureCard price={priceLabel} features={presentation.features} />

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
        ) : props.errorMessage && props.recovery === "support" ? (
          <ContactSupportAction
            body={`Hi Murph support,\n\nI need help finishing a ${targetPlan.displayName} billing change.`}
            className="w-full"
            subject={`Murph ${targetPlan.displayName} billing support`}
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
                  : `Upgrade to ${targetPlan.displayName}`}
          </Button>
        ) : null}
        <Button
          type="button"
          size="xl"
          variant="ghost"
          onClick={props.onCancel}
          disabled={props.isUpgrading}
          className="w-full"
        >
          {props.errorMessage && props.recovery !== "retry" ? "Close" : "Cancel"}
        </Button>
      </div>
    </>
  );
}

function resolvePlanUpgradeRecovery(error: unknown): PlanUpgradeRecovery {
  return resolveHostedBillingErrorAction({
    billingRecoveryCodes: PLAN_UPGRADE_BILLING_RECOVERY_CODES,
    error,
    supportRecoveryCodes: PLAN_UPGRADE_SUPPORT_RECOVERY_CODES,
  });
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
