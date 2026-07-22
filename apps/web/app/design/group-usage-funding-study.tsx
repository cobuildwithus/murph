"use client";

import { GroupUsageFundingCard } from "@/src/components/hosted-groups/group-usage-funding-card";
import { HostedUsageTopUpDialog } from "@/src/components/settings/hosted-usage-top-up-dialog";

const DESIGN_USAGE_OFFERS = [
  { amountLabel: "$5", offerCode: "usage_5_usd" },
  { amountLabel: "$10", offerCode: "usage_10_usd" },
  { amountLabel: "$25", offerCode: "usage_25_usd" },
] as const;

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
          capacityLabel="Available"
          groupName="Sunday sleep crew"
        />
      </div>
    </div>
  );
}

export { DESIGN_USAGE_OFFERS, GroupUsageFundingStudy };
