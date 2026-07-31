import type { ReactNode } from "react";
import { CheckIcon } from "lucide-react";
import {
  HOSTED_GROUP_MEMBER_PLAN_DISPLAY_NAME,
  type HostedPlanUsageStatus,
} from "@murphai/hosted-execution/plan-usage";

import { Button } from "@/src/components/ui/button";
import { Progress } from "@/src/components/ui/progress";
import { ContactSupportAction } from "@/src/components/support/contact-support-action";
import {
  HOSTED_FAMILY_PLAN_DISPLAY,
  HOSTED_PULSE_TRIAL_OFFER,
  formatHostedBillingPrice,
  getHostedBillingPlanDefinition,
  parseHostedBillingCheckoutOffer,
  parseHostedBillingPhase,
  parseHostedBillingPlanCode,
} from "@/src/lib/hosted-onboarding/billing-plans";
import type { MurphContactOption } from "@/src/lib/murph-contact-routing";
import { cn } from "@/src/lib/utils";

import { BillingPortalButton } from "./billing-portal-button";
import { HostedFamilyStartButton } from "./hosted-family-start-button";
import { HostedSettingsSessionState } from "./hosted-settings-session-state";
import { StartPaidPulseButton } from "./hosted-start-paid-pulse-button";
import { HostedPlanChangeButton } from "./hosted-plan-change-button";
import { SwitchToPulseButton } from "./hosted-plan-switch-to-pulse-button";
import { UpgradeToEdgeButton } from "./hosted-plan-upgrade-button";
import {
  HostedUsageTopUpDialog,
  type HostedUsageTopUpActivePurchase,
  type HostedUsageTopUpOffer,
  type HostedUsageTopUpReturn,
} from "./hosted-usage-top-up-dialog";

const GROUP_FEATURES = [
  "Stay connected to Murph groups",
  "Sync your health and activity data",
  "Keep group scores current",
  "Private Murph chat",
  "Lighter included AI usage",
];

const PULSE_FEATURES = [
  "Run experiments, see what changed",
  "Sync your health data",
  "Private before/after outcomes",
  "Chat via iMessage, Telegram, or email",
  "Access to the most capable AI models",
];

const EDGE_FEATURES = [
  "Everything in Pulse",
  "More usage on the latest AI models",
  "Murph remembers more of your history",
  "Deeper research and analysis",
];

const FAMILY_FEATURES = [
  "2 to 6 people, one bill",
  "Choose Pulse or Edge for each person",
  "Each person keeps a private Murph",
  "You can't see members' chats or health data",
];

interface PlanCardModel {
  action: ReactNode;
  current: boolean;
  currentLabel: string;
  features: readonly string[];
  key: string;
  name: string;
  note: ReactNode;
  price: string;
}

export function HostedBillingSettings(props: {
  authenticated: boolean;
  billingStatus?: unknown;
  canStartFamily?: boolean;
  canStartPaidPulse?: boolean;
  canSwitchToGroup?: boolean;
  canSwitchToPulse?: boolean;
  canUpgradeToPulse?: boolean;
  canUpgradeToEdge?: boolean;
  currentBillingPhase?: unknown;
  currentBillingPlanCode?: unknown;
  currentCheckoutOffer?: unknown;
  currentPeriodEnd?: Date | null;
  familyState?: "none" | "owner" | "sponsored";
  groupPaymentMethodSaved?: boolean;
  payerMemberId?: string | null;
  scheduledBillingEffectiveAt?: Date | null;
  scheduledBillingPlanCode?: unknown;
  showGroupPlan?: boolean;
  pulseTrialBillingContinuationPending?: boolean;
  usageActivityDetail?: ReactNode;
  usageStatus?: HostedPlanUsageStatus | null;
  usageTopUpActivePurchase?: HostedUsageTopUpActivePurchase | null;
  usageTopUpCheckoutUrl?: string;
  usageTopUpContactOptions?: readonly MurphContactOption[];
  usageTopUpInitialOpen?: boolean;
  usageTopUpOffers?: readonly HostedUsageTopUpOffer[];
  usageTopUpPurchaseReturn?: HostedUsageTopUpReturn | null;
  usageTopUpScope?: "family" | "personal";
  usageTopUpTargetLabel?: string;
}) {
  if (!props.authenticated) {
    return (
      <HostedSettingsSessionState
        authenticated={props.authenticated}
        signedOutDescription="Sign in to manage your subscription."
      />
    );
  }

  const currentPlanCode = parseHostedBillingPlanCode(props.currentBillingPlanCode);
  const currentPhase = parseHostedBillingPhase(props.currentBillingPhase);
  const currentOffer = parseHostedBillingCheckoutOffer(props.currentCheckoutOffer);
  const scheduledPlanCode = parseHostedBillingPlanCode(props.scheduledBillingPlanCode);
  const scheduledBillingEffectiveAt =
    props.scheduledBillingEffectiveAt instanceof Date ? props.scheduledBillingEffectiveAt : null;
  const currentPeriodEndIso = props.currentPeriodEnd?.toISOString() ?? null;

  const familyState = props.familyState ?? "none";
  const familyCurrent = familyState === "owner" || familyState === "sponsored";
  const familyOwner = familyState === "owner";
  const groupCurrent =
    !familyCurrent && currentPlanCode === "launch_group_monthly";
  const pulseCurrent = !familyCurrent && currentPlanCode === "launch_monthly";
  const edgeCurrent = !familyCurrent && currentPlanCode === "launch_edge_monthly";
  const usageTopUpOffers = props.usageTopUpOffers ?? [];

  const isPulseTrial =
    pulseCurrent && currentPhase !== "paid" && currentOffer === HOSTED_PULSE_TRIAL_OFFER;
  const pulseTrialBillingContinuationPending =
    props.pulseTrialBillingContinuationPending === true;
  const hasPendingGroupSwitch =
    scheduledPlanCode === "launch_group_monthly" &&
    scheduledBillingEffectiveAt !== null;
  const hasPendingPulseSwitch =
    scheduledPlanCode === "launch_monthly" && scheduledBillingEffectiveAt !== null;
  const pendingGroupSwitchDate = hasPendingGroupSwitch
    ? formatHostedBillingDate(scheduledBillingEffectiveAt)
    : null;
  const pendingPulseSwitchDate = hasPendingPulseSwitch
    ? formatHostedBillingDate(scheduledBillingEffectiveAt)
    : null;

  const cards: PlanCardModel[] = [
    ...(props.showGroupPlan === true && !familyCurrent
      ? [
          {
            action: groupCurrent
              ? <CurrentPlanButton />
              : hasPendingGroupSwitch
                ? null
                : props.canSwitchToGroup === true
                  ? isPulseTrial
                    ? (
                        <StartPaidPulseButton
                          block
                          targetPlanCode="launch_group_monthly"
                          timing="at_trial_end"
                        >
                          Choose {HOSTED_GROUP_MEMBER_PLAN_DISPLAY_NAME}
                        </StartPaidPulseButton>
                      )
                    : (
                        <HostedPlanChangeButton
                          block
                          currentPeriodEnd={currentPeriodEndIso}
                          mode="schedule"
                          targetPlanCode="launch_group_monthly"
                        >
                          Choose {HOSTED_GROUP_MEMBER_PLAN_DISPLAY_NAME}
                        </HostedPlanChangeButton>
                      )
                  : isPulseTrial && props.canStartPaidPulse === true
                    ? (
                        <StartPaidPulseButton
                          block
                          targetPlanCode="launch_group_monthly"
                          timing="now"
                        >
                          Start {HOSTED_GROUP_MEMBER_PLAN_DISPLAY_NAME}
                        </StartPaidPulseButton>
                      )
                  : null,
            current: groupCurrent,
            currentLabel: "Current plan",
            features: GROUP_FEATURES,
            key: "launch_group_monthly",
            name: HOSTED_GROUP_MEMBER_PLAN_DISPLAY_NAME,
            note: pendingGroupSwitchDate
              ? `Scheduled to start ${pendingGroupSwitchDate}`
              : "Available to confirmed members of a Murph group.",
            price: formatHostedBillingPrice(
              getHostedBillingPlanDefinition("launch_group_monthly")
                .recurringAmountUsdCents,
            ),
          } satisfies PlanCardModel,
        ]
      : []),
    {
      action: familyOwner
        ? <FamilyBillingChangeButton block targetPlanName="Pulse" />
        : groupCurrent && props.canUpgradeToPulse === true
          ? (
              <HostedPlanChangeButton
                block
                expectedCurrentPlanCode="launch_group_monthly"
                mode="upgrade"
                targetPlanCode="launch_monthly"
              >
                Choose Pulse
              </HostedPlanChangeButton>
            )
        : pulseCurrent
        ? isPulseTrial
          && props.canStartPaidPulse === true
          && !pulseTrialBillingContinuationPending
          ? <StartPaidPulseButton block>Start Pulse plan</StartPaidPulseButton>
          : <CurrentPlanButton />
        : hasPendingPulseSwitch
          ? null
          : props.canSwitchToPulse === true
            ? (
                <SwitchToPulseButton block currentPeriodEnd={currentPeriodEndIso}>
                  Choose Pulse
                </SwitchToPulseButton>
              )
            : <BillingPortalButton block variant="secondary" label="Choose Pulse" />,
      current: pulseCurrent,
      currentLabel: isPulseTrial ? "Free trial" : "Current plan",
      features: PULSE_FEATURES,
      key: "launch_monthly",
      name: "Pulse",
      note: familyOwner
        ? "If you switch away from Family, your family members lose their included access when the Family plan ends."
        : pulseCurrent && hasPendingGroupSwitch && pendingGroupSwitchDate
          ? (
              <PendingPlanChangeNote
                currentPlanName="Pulse"
                effectiveAt={pendingGroupSwitchDate}
                targetPlanName={HOSTED_GROUP_MEMBER_PLAN_DISPLAY_NAME}
              />
            )
        : !pulseCurrent && hasPendingPulseSwitch && pendingPulseSwitchDate
        ? `Scheduled to start ${pendingPulseSwitchDate}`
        : null,
      price: formatHostedBillingPrice(
        getHostedBillingPlanDefinition("launch_monthly").recurringAmountUsdCents,
      ),
    },
    {
      action: familyOwner
        ? <FamilyBillingChangeButton block targetPlanName="Edge" />
        : edgeCurrent
        ? <CurrentPlanButton />
        : props.canUpgradeToEdge === true
          ? currentPlanCode === "launch_group_monthly"
            || currentPlanCode === "launch_monthly"
            ? (
                <UpgradeToEdgeButton
                  block
                  expectedCurrentPlanCode={currentPlanCode}
                >
                  Choose Edge
                </UpgradeToEdgeButton>
              )
            : null
          : <BillingPortalButton block variant="secondary" label="Choose Edge" />,
      current: edgeCurrent,
      currentLabel: "Current plan",
      features: EDGE_FEATURES,
      key: "launch_edge_monthly",
      name: "Edge",
      note: familyOwner
        ? "End or change the Family plan first, then switch to an individual plan."
        : edgeCurrent && hasPendingPulseSwitch && pendingPulseSwitchDate
        ? (
            <PendingPlanChangeNote
              currentPlanName="Edge"
              effectiveAt={pendingPulseSwitchDate}
              targetPlanName="Pulse"
            />
          )
        : edgeCurrent && hasPendingGroupSwitch && pendingGroupSwitchDate
        ? (
            <PendingPlanChangeNote
              currentPlanName="Edge"
              effectiveAt={pendingGroupSwitchDate}
              targetPlanName={HOSTED_GROUP_MEMBER_PLAN_DISPLAY_NAME}
            />
          )
        : null,
      price: formatHostedBillingPrice(
        getHostedBillingPlanDefinition("launch_edge_monthly").recurringAmountUsdCents,
      ),
    },
    {
      action: familyCurrent
        ? <CurrentPlanButton />
        : props.canStartFamily === true
          ? <HostedFamilyStartButton block label="Choose Family" />
          : null,
      current: familyCurrent,
      currentLabel: familyState === "sponsored" ? "Sponsored" : "Current plan",
      features: FAMILY_FEATURES,
      key: "family",
      name: "Family",
      note: familyState === "sponsored" ? "Paid by your family plan owner." : null,
      price: `From ${formatHostedBillingPrice(
        HOSTED_FAMILY_PLAN_DISPLAY.recurringAmountUsdCentsPerSeat,
      )}/person`,
    },
  ];

  const planResolved = groupCurrent || pulseCurrent || edgeCurrent || familyCurrent;
  const noPlanText =
    props.billingStatus === "active"
      ? "Your subscription is active."
      : "You're not on a paid plan yet. Choose one below.";

  return (
    <div className="flex flex-col gap-4">
      {props.groupPaymentMethodSaved ? (
        <div className="flex flex-col gap-4 rounded-xl border border-primary/25 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-primary">
              Payment method saved
            </p>
            <p className="mt-1 font-serif text-xl font-semibold tracking-tight text-foreground">
              {HOSTED_GROUP_MEMBER_PLAN_DISPLAY_NAME} has not started
            </p>
            <p className="mt-1 max-w-2xl text-sm text-pretty text-muted-foreground">
              {HOSTED_GROUP_MEMBER_PLAN_DISPLAY_NAME} has not started. Review
              the plan options below and make a fresh choice when you are
              ready.
            </p>
          </div>
        </div>
      ) : null}
      {!planResolved ? (
        <p className="text-sm text-pretty text-muted-foreground">{noPlanText}</p>
      ) : null}
      <PlanUsageBand
        pulseTrialBillingContinuationPending={pulseTrialBillingContinuationPending}
        status={props.usageStatus}
        usageTopUpActivePurchase={props.usageTopUpActivePurchase}
        usageTopUpCheckoutUrl={props.usageTopUpCheckoutUrl}
        usageTopUpContactOptions={props.usageTopUpContactOptions}
        usageTopUpInitialOpen={props.usageTopUpInitialOpen}
        usageTopUpOffers={usageTopUpOffers}
        payerMemberId={props.payerMemberId}
        usageTopUpPurchaseReturn={props.usageTopUpPurchaseReturn}
        usageTopUpScope={props.usageTopUpScope}
        usageTopUpTargetLabel={props.usageTopUpTargetLabel}
      />
      {props.usageActivityDetail}
      <div
        className={cn(
          "grid items-stretch gap-3",
          props.showGroupPlan === true && !familyCurrent
            ? "sm:grid-cols-2 lg:grid-cols-4"
            : "sm:grid-cols-3",
        )}
      >
        {cards.map((card) => (
          <PlanCard key={card.key} card={card} />
        ))}
      </div>
      <div className="flex justify-end">
        {familyState === "sponsored" ? (
          <p className="text-sm text-muted-foreground">
            Billing is managed by your Family plan owner.
          </p>
        ) : (
          <BillingPortalButton
            billingScope={familyOwner ? "family" : "member"}
            variant="ghost"
            label={familyOwner ? "Manage Family billing" : "Manage billing"}
          />
        )}
      </div>
    </div>
  );
}

function PlanUsageBand(props: {
  pulseTrialBillingContinuationPending: boolean;
  status?: HostedPlanUsageStatus | null;
  usageTopUpActivePurchase?: HostedUsageTopUpActivePurchase | null;
  usageTopUpCheckoutUrl?: string;
  usageTopUpContactOptions?: readonly MurphContactOption[];
  usageTopUpInitialOpen?: boolean;
  usageTopUpOffers: readonly HostedUsageTopUpOffer[];
  payerMemberId?: string | null;
  usageTopUpPurchaseReturn?: HostedUsageTopUpReturn | null;
  usageTopUpScope?: "family" | "personal";
  usageTopUpTargetLabel?: string;
}) {
  const payerMemberId = props.payerMemberId?.trim() || null;
  const inactiveTopUpDialog =
    payerMemberId && (
      props.usageTopUpActivePurchase ||
      props.usageTopUpInitialOpen ||
      props.usageTopUpPurchaseReturn
    ) ? (
      <HostedUsageTopUpDialog
        activePurchase={props.usageTopUpActivePurchase}
        checkoutUrl={props.usageTopUpCheckoutUrl}
        contactOptions={props.usageTopUpContactOptions}
        initialOpen={props.usageTopUpInitialOpen}
        offers={[]}
        payerMemberId={payerMemberId}
        purchaseReturn={props.usageTopUpPurchaseReturn}
        scope={props.usageTopUpScope}
        targetLabel={props.usageTopUpTargetLabel}
      />
    ) : null;

  if (!props.status) {
    return inactiveTopUpDialog;
  }

  const { status } = props;
  if (status.status === "unavailable") {
    if (status.reason !== "trial_conversion_pending") {
      return inactiveTopUpDialog;
    }

    const action = status.recommendedAction;
    const hasStartAction = action?.kind === "start_pulse";
    const canShowStartAction =
      hasStartAction && !props.pulseTrialBillingContinuationPending;
    return (
      <>
        <div
          aria-label="Pulse Trial AI usage"
          className="flex flex-col gap-3 border-y border-border/80 py-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <div>
            <p className="text-sm font-semibold text-foreground">AI usage</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Pulse Trial · Trial ended
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              {hasStartAction
                ? props.pulseTrialBillingContinuationPending
                  ? "Finishing your Pulse update."
                  : "Start Pulse to keep Murph replying."
                : "Your trial usage is no longer active."}
            </p>
          </div>
          {canShowStartAction ? (
            <StartPaidPulseButton>
              {action?.label ?? "Start Pulse"}
            </StartPaidPulseButton>
          ) : null}
        </div>
        {inactiveTopUpDialog}
      </>
    );
  }

  const periodEndLabel = formatHostedBillingDate(new Date(status.periodEnd));
  const displayPlanName =
    status.planCode === "launch_group_monthly"
      ? HOSTED_GROUP_MEMBER_PLAN_DISPLAY_NAME
      : status.planName;
  const periodLabel = status.periodKind === "trial"
    ? `Trial ends ${periodEndLabel}`
    : `Resets ${periodEndLabel}`;
  const action = status.recommendedAction;
  const forecast = status.forecast
    ? `At your recent pace, usage may run out in about ${status.forecast.estimatedDaysRemaining} ${status.forecast.estimatedDaysRemaining === 1 ? "day" : "days"}.`
    : null;
  const usageTopUpDialog = payerMemberId ? (
    <HostedUsageTopUpDialog
      activePurchase={props.usageTopUpActivePurchase}
      checkoutUrl={props.usageTopUpCheckoutUrl}
      contactOptions={props.usageTopUpContactOptions}
      initialOpen={props.usageTopUpInitialOpen}
      offers={props.usageTopUpOffers}
      payerMemberId={payerMemberId}
      purchaseReturn={props.usageTopUpPurchaseReturn}
      scope={props.usageTopUpScope}
      targetLabel={props.usageTopUpTargetLabel}
      triggerClassName="shrink-0"
      triggerSize="sm"
    />
  ) : null;

  return (
    <div
      aria-label={`${displayPlanName} AI usage`}
      className="border-y border-border/80 py-4"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">AI usage</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {displayPlanName} · {periodLabel}
          </p>
        </div>
        {props.usageTopUpOffers.length > 0 || props.usageTopUpActivePurchase
          ? usageTopUpDialog
          : action?.kind === "start_pulse"
            && !props.pulseTrialBillingContinuationPending ? (
          <StartPaidPulseButton>{action.label}</StartPaidPulseButton>
        ) : action?.kind === "upgrade_edge" ? (
          <UpgradeToEdgeButton
            expectedCurrentPlanCode={
              status.planCode === "launch_group_monthly"
                ? "launch_group_monthly"
                : "launch_monthly"
            }
          >
            {action.label}
          </UpgradeToEdgeButton>
        ) : null}
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Progress
          aria-label={`${status.usedPercent}% used, ${status.remainingPercent}% remaining`}
          className="min-w-0 flex-1"
          value={status.usedPercent}
        />
        <span className="shrink-0 text-xs font-medium tabular-nums text-foreground">
          {status.remainingPercent}% remaining
        </span>
      </div>
      {status.status === "exhausted" ? (
        <p className="mt-3 text-sm text-pretty text-muted-foreground">
          {status.planCode === "launch_group_monthly"
            ? "You've used this period's included AI usage. Your wearable keeps syncing and your group activity stays current."
            : props.usageTopUpOffers.length > 0
              ? "You've used all available usage. Add usage to continue."
              : "You've used all available usage. Murph pauses new usage until more capacity is available."}
        </p>
      ) : forecast ? (
        <p className="mt-3 text-sm text-pretty text-muted-foreground">{forecast}</p>
      ) : null}
      {props.usageTopUpOffers.length === 0 &&
      !props.usageTopUpActivePurchase &&
      (props.usageTopUpInitialOpen || props.usageTopUpPurchaseReturn)
        ? usageTopUpDialog
        : null}
    </div>
  );
}

function FamilyBillingChangeButton(props: {
  block?: boolean;
  targetPlanName: "Edge" | "Pulse";
}) {
  return (
    <BillingPortalButton
      billingScope="family"
      block={props.block}
      variant="secondary"
      label={`Manage Family billing`}
      confirmation={{
        confirmLabel: "Open Family billing",
        title: `Switch from Family to ${props.targetPlanName}`,
        description:
          "Family billing is shared. If you end or change it, your family members keep their own Murph accounts, but their included access ends when the Family plan ends.",
      }}
    />
  );
}

function PendingPlanChangeNote(props: {
  currentPlanName: string;
  effectiveAt: string;
  targetPlanName: string;
}) {
  return (
    <span className="flex flex-col items-start gap-2">
      <span>
        {props.targetPlanName} starts {props.effectiveAt}.{" "}
        {props.currentPlanName} stays active until then.
      </span>
      <ContactSupportAction
        body={`Hi Murph support,\n\nI need help changing my scheduled ${props.targetPlanName} plan switch.`}
        className="rounded-lg px-3 py-1.5 text-xs"
        subject="Murph scheduled plan change"
      >
        Change scheduled plan
      </ContactSupportAction>
    </span>
  );
}

function PlanCard({ card }: { card: PlanCardModel }) {
  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-xl border",
        card.current ? "border-primary ring-1 ring-primary/40" : "border-border",
      )}
    >
      {card.current ? (
        <div className="bg-primary px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-primary-foreground">
          {card.currentLabel}
        </div>
      ) : null}
      <div className="flex flex-1 flex-col gap-3 p-4">
        <p className="font-serif text-xl font-semibold tracking-tight text-foreground">
          {card.name}
        </p>
        <p className="text-sm text-muted-foreground">
          <span className="font-serif text-2xl font-semibold tracking-tight text-foreground">
            {card.price}
          </span>{" "}
          / month
        </p>
        <ul className="flex flex-1 flex-col gap-2 text-sm text-muted-foreground">
          {card.features.map((feature) => (
            <li key={feature} className="flex items-start gap-2">
              <CheckIcon
                className="mt-0.5 size-3.5 shrink-0 text-primary"
                strokeWidth={2.5}
                aria-hidden="true"
              />
              {feature}
            </li>
          ))}
        </ul>
        {card.note ? (
          <div className="text-xs leading-5 text-muted-foreground">
            {card.note}
          </div>
        ) : null}
        {card.action ? <div className="pt-1">{card.action}</div> : null}
      </div>
    </div>
  );
}

function CurrentPlanButton() {
  return (
    <Button type="button" variant="outline" size="default" disabled className="w-full">
      Current plan
    </Button>
  );
}

function formatHostedBillingDate(value: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(value);
}
