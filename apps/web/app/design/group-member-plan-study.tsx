"use client";

import type { HostedPlanUsageAvailableStatus } from "@murphai/hosted-execution/plan-usage";

import { HostedBillingSettings } from "@/src/components/settings/hosted-billing-settings";
import { StartPaidPulseConfirmationContent } from "@/src/components/settings/hosted-start-paid-pulse-button";
import { Dialog } from "@/src/components/ui/dialog";

const NOOP = () => {};
const PERIOD_START = "2026-07-27T04:00:00.000Z";
const PERIOD_END = "2026-08-27T04:00:00.000Z";

const DESIGN_GROUP_EXHAUSTED_STATUS: HostedPlanUsageAvailableStatus = {
  accessKind: "paid",
  forecast: null,
  generatedAt: "2026-08-10T12:00:00.000Z",
  periodEnd: PERIOD_END,
  periodKind: "monthly",
  periodStart: PERIOD_START,
  planCode: "launch_group_monthly",
  planName: "Group",
  recommendedAction: {
    kind: "change_plan",
    label: "Upgrade to Pulse ($8/month)",
    targetPlanCode: "launch_monthly",
    url: "https://example.com/settings#subscription",
  },
  remainingPercent: 0,
  status: "exhausted",
  usedPercent: 100,
};

const DESIGN_TRIAL_STATUS: HostedPlanUsageAvailableStatus = {
  accessKind: "trial",
  forecast: null,
  generatedAt: "2026-07-30T12:00:00.000Z",
  periodEnd: "2026-08-02T04:00:00.000Z",
  periodKind: "trial",
  periodStart: "2026-07-26T04:00:00.000Z",
  planCode: "launch_monthly",
  planName: "Pulse Trial",
  recommendedAction: null,
  remainingPercent: 68,
  status: "active",
  usedPercent: 32,
};

export function GroupMemberPlanStudy() {
  return (
    <div
      className="flex flex-col gap-8"
      data-design-section="group-member-plan"
      id="group-member-plan-section"
    >
      <StudyState label="Eligible Pulse trial">
        <div inert>
          <HostedBillingSettings
            authenticated
            billingStatus="active"
            canStartPaidPulse
            canSwitchToGroup
            currentBillingPhase="trial"
            currentBillingPlanCode="launch_monthly"
            currentCheckoutOffer="pulse_trial_7d"
            currentPeriodEnd={new Date("2026-08-02T04:00:00.000Z")}
            showGroupPlan
            usageStatus={DESIGN_TRIAL_STATUS}
          />
        </div>
      </StudyState>

      <StudyState label="Group allowance exhausted">
        <div inert>
          <HostedBillingSettings
            authenticated
            billingStatus="active"
            canUpgradeToPulse
            currentBillingPhase="paid"
            currentBillingPlanCode="launch_group_monthly"
            currentPeriodEnd={new Date(PERIOD_END)}
            showGroupPlan
            usageStatus={DESIGN_GROUP_EXHAUSTED_STATUS}
          />
        </div>
      </StudyState>

      <StudyState label="Choose Group after the trial">
        <div className="grid gap-4 lg:grid-cols-2">
          <GroupTrialContinuationCard status="idle" />
          <GroupTrialContinuationCard status="continuing" />
        </div>
      </StudyState>

      <StudyState label="End trial and start Group now">
        <Dialog>
          <div
            className="mx-auto w-full max-w-md rounded-2xl border border-[#c4a882]/25 bg-[#fffcf6] p-6"
            inert
          >
            <StartPaidPulseConfirmationContent
              errorAction={null}
              errorMessage={null}
              onCancel={NOOP}
              onConfirm={NOOP}
              status="idle"
              targetPlanCode="launch_group_monthly"
            />
          </div>
        </Dialog>
      </StudyState>
    </div>
  );
}

function GroupTrialContinuationCard(props: {
  status: "continuing" | "idle";
}) {
  return (
    <Dialog>
      <div
        className="mx-auto w-full max-w-md rounded-2xl border border-[#c4a882]/25 bg-[#fffcf6] p-6"
        inert
      >
        <StartPaidPulseConfirmationContent
          errorAction={null}
          errorMessage={null}
          onCancel={NOOP}
          onConfirm={NOOP}
          status={props.status}
          targetPlanCode="launch_group_monthly"
          timing="at_trial_end"
        />
      </div>
    </Dialog>
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
