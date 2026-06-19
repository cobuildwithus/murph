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
    currentBillingPhase !== "paid" &&
    currentCheckoutOffer === HOSTED_PULSE_TRIAL_OFFER;
  const pendingPulseSwitchDate = hasPendingPulseSwitch
    ? formatHostedBillingDate(scheduledBillingEffectiveAt)
    : null;
  const scheduledPlanPrice = scheduledPlan
    ? `$${Math.round(scheduledPlan.recurringAmountUsdCents / 100)} / month`
    : null;
  const billingActionHelperText = hasPendingPulseSwitch
    ? "Want to keep Edge? Contact support and we'll help."
    : null;

  const planDisplayName = isPulseTrial
    ? "Pulse trial"
    : currentPlan?.displayName ?? "Plan syncing";

  const statusChip = hasPendingPulseSwitch
    ? { label: "Switching", sage: false }
    : null;

  return (
    <div className="flex flex-col gap-3 pb-2 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p className="font-serif text-2xl font-semibold tracking-tight text-foreground">
            {planDisplayName}
          </p>
          {statusChip ? (
            <span className="inline-flex items-center gap-1.5 rounded-sm bg-[rgba(196,168,130,0.15)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.11em] text-[#736a58]">
              {statusChip.label}
            </span>
          ) : null}
        </div>
        {hasPendingPulseSwitch && pendingPulseSwitchDate ? (
          <p className="mt-1.5 text-sm text-muted-foreground">
            Pulse starts {pendingPulseSwitchDate}{scheduledPlanPrice ? ` at ${scheduledPlanPrice}` : ""}
          </p>
        ) : null}
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
