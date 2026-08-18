import type { ReactNode } from "react";
import Link from "next/link";
import { CheckIcon } from "lucide-react";
import {
  HOSTED_GROUP_MEMBER_PLAN_DISPLAY_NAME,
  type HostedPlanUsageStatus,
} from "@murphai/hosted-execution/plan-usage";

import { ContactSupportAction } from "@/src/components/support/contact-support-action";
import { Button, buttonVariants } from "@/src/components/ui/button";
import { Progress } from "@/src/components/ui/progress";
import {
  HOSTED_FAMILY_PLAN_DISPLAY,
  formatHostedBillingPrice,
  getHostedBillingPlanDefinition,
  parseHostedBillingPhase,
  parseHostedBillingPlanCode,
  type HostedBillingPlanCode,
} from "@/src/lib/hosted-onboarding/billing-plans";
import {
  SETTINGS_CORE_FEATURES,
  SETTINGS_EDGE_FEATURES,
  SETTINGS_FAMILY_FEATURES,
  SETTINGS_MAX_FEATURES,
  SETTINGS_PULSE_FEATURES,
} from "@/src/lib/hosted-onboarding/plan-features";
import type {
  HostedFamilyDraftRecoveryProjection,
} from "@/src/lib/hosted-onboarding/family-plan";
import { cn } from "@/src/lib/utils";

import { BillingPortalButton } from "./billing-portal-button";
import { HostedFamilyAbandonButton } from "./hosted-family-abandon-button";
import { HostedFamilyStartButton } from "./hosted-family-start-button";
import { HostedPlanChangeButton } from "./hosted-plan-change-button";
import { HostedPlanCheckoutButton } from "./hosted-plan-checkout-button";
import { SwitchToPulseButton } from "./hosted-plan-switch-to-pulse-button";
import { UpgradeToEdgeButton } from "./hosted-plan-upgrade-button";
import { HostedSettingsSessionState } from "./hosted-settings-session-state";
import { HostedSponsoredFamilyRecoveryDialog } from "./hosted-sponsored-family-recovery-dialog";
import {
  HostedUsageTopUpDialog,
  type HostedUsageTopUpActivePurchase,
  type HostedUsageTopUpOffer,
  type HostedUsageTopUpReturn,
} from "./hosted-usage-top-up-dialog";

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
  canManageBilling?: boolean;
  canStartDirectPlan?: boolean;
  canStartFamily?: boolean;
  canSwitchToEdge?: boolean;
  canSwitchToGroup?: boolean;
  canSwitchToPulse?: boolean;
  canUpgradeToEdge?: boolean;
  canUpgradeToMax?: boolean;
  canUpgradeToPulse?: boolean;
  currentBillingPhase?: unknown;
  currentBillingPlanCode?: unknown;
  currentPeriodEnd?: Date | null;
  familyBillingOwner?: boolean;
  familyDraftRecovery?: HostedFamilyDraftRecoveryProjection | null;
  familyInviteReturnPath?: string | null;
  familyRecurringUpgradeAvailable?: boolean;
  familyState?: "none" | "owner" | "sponsored";
  groupPaymentMethodSaved?: boolean;
  payerMemberId?: string | null;
  planChangePending?: boolean;
  scheduledBillingEffectiveAt?: Date | null;
  scheduledBillingPlanCode?: unknown;
  showGroupPlan?: boolean;
  showMaxPlan?: boolean;
  usageActivityDetail?: ReactNode;
  usageRecoveryInitialOpen?: boolean;
  usageStatus?: HostedPlanUsageStatus | null;
  usageTopUpActivePurchase?: HostedUsageTopUpActivePurchase | null;
  usageTopUpCheckoutUrl?: string;
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
  const scheduledPlanCode = parseHostedBillingPlanCode(props.scheduledBillingPlanCode);
  const scheduledBillingEffectiveAt =
    props.scheduledBillingEffectiveAt instanceof Date
      ? props.scheduledBillingEffectiveAt
      : null;
  const currentPeriodEndIso = props.currentPeriodEnd?.toISOString() ?? null;

  const familyState = props.familyState ?? "none";
  const familyCurrent = familyState === "owner" || familyState === "sponsored";
  const activeFamilyOwner = familyState === "owner";
  const familyBillingOwner = props.familyBillingOwner === true || activeFamilyOwner;
  const familyDraftRecovery = familyBillingOwner
    ? null
    : props.familyDraftRecovery ?? null;
  const familyDraftRecoveryState = familyDraftRecovery?.state ?? null;
  const sponsoredMember = familyState === "sponsored";
  const ownAccessActive =
    props.billingStatus === "active"
    && !familyCurrent
    && !familyBillingOwner;
  const ownPaidBillingActive = ownAccessActive && currentPhase === "paid";
  const starterAccessActive = ownAccessActive && !ownPaidBillingActive;
  const groupCurrent =
    ownPaidBillingActive && currentPlanCode === "launch_group_monthly";
  const pulseCurrent =
    ownPaidBillingActive && currentPlanCode === "launch_monthly";
  const edgeCurrent =
    ownPaidBillingActive && currentPlanCode === "launch_edge_monthly";
  const maxCurrent =
    ownPaidBillingActive && currentPlanCode === "launch_max_monthly";
  const usageTopUpOffers = props.usageTopUpOffers ?? [];
  const canStartDirectPlan =
    props.canStartDirectPlan === true && !familyCurrent && !ownPaidBillingActive;
  const usageRecoveryPlanCode = resolveDirectUsageRecoveryPlanCode({
    canStartDirectPlan,
    canUpgradeToEdge: props.canUpgradeToEdge === true,
    canUpgradeToMax: props.canUpgradeToMax === true,
    canUpgradeToPulse: props.canUpgradeToPulse === true,
    currentPlanCode,
    familyCurrent,
    planChangePending: props.planChangePending === true,
    showGroupPlan: props.showGroupPlan === true,
    status: props.usageStatus,
  });
  const usageRecoveryPlanName = usageRecoveryPlanCode
    ? getHostedBillingPlanDefinition(usageRecoveryPlanCode).displayName
    : null;
  const usageRecoveryRecurringAction = usageRecoveryPlanCode && usageRecoveryPlanName
    ? renderDirectUsageRecoveryAction({
        currentPlanCode,
        starterAccessActive,
        targetPlanCode: usageRecoveryPlanCode,
        targetPlanName: usageRecoveryPlanName,
      })
    : activeFamilyOwner && props.familyRecurringUpgradeAvailable === true
      ? (
          <Link
            className={cn(
              buttonVariants({ size: "lg" }),
              "min-h-11 w-full sm:w-auto",
            )}
            href="#family"
          >
            Upgrade Family access
          </Link>
        )
      : null;
  const usageRecoveryRecurringPlanName = usageRecoveryPlanName
    ?? (activeFamilyOwner && props.familyRecurringUpgradeAvailable === true
      ? "a higher Family tier"
      : null);
  const hasUsageTopUpOwner = Boolean(
    props.usageTopUpActivePurchase || props.usageTopUpPurchaseReturn,
  );
  const showSponsoredRecovery =
    sponsoredMember
    && props.usageStatus?.status === "exhausted"
    && !hasUsageTopUpOwner;

  const hasPendingGroupSwitch =
    scheduledPlanCode === "launch_group_monthly" &&
    scheduledBillingEffectiveAt !== null;
  const hasPendingPulseSwitch =
    scheduledPlanCode === "launch_monthly" &&
    scheduledBillingEffectiveAt !== null;
  const hasPendingEdgeSwitch =
    scheduledPlanCode === "launch_edge_monthly" &&
    scheduledBillingEffectiveAt !== null;
  const hasPendingMaxSwitch =
    scheduledPlanCode === "launch_max_monthly" &&
    scheduledBillingEffectiveAt !== null;
  const pendingGroupSwitchDate = hasPendingGroupSwitch
    ? formatHostedBillingDate(scheduledBillingEffectiveAt)
    : null;
  const pendingPulseSwitchDate = hasPendingPulseSwitch
    ? formatHostedBillingDate(scheduledBillingEffectiveAt)
    : null;
  const pendingEdgeSwitchDate = hasPendingEdgeSwitch
    ? formatHostedBillingDate(scheduledBillingEffectiveAt)
    : null;
  const pendingMaxSwitchDate = hasPendingMaxSwitch
    ? formatHostedBillingDate(scheduledBillingEffectiveAt)
    : null;

  const pulseAction: ReactNode = (() => {
    if (activeFamilyOwner) {
      return <FamilyBillingChangeButton block targetPlanName="Pulse" />;
    }
    if (familyBillingOwner) {
      return null;
    }
    if (sponsoredMember) {
      return null;
    }
    if (groupCurrent && props.canUpgradeToPulse === true) {
      return (
        <HostedPlanChangeButton
          block
          expectedCurrentPlanCode="launch_group_monthly"
          mode="upgrade"
          targetPlanCode="launch_monthly"
        >
          Choose Pulse
        </HostedPlanChangeButton>
      );
    }
    if (pulseCurrent) {
      return <CurrentPlanButton />;
    }
    if (scheduledPlanCode !== null) {
      return null;
    }
    if (maxCurrent) {
      return props.canSwitchToPulse === true ? (
        <HostedPlanChangeButton
          block
          currentPeriodEnd={currentPeriodEndIso}
          mode="schedule"
          targetPlanCode="launch_monthly"
        >
          Choose Pulse
        </HostedPlanChangeButton>
      ) : null;
    }
    if (props.canSwitchToPulse === true) {
      return (
        <SwitchToPulseButton block currentPeriodEnd={currentPeriodEndIso}>
          Choose Pulse
        </SwitchToPulseButton>
      );
    }
    if (canStartDirectPlan) {
      return (
        <HostedPlanCheckoutButton block targetPlanCode="launch_monthly">
          Choose Pulse
        </HostedPlanCheckoutButton>
      );
    }
    return props.canManageBilling === true ? (
      <BillingPortalButton block label="Choose Pulse" variant="secondary" />
    ) : null;
  })();

  const edgeAction: ReactNode = (() => {
    if (activeFamilyOwner) {
      return <FamilyBillingChangeButton block targetPlanName="Edge" />;
    }
    if (familyBillingOwner) {
      return null;
    }
    if (sponsoredMember) {
      return null;
    }
    if (edgeCurrent) {
      return <CurrentPlanButton />;
    }
    if (scheduledPlanCode !== null) {
      return null;
    }
    if (maxCurrent) {
      return props.canSwitchToEdge === true ? (
        <HostedPlanChangeButton
          block
          currentPeriodEnd={currentPeriodEndIso}
          mode="schedule"
          targetPlanCode="launch_edge_monthly"
        >
          Choose Edge
        </HostedPlanChangeButton>
      ) : null;
    }
    if (
      props.canUpgradeToEdge === true &&
      (
        currentPlanCode === "launch_group_monthly" ||
        currentPlanCode === "launch_monthly"
      )
    ) {
      return (
        <UpgradeToEdgeButton block expectedCurrentPlanCode={currentPlanCode}>
          Choose Edge
        </UpgradeToEdgeButton>
      );
    }
    if (canStartDirectPlan) {
      return (
        <HostedPlanCheckoutButton block targetPlanCode="launch_edge_monthly">
          Choose Edge
        </HostedPlanCheckoutButton>
      );
    }
    return props.canManageBilling === true ? (
      <BillingPortalButton block label="Choose Edge" variant="secondary" />
    ) : null;
  })();

  const maxAction: ReactNode = (() => {
    if (familyBillingOwner) {
      return null;
    }
    if (maxCurrent) {
      return <CurrentPlanButton />;
    }
    if (scheduledPlanCode !== null) {
      return null;
    }
    if (
      props.canUpgradeToMax === true &&
      (
        currentPlanCode === "launch_group_monthly" ||
        currentPlanCode === "launch_monthly" ||
        currentPlanCode === "launch_edge_monthly"
      )
    ) {
      return (
        <HostedPlanChangeButton
          block
          expectedCurrentPlanCode={currentPlanCode}
          mode="upgrade"
          targetPlanCode="launch_max_monthly"
        >
          Choose Max
        </HostedPlanChangeButton>
      );
    }
    if (canStartDirectPlan) {
      return (
        <HostedPlanCheckoutButton block targetPlanCode="launch_max_monthly">
          Choose Max
        </HostedPlanCheckoutButton>
      );
    }
    return null;
  })();

  const cards: PlanCardModel[] = [
    ...(props.showGroupPlan === true && !familyCurrent
      ? [
          {
            action: familyBillingOwner
              ? null
              : groupCurrent
              ? <CurrentPlanButton />
              : hasPendingGroupSwitch
                ? null
                : props.canSwitchToGroup === true
                  ? (
                      <HostedPlanChangeButton
                        block
                        currentPeriodEnd={currentPeriodEndIso}
                        mode="schedule"
                        targetPlanCode="launch_group_monthly"
                      >
                        Choose {HOSTED_GROUP_MEMBER_PLAN_DISPLAY_NAME}
                      </HostedPlanChangeButton>
                    )
                  : canStartDirectPlan
                    ? (
                        <HostedPlanCheckoutButton
                          block
                          targetPlanCode="launch_group_monthly"
                        >
                          Choose {HOSTED_GROUP_MEMBER_PLAN_DISPLAY_NAME}
                        </HostedPlanCheckoutButton>
                      )
                    : null,
            current: groupCurrent,
            currentLabel: "Current plan",
            features: SETTINGS_CORE_FEATURES,
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
      action: pulseAction,
      current: pulseCurrent,
      currentLabel: "Current plan",
      features: SETTINGS_PULSE_FEATURES,
      key: "launch_monthly",
      name: "Pulse",
      note: activeFamilyOwner
        ? "If you switch away from Family, your family members lose their included access when the Family plan ends."
        : pulseCurrent && hasPendingGroupSwitch && pendingGroupSwitchDate
          ? (
              <PendingPlanChangeNote
                currentPlanName="Pulse"
                effectiveAt={pendingGroupSwitchDate}
                targetPlanName={HOSTED_GROUP_MEMBER_PLAN_DISPLAY_NAME}
              />
            )
          : pulseCurrent && hasPendingMaxSwitch && pendingMaxSwitchDate
            ? (
                <PendingPlanChangeNote
                  currentPlanName="Pulse"
                  effectiveAt={pendingMaxSwitchDate}
                  targetPlanName="Max"
                />
              )
            : !pulseCurrent && hasPendingPulseSwitch && pendingPulseSwitchDate
              ? `Scheduled to start ${pendingPulseSwitchDate}`
              : starterAccessActive
              ? "Starter usage does not expire. Choose Pulse for monthly included usage."
              : null,
      price: formatHostedBillingPrice(
        getHostedBillingPlanDefinition("launch_monthly").recurringAmountUsdCents,
      ),
    },
    {
      action: edgeAction,
      current: edgeCurrent,
      currentLabel: "Current plan",
      features: SETTINGS_EDGE_FEATURES,
      key: "launch_edge_monthly",
      name: "Edge",
      note: activeFamilyOwner
        ? "End or change the Family plan first, then switch to an individual plan."
        : !edgeCurrent && hasPendingEdgeSwitch && pendingEdgeSwitchDate
          ? `Scheduled to start ${pendingEdgeSwitchDate}`
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
            : edgeCurrent && hasPendingMaxSwitch && pendingMaxSwitchDate
              ? (
                  <PendingPlanChangeNote
                    currentPlanName="Edge"
                    effectiveAt={pendingMaxSwitchDate}
                    targetPlanName="Max"
                  />
                )
              : null,
      price: formatHostedBillingPrice(
        getHostedBillingPlanDefinition("launch_edge_monthly")
          .recurringAmountUsdCents,
      ),
    },
    ...(props.showMaxPlan === true && !familyCurrent
      ? [
          {
            action: maxAction,
            current: maxCurrent,
            currentLabel: "Current plan",
            features: SETTINGS_MAX_FEATURES,
            key: "launch_max_monthly",
            name: "Max",
            note: maxCurrent && hasPendingEdgeSwitch && pendingEdgeSwitchDate
              ? (
                  <PendingPlanChangeNote
                    currentPlanName="Max"
                    effectiveAt={pendingEdgeSwitchDate}
                    targetPlanName="Edge"
                  />
                )
              : maxCurrent && hasPendingPulseSwitch && pendingPulseSwitchDate
                ? (
                    <PendingPlanChangeNote
                      currentPlanName="Max"
                      effectiveAt={pendingPulseSwitchDate}
                      targetPlanName="Pulse"
                    />
                  )
                : maxCurrent && hasPendingGroupSwitch && pendingGroupSwitchDate
                  ? (
                      <PendingPlanChangeNote
                        currentPlanName="Max"
                        effectiveAt={pendingGroupSwitchDate}
                        targetPlanName={HOSTED_GROUP_MEMBER_PLAN_DISPLAY_NAME}
                      />
                    )
                  : !maxCurrent && hasPendingMaxSwitch && pendingMaxSwitchDate
                    ? `Scheduled to start ${pendingMaxSwitchDate}`
                    : starterAccessActive
                      ? "Starter usage does not expire. Choose Max for the highest monthly included usage."
                      : null,
            price: formatHostedBillingPrice(
              getHostedBillingPlanDefinition("launch_max_monthly")
                .recurringAmountUsdCents,
            ),
          } satisfies PlanCardModel,
        ]
      : []),
    {
      action: sponsoredMember
        ? null
        : activeFamilyOwner
          ? <CurrentPlanButton />
          : familyBillingOwner
            ? null
          : props.canStartFamily === true
            ? (
                <div className="flex w-full flex-col gap-1">
                  {familyDraftRecoveryState === "recovery_required" ? (
                    <ContactSupportAction
                      className="w-full"
                      subject="Family checkout recovery"
                    >
                      Contact support
                    </ContactSupportAction>
                  ) : (
                    <HostedFamilyStartButton
                      block
                      familyInviteReturnPath={props.familyInviteReturnPath}
                      label={familyDraftRecoveryState
                        ? "Continue your Family setup"
                        : "Start your own Family plan"}
                      ownershipConfirmation
                      returnDirectlyToInvite={
                        familyDraftRecoveryState === null
                        && props.familyInviteReturnPath !== null
                        && props.familyInviteReturnPath !== undefined
                      }
                      resolveCheckoutForInvite={
                        familyDraftRecoveryState === "checkout_starting"
                        && props.familyInviteReturnPath !== null
                        && props.familyInviteReturnPath !== undefined
                      }
                    />
                  )}
                  {familyDraftRecovery?.state === "abandonable" ? (
                    <HostedFamilyAbandonButton
                      checkoutAttemptId={familyDraftRecovery.checkoutAttemptId}
                      groupId={familyDraftRecovery.groupId}
                      returnPath={props.familyInviteReturnPath}
                    />
                  ) : null}
                </div>
              )
            : null,
      current: familyCurrent,
      currentLabel: familyState === "sponsored" ? "Sponsored" : "Current plan",
      features: SETTINGS_FAMILY_FEATURES,
      key: "family",
      name: "Family",
      note: familyState === "sponsored" ? "Paid by your family plan owner." : null,
      price: `From ${formatHostedBillingPrice(
        HOSTED_FAMILY_PLAN_DISPLAY.recurringAmountUsdCentsPerSeat,
      )}/person`,
    },
  ];

  const paidPlanResolved =
    groupCurrent || pulseCurrent || edgeCurrent || maxCurrent || familyCurrent;
  const planGridColumns = cards.length >= 5
    ? "sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-5"
    : cards.length === 4
      ? "sm:grid-cols-2 lg:grid-cols-4"
      : "sm:grid-cols-2 lg:grid-cols-3";
  const retainedPlan = currentPlanCode
    ? getHostedBillingPlanDefinition(currentPlanCode)
    : null;
  const noPlanText = familyDraftRecoveryState === "abandonable"
    ? "Your unfinished Family setup is not paid. Continue checkout to start a plan you own, or abandon it before joining someone else's Family."
    : familyDraftRecoveryState === "checkout_starting"
      ? "Your Family checkout is still starting. Continue it before changing Family plans."
      : familyDraftRecoveryState === "recovery_required"
        ? "Murph could not verify an earlier Family checkout. Contact support before changing Family plans."
        : familyDraftRecoveryState === "not_abandonable"
          ? "Your Family setup has membership or billing state to preserve. Continue setup instead of abandoning it."
    : familyBillingOwner && !activeFamilyOwner
    ? "Your Family plan needs billing attention. Use Manage Family billing to repair or cancel it."
    : starterAccessActive
      ? null
    : retainedPlan
      ? `${retainedPlan.displayName} is not active. Choose a plan below or use Manage billing.`
    : props.billingStatus === "active"
        ? "Your billing status is still syncing. Use Manage billing if it does not resolve."
        : "Choose a plan below when you want recurring included usage.";

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
              Review the plan options below and make a fresh choice when you are ready.
            </p>
          </div>
        </div>
      ) : null}
      {!paidPlanResolved
        && !props.planChangePending
        && !props.groupPaymentMethodSaved
        && noPlanText ? (
        <p className="text-sm text-pretty text-muted-foreground">{noPlanText}</p>
      ) : null}
      {showSponsoredRecovery ? (
        <div className="flex flex-col gap-4 rounded-2xl border border-primary/25 bg-primary/5 p-4 sm:p-5">
          <div>
            <p className="font-serif text-xl font-semibold tracking-tight text-foreground">
              Keep Murph going
            </p>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
              Your Family owner manages your plan. Send them this Family Settings
              link so they can choose your account after signing in.
            </p>
          </div>
          <HostedSponsoredFamilyRecoveryDialog
            initialOpen={props.usageRecoveryInitialOpen}
          />
        </div>
      ) : null}
      {showSponsoredRecovery ? null : (
        <PlanUsageBand
          planChangePending={props.planChangePending === true}
          recommendedRecurringAction={usageRecoveryRecurringAction}
          recommendedRecurringPlanName={usageRecoveryRecurringPlanName}
          status={props.usageStatus}
          usageTopUpActivePurchase={props.usageTopUpActivePurchase}
          usageTopUpCheckoutUrl={props.usageTopUpCheckoutUrl}
          usageTopUpInitialOpen={props.usageTopUpInitialOpen}
          usageTopUpOffers={usageTopUpOffers}
          payerMemberId={props.payerMemberId}
          usageTopUpPurchaseReturn={props.usageTopUpPurchaseReturn}
          usageTopUpScope={props.usageTopUpScope}
          usageTopUpTargetLabel={props.usageTopUpTargetLabel}
        />
      )}
      {props.usageActivityDetail}
      <div
        className={cn(
          "grid items-stretch gap-3",
          planGridColumns,
        )}
      >
        {cards.map((card) => (
          <PlanCard
            key={card.key}
            card={props.planChangePending === true
              ? { ...card, action: null }
              : card}
          />
        ))}
      </div>
      <div className="flex justify-end">
        {familyState === "sponsored" ? (
          <p className="text-sm text-muted-foreground">
            Billing is managed by your Family plan owner.
          </p>
        ) : familyBillingOwner ? (
          <BillingPortalButton
            billingScope="family"
            label="Manage Family billing"
            variant="ghost"
          />
        ) : props.canManageBilling === true ? (
          <BillingPortalButton label="Manage billing" variant="ghost" />
        ) : null}
      </div>
    </div>
  );
}

function resolveDirectUsageRecoveryPlanCode(input: {
  canStartDirectPlan: boolean;
  canUpgradeToEdge: boolean;
  canUpgradeToMax: boolean;
  canUpgradeToPulse: boolean;
  currentPlanCode: HostedBillingPlanCode | null;
  familyCurrent: boolean;
  planChangePending: boolean;
  showGroupPlan: boolean;
  status?: HostedPlanUsageStatus | null;
}): HostedBillingPlanCode | null {
  if (
    input.familyCurrent
    || input.planChangePending
    || !input.status
    || input.status.status !== "exhausted"
  ) {
    return null;
  }

  if (input.status.accessKind === "starter") {
    if (!input.canStartDirectPlan) {
      return null;
    }
    return input.showGroupPlan
      ? "launch_group_monthly"
      : "launch_monthly";
  }
  if (input.status.accessKind !== "paid") {
    return null;
  }
  switch (input.currentPlanCode) {
    case "launch_group_monthly":
      return input.canUpgradeToPulse ? "launch_monthly" : null;
    case "launch_monthly":
      return input.canUpgradeToEdge ? "launch_edge_monthly" : null;
    case "launch_edge_monthly":
      return input.canUpgradeToMax ? "launch_max_monthly" : null;
    case "launch_max_monthly":
    case null:
      return null;
  }
}

function renderDirectUsageRecoveryAction(input: {
  currentPlanCode: HostedBillingPlanCode | null;
  starterAccessActive: boolean;
  targetPlanCode: HostedBillingPlanCode;
  targetPlanName: string;
}): ReactNode {
  const label = `Upgrade to ${input.targetPlanName}`;
  if (input.starterAccessActive) {
    return (
      <HostedPlanCheckoutButton block targetPlanCode={input.targetPlanCode}>
        {label}
      </HostedPlanCheckoutButton>
    );
  }
  if (
    input.targetPlanCode === "launch_edge_monthly"
    && (
      input.currentPlanCode === "launch_group_monthly"
      || input.currentPlanCode === "launch_monthly"
    )
  ) {
    return (
      <UpgradeToEdgeButton
        block
        expectedCurrentPlanCode={input.currentPlanCode}
        primary
      >
        {label}
      </UpgradeToEdgeButton>
    );
  }
  if (!input.currentPlanCode) {
    return null;
  }
  return (
    <HostedPlanChangeButton
      block
      expectedCurrentPlanCode={input.currentPlanCode}
      mode="upgrade"
      primary
      targetPlanCode={input.targetPlanCode}
    >
      {label}
    </HostedPlanChangeButton>
  );
}

function PlanUsageBand(props: {
  planChangePending: boolean;
  recommendedRecurringAction?: ReactNode;
  recommendedRecurringPlanName?: string | null;
  status?: HostedPlanUsageStatus | null;
  usageTopUpActivePurchase?: HostedUsageTopUpActivePurchase | null;
  usageTopUpCheckoutUrl?: string;
  usageTopUpInitialOpen?: boolean;
  usageTopUpOffers: readonly HostedUsageTopUpOffer[];
  payerMemberId?: string | null;
  usageTopUpPurchaseReturn?: HostedUsageTopUpReturn | null;
  usageTopUpScope?: "family" | "personal";
  usageTopUpTargetLabel?: string;
}) {
  const payerMemberId = props.payerMemberId?.trim() || null;
  const inactiveTopUpDialog =
    payerMemberId
    && (
      props.usageTopUpActivePurchase
      || props.usageTopUpInitialOpen
      || props.usageTopUpPurchaseReturn
    ) ? (
      <HostedUsageTopUpDialog
        activePurchase={props.usageTopUpActivePurchase}
        checkoutUrl={props.usageTopUpCheckoutUrl}
        deferTerminalRefreshUntilClose
        initialOpen={props.usageTopUpInitialOpen}
        offers={[]}
        payerMemberId={payerMemberId}
        purchaseReturn={props.usageTopUpPurchaseReturn}
        scope={props.usageTopUpScope}
        targetLabel={props.usageTopUpTargetLabel}
      />
    ) : null;

  if (!props.status || props.status.status === "unavailable") {
    return inactiveTopUpDialog;
  }

  const { status } = props;
  const displayPlanName = status.planCode === "launch_group_monthly"
    ? HOSTED_GROUP_MEMBER_PLAN_DISPLAY_NAME
    : status.planName;
  const periodLabel = status.periodKind === "lifetime"
    ? null
    : `Resets ${formatHostedBillingDate(new Date(status.periodEnd))}`;
  const action = status.recommendedAction;
  const eligibleUsageTopUpOffers =
    status.accessKind === "paid" || status.accessKind === "family_sponsored"
      ? props.usageTopUpOffers
      : [];
  const hasAuthorizedTopUp = Boolean(payerMemberId)
    && (
      eligibleUsageTopUpOffers.length > 0
      || Boolean(props.usageTopUpActivePurchase)
    );
  const hasRecurringRecovery = Boolean(
    !props.planChangePending && props.recommendedRecurringAction,
  );

  if (status.status === "exhausted") {
    const topUpIsPrimary = hasAuthorizedTopUp && !hasRecurringRecovery;
    const exhaustedTopUpDialog = payerMemberId && hasAuthorizedTopUp ? (
      <HostedUsageTopUpDialog
        activePurchase={props.usageTopUpActivePurchase}
        checkoutUrl={props.usageTopUpCheckoutUrl}
        initialOpen={props.usageTopUpInitialOpen}
        offers={eligibleUsageTopUpOffers}
        payerMemberId={payerMemberId}
        purchaseReturn={props.usageTopUpPurchaseReturn}
        scope={props.usageTopUpScope}
        targetLabel={props.usageTopUpTargetLabel}
        triggerClassName="min-h-11 w-full sm:w-auto"
        triggerLabel="Add usage"
        triggerSize={topUpIsPrimary ? "xl" : "lg"}
        triggerVariant={topUpIsPrimary ? "default" : "outline"}
      />
    ) : null;
    const recoveryExplanation = hasRecurringRecovery
      ? props.recommendedRecurringPlanName === "a higher Family tier"
        ? "Your Family plan can be upgraded for more included usage each month."
        : `${props.recommendedRecurringPlanName ?? "A higher plan"} includes more usage each month.`
      : props.planChangePending
        ? hasAuthorizedTopUp
          ? "A plan change is already in progress. Add usage to continue while it finishes."
          : status.periodKind === "monthly"
            ? "A plan change is already in progress. Murph will resume when new usage is available or this allowance resets."
            : "A plan change is already in progress. Murph will resume when new usage is available."
        : hasAuthorizedTopUp
          ? "No higher plan is available. Add usage to continue."
          : status.periodKind === "monthly"
            ? "Murph will resume when this allowance resets."
            : "No additional usage is available right now.";

    return (
      <div
        aria-label={`${displayPlanName} AI usage`}
        className="rounded-2xl border border-border bg-card p-4 sm:p-5"
      >
        <div className="flex flex-col gap-1">
          <p className="font-serif text-xl font-semibold tracking-tight text-foreground">
            Keep Murph going
          </p>
          <p className="text-sm text-muted-foreground">
            {displayPlanName}{periodLabel ? ` · ${periodLabel}` : null}
          </p>
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
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
          {recoveryExplanation}
        </p>
        {hasRecurringRecovery || exhaustedTopUpDialog ? (
          <div className="mt-4 flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
            {hasRecurringRecovery ? (
              <div className="w-full sm:w-auto [&_button]:min-h-11">
                {props.recommendedRecurringAction}
              </div>
            ) : null}
            {exhaustedTopUpDialog}
          </div>
        ) : null}
        {!hasAuthorizedTopUp
        && (props.usageTopUpInitialOpen || props.usageTopUpPurchaseReturn)
          ? inactiveTopUpDialog
          : null}
      </div>
    );
  }

  const usageTopUpDialog = payerMemberId ? (
    <HostedUsageTopUpDialog
      activePurchase={props.usageTopUpActivePurchase}
      checkoutUrl={props.usageTopUpCheckoutUrl}
      initialOpen={props.usageTopUpInitialOpen}
      offers={eligibleUsageTopUpOffers}
      payerMemberId={payerMemberId}
      purchaseReturn={props.usageTopUpPurchaseReturn}
      quietSuccessfulReturn
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
            {displayPlanName}
            {periodLabel ? ` · ${periodLabel}` : null}
          </p>
        </div>
        {eligibleUsageTopUpOffers.length > 0 || props.usageTopUpActivePurchase
          ? usageTopUpDialog
          : !props.planChangePending && action?.kind === "start_pulse"
            ? (
                <HostedPlanCheckoutButton targetPlanCode="launch_monthly">
                  {action.label}
                </HostedPlanCheckoutButton>
              )
            : !props.planChangePending && action?.kind === "upgrade_edge"
              ? (
                  <UpgradeToEdgeButton
                    expectedCurrentPlanCode={
                      status.planCode === "launch_group_monthly"
                        ? "launch_group_monthly"
                        : "launch_monthly"
                    }
                  >
                    {action.label}
                  </UpgradeToEdgeButton>
                )
              : null}
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
      {eligibleUsageTopUpOffers.length === 0
      && !props.usageTopUpActivePurchase
      && (props.usageTopUpInitialOpen || props.usageTopUpPurchaseReturn)
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
      label="Manage Family billing"
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
    <Button
      className="w-full"
      disabled
      size="default"
      type="button"
      variant="outline"
    >
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
