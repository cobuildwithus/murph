"use client";

import { useState } from "react";
import type { HostedPlanUsageAvailableStatus } from "@murphai/hosted-execution/plan-usage";

import { GroupUsageFundingCard } from "@/src/components/hosted-groups/group-usage-funding-card";
import { GroupSponsorshipDialog } from "@/src/components/hosted-groups/group-sponsorship-dialog";
import { HostedBillingSettings } from "@/src/components/settings/hosted-billing-settings";
import { HostedUsageTopUpDialog } from "@/src/components/settings/hosted-usage-top-up-dialog";
import { Button } from "@/src/components/ui/button";
import {
  buildMurphSmsHref,
  buildMurphTelegramTextHref,
  type MurphContactOption,
} from "@/src/lib/murph-contact-routing";

const DESIGN_USAGE_OFFERS = [
  { amountLabel: "$5", estimatedMessages: 100, offerCode: "usage_5_usd" },
  { amountLabel: "$10", estimatedMessages: 200, offerCode: "usage_10_usd" },
  { amountLabel: "$25", estimatedMessages: 500, offerCode: "usage_25_usd" },
] as const;

const DESIGN_GROUP_SPONSORSHIP_OFFERS = [
  {
    amountLabel: "$5",
    estimatedMessages: 100,
    offerCode: "usage_5_usd",
    runningBitDurationLabel: null,
  },
  {
    amountLabel: "$10",
    estimatedMessages: 200,
    offerCode: "usage_10_usd",
    runningBitDurationLabel: "1 day",
  },
  {
    amountLabel: "$20",
    estimatedMessages: 400,
    offerCode: "usage_20_usd",
    runningBitDurationLabel: "3 days",
  },
] as const;

const DESIGN_TOP_UP_CONTACT_OPTIONS: MurphContactOption[] = [
  {
    href: buildMurphSmsHref({
      body: "Hey Murph, I just added more usage.",
      murphPhoneNumber: "+15555550100",
    }),
    kind: "text",
    label: "Messages",
  },
];

const DESIGN_TOP_UP_MULTI_CONTACT_OPTIONS: MurphContactOption[] = [
  ...DESIGN_TOP_UP_CONTACT_OPTIONS,
  {
    href: buildMurphTelegramTextHref({
      body: "Hey Murph, I just added more usage.",
      username: "withmurph_bot",
    }),
    kind: "telegram",
    label: "Telegram",
    rel: "noopener noreferrer",
    target: "_blank",
  },
];

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
  ...DESIGN_PERSONAL_USAGE_STATUS,
  remainingPercent: 24,
  usedPercent: 76,
};

const DESIGN_FULFILLED_USAGE_STATUS: HostedPlanUsageAvailableStatus = {
  ...DESIGN_PERSONAL_USAGE_STATUS,
  remainingPercent: 45,
  usedPercent: 55,
};

function GroupUsageFundingStudy() {
  const [groupFulfilledPreviewKey, setGroupFulfilledPreviewKey] = useState(0);
  const [groupPaymentRecoveryPreviewKey, setGroupPaymentRecoveryPreviewKey] =
    useState(0);
  const [fulfilledPreviewKey, setFulfilledPreviewKey] = useState(0);
  const [multiChannelPreviewKey, setMultiChannelPreviewKey] = useState(0);

  return (
    <div
      className="flex min-h-[42rem] flex-col items-center justify-center gap-8 rounded-3xl border border-border bg-background px-4 py-12 sm:px-8"
      data-design-study="group-usage-funding"
      id="group-usage-funding"
    >
      <div className="w-full max-w-xl">
        <GroupUsageFundingCard
          action={
            <GroupSponsorshipDialog
              checkoutUrl="/api/design/usage-credit-preview"
              customizationAllowed
              offers={DESIGN_GROUP_SPONSORSHIP_OFFERS}
            />
          }
          groupName="Sunday sleep crew"
        />
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          The amount dialog authorizes one contribution at a time. Murph uses a
          saved card when available; Stripe collects or verifies the card when
          needed.
        </p>
      </div>
      <div
        className="flex w-full max-w-xl flex-col items-start gap-3"
        data-design-state="usage-added-follow-up"
      >
        <p className="text-sm text-muted-foreground">
          After a group payment completes, the confirmation offers Open
          Messages — there is no deep link back into the group thread, so it
          opens the Messages app. Personal and Family top-ups keep the Text
          Murph action: one channel renders a direct link; several channels
          render inline rows in the same dialog.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => setGroupFulfilledPreviewKey((key) => key + 1)}
          >
            Preview group usage added
          </Button>
          <Button
            variant="outline"
            onClick={() => setGroupPaymentRecoveryPreviewKey((key) => key + 1)}
          >
            Preview group payment recovery
          </Button>
          <Button
            variant="outline"
            onClick={() => setFulfilledPreviewKey((key) => key + 1)}
          >
            Preview usage added with Text Murph
          </Button>
          <Button
            variant="outline"
            onClick={() => setMultiChannelPreviewKey((key) => key + 1)}
          >
            Preview usage added with channel choices
          </Button>
        </div>
        {groupFulfilledPreviewKey > 0 ? (
          <GroupSponsorshipDialog
            key={groupFulfilledPreviewKey}
            activePurchase={{
              offerCode: "usage_5_usd",
              purchaseId: "hucp_design_added_0",
              retryAllowed: false,
              status: "fulfilled",
            }}
            deferTerminalRefreshUntilClose
            customizationAllowed
            initialOpen
            offers={[]}
          />
        ) : null}
        {groupPaymentRecoveryPreviewKey > 0 ? (
          <GroupSponsorshipDialog
            key={groupPaymentRecoveryPreviewKey}
            activePurchase={{
              cancelAllowed: true,
              offerCode: "usage_20_usd",
              purchaseId: "hucp_design_pending_0",
              retryAllowed: true,
              status: "payment_pending",
            }}
            checkoutUrl="/api/design/usage-credit-preview"
            customizationAllowed
            initialOpen
            offers={[]}
          />
        ) : null}
        {fulfilledPreviewKey > 0 ? (
          <HostedUsageTopUpDialog
            key={fulfilledPreviewKey}
            activePurchase={{
              offerCode: "usage_5_usd",
              purchaseId: "hucp_design_added_1",
              retryAllowed: false,
              status: "fulfilled",
            }}
            contactOptions={DESIGN_TOP_UP_CONTACT_OPTIONS}
            deferTerminalRefreshUntilClose
            initialOpen
            offers={[]}
          />
        ) : null}
        {multiChannelPreviewKey > 0 ? (
          <HostedUsageTopUpDialog
            key={multiChannelPreviewKey}
            activePurchase={{
              offerCode: "usage_5_usd",
              purchaseId: "hucp_design_added_2",
              retryAllowed: false,
              status: "fulfilled",
            }}
            contactOptions={DESIGN_TOP_UP_MULTI_CONTACT_OPTIONS}
            deferTerminalRefreshUntilClose
            initialOpen
            offers={[]}
          />
        ) : null}
      </div>
    </div>
  );
}

function PersonalUsageCreditOwnerStudy() {
  const [fulfilledPreviewKey, setFulfilledPreviewKey] = useState(0);

  return (
    <div
      className="flex flex-col gap-6 rounded-3xl border border-border bg-background px-4 py-8 sm:px-8"
      data-design-study="personal-usage-credit-owner"
      id="personal-usage-credit-owner"
    >
      <p className="text-sm text-muted-foreground">
        Static owner-layout preview with plan allowance and purchased credit
        combined in one usage bar. Exact balances are omitted, and billing
        actions are disabled here.
      </p>
      <PersonalUsageCreditState
        label="Overall usage active"
        state="active-with-credit"
        usageStatus={DESIGN_PERSONAL_USAGE_STATUS}
      />
      <PersonalUsageCreditState
        label="Plan usage exhausted, credit remains"
        state="exhausted-with-credit"
        usageStatus={DESIGN_CREDIT_BACKED_USAGE_STATUS}
      />
      <PersonalUsageCreditState
        label="All available usage exhausted"
        state="exhausted-without-credit"
        usageStatus={DESIGN_EXHAUSTED_USAGE_STATUS}
      />
      <div
        className="flex flex-col gap-3"
        data-design-state="fulfilled-with-overall-usage"
      >
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Fulfilled top-up with refreshed usage
        </p>
        <Button
          className="self-start"
          variant="outline"
          onClick={() => setFulfilledPreviewKey((key) => key + 1)}
        >
          Preview fulfilled top-up
        </Button>
        {fulfilledPreviewKey > 0 ? (
          <HostedBillingSettings
            key={fulfilledPreviewKey}
            authenticated
            billingStatus="active"
            currentBillingPhase="paid"
            currentBillingPlanCode="launch_monthly"
            usageStatus={DESIGN_FULFILLED_USAGE_STATUS}
            usageTopUpActivePurchase={{
              offerCode: "usage_5_usd",
              purchaseId: "hucp_design_overall_usage_added",
              retryAllowed: false,
              status: "fulfilled",
            }}
            usageTopUpContactOptions={DESIGN_TOP_UP_CONTACT_OPTIONS}
            usageTopUpInitialOpen
            usageTopUpOffers={[]}
          />
        ) : null}
      </div>
    </div>
  );
}

function PersonalUsageCreditState(props: {
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
          usageStatus={props.usageStatus}
          usageTopUpOffers={DESIGN_USAGE_OFFERS}
        />
      </div>
    </div>
  );
}

export {
  DESIGN_GROUP_SPONSORSHIP_OFFERS,
  DESIGN_USAGE_OFFERS,
  GroupUsageFundingStudy,
  PersonalUsageCreditOwnerStudy,
};
