"use client";

import {
  useState,
  type ReactNode,
} from "react";
import type {
  HostedPlanUsageAvailableStatus,
  HostedPlanUsageStatus,
} from "@murphai/hosted-execution/plan-usage";

import {
  GroupFundingAttemptFailure,
  GroupFundingCapacityConflict,
  GroupFundingCheckout,
  GroupFundingPurchaseStatus,
  GroupFundingSelection,
  readGroupFundingPurchaseStatus,
  type GroupFundingMonthlyCapOption,
} from "@/src/components/hosted-groups/group-funding-checkout";
import {
  GroupFundingSignInButton,
} from "@/src/components/hosted-groups/group-funding-sign-in-button";
import {
  LinkPageScreen,
  LinkPageSurface,
} from "@/src/components/link-page/link-page-shell";
import {
  GroupSponsorshipCanceledReceipt,
  GroupSponsorshipManagementCard,
  GroupSponsorshipManagementConfirmationDialog,
} from "@/src/components/hosted-groups/group-sponsorship-management-card";
import { HostedAiUsageActivity } from "@/src/components/settings/hosted-ai-usage-activity";
import { HostedBillingSettings } from "@/src/components/settings/hosted-billing-settings";
import { HostedUsageTopUpDialog } from "@/src/components/settings/hosted-usage-top-up-dialog";
import {
  readHostedUsageTopUpPurchaseActions,
  type HostedUsageTopUpPurchaseScreen,
} from "@/src/components/settings/hosted-usage-top-up-state";
import { Button } from "@/src/components/ui/button";
import type { HostedAiUsageActivitySnapshot } from "@/src/lib/hosted-execution/usage-activity-types";
import {
  HOSTED_GROUP_SPONSORSHIP_MONTHLY_CAPS_MINOR,
} from "@/src/lib/hosted-groups/group-sponsorship-contract";
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
  { amountLabel: "$5", offerCode: "usage_5_usd" },
  { amountLabel: "$10", offerCode: "usage_10_usd" },
  { amountLabel: "$20", offerCode: "usage_20_usd" },
] as const;

const DESIGN_GROUP_MONTHLY_CAPS =
  HOSTED_GROUP_SPONSORSHIP_MONTHLY_CAPS_MINOR.map((monthlyCapMinor) => ({
    amountLabel: `$${monthlyCapMinor / 100}`,
    monthlyCapMinor,
  })) satisfies readonly GroupFundingMonthlyCapOption[];

const DESIGN_GROUP_NAME = "Sunday sleep crew";
const DESIGN_GROUP_MONTHLY_PLAN = {
  capOptions: DESIGN_GROUP_MONTHLY_CAPS,
  offer: DESIGN_GROUP_SPONSORSHIP_OFFERS[0],
};
const DESIGN_GROUP_MONTHLY_DIAL = {
  caption: "a month",
  onValueChange: () => undefined,
  options: DESIGN_GROUP_MONTHLY_CAPS.map((option) => ({
    amountLabel: option.amountLabel,
    value: option.monthlyCapMinor,
  })),
  value: 1_000,
};
const DESIGN_GROUP_ONE_TIME_DIAL = {
  caption: "one time",
  onValueChange: () => undefined,
  options: DESIGN_GROUP_SPONSORSHIP_OFFERS.map((offer) => ({
    amountLabel: offer.amountLabel,
    value: offer.offerCode as string,
  })),
  value: "usage_10_usd",
};

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
  reason: "hosted_access_inactive",
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
  const headline = `Keep Murph in ${DESIGN_GROUP_NAME}.`;
  const selection = {
    onSubmit: () => undefined,
    title: headline,
  };
  const monthly = {
    ...selection,
    amount: DESIGN_GROUP_MONTHLY_DIAL,
    mode: "monthly" as const,
    onModeChange: () => undefined,
  };
  const management = {
    chargedThisPeriodMinor: 500,
    monthlyCapMinor: 2_000,
    pendingMonthlyCapMinor: null,
    pendingThisPeriodMinor: 0,
    periodEnd: "2026-08-30T16:00:00.000Z",
  } as const;
  const card = {
    endpoint,
    groupName: DESIGN_GROUP_NAME,
    periodEndTimeZone: "UTC",
  };

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
          One page on the app&apos;s night ground, the twin of a challenge invite
          link. Each state has one headline and one action.
        </p>
      </div>

      <div className="grid gap-x-6 gap-y-10 md:grid-cols-2 xl:grid-cols-3">
        <DesignSponsorshipState label="Monthly sponsorship" state="monthly-activation">
          <GroupFundingCheckout
            checkoutUrl="/api/design/usage-credit-preview"
            groupName={DESIGN_GROUP_NAME}
            initialMonthlyCapMinor={1_000}
            monthly={DESIGN_GROUP_MONTHLY_PLAN}
            oneTimeOffers={DESIGN_GROUP_SPONSORSHIP_OFFERS}
            payerMemberId={DESIGN_PAYER_MEMBER_ID}
          />
        </DesignSponsorshipState>

        <DesignSponsorshipState label="One-time contribution" state="one-time">
          <GroupFundingSelection
            {...selection}
            amount={DESIGN_GROUP_ONE_TIME_DIAL}
            mode="one_time"
            onModeChange={() => undefined}
          />
        </DesignSponsorshipState>

        <DesignSponsorshipState
          label="Chat already sponsored by someone else"
          state="ordinary-sponsored-one-time"
        >
          <GroupFundingSelection
            {...selection}
            amount={DESIGN_GROUP_ONE_TIME_DIAL}
            detail="You can still chip in."
            mode="one_time"
            title={`${DESIGN_GROUP_NAME} is sponsored.`}
          />
        </DesignSponsorshipState>

        <DesignSponsorshipState label="Canceled at checkout" state="checkout-canceled">
          <GroupFundingSelection
            {...monthly}
            detail="Checkout canceled. Nothing was charged."
          />
        </DesignSponsorshipState>

        <DesignSponsorshipState label="Payment failed" state="payment-failed">
          <GroupFundingSelection
            {...monthly}
            detail="That payment didn’t go through. Nothing was charged."
          />
        </DesignSponsorshipState>

        <DesignSponsorshipState label="Opening checkout" state="checkout-opening">
          <GroupFundingSelection {...monthly} busy locked onModeChange={null} />
        </DesignSponsorshipState>

        <DesignSponsorshipState label="Checkout didn’t open" state="checkout-not-opened">
          <GroupFundingAttemptFailure failure="not_opened" />
        </DesignSponsorshipState>

        <DesignSponsorshipState
          label="Attempt may have reached payment"
          state="checkout-unconfirmed"
        >
          <GroupFundingAttemptFailure failure="unconfirmed" />
        </DesignSponsorshipState>

        <DesignSponsorshipState label="Checkout left open" state="checkout-open">
          <GroupFundingPurchaseStudy
            purchase={designPurchase({
              checkoutUrl: "https://checkout.stripe.test/design",
              status: "checkout_open",
            })}
          />
        </DesignSponsorshipState>

        <DesignSponsorshipState label="Checkout open for another chat" state="target-conflict">
          <GroupFundingPurchaseStudy
            purchase={designPurchase({
              status: "checkout_open",
              targetConflict: true,
            })}
          />
        </DesignSponsorshipState>

        <DesignSponsorshipState label="Confirming payment" state="payment-confirming">
          <GroupFundingPurchaseStudy
            purchase={designPurchase({ status: "payment_pending" })}
          />
        </DesignSponsorshipState>

        <DesignSponsorshipState label="Confirmation is slow" state="payment-slow">
          <GroupFundingPurchaseStudy
            purchase={designPurchase({
              poll: { kind: "exhausted", run: 0 },
              status: "payment_pending",
            })}
          />
        </DesignSponsorshipState>

        <DesignSponsorshipState label="Couldn’t check payment" state="payment-check-failed">
          <GroupFundingPurchaseStudy
            purchase={designPurchase({ poll: { kind: "failed", run: 0 } })}
          />
        </DesignSponsorshipState>

        <DesignSponsorshipState label="Contribution complete" state="fulfilled-receipt">
          <GroupFundingPurchaseStudy
            purchase={designPurchase({ status: "fulfilled" })}
          />
        </DesignSponsorshipState>

        <DesignSponsorshipState label="Group credit is full" state="capacity-conflict">
          <GroupFundingCapacityConflict />
        </DesignSponsorshipState>

        <DesignSponsorshipState label="Active sponsor" state="monthly-active">
          <GroupSponsorshipManagementCard
            {...card}
            management={{
              ...management,
              authorizationId: "hgsa_design_active",
              pendingThisPeriodMinor: 500,
              status: "active",
            }}
          />
        </DesignSponsorshipState>

        <DesignSponsorshipState label="Raising the limit" state="monthly-raising">
          <GroupSponsorshipManagementCard
            {...card}
            initialSelectedMonthlyCapMinor={5_000}
            management={{
              ...management,
              authorizationId: "hgsa_design_raising",
              status: "active",
            }}
          />
        </DesignSponsorshipState>

        <DesignSponsorshipState label="Paused" state="monthly-paused">
          <GroupSponsorshipManagementCard
            {...card}
            management={{
              ...management,
              authorizationId: "hgsa_design_paused",
              status: "paused",
            }}
          />
        </DesignSponsorshipState>

        <DesignSponsorshipState label="Payment needs attention" state="monthly-recovery">
          <GroupSponsorshipManagementCard
            {...card}
            management={{
              ...management,
              authorizationId: "hgsa_design_recovery",
              chargedThisPeriodMinor: 0,
              status: "recovery_required",
            }}
          />
        </DesignSponsorshipState>

        <DesignSponsorshipState label="Billing locked, cancel only" state="monthly-cancel-only">
          <GroupSponsorshipManagementCard
            {...card}
            cancelOnly
            endpoint="/api/groups/fund/design/sponsorship"
            management={{
              ...management,
              authorizationId: "hgsa_design_cancel_only",
              status: "active",
            }}
          />
        </DesignSponsorshipState>

        <DesignSponsorshipState label="Sponsorship canceled" state="monthly-canceled">
          <GroupSponsorshipCanceledReceipt />
        </DesignSponsorshipState>

        <DesignSponsorshipState label="Signed out, group known" state="signed-out">
          <LinkPageScreen
            actions={<GroupFundingSignInButton initiallyOpen={false} />}
            title={headline}
          />
        </DesignSponsorshipState>

        <DesignSponsorshipState
          label="Signed out, link not public"
          state="monthly-management-sign-in"
        >
          <LinkPageScreen
            actions={<GroupFundingSignInButton initiallyOpen={false} />}
            title="Sign in to continue."
          />
        </DesignSponsorshipState>

        <DesignSponsorshipState label="Link unavailable" state="unavailable">
          <LinkPageScreen
            detail="Ask the group for a new one."
            title="This link isn’t working."
          />
        </DesignSponsorshipState>
      </div>

      <GroupSponsorshipManagementConfirmationStudy />
    </div>
  );
}

function designPurchase(
  overrides: Partial<HostedUsageTopUpPurchaseScreen>,
): HostedUsageTopUpPurchaseScreen {
  return {
    cancelAllowed: false,
    checkoutError: null,
    checkoutUrl: null,
    kind: "purchase",
    operation: "idle",
    poll: { kind: "dormant", run: 0 },
    purchaseId: "hucp_design_group_funding",
    restartAt: null,
    retryOfferCode: null,
    retryRequestKey: null,
    selectionConflict: null,
    status: null,
    targetConflict: false,
    ...overrides,
  };
}

function GroupFundingPurchaseStudy({
  purchase,
}: {
  purchase: HostedUsageTopUpPurchaseScreen;
}) {
  const actions = readHostedUsageTopUpPurchaseActions(purchase, false);
  return (
    <GroupFundingPurchaseStatus
      actions={actions}
      groupName={DESIGN_GROUP_NAME}
      operation={purchase.operation}
      status={readGroupFundingPurchaseStatus({
        actions,
        purchase,
        returnedFromSuccessfulCheckout: false,
      })}
    />
  );
}

export function GroupSponsorshipManagementConfirmationStudy() {
  const [open, setOpen] = useState(false);

  return (
    <div
      className="flex flex-col items-start gap-3"
      data-design-component="group-sponsorship-management-confirmation"
    >
      <p className="max-w-[48ch] text-sm/6 text-muted-foreground">
        Preview the payer confirmation shown before a monthly limit increase.
      </p>
      <Button onClick={() => setOpen(true)} variant="outline">
        Preview $50 limit confirmation
      </Button>
      <GroupSponsorshipManagementConfirmationDialog
        busy={false}
        confirmation={open
          ? {
            currentMonthlyCapMinor: 1_000,
            kind: "increase",
            nextMonthlyCapMinor: 5_000,
          }
          : null}
        inert
        onConfirm={() => undefined}
        onOpenChange={setOpen}
      />
    </div>
  );
}

function DesignSponsorshipState(props: {
  children: ReactNode;
  label: string;
  state: string;
}) {
  return (
    <section
      className="min-w-0 scroll-mt-6 space-y-3"
      data-design-state={props.state}
      id={`group-funding-${props.state}`}
    >
      <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        {props.label}
      </p>
      <div
        className="mx-auto flex min-h-[44rem] w-full max-w-sm flex-col overflow-hidden rounded-3xl"
        data-design-surface
      >
        <LinkPageSurface>{props.children}</LinkPageSurface>
      </div>
    </section>
  );
}

function PersonalUsageCreditOwnerStudy() {
  const [fulfilledPreviewKey, setFulfilledPreviewKey] = useState(0);
  const [returnPreview, setReturnPreview] = useState<
    "failed" | "family" | "former" | "inactive" | null
  >(null);

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
          Successful top-up return
        </p>
        <Button
          className="self-start"
          variant="outline"
          onClick={() => setFulfilledPreviewKey((key) => key + 1)}
        >
          Preview quiet refresh
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
              usageTopUpOffers={[]}
            />
          </div>
        ) : null}
      </div>
      <div
        className="flex flex-col gap-3"
        data-design-state="usage-return-dialogs"
      >
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Compact return recovery and Family confirmation
        </p>
        <div className="flex flex-wrap gap-3">
          <Button
            variant="outline"
            onClick={() => setReturnPreview("failed")}
          >
            Preview failed recovery
          </Button>
          <Button
            variant="outline"
            onClick={() => setReturnPreview("family")}
          >
            Preview Family member completion
          </Button>
          <Button
            variant="outline"
            onClick={() => setReturnPreview("inactive")}
          >
            Preview inactive account completion
          </Button>
          <Button
            variant="outline"
            onClick={() => setReturnPreview("former")}
          >
            Preview former member completion
          </Button>
        </div>
        {returnPreview === "failed" ? (
          <HostedUsageTopUpDialog
            activePurchase={{
              offerCode: "usage_10_usd",
              purchaseId: "hucp_design_failed_return",
              retryAllowed: false,
              status: "payment_failed",
            }}
            inert
            initialOpen
            offers={[]}
            payerMemberId={DESIGN_PAYER_MEMBER_ID}
            quietSuccessfulReturn
            scope="personal"
          />
        ) : null}
        {returnPreview === "family" ? (
          <HostedUsageTopUpDialog
            activePurchase={{
              offerCode: "usage_10_usd",
              purchaseId: "hucp_design_family_return",
              retryAllowed: false,
              status: "fulfilled",
            }}
            deferTerminalRefreshUntilClose
            inert
            initialOpen
            offers={[]}
            payerMemberId={DESIGN_PAYER_MEMBER_ID}
            scope="family"
            targetLabel="Family member"
          />
        ) : null}
        {returnPreview === "inactive" ? (
          <HostedBillingSettings
            authenticated
            payerMemberId={DESIGN_PAYER_MEMBER_ID}
            usageStatus={DESIGN_UNAVAILABLE_USAGE_STATUS}
            usageTopUpActivePurchase={{
              offerCode: "usage_10_usd",
              purchaseId: "hucp_design_inactive_return",
              retryAllowed: false,
              status: "fulfilled",
            }}
            usageTopUpInitialOpen
            usageTopUpOffers={[]}
            usageTopUpScope="personal"
          />
        ) : null}
        {returnPreview === "former" ? (
          <HostedUsageTopUpDialog
            activePurchase={{
              offerCode: "usage_10_usd",
              purchaseId: "hucp_design_former_return",
              retryAllowed: false,
              status: "fulfilled",
            }}
            deferTerminalRefreshUntilClose
            inert
            initialOpen
            offers={[]}
            payerMemberId={DESIGN_PAYER_MEMBER_ID}
            scope="family"
            targetLabel="a former family member"
          />
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
