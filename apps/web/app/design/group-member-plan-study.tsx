"use client";

import type {
  HostedPlanUsageAvailableStatus,
} from "@murphai/hosted-execution/plan-usage";

import { UsageLimitBanner } from "@/src/components/home/usage-limit-banner";
import { HostedBillingSettings } from "@/src/components/settings/hosted-billing-settings";
import { HostedPlanUpdateReturn } from "@/src/components/settings/hosted-plan-update-return";
import {
  StartPaidPlanConfirmationContent,
} from "@/src/components/settings/hosted-start-paid-pulse-button";

const CORE_USAGE_STATUS: HostedPlanUsageAvailableStatus = {
  accessKind: "paid",
  forecast: {
    estimatedDaysRemaining: 7,
    estimatedExhaustionAt: "2026-08-16T04:00:00.000Z",
  },
  generatedAt: "2026-07-27T04:00:00.000Z",
  periodEnd: "2026-08-27T04:00:00.000Z",
  periodKind: "monthly",
  periodStart: "2026-07-27T04:00:00.000Z",
  planCode: "launch_group_monthly",
  planName: "Group",
  recommendedAction: null,
  remainingPercent: 72,
  status: "active",
  usedPercent: 28,
};

const MAX_USAGE_STATUS: HostedPlanUsageAvailableStatus = {
  accessKind: "paid",
  forecast: null,
  generatedAt: "2026-08-07T20:00:00.000Z",
  periodEnd: "2026-09-07T20:00:00.000Z",
  periodKind: "monthly",
  periodStart: "2026-08-07T20:00:00.000Z",
  planCode: "launch_max_monthly",
  planName: "Max",
  recommendedAction: null,
  remainingPercent: 84,
  status: "active",
  usedPercent: 16,
};

export function GroupMemberPlanStudy() {
  return (
    <div
      className="flex flex-col gap-8"
      data-design-section="group-member-plan"
      id="group-member-plan-section"
    >
      <StudyState
        label="Confirmed group member on the free trial"
        state="trial"
      >
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

      <StudyState
        label="Paused Pulse trial ready to resume after payment recovery"
        state="payment-recovery"
      >
        <div inert>
          <HostedBillingSettings
            authenticated
            billingStatus="paused"
            canStartPaidPulse
            currentBillingPhase="trial"
            currentBillingPlanCode="launch_monthly"
            currentCheckoutOffer="pulse_trial_7d"
            groupPaymentMethodSaved
            showGroupPlan
          />
        </div>
      </StudyState>

      <StudyState
        label="Core trial conversion is claimed and awaiting Stripe confirmation"
        state="payment-recovery-pending"
      >
        <div inert>
          <HostedBillingSettings
            authenticated
            billingStatus="incomplete"
            canStartPaidPulse
            canSwitchToGroup
            currentBillingPhase="trial"
            currentBillingPlanCode="launch_group_monthly"
            currentCheckoutOffer="pulse_trial_7d"
            showGroupPlan
          />
        </div>
      </StudyState>

      <StudyState
        label="Exact Core status check while Stripe confirmation is pending"
        state="payment-recovery-pending-confirmation"
      >
        <div
          className="mx-auto grid w-full max-w-md gap-6 rounded-2xl border border-[#c4a882]/25 bg-[#fffcf6] p-6 text-[#2d3436] ring-[#c4a882]/25 md:p-7"
          inert
        >
          <StartPaidPlanConfirmationContent
            errorMessage={null}
            onClose={() => undefined}
            onConfirm={() => undefined}
            staticPresentation
            status="billing_pending"
            targetPlanCode="launch_group_monthly"
            timing="now"
          />
        </div>
      </StudyState>

      <StudyState
        label="Group member on the $3.50 Core plan"
        state="active-core-usage"
      >
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
            usageStatus={CORE_USAGE_STATUS}
          />
        </div>
      </StudyState>

      <StudyState
        label="Edge member can upgrade to the $50 Max plan"
        state="edge-upgrade-max"
      >
        <div inert>
          <HostedBillingSettings
            authenticated
            billingStatus="active"
            canUpgradeToMax
            currentBillingPhase="paid"
            currentBillingPlanCode="launch_edge_monthly"
            currentPeriodEnd={new Date("2026-09-07T20:00:00.000Z")}
            showMaxPlan
          />
        </div>
      </StudyState>

      <StudyState
        label="Max stays active until the scheduled Edge downgrade"
        state="active-max-scheduled-edge"
      >
        <div inert>
          <HostedBillingSettings
            authenticated
            billingStatus="active"
            canSwitchToEdge
            currentBillingPhase="paid"
            currentBillingPlanCode="launch_max_monthly"
            currentPeriodEnd={new Date("2026-09-07T20:00:00.000Z")}
            scheduledBillingEffectiveAt={new Date("2026-09-07T20:00:00.000Z")}
            scheduledBillingPlanCode="launch_edge_monthly"
            showMaxPlan
            usageStatus={MAX_USAGE_STATUS}
          />
        </div>
      </StudyState>

      <StudyState
        label="Paid plan lapsed while Stripe recovery is available"
        state="lapsed-pulse"
      >
        <div inert>
          <HostedBillingSettings
            authenticated
            billingStatus="past_due"
            currentBillingPhase="paid"
            currentBillingPlanCode="launch_monthly"
            currentCheckoutOffer="standard"
            showGroupPlan
          />
        </div>
      </StudyState>

      <StudyState
        label="Family-sponsored member with billing owned by the sponsor"
        state="family-sponsored"
      >
        <div inert>
          <HostedBillingSettings
            authenticated
            billingStatus="active"
            currentBillingPhase="paid"
            currentBillingPlanCode="launch_edge_monthly"
            familyState="sponsored"
            showGroupPlan
          />
        </div>
      </StudyState>

      <StudyState
        label="Completed Max upgrade awaiting billing sync"
        state="plan-update-pending"
      >
        <div className="flex flex-col gap-4" inert>
          <HostedPlanUpdateReturn
            active={false}
            pollingEnabled={false}
            targetPlanCode="launch_max_monthly"
          />
          <HostedBillingSettings
            authenticated
            billingStatus="active"
            canStartFamily
            canSwitchToGroup
            canUpgradeToEdge
            canUpgradeToMax
            canUpgradeToPulse
            currentBillingPhase="paid"
            currentBillingPlanCode="launch_edge_monthly"
            currentPeriodEnd={new Date("2026-09-07T20:00:00.000Z")}
            planChangePending
            showGroupPlan
            showMaxPlan
          />
        </div>
      </StudyState>

      <StudyState
        label="Pulse stays active until the scheduled Core switch"
        state="scheduled-core"
      >
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

      <StudyState
        label="Core usage exhausted"
        state="core-usage-exhausted"
      >
        <div inert>
          <UsageLimitBanner
            noticeCode="group_upgrade_pulse"
            now={new Date("2026-08-21T12:00:00.000Z")}
            recommendedAction={{
              kind: "change_plan",
              label: "Choose Pulse",
              targetPlanCode: "launch_monthly",
              url: "/settings#subscription",
            }}
            resetAt={new Date("2026-08-27T04:00:00.000Z")}
          />
        </div>
      </StudyState>

      <StudyState
        label="Family allowance exhausted with the fallback Add usage action"
        state="family-usage-exhausted-fallback"
      >
        <div inert>
          <UsageLimitBanner
            noticeCode="family_usage_limit_reached"
            now={new Date("2026-08-21T12:00:00.000Z")}
            resetAt={new Date("2026-08-27T04:00:00.000Z")}
          />
        </div>
      </StudyState>

      <StudyState
        label="Pulse usage exhausted with an add-usage action"
        state="pulse-usage-exhausted-add-usage"
      >
        <div inert>
          <UsageLimitBanner
            noticeCode="pulse_upgrade_edge"
            now={new Date("2026-08-21T12:00:00.000Z")}
            recommendedAction={{
              kind: "add_usage",
              label: "Add usage",
              url: "/settings?addUsage=true#subscription",
            }}
            resetAt={new Date("2026-08-27T04:00:00.000Z")}
          />
        </div>
      </StudyState>

      <StudyState
        label="Max usage exhausted with an add-usage action"
        state="max-usage-exhausted-add-usage"
      >
        <div inert>
          <UsageLimitBanner
            noticeCode="max_usage_limit_reached"
            now={new Date("2026-08-21T12:00:00.000Z")}
            recommendedAction={{
              kind: "add_usage",
              label: "Add usage",
              url: "/settings?addUsage=true#subscription",
            }}
            resetAt={new Date("2026-08-27T04:00:00.000Z")}
          />
        </div>
      </StudyState>

      <StudyState
        label="Continue with Core when the trial ends"
        state="trial-core-confirmation"
      >
        <div
          className="mx-auto grid w-full max-w-md gap-6 rounded-2xl border border-[#c4a882]/25 bg-[#fffcf6] p-6 text-[#2d3436] ring-[#c4a882]/25 md:p-7"
          inert
        >
          <StartPaidPlanConfirmationContent
            errorMessage={null}
            onClose={() => undefined}
            onConfirm={() => undefined}
            staticPresentation
            status="idle"
            targetPlanCode="launch_group_monthly"
            timing="at_trial_end"
          />
        </div>
      </StudyState>
    </div>
  );
}

function StudyState(props: {
  children: React.ReactNode;
  label: string;
  state: string;
}) {
  return (
    <div className="flex flex-col gap-3" data-design-state={props.state}>
      <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        {props.label}
      </p>
      {props.children}
    </div>
  );
}
