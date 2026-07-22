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
      className="rounded-3xl border border-border bg-background px-4 py-8 sm:px-8"
      data-design-study="personal-usage-credit-owner"
      id="personal-usage-credit-owner"
    >
      <p className="mb-4 text-sm text-muted-foreground">
        Static owner-layout preview. Billing actions are disabled here.
      </p>
      <div inert>
        <HostedBillingSettings
          authenticated
          billingStatus="active"
          currentBillingPhase="paid"
          currentBillingPlanCode="launch_monthly"
          usageCreditBalanceUsdMicros="8429999"
          usageStatus={DESIGN_PERSONAL_USAGE_STATUS}
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
