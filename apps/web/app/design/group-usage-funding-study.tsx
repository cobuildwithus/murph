"use client";

import { useState, type ReactNode } from "react";
import type {
  HostedPlanUsageAvailableStatus,
  HostedPlanUsageStatus,
} from "@murphai/hosted-execution/plan-usage";

import { GroupUsageFundingCard } from "@/src/components/hosted-groups/group-usage-funding-card";
import { GroupSponsorshipDialog } from "@/src/components/hosted-groups/group-sponsorship-dialog";
import { HostedAiUsageActivity } from "@/src/components/settings/hosted-ai-usage-activity";
import { HostedBillingSettings } from "@/src/components/settings/hosted-billing-settings";
import { HostedUsageTopUpDialog } from "@/src/components/settings/hosted-usage-top-up-dialog";
import { Button } from "@/src/components/ui/button";
import type { HostedAiUsageActivitySnapshot } from "@/src/lib/hosted-execution/usage-activity-types";
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
const DESIGN_PAYER_MEMBER_ID = "design_usage_top_up_payer";

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

const DESIGN_USAGE_MISSION_CONTACT_OPTION: MurphContactOption = {
  href: buildMurphSmsHref({
    body: "Hey Murph, what usage missions can I choose from?",
    murphPhoneNumber: "+15555550100",
  }),
  kind: "text",
  label: "Messages",
};

const DESIGN_AI_USAGE_ACTIVITY: HostedAiUsageActivitySnapshot = {
  credits: [
    {
      addedLabel: "$10.00",
      dateLabel: "Jul 24, 2026",
      id: "design-credit-purchased",
      sourceLabel: "Purchased by you",
    },
    {
      addedLabel: "$5.00",
      dateLabel: "Jul 18, 2026",
      id: "design-credit-added",
      sourceLabel: "Added for you",
    },
  ],
  missions: [
    {
      destinationLabel: "the group",
      id: "design-mission-active-group",
      requirementsLabel:
        "Start a fresh group and make it genuinely active, with multiple people actually talking.",
      rewardLabel: "$3.50",
      selectedLabel: "Jul 27, 2026",
      status: "in_progress",
      statusLabel: "In progress",
      timingLabel: "Ends Aug 3, 2026, 12:00:00 PM UTC",
      title: "Start an active group",
    },
    {
      destinationLabel: "the group",
      id: "design-mission-checking-final-activity",
      requirementsLabel:
        "Start a fresh group and make it genuinely active, with multiple people actually talking.",
      rewardLabel: "$3.50",
      selectedLabel: "Jul 20, 2026",
      status: "checking_final_activity",
      statusLabel: "Checking final activity",
      timingLabel:
        "Action closed Jul 27, 2026, 12:00:00 PM UTC; checking delayed activity",
      title: "Start an active group",
    },
    {
      destinationLabel: "your Murph",
      id: "design-mission-new-person",
      requirementsLabel:
        "Bring one new person into a fresh Murph group. Murph handles onboarding, and the mission completes once they join the conversation with their own Murph.",
      rewardLabel: "$2.00",
      selectedLabel: "Jul 10, 2026",
      status: "completed",
      statusLabel: "Completed",
      timingLabel: "Earned Jul 16, 2026",
      title: "Bring someone new to Murph",
    },
  ],
  missionsEnabled: true,
};

const DESIGN_AI_USAGE_WAITING_ACTIVITY: HostedAiUsageActivitySnapshot = {
  credits: [],
  missions: [
    {
      destinationLabel: "the group",
      id: "design-mission-waiting-group",
      requirementsLabel:
        "Start a fresh group and make it genuinely active, with multiple people actually talking.",
      rewardLabel: "$3.50",
      selectedLabel: "Jul 29, 2026",
      status: "waiting_for_group",
      statusLabel: "Waiting for a new group",
      timingLabel: "Start a new group by Aug 5, 2026, 12:00:00 PM UTC",
      title: "Start an active group",
    },
  ],
  missionsEnabled: true,
};

const DESIGN_AI_USAGE_DISABLED_HISTORY: HostedAiUsageActivitySnapshot = {
  credits: [
    {
      addedLabel: "$5.00",
      dateLabel: "Jul 18, 2026",
      id: "design-credit-history-only",
      sourceLabel: "Added for you",
    },
  ],
  missions: [
    {
      destinationLabel: "your Murph",
      id: "design-mission-disabled-history",
      requirementsLabel:
        "Bring one new person into a fresh Murph group. Murph handles onboarding, and the mission completes once they join the conversation with their own Murph.",
      rewardLabel: "$2.00",
      selectedLabel: "Jul 10, 2026",
      status: "completed",
      statusLabel: "Completed",
      timingLabel: "Earned Jul 16, 2026",
      title: "Bring someone new to Murph",
    },
  ],
  missionsEnabled: false,
};

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

const DESIGN_UNAVAILABLE_USAGE_STATUS: HostedPlanUsageStatus = {
  generatedAt: "2026-07-22T12:00:00.000Z",
  reason: "group_not_supported",
  recommendedAction: null,
  status: "unavailable",
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
              payerMemberId={DESIGN_PAYER_MEMBER_ID}
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
      <PersonalUsageCreditState
        label="Historical activity without a current usage bar"
        state="usage-history-without-overall-bar"
        usageStatus={DESIGN_UNAVAILABLE_USAGE_STATUS}
        usageActivityDetail={
          <section className="flex flex-col gap-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              AI usage
            </div>
            <HostedAiUsageActivity
              activity={DESIGN_AI_USAGE_DISABLED_HISTORY}
              missionContactOption={null}
            />
          </section>
        }
      />
      <div
        className="flex w-full max-w-xl flex-col items-start gap-3"
        data-design-state="usage-added-follow-up"
      >
        <p className="text-sm text-muted-foreground">
          After a group payment completes, the confirmation makes the added
          capacity unmistakable, then offers Open Messages. Messages cannot
          deep-link to the group thread, so the handoff says to choose the
          group. Personal and Family top-ups keep the Text Murph action: one
          channel renders a direct link; several channels render inline rows in
          the same dialog.
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
            frozenSponsorship={{
              publicAlias: "Sunday sleep crew",
              runningBitRequest: "Keep the recovery jokes going.",
              sponsorMessage: "More room for the group.",
            }}
            initialOpen
            offers={[]}
            payerMemberId={DESIGN_PAYER_MEMBER_ID}
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
            payerMemberId={DESIGN_PAYER_MEMBER_ID}
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
            payerMemberId={DESIGN_PAYER_MEMBER_ID}
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
            payerMemberId={DESIGN_PAYER_MEMBER_ID}
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
        Static owner-layout preview keeps plan allowance and purchased credit
        combined in one usage bar at the top, then adds the read-only credit
        and mission history below.
      </p>
      <div
        className="flex flex-col gap-3"
        data-design-state="usage-credits-and-missions"
      >
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Overall usage with credits and missions
        </p>
        <PersonalUsageCreditState
          label="Overall usage active"
          state="active-with-credit"
          usageStatus={DESIGN_PERSONAL_USAGE_STATUS}
          usageActivityDetail={
            <section className="flex flex-col gap-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                AI usage
              </div>
              <HostedAiUsageActivity
                activity={DESIGN_AI_USAGE_ACTIVITY}
                missionContactOption={DESIGN_USAGE_MISSION_CONTACT_OPTION}
              />
            </section>
          }
        />
      </div>
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
            payerMemberId={DESIGN_PAYER_MEMBER_ID}
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
  usageActivityDetail?: ReactNode;
  usageStatus: HostedPlanUsageStatus;
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
          payerMemberId={DESIGN_PAYER_MEMBER_ID}
          usageActivityDetail={props.usageActivityDetail}
          usageStatus={props.usageStatus}
          usageTopUpOffers={DESIGN_USAGE_OFFERS}
        />
      </div>
    </div>
  );
}

export {
  DESIGN_AI_USAGE_ACTIVITY,
  DESIGN_AI_USAGE_DISABLED_HISTORY,
  DESIGN_AI_USAGE_WAITING_ACTIVITY,
  DESIGN_GROUP_SPONSORSHIP_OFFERS,
  DESIGN_USAGE_OFFERS,
  DESIGN_USAGE_MISSION_CONTACT_OPTION,
  GroupUsageFundingStudy,
  PersonalUsageCreditOwnerStudy,
};
