"use client";

import { CheckIcon, MinusIcon } from "lucide-react";
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
import {
  formatHostedBillingPrice,
  getHostedBillingPlanDefinition,
  type HostedBillingPlanCode,
} from "@/src/lib/hosted-onboarding/billing-plans";
import { cn } from "@/src/lib/utils";

import { toErrorMessage } from "./hosted-settings-sync-helpers";

interface HostedBillingPlanSwitchResponse {
  effectiveAt: string;
  scheduledBillingPlanCode: HostedBillingPlanCode;
  status: "already_scheduled" | "scheduled";
}

type HostedScheduledPlanTarget =
  | "launch_group_monthly"
  | "launch_monthly";

const groupPlan = getHostedBillingPlanDefinition("launch_group_monthly");
const pulsePlan = getHostedBillingPlanDefinition("launch_monthly");
const edgePlan = getHostedBillingPlanDefinition("launch_edge_monthly");
const groupPriceLabel = formatHostedBillingPrice(
  groupPlan.recurringAmountUsdCents,
);
const pulsePriceLabel = formatHostedBillingPrice(
  pulsePlan.recurringAmountUsdCents,
);
const edgePriceLabel = formatHostedBillingPrice(
  edgePlan.recurringAmountUsdCents,
);

interface SwitchPlanButtonProps {
  block?: boolean;
  children?: ReactNode;
  currentPlanCode?: HostedBillingPlanCode;
  currentPeriodEnd?: string | null;
  disabled?: boolean;
  onPendingChange?: (pending: boolean) => void;
  targetPlanCode: HostedScheduledPlanTarget;
}

export function SwitchToPulseButton(
  props: Omit<SwitchPlanButtonProps, "targetPlanCode">,
) {
  return <SwitchPlanButton {...props} targetPlanCode="launch_monthly" />;
}

export function SwitchToGroupButton(
  props: Omit<SwitchPlanButtonProps, "targetPlanCode">,
) {
  return <SwitchPlanButton {...props} targetPlanCode="launch_group_monthly" />;
}

function SwitchPlanButton(props: SwitchPlanButtonProps) {
  const targetPlan = getHostedBillingPlanDefinition(props.targetPlanCode);
  const router = useRouter();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);
  const label = isSwitching
    ? "Scheduling..."
    : props.children ?? `Switch to ${targetPlan.displayName}`;
  const disabled = props.disabled === true || isSwitching;

  async function handleSwitchPlan() {
    setErrorMessage(null);
    setIsSwitching(true);
    props.onPendingChange?.(true);

    try {
      const request = props.targetPlanCode === "launch_monthly"
        ? {
            method: "POST" as const,
            url: "/api/settings/billing/switch-to-pulse",
          }
        : {
            method: "POST" as const,
            payload: {
              targetPlanCode: props.targetPlanCode,
            },
            url: "/api/settings/billing/switch-plan",
          };
      await requestHostedOnboardingJson<HostedBillingPlanSwitchResponse>(
        request,
      );

      setConfirmationOpen(false);
      router.refresh();
    } catch (error) {
      setErrorMessage(
        toErrorMessage(
          error,
          `Could not schedule ${targetPlan.displayName} right now.`,
        ),
      );
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
      <PlanSwitchConfirmationDialog
        currentPlanCode={props.currentPlanCode ?? "launch_edge_monthly"}
        currentPeriodEnd={props.currentPeriodEnd}
        errorMessage={errorMessage}
        isSwitching={isSwitching}
        onConfirm={() => void handleSwitchPlan()}
        onOpenChange={setConfirmationOpen}
        open={confirmationOpen}
        targetPlanCode={props.targetPlanCode}
      />
    </div>
  );
}

const PULSE_DOWNGRADE_CHANGES = [
  "More usage on latest AI models",
  "Murph remembers more of your history",
  "Deeper research and analysis",
];

const GROUP_PLAN_CONTINUITIES = [
  "Wearable syncing stays on",
  "Group activity stays current",
  "Private Murph continues with a lighter monthly allowance",
];

function PlanSwitchConfirmationDialog(props: {
  currentPlanCode: HostedBillingPlanCode;
  currentPeriodEnd?: string | null;
  errorMessage: string | null;
  isSwitching: boolean;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  targetPlanCode: HostedScheduledPlanTarget;
}) {
  const renewalDate = formatHostedBillingDate(props.currentPeriodEnd);
  const currentPlan = getHostedBillingPlanDefinition(props.currentPlanCode);
  const targetPlan = getHostedBillingPlanDefinition(props.targetPlanCode);
  const targetPriceLabel = props.targetPlanCode === "launch_group_monthly"
    ? groupPriceLabel
    : pulsePriceLabel;
  const targetIsGroup = props.targetPlanCode === "launch_group_monthly";

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-md gap-6 rounded-2xl border border-[#c4a882]/25 bg-[#fffcf6] p-6 text-[#2d3436] ring-[#c4a882]/25 md:p-7">
        <DialogHeader className="pr-10">
          <DialogTitle className="font-serif text-2xl/7 font-semibold tracking-normal text-[#2d3436]">
            Switch to {targetPlan.displayName}
          </DialogTitle>
          <DialogDescription className="text-sm leading-6 text-[#736a58]">
            You keep {currentPlan.displayName} through {renewalDate}, then{" "}
            {targetPlan.displayName} at {targetPriceLabel}/mo.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-[#c4a882]/25 px-5 py-4">
          <div className="flex items-baseline gap-1">
            <span className="font-serif text-3xl font-semibold tracking-tight text-[#2d3436]">
              {targetPriceLabel}
            </span>
            <span className="text-sm text-[#736a58]">/ month</span>
          </div>
          <p className="mt-1 text-xs text-[#736a58]">
            Down from{" "}
            {props.currentPlanCode === "launch_edge_monthly"
              ? edgePriceLabel
              : pulsePriceLabel}
            /mo
          </p>
          <ul className="mt-4 flex flex-col gap-2.5">
            {(targetIsGroup
              ? GROUP_PLAN_CONTINUITIES
              : PULSE_DOWNGRADE_CHANGES
            ).map((feature) => (
              <li key={feature} className="flex items-start gap-2.5 text-sm text-[#736a58]">
                <span
                  aria-hidden
                  className={cn(
                    "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full",
                    targetIsGroup
                      ? "bg-primary/10"
                      : "bg-destructive/10",
                  )}
                >
                  {targetIsGroup ? (
                    <CheckIcon className="size-3 text-primary" strokeWidth={2.5} />
                  ) : (
                    <MinusIcon className="size-3 text-destructive/70" strokeWidth={2.5} />
                  )}
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
