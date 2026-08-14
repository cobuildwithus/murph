"use client";

import {
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type {
  HostedPlanUsageAvailableStatus,
  HostedPlanUsageStatus,
} from "@murphai/hosted-execution/plan-usage";

import {
  GroupFundingSignInRequired,
} from "@/src/components/hosted-groups/group-funding-sign-in-button";
import { GroupFundingSupporters } from "@/src/components/hosted-groups/group-funding-supporters";
import {
  GroupUsageFundingActions,
  GroupUsageFundingShell,
} from "@/src/components/hosted-groups/group-usage-funding-shell";
import { GroupSponsorshipDialog } from "@/src/components/hosted-groups/group-sponsorship-dialog";
import {
  GroupSponsorshipCanceledReceipt,
  GroupSponsorshipManagementCard,
} from "@/src/components/hosted-groups/group-sponsorship-management-card";
import { HostedAiUsageActivity } from "@/src/components/settings/hosted-ai-usage-activity";
import { HostedBillingSettings } from "@/src/components/settings/hosted-billing-settings";
import { Button } from "@/src/components/ui/button";
import type { HostedAiUsageActivitySnapshot } from "@/src/lib/hosted-execution/usage-activity-types";
import {
  buildMurphSmsHref,
  type MurphContactOption,
} from "@/src/lib/murph-contact-routing";

const DESIGN_USAGE_OFFERS = [
  { amountLabel: "$5", offerCode: "usage_5_usd" },
  { amountLabel: "$10", offerCode: "usage_10_usd" },
  { amountLabel: "$25", offerCode: "usage_25_usd" },
] as const;
const DESIGN_PAYER_MEMBER_ID = "design_usage_top_up_payer";
const DESIGN_SIGNUP_REFERRAL_URL = "https://example.com/r/design-referral";

const DESIGN_GROUP_SPONSORSHIP_OFFERS = [
  {
    amountLabel: "$5",
    offerCode: "usage_5_usd",
    runningBitDurationLabel: null,
  },
  {
    amountLabel: "$10",
    offerCode: "usage_10_usd",
    runningBitDurationLabel: "1 day",
  },
  {
    amountLabel: "$20",
    offerCode: "usage_20_usd",
    runningBitDurationLabel: "3 days",
  },
] as const;

const DESIGN_GROUP_MONTHLY_CAPS = [
  { amountLabel: "$5", monthlyCapMinor: 500 },
  { amountLabel: "$10", monthlyCapMinor: 1_000 },
  { amountLabel: "$20", monthlyCapMinor: 2_000 },
] as const;

const DESIGN_GROUP_FUNDING_SUPPORTERS = {
  monthlySponsor: {
    id: "hucp_design_monthly_sponsor",
    name: "The Group Historian",
  },
  oneTimeContributions: [
    { id: "hucp_design_one_time_1", name: "Night Shift" },
    { id: "hucp_design_one_time_2", name: "Anonymous" },
  ],
};

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

const DESIGN_USAGE_MISSION_CONTACT_OPTION: MurphContactOption = {
  href: buildMurphSmsHref({
    body: "Hey Murph, what referral options can I choose from?",
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
      rewardLabel: "About 14 more days of Murph usage",
      selectedLabel: "Jul 27, 2026",
      status: "in_progress",
      statusLabel: "In progress",
      timingLabel: "Ends Aug 3 at 12:00 PM UTC",
      title: "Start a group conversation",
    },
    {
      destinationLabel: "the group",
      id: "design-mission-checking-final-activity",
      requirementsLabel:
        "Start a fresh group and make it genuinely active, with multiple people actually talking.",
      rewardLabel: "About 14 more days of Murph usage",
      selectedLabel: "Jul 20, 2026",
      status: "checking_final_activity",
      statusLabel: "Checking final activity",
      timingLabel: "Closed Jul 27 at 12:00 PM UTC",
      title: "Start a group conversation",
    },
    {
      destinationLabel: "the group",
      id: "design-mission-reward-pending",
      requirementsLabel:
        "Start a fresh group and make it genuinely active, with multiple people actually talking.",
      rewardLabel: "About 14 more days of Murph usage",
      selectedLabel: "Jul 18, 2026",
      status: "reward_pending",
      statusLabel: "Reward pending",
      timingLabel: "Qualified Jul 25",
      title: "Start a group conversation",
    },
    {
      destinationLabel: "your Murph",
      id: "design-mission-new-person",
      requirementsLabel:
        "Bring one new person into a fresh Murph group. Murph handles setup, and the reward is earned once they join the conversation with their own Murph.",
      rewardLabel: "About 10 more days of Murph usage",
      selectedLabel: "Jul 10, 2026",
      status: "completed",
      statusLabel: "Completed",
      timingLabel: "Earned Jul 16",
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
      rewardLabel: "About 14 more days of Murph usage",
      selectedLabel: "Jul 29, 2026",
      status: "waiting_for_group",
      statusLabel: "Waiting for a new group",
      timingLabel: "Start by Aug 5 at 12:00 PM UTC",
      title: "Start a group conversation",
    },
  ],
  missionsEnabled: true,
};

const DESIGN_AI_USAGE_EMPTY_ACTIVITY: HostedAiUsageActivitySnapshot = {
  credits: [],
  missions: [],
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
        "Bring one new person into a fresh Murph group. Murph handles setup, and the reward is earned once they join the conversation with their own Murph.",
      rewardLabel: "About 10 more days of Murph usage",
      selectedLabel: "Jul 10, 2026",
      status: "completed",
      statusLabel: "Completed",
      timingLabel: "Earned Jul 16",
      title: "Bring someone new to Murph",
    },
  ],
  missionsEnabled: false,
};

const DESIGN_AI_USAGE_HISTORY_INTERACTION: HostedAiUsageActivitySnapshot = {
  credits: DESIGN_AI_USAGE_DISABLED_HISTORY.credits,
  missions: DESIGN_AI_USAGE_DISABLED_HISTORY.missions,
  missionsEnabled: true,
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

const DESIGN_STARTER_USAGE_STATUS: HostedPlanUsageAvailableStatus = {
  accessKind: "starter",
  forecast: null,
  generatedAt: "2026-08-07T20:00:00.000Z",
  periodEnd: "2099-12-31T23:59:59.999Z",
  periodKind: "lifetime",
  periodStart: "2026-08-07T20:00:00.000Z",
  planCode: "launch_monthly",
  planName: "Starter",
  recommendedAction: {
    kind: "change_plan",
    label: "Choose Pulse",
    targetPlanCode: "launch_monthly",
    url: "/settings#subscription",
  },
  remainingPercent: 0,
  status: "exhausted",
  usedPercent: 100,
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
  remainingPercent: 100,
  usedPercent: 0,
};

const DESIGN_FAMILY_EXHAUSTED_USAGE_STATUS: HostedPlanUsageAvailableStatus = {
  ...DESIGN_EXHAUSTED_USAGE_STATUS,
  accessKind: "family_sponsored",
  planName: "Family",
};

function GroupUsageFundingStudy() {
  const endpoint = "/api/design/group-sponsorship-management";
  const [previewMode, setPreviewMode] = useState<"monthly" | "one_time" | null>(
    null,
  );

  useEffect(() => {
    function syncActivationPreview() {
      setPreviewMode(
        window.location.hash === "#group-usage-funding"
          ? "monthly"
          : window.location.hash === "#group-one-time-contribution"
            ? "one_time"
            : null,
      );
    }

    syncActivationPreview();
    window.addEventListener("hashchange", syncActivationPreview);
    return () =>
      window.removeEventListener("hashchange", syncActivationPreview);
  }, []);

  const previewOpenProps = (mode: "monthly" | "one_time") => ({
    initialOpen: previewMode === mode,
  });

  const oneTimeContribution = (
    <div className="space-y-4">
      <p className="text-center text-sm text-muted-foreground">
        Murph is sponsored in this chat.
      </p>
      <GroupUsageFundingActions
        oneTimeAction={(
          <GroupSponsorshipDialog
            {...previewOpenProps("one_time")}
            key={previewMode === "one_time" ? "open" : "closed"}
            checkoutUrl="/api/design/usage-credit-preview"
            customizationAllowed
            inert
            mode="one_time"
            offers={DESIGN_GROUP_SPONSORSHIP_OFFERS}
            payerMemberId={DESIGN_PAYER_MEMBER_ID}
            triggerSize="default"
            triggerVariant="link"
          />
        )}
      />
      <GroupFundingSupporters supporters={DESIGN_GROUP_FUNDING_SUPPORTERS} />
    </div>
  );
  const oneTimeRecovery = () => (
    <div className="space-y-4">
      <p className="text-center text-sm text-muted-foreground">
        Murph is sponsored in this chat.
      </p>
      <GroupSponsorshipDialog
        activePurchase={{
          cancelAllowed: true,
          offerCode: "usage_10_usd",
          purchaseId: "hucp_design_one_time_recovery",
          retryAllowed: true,
          status: "checkout_open",
          url: "https://checkout.stripe.test/design-group-one-time",
        }}
        checkoutUrl="/api/design/usage-credit-preview"
        customizationAllowed
        frozenSponsorship={{
          creativeRequest: {
            format: "song",
            prompt: "Turn the group’s finish-line energy into a tiny theme.",
            styleRequest: "Warm acoustic ensemble with a bright tempo.",
          },
          publicAlias: "Sunday sleep crew",
          runningBitRequest: "Keep the finish-line jokes going.",
          sponsorMessage: null,
        }}
        inert
        mode="one_time"
        offers={[]}
        payerMemberId={DESIGN_PAYER_MEMBER_ID}
      />
    </div>
  );

  return (
    <div
      className="space-y-10 rounded-3xl border border-border bg-background px-4 py-10 sm:px-8"
      data-design-study="group-usage-funding"
      id="group-usage-funding"
    >
      <div className="space-y-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Production components · inert synthetic states
        </p>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
          Monthly sponsorship is the primary flow. One-time contribution
          remains a separate secondary action and stays quiet in the room by
          default. An authorized participant can optionally request one message,
          poem, or 15-second song before checkout.
        </p>
      </div>

      <DesignSponsorshipState
        label="Activation at any capacity"
        state="monthly-activation"
      >
        <GroupUsageFundingShell
          action={(
            <div inert>
              <GroupUsageFundingActions
                monthlyAction={(
                  <GroupSponsorshipDialog
                    {...previewOpenProps("monthly")}
                    key={previewMode === "monthly" ? "open" : "closed"}
                    checkoutUrl="/api/design/usage-credit-preview"
                    customizationAllowed
                    inert
                    mode="monthly"
                    monthlyCapMinor={1_000}
                    monthlyCapOptions={DESIGN_GROUP_MONTHLY_CAPS}
                    offers={[DESIGN_GROUP_SPONSORSHIP_OFFERS[0]]}
                    payerMemberId={DESIGN_PAYER_MEMBER_ID}
                  />
                )}
                oneTimeAction={(
                  <GroupSponsorshipDialog
                    checkoutUrl="/api/design/usage-credit-preview"
                    customizationAllowed
                    inert
                    mode="one_time"
                    offers={DESIGN_GROUP_SPONSORSHIP_OFFERS}
                    payerMemberId={DESIGN_PAYER_MEMBER_ID}
                    triggerSize="default"
                    triggerVariant="link"
                  />
                )}
              />
            </div>
          )}
          groupName="Sunday sleep crew"
        />
      </DesignSponsorshipState>

      <div className="grid gap-6 xl:grid-cols-2">
        <DesignSponsorshipState
          label="Ordinary sponsored participant + one-time action"
          state="ordinary-sponsored-one-time"
        >
          <div id="group-one-time-contribution">
            <GroupUsageFundingShell
              action={<div inert>{oneTimeContribution}</div>}
              groupName="Sunday sleep crew"
            />
          </div>
        </DesignSponsorshipState>

        <DesignSponsorshipState
          label="Active management near cap"
          state="monthly-active"
        >
          <GroupSponsorshipManagementCard
            endpoint={endpoint}
            inert
            management={{
              authorizationId: "hgsa_design_active",
              chargedThisPeriodMinor: 500,
              monthlyCapMinor: 1_000,
              pendingMonthlyCapMinor: null,
              pendingThisPeriodMinor: 500,
              periodEnd: "2026-08-30T16:00:00.000Z",
              status: "active",
            }}
          />
        </DesignSponsorshipState>

        <DesignSponsorshipState
          label="Paused with next-period decrease"
          state="monthly-paused"
        >
          <GroupSponsorshipManagementCard
            endpoint={endpoint}
            inert
            management={{
              authorizationId: "hgsa_design_paused",
              chargedThisPeriodMinor: 1_000,
              monthlyCapMinor: 2_000,
              pendingMonthlyCapMinor: 500,
              pendingThisPeriodMinor: 0,
              periodEnd: "2026-08-30T16:00:00.000Z",
              status: "paused",
            }}
          />
        </DesignSponsorshipState>

        <DesignSponsorshipState
          label="Payment recovery"
          state="monthly-recovery"
        >
          <GroupSponsorshipManagementCard
            endpoint={endpoint}
            inert
            management={{
              authorizationId: "hgsa_design_recovery",
              chargedThisPeriodMinor: 500,
              monthlyCapMinor: 1_000,
              pendingMonthlyCapMinor: null,
              pendingThisPeriodMinor: 0,
              periodEnd: "2026-08-30T16:00:00.000Z",
              status: "recovery_required",
            }}
          />
        </DesignSponsorshipState>

        <DesignSponsorshipState
          label="Cancellation-only recovery"
          state="monthly-cancel-only"
        >
          <GroupSponsorshipManagementCard
            cancelOnly
            endpoint="/api/groups/fund/design/sponsorship"
            management={{
              authorizationId: "hgsa_design_cancel_only",
              chargedThisPeriodMinor: 500,
              monthlyCapMinor: 1_000,
              pendingMonthlyCapMinor: null,
              pendingThisPeriodMinor: 0,
              periodEnd: "2026-08-30T16:00:00.000Z",
              status: "active",
            }}
          />
        </DesignSponsorshipState>

        <DesignSponsorshipState
          label="Signed-out sponsorship management handoff"
          state="monthly-management-sign-in"
        >
          <GroupFundingSignInRequired initiallyOpen={false} />
        </DesignSponsorshipState>

        <DesignSponsorshipState
          label="Cancellation completion receipt"
          state="monthly-canceled"
        >
          <GroupSponsorshipCanceledReceipt />
        </DesignSponsorshipState>

        <DesignSponsorshipState
          label="Sponsored-chat one-time purchase recovery"
          state="sponsored-one-time-recovery"
        >
          <GroupUsageFundingShell
            action={<div inert>{oneTimeRecovery()}</div>}
            groupName="Sunday sleep crew"
          />
        </DesignSponsorshipState>
      </div>
    </div>
  );
}

export function GroupFundingSupportersStudy() {
  return (
    <div
      className="w-full max-w-lg rounded-3xl border border-border bg-background px-6 pb-8"
      data-design-component="group-funding-supporters"
      inert
    >
      <GroupFundingSupporters supporters={DESIGN_GROUP_FUNDING_SUPPORTERS} />
    </div>
  );
}

function DesignSponsorshipState(props: {
  children: ReactNode;
  label: string;
  state: string;
}) {
  return (
    <section className="space-y-3" data-design-state={props.state}>
      <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        {props.label}
      </p>
      <div className="w-full max-w-xl">
        {props.children}
      </div>
    </section>
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
        Static owner-layout preview keeps remaining capacity in one usage bar
        at the top. A fulfilled purchase starts that display at 0% used, while
        current referrals stay visible below it and history remains on demand.
      </p>
      <div
        className="flex flex-col gap-3"
        data-design-state="usage-credits-and-missions"
      >
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Overall usage with active referrals and history
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
                signupReferralUrl={DESIGN_SIGNUP_REFERRAL_URL}
              />
            </section>
          }
        />
      </div>
      <div
        className="grid gap-6 lg:grid-cols-2"
        data-design-state="usage-activity-interactions"
      >
        <section className="flex flex-col gap-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Referral details interaction
          </p>
          <div data-design-interaction="referral-details">
            <HostedAiUsageActivity
              activity={DESIGN_AI_USAGE_ACTIVITY}
              missionContactOption={null}
              signupReferralUrl={DESIGN_SIGNUP_REFERRAL_URL}
            />
          </div>
        </section>
        <section className="flex flex-col gap-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Guidance with history interaction
          </p>
          <div data-design-interaction="guidance-with-history">
            <HostedAiUsageActivity
              activity={DESIGN_AI_USAGE_HISTORY_INTERACTION}
              missionContactOption={DESIGN_USAGE_MISSION_CONTACT_OPTION}
              signupReferralUrl={DESIGN_SIGNUP_REFERRAL_URL}
            />
          </div>
        </section>
      </div>
      <PersonalUsageCreditState
        label="Plan usage exhausted, credit remains"
        state="exhausted-with-credit"
        usageStatus={DESIGN_CREDIT_BACKED_USAGE_STATUS}
      />
      <PersonalUsageCreditState
        label="Fresh purchase starts at zero used"
        state="fresh-purchase-meter"
        usageStatus={DESIGN_FULFILLED_USAGE_STATUS}
      />
      <PersonalUsageCreditState
        label="All available usage exhausted"
        state="exhausted-without-credit"
        usageStatus={DESIGN_EXHAUSTED_USAGE_STATUS}
      />
      <div
        className="flex flex-col gap-3"
        data-design-state="family-owner-exhausted"
      >
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Family owner can add usage for their own seat
        </p>
        <div inert>
          <HostedBillingSettings
            authenticated
            billingStatus="active"
            currentBillingPhase="paid"
            currentBillingPlanCode="launch_monthly"
            familyState="owner"
            payerMemberId={DESIGN_PAYER_MEMBER_ID}
            usageStatus={DESIGN_FAMILY_EXHAUSTED_USAGE_STATUS}
            usageTopUpCheckoutUrl="/api/design/usage-credit-preview"
            usageTopUpOffers={DESIGN_USAGE_OFFERS}
            usageTopUpScope="family"
            usageTopUpTargetLabel="you"
          />
        </div>
      </div>
      <PersonalUsageCreditState
        billingState="starter"
        canStartDirectPlan
        label="Starter usage exhausted"
        state="starter-exhausted"
        usageStatus={DESIGN_STARTER_USAGE_STATUS}
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
          <div key={fulfilledPreviewKey}>
            <HostedBillingSettings
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
          </div>
        ) : null}
      </div>
    </div>
  );
}

function PersonalUsageCreditState(props: {
  billingState?: "paid" | "starter";
  canStartDirectPlan?: boolean;
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
      <div
        inert
      >
        <HostedBillingSettings
          authenticated
          billingStatus="active"
          canStartDirectPlan={props.canStartDirectPlan}
          currentBillingPhase={
            props.billingState === "starter" ? null : "paid"
          }
          currentBillingPlanCode={
            props.billingState === "starter" ? null : "launch_monthly"
          }
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
  DESIGN_AI_USAGE_EMPTY_ACTIVITY,
  DESIGN_AI_USAGE_WAITING_ACTIVITY,
  DESIGN_GROUP_MONTHLY_CAPS,
  DESIGN_GROUP_SPONSORSHIP_OFFERS,
  DESIGN_USAGE_OFFERS,
  DESIGN_USAGE_MISSION_CONTACT_OPTION,
  GroupUsageFundingStudy,
  PersonalUsageCreditOwnerStudy,
};
