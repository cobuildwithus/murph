"use client";

import type { HostedPlanUsageAvailableStatus } from "@murphai/hosted-execution/plan-usage";

import { GroupUsageFundingCard } from "@/src/components/hosted-groups/group-usage-funding-card";
import { HostedBillingSettings } from "@/src/components/settings/hosted-billing-settings";
import { HostedUsageTopUpDialog } from "@/src/components/settings/hosted-usage-top-up-dialog";

const DESIGN_USAGE_OFFERS = [
  { amountLabel: "$5", offerCode: "usage_5_usd" },
  { amountLabel: "$10", offerCode: "usage_10_usd" },
  { amountLabel: "$25", offerCode: "usage_25_usd" },
] as const;

const DESIGN_PERSONAL_USAGE_STATUS: HostedPlanUsageAvailableStatus = {
  accessKind: "paid",
  forecast: null,
  generatedAt: "2026-07-22T12:00:00.000Z",
  periodEnd: "2026-08-22T12:00:00.000Z",
  periodKind: "monthly",
  periodStart: "2026-07-22T12:00:00.000Z",
  planCode: "launch_monthly",
  planName: "Pulse",
  recommendedAction: null,
  remainingPercent: 65,
  status: "active",
  usedPercent: 35,
};

const DESIGN_EXHAUSTED_USAGE_STATUS: HostedPlanUsageAvailableStatus = {
  ...DESIGN_PERSONAL_USAGE_STATUS,
  remainingPercent: 0,
  status: "exhausted",
  usedPercent: 100,
};

const DESIGN_CREDIT_BACKED_USAGE_STATUS: HostedPlanUsageAvailableStatus = {
  ...DESIGN_EXHAUSTED_USAGE_STATUS,
  status: "active",
};

function GroupUsageFundingStudy() {
  return (
    <div
      className="flex min-h-[42rem] items-center justify-center rounded-3xl border border-border bg-background px-4 py-12 sm:px-8"
      data-design-study="group-usage-funding"
      id="group-usage-funding"
    >
      <div className="w-full max-w-xl">
        <GroupUsageFundingCard
          action={
            <HostedUsageTopUpDialog
              checkoutUrl="/api/design/usage-credit-preview"
              offers={DESIGN_USAGE_OFFERS}
              scope="group"
            />
          }
          groupName="Sunday sleep crew"
        />
      </div>
    </div>
  );
}

function PersonalUsageCreditOwnerStudy() {
  return (
    <div
      className="flex flex-col gap-6 rounded-3xl border border-border bg-background px-4 py-8 sm:px-8"
      data-design-study="personal-usage-credit-owner"
      id="personal-usage-credit-owner"
    >
      <p className="text-sm text-muted-foreground">
        Static owner-layout preview with purchased credit present. The exact
        balance is omitted, and billing actions are disabled here.
      </p>
      <PersonalUsageCreditState
        balanceUsdMicros="8429999"
        label="Included usage active"
        state="active-with-credit"
        usageStatus={DESIGN_PERSONAL_USAGE_STATUS}
      />
      <PersonalUsageCreditState
        balanceUsdMicros="8429999"
        label="Included usage exhausted, credit remains"
        state="exhausted-with-credit"
        usageStatus={DESIGN_CREDIT_BACKED_USAGE_STATUS}
      />
      <PersonalUsageCreditState
        label="Included usage and credit exhausted"
        state="exhausted-without-credit"
        usageStatus={DESIGN_EXHAUSTED_USAGE_STATUS}
      />
    </div>
  );
}

function PersonalUsageCreditState(props: {
  balanceUsdMicros?: string;
  label: string;
  state: string;
  usageStatus: HostedPlanUsageAvailableStatus;
}) {
  return (
    <div
      className="flex flex-col gap-3"
      data-design-state={props.state}
    >
      <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        {props.label}
      </p>
      <div inert>
        <HostedBillingSettings
          authenticated
          billingStatus="active"
          currentBillingPhase="paid"
          currentBillingPlanCode="launch_monthly"
          usageCreditBalanceUsdMicros={props.balanceUsdMicros}
          usageStatus={props.usageStatus}
          usageTopUpOffers={DESIGN_USAGE_OFFERS}
        />
      </div>
    </div>
  );
}

export {
  DESIGN_USAGE_OFFERS,
  GroupUsageFundingStudy,
  PersonalUsageCreditOwnerStudy,
};
