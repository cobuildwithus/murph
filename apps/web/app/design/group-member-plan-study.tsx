"use client";

import { HostedBillingSettings } from "@/src/components/settings/hosted-billing-settings";

export function GroupMemberPlanStudy() {
  return (
    <div
      className="flex flex-col gap-8"
      data-design-section="group-member-plan"
      id="group-member-plan-section"
    >
      <StudyState label="Confirmed group member on the free trial">
        <div inert>
          <HostedBillingSettings
            authenticated
            billingStatus="active"
            canStartPaidPulse
            canSwitchToGroup
            currentBillingPhase="trial"
            currentBillingPlanCode="launch_monthly"
            currentCheckoutOffer="pulse_trial_7d"
            currentPeriodEnd={new Date("2026-08-12T04:00:00.000Z")}
            showGroupPlan
          />
        </div>
      </StudyState>

      <StudyState label="Payment method saved before starting Core">
        <div inert>
          <HostedBillingSettings
            authenticated
            billingStatus="paused"
            canStartPaidPulse
            currentBillingPlanCode="launch_monthly"
            currentCheckoutOffer="pulse_trial_7d"
            groupPaymentMethodSaved
            showGroupPlan
          />
        </div>
      </StudyState>

      <StudyState label="Group member on the $3.50 Core plan">
        <div inert>
          <HostedBillingSettings
            authenticated
            billingStatus="active"
            canUpgradeToEdge
            canUpgradeToPulse
            currentBillingPhase="paid"
            currentBillingPlanCode="launch_group_monthly"
            currentPeriodEnd={new Date("2026-08-27T04:00:00.000Z")}
            showGroupPlan
          />
        </div>
      </StudyState>

      <StudyState label="Pulse stays active until the scheduled Core switch">
        <div inert>
          <HostedBillingSettings
            authenticated
            billingStatus="active"
            currentBillingPhase="paid"
            currentBillingPlanCode="launch_monthly"
            currentPeriodEnd={new Date("2026-08-27T04:00:00.000Z")}
            scheduledBillingEffectiveAt={new Date("2026-08-27T04:00:00.000Z")}
            scheduledBillingPlanCode="launch_group_monthly"
            showGroupPlan
          />
        </div>
      </StudyState>
    </div>
  );
}

function StudyState(props: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        {props.label}
      </p>
      {props.children}
    </div>
  );
}
