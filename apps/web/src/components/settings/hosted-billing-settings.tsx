import {
  getHostedBillingPlanDefinition,
  parseHostedBillingPlanCode,
} from "@/src/lib/hosted-onboarding/billing-plans";

import { HostedBillingSettingsAction } from "./hosted-billing-settings-action";
import { HostedSettingsSessionState } from "./hosted-settings-session-state";

export function HostedBillingSettings(props: {
  authenticated: boolean;
  canUpgradeToEdge?: boolean;
  currentBillingPlanCode?: unknown;
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
  const currentPlanPrice = currentPlan
    ? `$${Math.round(currentPlan.recurringAmountUsdCents / 100)} / month`
    : "Syncing";

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-muted/40 p-5 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Current plan
        </p>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p className="font-serif text-3xl font-normal tracking-tight text-foreground">
            {currentPlan?.displayName ?? "Plan syncing"}
          </p>
          <p className="text-sm text-muted-foreground">
            {currentPlanPrice}
          </p>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Manage your plan and payment details.
        </p>
      </div>
      <HostedBillingSettingsAction
        showUpgrade={props.canUpgradeToEdge === true}
      />
    </div>
  );
}
