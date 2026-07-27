import type { ReactNode } from "react";
import { CheckIcon } from "lucide-react";
import type { HostedPlanUsageStatus } from "@murphai/hosted-execution/plan-usage";

import { Button } from "@/src/components/ui/button";
import { Progress } from "@/src/components/ui/progress";
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
import { HostedFamilyStartButton } from "./hosted-family-settings-actions";
import { HostedSettingsSessionState } from "./hosted-settings-session-state";
import { StartPaidPulseButton } from "./hosted-start-paid-pulse-button";
import {
  SwitchToGroupButton,
  SwitchToPulseButton,
} from "./hosted-plan-switch-to-pulse-button";
import {
  UpgradeToEdgeButton,
  UpgradeToPulseButton,
} from "./hosted-plan-upgrade-button";
import {
  HostedUsageTopUpDialog,
  type HostedUsageTopUpActivePurchase,
  type HostedUsageTopUpOffer,
  type HostedUsageTopUpReturn,
} from "./hosted-usage-top-up-dialog";

const GROUP_FEATURES = [
  "Same Murph tools and private chat",
  "Stay connected to Murph groups",
  "Sync your health data",
  "Keep group activity current",
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
  note: string | null;
  price: string;
  recommended: boolean;
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
  showGroupPlan?: boolean;
  currentBillingPhase?: unknown;
  currentBillingPlanCode?: unknown;
  currentCheckoutOffer?: unknown;
  currentPeriodEnd?: Date | null;
  familyState?: "none" | "owner" | "sponsored";
  scheduledBillingEffectiveAt?: Date | null;
  scheduledBillingPlanCode?: unknown;
  pulseTrialBillingContinuationPending?: boolean;
  usageCreditBalanceUsdMicros?: string | null;
  usageStatus?: HostedPlanUsageStatus | null;
  usageTopUpActivePurchase?: HostedUsageTopUpActivePurchase | null;
  usageTopUpContactOptions?: readonly MurphContactOption[];
  usageTopUpInitialOpen?: boolean;
  usageTopUpOffers?: readonly HostedUsageTopUpOffer[];
  usageTopUpPurchaseReturn?: HostedUsageTopUpReturn | null;
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
    scheduledPlanCode === "launch_monthly" &&
    scheduledBillingEffectiveAt !== null;
  const pendingGroupSwitchDate = hasPendingGroupSwitch
    ? formatHostedBillingDate(scheduledBillingEffectiveAt)
    : null;
  const pendingPulseSwitchDate = hasPendingPulseSwitch
    ? formatHostedBillingDate(scheduledBillingEffectiveAt)
    : null;

  const cards: PlanCardModel[] = [
    ...(props.showGroupPlan === true && !familyCurrent
      ? [{
          action: groupCurrent
            ? <CurrentPlanButton />
            : hasPendingGroupSwitch
              ? null
              : props.canSwitchToGroup === true &&
                  (pulseCurrent || edgeCurrent)
                ? (
                    isPulseTrial
                      ? (
                          <StartPaidPulseButton
                            block
                            targetPlanCode="launch_group_monthly"
                            timing="at_trial_end"
                          >
                            Choose Group
                          </StartPaidPulseButton>
                        )
                      : (
                          <SwitchToGroupButton
                            block
                            currentPeriodEnd={currentPeriodEndIso}
                            currentPlanCode={
                              edgeCurrent
                                ? "launch_edge_monthly"
                                : "launch_monthly"
                            }
                          >
                            Choose Group
                          </SwitchToGroupButton>
                        )
                  )
                : null,
          current: groupCurrent,
          currentLabel: "Current plan",
          features: GROUP_FEATURES,
          key: "launch_group_monthly",
          name: "Group",
          note: hasPendingGroupSwitch && pendingGroupSwitchDate
            ? `Scheduled to start ${pendingGroupSwitchDate}`
            : null,
          price: formatHostedBillingPrice(
            getHostedBillingPlanDefinition(
              "launch_group_monthly",
            ).recurringAmountUsdCents,
          ),
          recommended:
            isPulseTrial && props.canSwitchToGroup === true,
        } satisfies PlanCardModel]
      : []),
    {
      action: familyOwner
        ? <FamilyBillingChangeButton block targetPlanName="Pulse" />
        : groupCurrent && props.canUpgradeToPulse === true
          ? <UpgradeToPulseButton block>Choose Pulse</UpgradeToPulseButton>
        : pulseCurrent
          ? isPulseTrial &&
              props.canStartPaidPulse === true &&
              !pulseTrialBillingContinuationPending
            ? (
                <StartPaidPulseButton block timing="at_trial_end">
                  Keep Pulse
                </StartPaidPulseButton>
              )
            : <CurrentPlanButton />
          : hasPendingPulseSwitch
            ? null
            : edgeCurrent && props.canSwitchToPulse === true
              ? (
                  <SwitchToPulseButton
                    block
                    currentPeriodEnd={currentPeriodEndIso}
                    currentPlanCode="launch_edge_monthly"
                  >
                    Choose Pulse
                  </SwitchToPulseButton>
                )
              : (
                  <BillingPortalButton
                    block
                    variant="secondary"
                    label="Choose Pulse"
                  />
                ),
      current: pulseCurrent,
      currentLabel: isPulseTrial ? "Free trial" : "Current plan",
      features: PULSE_FEATURES,
      key: "launch_monthly",
      name: "Pulse",
      note: familyOwner
        ? "If you switch away from Family, your family members lose their included access when the Family plan ends."
        : !pulseCurrent && hasPendingPulseSwitch && pendingPulseSwitchDate
          ? `Scheduled to start ${pendingPulseSwitchDate}`
          : null,
      price: formatHostedBillingPrice(
        getHostedBillingPlanDefinition("launch_monthly")
          .recurringAmountUsdCents,
      ),
      recommended: false,
    },
    {
      action: familyOwner
        ? <FamilyBillingChangeButton block targetPlanName="Edge" />
        : edgeCurrent
        ? <CurrentPlanButton />
        : props.canUpgradeToEdge === true
          ? <UpgradeToEdgeButton block>Choose Edge</UpgradeToEdgeButton>
          : <BillingPortalButton block variant="secondary" label="Choose Edge" />,
      current: edgeCurrent,
      currentLabel: "Current plan",
      features: EDGE_FEATURES,
      key: "launch_edge_monthly",
      name: "Edge",
      note: familyOwner
        ? "End or change the Family plan first, then switch to an individual plan."
        : edgeCurrent && hasPendingPulseSwitch && pendingPulseSwitchDate
          ? `Switching to Pulse on ${pendingPulseSwitchDate}. Want to keep Edge? Contact support.`
          : edgeCurrent && hasPendingGroupSwitch && pendingGroupSwitchDate
            ? `Switching to Group on ${pendingGroupSwitchDate}. Want to keep Edge? Contact support.`
            : null,
      price: formatHostedBillingPrice(
        getHostedBillingPlanDefinition("launch_edge_monthly")
          .recurringAmountUsdCents,
      ),
      recommended: false,
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
      recommended: false,
    },
  ];

  const planResolved =
    groupCurrent || pulseCurrent || edgeCurrent || familyCurrent;
  const noPlanText =
    props.billingStatus === "active"
      ? "Your subscription is active."
      : "You're not on a paid plan yet. Choose one below.";

  return (
    <div className="flex flex-col gap-4">
      {!planResolved ? (
        <p className="text-sm text-pretty text-muted-foreground">{noPlanText}</p>
      ) : null}
      <PlanUsageBand
        canStartGroupNow={
          isPulseTrial &&
          props.canStartPaidPulse === true &&
          props.showGroupPlan === true &&
          !pulseTrialBillingContinuationPending
        }
        pulseTrialBillingContinuationPending={pulseTrialBillingContinuationPending}
        status={props.usageStatus}
        usageCreditBalanceUsdMicros={props.usageCreditBalanceUsdMicros}
        usageTopUpActivePurchase={props.usageTopUpActivePurchase}
        usageTopUpContactOptions={props.usageTopUpContactOptions}
        usageTopUpInitialOpen={props.usageTopUpInitialOpen}
        usageTopUpOffers={usageTopUpOffers}
        usageTopUpPurchaseReturn={props.usageTopUpPurchaseReturn}
      />
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
  canStartGroupNow: boolean;
  pulseTrialBillingContinuationPending: boolean;
  status?: HostedPlanUsageStatus | null;
  usageCreditBalanceUsdMicros?: string | null;
  usageTopUpActivePurchase?: HostedUsageTopUpActivePurchase | null;
  usageTopUpContactOptions?: readonly MurphContactOption[];
  usageTopUpInitialOpen?: boolean;
  usageTopUpOffers: readonly HostedUsageTopUpOffer[];
  usageTopUpPurchaseReturn?: HostedUsageTopUpReturn | null;
}) {
  const inactiveTopUpDialog =
    props.usageTopUpActivePurchase ||
    props.usageTopUpInitialOpen ||
    props.usageTopUpPurchaseReturn ? (
      <HostedUsageTopUpDialog
        activePurchase={props.usageTopUpActivePurchase}
        contactOptions={props.usageTopUpContactOptions}
        initialOpen={props.usageTopUpInitialOpen}
        offers={[]}
        purchaseReturn={props.usageTopUpPurchaseReturn}
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
          aria-label="Pulse Trial included AI usage"
          className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5"
        >
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              Included AI usage
            </p>
            <p className="mt-1 font-serif text-xl font-semibold tracking-tight text-foreground">
              Trial ended
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {hasStartAction
                ? props.pulseTrialBillingContinuationPending
                  ? "Finishing your Pulse update."
                  : "Start Pulse to keep Murph replying."
                : "Your included trial usage is no longer active."}
            </p>
          </div>
          {canShowStartAction ? (
            <div className="flex flex-wrap gap-2">
              {props.canStartGroupNow ? (
                <StartPaidPulseButton
                  targetPlanCode="launch_group_monthly"
                >
                  Start Group — $3.50/month
                </StartPaidPulseButton>
              ) : null}
              <StartPaidPulseButton>{action.label}</StartPaidPulseButton>
            </div>
          ) : null}
        </div>
        {inactiveTopUpDialog}
      </>
    );
  }

  const periodEndLabel = formatHostedBillingDate(new Date(status.periodEnd));
  const periodLabel = status.periodKind === "trial"
    ? `Trial ends ${periodEndLabel}`
    : `Resets ${periodEndLabel}`;
  const action = status.recommendedAction;
  const forecast = status.forecast
    ? `At your recent pace, included usage may run out in about ${status.forecast.estimatedDaysRemaining} ${status.forecast.estimatedDaysRemaining === 1 ? "day" : "days"}.`
    : null;
  const hasUsageCredit = hasPositiveUsageCreditBalance(
    props.usageCreditBalanceUsdMicros,
  );
  const willUseUsageCredit =
    status.remainingPercent === 0 && hasUsageCredit;
  const usageTopUpDialog = (
    <HostedUsageTopUpDialog
      activePurchase={props.usageTopUpActivePurchase}
      contactOptions={props.usageTopUpContactOptions}
      initialOpen={props.usageTopUpInitialOpen}
      offers={props.usageTopUpOffers}
      purchaseReturn={props.usageTopUpPurchaseReturn}
    />
  );
  const planAction = (
    <UsagePlanAction
      action={action}
      canStartGroupNow={props.canStartGroupNow === true}
      pulseTrialBillingContinuationPending={
        props.pulseTrialBillingContinuationPending === true
      }
      status={status}
    />
  );

  return (
    <div
      aria-label={`${status.planName} included AI usage`}
      className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 sm:p-5"
    >
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Included AI usage
          </p>
          <p className="mt-1 font-serif text-xl font-semibold tracking-tight text-foreground">
            {status.planName}
          </p>
        </div>
        <p className="text-sm text-muted-foreground">{periodLabel}</p>
      </div>

      <Progress
        aria-label={`${status.usedPercent}% used, ${status.remainingPercent}% remaining`}
        value={status.usedPercent}
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium tabular-nums text-foreground">
            {status.usedPercent}% used
            <span className="font-normal text-muted-foreground">
              {` · ${status.remainingPercent}% remaining`}
            </span>
          </p>
          {willUseUsageCredit ? (
            <p className="text-sm text-pretty text-muted-foreground">
              You&apos;ve used this period&apos;s included usage. Murph will use
              your remaining usage credit.
            </p>
          ) : status.status === "exhausted" ? (
            <p className="text-sm text-pretty text-muted-foreground">
              {status.planCode === "launch_group_monthly"
                ? "You've used this period's included AI usage. Your wearable keeps syncing and your group activity stays current."
                : props.usageTopUpOffers.length > 0
                ? "You've used this period's included usage and any usage credit. Add usage to continue."
                : "You've used this period's included AI usage. New Murph replies pause until more capacity is available; your wearable keeps syncing."}
            </p>
          ) : forecast ? (
            <p className="text-sm text-pretty text-muted-foreground">{forecast}</p>
          ) : null}
        </div>

        {props.usageTopUpOffers.length > 0 || props.usageTopUpActivePurchase
          ? usageTopUpDialog
          : planAction}
      </div>
      {props.usageTopUpOffers.length === 0 &&
      !props.usageTopUpActivePurchase &&
      (props.usageTopUpInitialOpen || props.usageTopUpPurchaseReturn)
        ? usageTopUpDialog
        : null}
    </div>
  );
}

function UsagePlanAction(props: {
  action: Extract<
    HostedPlanUsageStatus,
    { accessKind: string }
  >["recommendedAction"];
  canStartGroupNow: boolean;
  pulseTrialBillingContinuationPending: boolean;
  status: Extract<HostedPlanUsageStatus, { accessKind: string }>;
}) {
  const action = props.action;
  if (!action) {
    return null;
  }

  if (action.kind === "change_plan") {
    if (action.targetPlanCode === "launch_group_monthly") {
      return props.canStartGroupNow ? (
        <StartPaidPulseButton
          targetPlanCode="launch_group_monthly"
          timing={props.status.status === "exhausted" ? "now" : "at_trial_end"}
        >
          {action.label}
        </StartPaidPulseButton>
      ) : null;
    }
    if (action.targetPlanCode === "launch_monthly") {
      return props.status.accessKind === "trial" ? (
        <StartPaidPulseButton
          timing={props.status.status === "exhausted" ? "now" : "at_trial_end"}
        >
          {action.label}
        </StartPaidPulseButton>
      ) : (
        <UpgradeToPulseButton>{action.label}</UpgradeToPulseButton>
      );
    }
    return <UpgradeToEdgeButton>{action.label}</UpgradeToEdgeButton>;
  }

  if (
    action.kind === "start_pulse"
    && !props.pulseTrialBillingContinuationPending
  ) {
    return (
      <div className="flex flex-wrap gap-2">
        {props.canStartGroupNow ? (
          <StartPaidPulseButton targetPlanCode="launch_group_monthly">
            Start Group — $3.50/month
          </StartPaidPulseButton>
        ) : null}
        <StartPaidPulseButton>{action.label}</StartPaidPulseButton>
      </div>
    );
  }
  if (action.kind === "upgrade_pulse") {
    return <UpgradeToPulseButton>{action.label}</UpgradeToPulseButton>;
  }
  if (action.kind === "upgrade_edge") {
    return <UpgradeToEdgeButton>{action.label}</UpgradeToEdgeButton>;
  }
  return null;
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

function PlanCard({ card }: { card: PlanCardModel }) {
  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-xl border",
        card.current || card.recommended
          ? "border-primary ring-1 ring-primary/40"
          : "border-border",
      )}
    >
      {card.current || card.recommended ? (
        <div className="bg-primary px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-primary-foreground">
          {card.current ? card.currentLabel : "Recommended"}
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
        {card.note ? <p className="text-xs leading-5 text-muted-foreground">{card.note}</p> : null}
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

function hasPositiveUsageCreditBalance(
  value: string | null | undefined,
): boolean {
  if (typeof value !== "string" || !/^[0-9]+$/u.test(value)) {
    return false;
  }

  return BigInt(value) > 0n;
}
