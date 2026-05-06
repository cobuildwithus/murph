import {
  HOSTED_PULSE_TRIAL_OFFER,
  getHostedBillingPlanDefinition,
  parseHostedBillingCheckoutOffer,
  parseHostedBillingPhase,
  parseHostedBillingPlanCode,
} from "@/src/lib/hosted-onboarding/billing-plans";

import { HostedBillingSettingsAction } from "./hosted-billing-settings-action";
import { HostedSettingsSessionState } from "./hosted-settings-session-state";

export function HostedBillingSettings(props: {
  authenticated: boolean;
  canStartPaidPulse?: boolean;
  canSwitchToPulse?: boolean;
  canUpgradeToEdge?: boolean;
  currentBillingPhase?: unknown;
  currentCheckoutOffer?: unknown;
  currentBillingPlanCode?: unknown;
  currentPeriodEnd?: Date | null;
  scheduledBillingEffectiveAt?: Date | null;
  scheduledBillingPlanCode?: unknown;
}) {
  if (!props.authenticated) {
    return (
      <HostedSettingsSessionState
        authenticated={props.authenticated}
        signedOutDescription="Sign in to manage your subscription."
      />
    );
  }

  const currentPlanCode = parseHostedBillingPlanCode(props.currentBillingPlanCode);
  const currentPlan = currentPlanCode ? getHostedBillingPlanDefinition(currentPlanCode) : null;
  const currentBillingPhase = parseHostedBillingPhase(props.currentBillingPhase);
  const currentCheckoutOffer = parseHostedBillingCheckoutOffer(props.currentCheckoutOffer);
  const scheduledPlanCode = parseHostedBillingPlanCode(props.scheduledBillingPlanCode);
  const scheduledPlan = scheduledPlanCode ? getHostedBillingPlanDefinition(scheduledPlanCode) : null;
  const scheduledBillingEffectiveAt =
    props.scheduledBillingEffectiveAt instanceof Date
      ? props.scheduledBillingEffectiveAt
      : null;
  const hasPendingPulseSwitch =
    currentPlanCode === "launch_edge_monthly" &&
    scheduledPlanCode === "launch_monthly" &&
    scheduledBillingEffectiveAt !== null;
  const isPulseTrial =
    currentPlanCode === "launch_monthly" &&
    currentBillingPhase === "trial" &&
    currentCheckoutOffer === HOSTED_PULSE_TRIAL_OFFER;
  const currentPlanPrice = currentPlan
    ? `${isPulseTrial ? "Then " : ""}$${Math.round(currentPlan.recurringAmountUsdCents / 100)} / month`
    : "Syncing";
  const pendingPulseSwitchDate = hasPendingPulseSwitch
    ? formatHostedBillingDate(scheduledBillingEffectiveAt)
    : null;
  const scheduledPlanPrice = scheduledPlan
    ? `$${Math.round(scheduledPlan.recurringAmountUsdCents / 100)} / month`
    : null;
  const billingActionHelperText = hasPendingPulseSwitch
    ? "Want to keep Edge? Contact support and we'll help."
    : isPulseTrial
    ? "Start Pulse when trial credits are used up."
    : null;

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-muted/40 p-5 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Current plan
        </p>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p className="font-serif text-3xl font-normal tracking-tight text-foreground">
            {isPulseTrial ? "Pulse trial" : currentPlan?.displayName ?? "Plan syncing"}
          </p>
          <p className="text-sm text-muted-foreground">
            {currentPlanPrice}
          </p>
        </div>
        {hasPendingPulseSwitch && pendingPulseSwitchDate ? (
          <div className="mt-2 space-y-1 text-sm text-muted-foreground">
            <p>
              Pulse starts on {pendingPulseSwitchDate}. Edge remains active until then.
            </p>
            {scheduledPlanPrice ? <p>Then {scheduledPlanPrice}</p> : null}
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            Manage invoices, billing details, and payment methods.
          </p>
        )}
      </div>
      <HostedBillingSettingsAction
        currentPeriodEnd={props.currentPeriodEnd?.toISOString() ?? null}
        helperText={billingActionHelperText}
        showSwitchToPulse={props.canSwitchToPulse === true && !hasPendingPulseSwitch}
        showStartPaidPulse={props.canStartPaidPulse === true && !hasPendingPulseSwitch}
        showUpgrade={props.canUpgradeToEdge === true}
      />
    </div>
  );
}

function formatHostedBillingDate(value: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(value);
}
