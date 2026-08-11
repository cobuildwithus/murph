import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  HOSTED_ASSISTANT_DEFAULT_PROVIDER,
  HOSTED_ASSISTANT_TERRA_MODEL,
} from "@murphai/hosted-execution/assistant-model";

import { HostedPrivyProvider } from "@/src/components/hosted-onboarding/privy-provider";
import { CustomizeMurphSettings } from "@/src/components/settings/customize-murph-settings";
import { HostedAccountSettingsCards } from "@/src/components/settings/hosted-account-settings-cards";
import { HostedAiUsageActivity } from "@/src/components/settings/hosted-ai-usage-activity";
import { HostedAssistantModelSettings } from "@/src/components/settings/hosted-assistant-model-settings";
import { HostedBillingSettings } from "@/src/components/settings/hosted-billing-settings";
import type {
  HostedUsageTopUpOffer,
  HostedUsageTopUpReturn,
} from "@/src/components/settings/hosted-usage-top-up-dialog";
import { HostedDataPrivacySettings } from "@/src/components/settings/hosted-data-privacy-settings";
import { HostedHealthDataConsentSettings } from "@/src/components/settings/hosted-health-data-consent-settings";
import { SettingsAuthRequired } from "./settings-auth-required";
import { HostedFamilySettings } from "@/src/components/settings/hosted-family-settings";
import { HostedPasskeySettings } from "@/src/components/settings/hosted-passkey-settings";
import { HostedPlanUpdateReturn } from "@/src/components/settings/hosted-plan-update-return";
import { Watch } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/src/components/ui/page-header";
import {
  readHostedAccountSettingsPageSnapshot,
  withServerApprovedPrivyAccountHints,
} from "@/src/lib/hosted-onboarding/account-settings-snapshot";
import {
  canScheduleHostedBillingPlanChange,
  canSwitchHostedBillingPlanToPulse,
  canUpgradeHostedBillingPlan,
  isHostedBillingPlanChangePortalConfigured,
  parseHostedBillingPhase,
  parseHostedBillingPlanCode,
} from "@/src/lib/hosted-onboarding/billing-plans";
import {
  hasConfirmedHostedGroupMembership,
  resolveVisibleHostedBillingPlanCodes,
} from "@/src/lib/hosted-onboarding/billing-plan-eligibility";
import { isHostedVeniceAssistantEnabled } from "@/src/lib/hosted-onboarding/assistant-model-preference";
import {
  isHostedCustomChatCompletionsEnabled,
  isHostedCustomInferenceEnabled,
} from "@/src/lib/hosted-inference/feature";
import {
  readHostedInferenceConnectionView,
} from "@/src/lib/hosted-inference/connection-store";
import {
  HOSTED_START_PAID_GROUP_RETURN_PARAM,
  HOSTED_START_PAID_GROUP_RETURN_VALUE,
} from "@/src/lib/hosted-onboarding/billing-group-payment-method-contract";
import {
  HOSTED_BILLING_PLAN_CHANGE_CANCELED_RETURN_VALUE,
  parseHostedBillingPlanChangeReturnValue,
} from "@/src/lib/hosted-onboarding/billing-plan-change-contract";
import {
  hasHostedMemberOwnActiveAccess,
  hasHostedMemberOwnPaidBilling,
} from "@/src/lib/hosted-onboarding/entitlement";
import { hasHostedRecoverableBilling } from "@/src/lib/hosted-onboarding/lifecycle";
import {
  isHostedFamilyBillingPortalManageable,
  readHostedFamilyAccessForMember,
  readHostedFamilyDraftRecoveryStateForOwner,
  readHostedFamilyOwnerSnapshotForMember,
  type HostedFamilyDraftRecoveryState,
  type HostedFamilyOwnerMemberRow,
  type HostedFamilyOwnerSnapshot,
} from "@/src/lib/hosted-onboarding/family-plan";
import {
  HOSTED_FAMILY_INVITE_RETURN_PARAM,
  parseHostedFamilyInviteReturnPath,
} from "@/src/lib/hosted-onboarding/app-routes";
import { getHostedPrivySession } from "@/src/lib/hosted-onboarding/hosted-session";
import { getHostedDashboardPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import {
  readHostedConfiguredUsageCreditOfferCodes,
  readHostedPersonalUsageCreditOfferCodes,
} from "@/src/lib/hosted-onboarding/personal-usage-credit-eligibility";
import {
  isHostedBillingPlanSelectionAvailable,
} from "@/src/lib/hosted-onboarding/runtime";
import {
  readHostedConsentStatus,
} from "@/src/lib/legal/consent";
import { getPrisma } from "@/src/lib/prisma";
import { readHostedSecureApprovalStatus } from "@/src/lib/sensitive-actions/secure-approval-status";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";
import { readHostedAiUsageActivity } from "@/src/lib/hosted-execution/usage-activity";
import { readHostedPersonalAiUsageStatus } from "@/src/lib/hosted-execution/usage-status";
import {
  filterHostedNonGroupUsageCreditOfferCodes,
  getHostedUsageCreditOfferDefinition,
  type HostedUsageCreditOfferCode,
} from "@/src/lib/hosted-onboarding/usage-credit-offers";
import {
  readHostedActiveUsageCreditPurchaseForPayer,
  readHostedUsageCreditPurchaseTargetForPayer,
  type HostedUsageCreditPurchaseTargetProjection,
} from "@/src/lib/hosted-onboarding/usage-credit-purchase-service";
import { resolveMurphContactOptions } from "@/src/lib/murph-contact-routing";

export const metadata: Metadata = createMurphPageMetadata({
  title: "Settings — Murph",
  description: "Manage your Murph account settings.",
});

type SettingsSearchParams = {
  addEmail?: string | string[] | undefined;
  addUsage?: string | string[] | undefined;
  familyInviteReturn?: string | string[] | undefined;
  startGroup?: string | string[] | undefined;
  planUpdate?: string | string[] | undefined;
  usageCheckout?: string | string[] | undefined;
  usageFamily?: string | string[] | undefined;
  usageMember?: string | string[] | undefined;
  usagePurchase?: string | string[] | undefined;
  voice?: string | string[] | undefined;
};

const HOSTED_USAGE_CREDIT_PURCHASE_ID_PATTERN = /^hucp_[A-Za-z0-9_-]{16}$/u;

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<SettingsSearchParams>;
}) {
  const resolvedSearchParams = await searchParams;
  const familyInviteReturnPath = parseHostedFamilyInviteReturnPath(
    readOnlySearchParamValue(
      resolvedSearchParams[HOSTED_FAMILY_INVITE_RETURN_PARAM],
    ),
  );
  const openEmailLink =
    readFirstSearchParamValue(resolvedSearchParams.addEmail) === "true";
  const addUsageTarget = readOnlySearchParamValue(resolvedSearchParams.addUsage);
  const openPersonalUsageTopUp = addUsageTarget === "true";
  const requestedFamilyOwnerUsageTopUp = addUsageTarget === "family";
  const openVoiceLink =
    readFirstSearchParamValue(resolvedSearchParams.voice) === "true";
  const usageTopUpPurchaseReturn = readUsageTopUpPurchaseReturn(
    resolvedSearchParams,
  );
  const groupPaymentMethodSaved =
    readFirstSearchParamValue(
      resolvedSearchParams[HOSTED_START_PAID_GROUP_RETURN_PARAM],
    ) === HOSTED_START_PAID_GROUP_RETURN_VALUE;
  const planChangeReturn = parseHostedBillingPlanChangeReturnValue(
    readOnlySearchParamValue(resolvedSearchParams.planUpdate),
  );
  const { authenticated, authenticatedMember, session } =
    await getHostedDashboardPageAuthSnapshot();
  if (!authenticated) {
    if (
      familyInviteReturnPath === null
      && !groupPaymentMethodSaved
      && planChangeReturn === null
      && usageTopUpPurchaseReturn === null
    ) {
      redirect("/");
    }
    return <SettingsAuthRequired />;
  }

  if (planChangeReturn === HOSTED_BILLING_PLAN_CHANGE_CANCELED_RETURN_VALUE) {
    redirect("/settings#subscription");
  }

  const prisma = getPrisma();
  const settingsData = authenticatedMember
    ? await readSettingsPageData({
        memberId: authenticatedMember.id,
        prisma,
        privyUserId: session?.privyUserId,
        usageReturnPurchaseId: usageTopUpPurchaseReturn?.purchaseId ?? null,
      })
    : null;
  const settingsSnapshot = settingsData?.settingsSnapshot ?? null;
  const consentStatus = settingsData?.consentStatus ?? null;
  const freshPrivySession = settingsData?.freshPrivySession ?? null;
  const familyOwner = settingsData?.familyOwner ?? null;
  const familyDraftRecoveryState =
    settingsData?.familyDraftRecoveryState ?? null;
  const familyAccess = settingsData?.familyAccess ?? null;
  const secureApprovalStatus =
    settingsData?.secureApprovalStatus ?? ({ status: "unavailable" } as const);
  const usageStatus = settingsData?.usageStatus ?? null;
  const hasConfirmedGroupMembership =
    settingsData?.hasConfirmedGroupMembership === true;
  const usageActivity = settingsData?.usageActivity ?? null;
  const usageTopUpOfferCodes = settingsData?.usageTopUpOfferCodes ?? [];
  const usageTopUpActivePurchase = settingsData?.usageTopUpActivePurchase ?? null;
  const usageTopUpReturnTarget = settingsData?.usageTopUpReturnTarget ?? null;
  const inferenceConnection = settingsData?.inferenceConnection ?? null;
  const account = settingsSnapshot?.account ?? null;
  const billingRef = settingsSnapshot?.billingRef ?? null;
  const routing = settingsSnapshot?.routing ?? null;
  const activeFamilyOwner = familyOwner?.billingActive === true;
  const familyBillingOwner = familyOwner !== null
    && isHostedFamilyBillingPortalManageable(familyOwner.billingStatus);
  const familyOwnerUsageTopUpMember =
    resolveActiveFamilyOwnerUsageTopUpMember(familyOwner);
  const sponsoredMember = familyAccess !== null && familyOwner === null;
  const usageTopUpOffers = usageTopUpActivePurchase
    ? []
    : projectHostedUsageTopUpOffers(usageTopUpOfferCodes);
  const familyUsageTopUpOffers = activeFamilyOwner && !usageTopUpActivePurchase
    ? projectHostedUsageTopUpOffers(readHostedConfiguredUsageCreditOfferCodesSafely())
    : [];
  const familyUsageTopUpActivePurchase =
    usageTopUpActivePurchase?.target.kind === "family"
    && usageTopUpActivePurchase.target.familyGroupId === familyOwner?.groupId
      ? usageTopUpActivePurchase
      : null;
  const personalUsageTopUpActivePurchase =
    usageTopUpActivePurchase?.target.kind === "personal"
      ? usageTopUpActivePurchase
      : usageTopUpActivePurchase && !familyUsageTopUpActivePurchase
        ? {
            ...usageTopUpActivePurchase,
            retryAllowed: false,
            targetConflict: true as const,
            url: undefined,
          }
        : null;
  const familyUsageTopUpActiveMemberId =
    familyUsageTopUpActivePurchase?.target.beneficiaryMemberId ?? null;
  const familyOwnerUsageTopUpActivePurchase = familyOwnerUsageTopUpMember
    ? familyUsageTopUpActivePurchase?.target.beneficiaryMemberId ===
        familyOwnerUsageTopUpMember.memberId
      ? familyUsageTopUpActivePurchase
      : usageTopUpActivePurchase
        ? {
            ...usageTopUpActivePurchase,
            retryAllowed: false,
            targetConflict: true as const,
            url: undefined,
          }
        : null
    : null;
  const personalUsageTopUpPurchaseReturn =
    usageTopUpPurchaseReturn
    && usageTopUpReturnTarget?.kind === "personal"
    && resolvedSearchParams.usageFamily === undefined
    && resolvedSearchParams.usageMember === undefined
      ? usageTopUpPurchaseReturn
      : null;
  const familyUsageTopUpPurchaseReturn =
    usageTopUpPurchaseReturn
    && usageTopUpReturnTarget?.kind === "family"
    && usageTopUpReturnTarget.familyGroupId === familyOwner?.groupId
    && readOnlySearchParamValue(resolvedSearchParams.usageFamily)
      === usageTopUpReturnTarget.familyGroupId
    && readOnlySearchParamValue(resolvedSearchParams.usageMember)
      === usageTopUpReturnTarget.beneficiaryMemberId
      ? usageTopUpPurchaseReturn
      : null;
  const familyUsageTopUpReturnMemberId =
    familyUsageTopUpPurchaseReturn
      ? usageTopUpReturnTarget?.beneficiaryMemberId ?? null
      : null;
  const familyOwnerUsageTopUpAvailable =
    familyOwnerUsageTopUpMember !== null;
  const familyOwnerUsageTopUpPurchaseReturn =
    familyOwnerUsageTopUpMember
    && familyUsageTopUpPurchaseReturn
    && usageTopUpReturnTarget?.beneficiaryMemberId ===
      familyOwnerUsageTopUpMember.memberId
      ? familyUsageTopUpPurchaseReturn
      : null;
  const familySettingsUsageTopUpPurchaseReturn =
    familyOwnerUsageTopUpPurchaseReturn ? null : familyUsageTopUpPurchaseReturn;
  const familySettingsUsageTopUpReturnMemberId =
    familyOwnerUsageTopUpPurchaseReturn ? null : familyUsageTopUpReturnMemberId;
  const billingUsageTopUpUsesFamilyOwner =
    familyOwnerUsageTopUpAvailable
    && usageTopUpActivePurchase?.target.kind !== "personal"
    && personalUsageTopUpPurchaseReturn === null;
  const billingUsageTopUpPurchaseReturn = billingUsageTopUpUsesFamilyOwner
    ? familyOwnerUsageTopUpPurchaseReturn
    : personalUsageTopUpPurchaseReturn;
  const billingUsageTopUpActivePurchase = billingUsageTopUpPurchaseReturn
    ? null
    : billingUsageTopUpUsesFamilyOwner
      ? familyOwnerUsageTopUpActivePurchase
      : personalUsageTopUpActivePurchase;
  const billingUsageTopUpOffers = billingUsageTopUpUsesFamilyOwner
    ? familyUsageTopUpOffers
    : usageTopUpOffers;
  const canStartFamily =
    authenticatedMember != null &&
    !familyBillingOwner &&
    !sponsoredMember &&
    !authenticatedMember.suspendedAt;
  const currentPlanCode = parseHostedBillingPlanCode(
    billingRef?.currentBillingPlanCode,
  );
  const directPlanUpdateTarget =
    !activeFamilyOwner &&
    !sponsoredMember &&
    (
      planChangeReturn === "launch_edge_monthly" ||
      planChangeReturn === "launch_max_monthly" ||
      planChangeReturn === "launch_monthly"
    )
      ? planChangeReturn
      : null;
  const directPlanUpdateActive =
    directPlanUpdateTarget !== null &&
    authenticatedMember !== null &&
    hasHostedMemberOwnActiveAccess(authenticatedMember) &&
    parseHostedBillingPhase(billingRef?.currentBillingPhase) === "paid" &&
    currentPlanCode === directPlanUpdateTarget;
  const planChangePending =
    directPlanUpdateTarget !== null && !directPlanUpdateActive;
  const scheduledPlanCode = parseHostedBillingPlanCode(
    billingRef?.scheduledBillingPlanCode,
  );
  const hasScheduledPlanChange = scheduledPlanCode !== null;
  const groupPlanConfigured = settingsData?.groupPlanAvailable === true;
  const maxPlanConfigured = settingsData?.maxPlanAvailable === true;
  const visiblePlanCodes = resolveVisibleHostedBillingPlanCodes({
    currentPlanCode,
    groupPlanConfigured,
    hasConfirmedGroupMembership,
    maxPlanConfigured,
    scheduledPlanCode,
  });
  const showGroupPlan = visiblePlanCodes.includes("launch_group_monthly");
  const showMaxPlan = visiblePlanCodes.includes("launch_max_monthly");
  const ownPaidBillingActive =
    authenticatedMember !== null &&
    hasHostedMemberOwnPaidBilling({
      billingStatus: authenticatedMember.billingStatus,
      billingRef: {
        currentBillingPhase: billingRef?.currentBillingPhase ?? null,
        currentCheckoutOffer: billingRef?.currentCheckoutOffer ?? null,
        stripeSubscriptionLookupKey: billingRef?.stripeSubscriptionId
          ? "configured"
          : null,
      },
      suspendedAt: authenticatedMember.suspendedAt,
    });
  const hasRecoverableBilling =
    authenticatedMember !== null &&
    hasHostedRecoverableBilling({
      billingStatus: authenticatedMember.billingStatus,
      hasExistingSubscription: Boolean(billingRef?.stripeSubscriptionId),
    });
  const canStartDirectPlan =
    !hasScheduledPlanChange &&
    authenticatedMember !== null &&
    !activeFamilyOwner &&
    !sponsoredMember &&
    !authenticatedMember.suspendedAt &&
    !ownPaidBillingActive &&
    !hasRecoverableBilling;
  const canManageBilling =
    activeFamilyOwner ||
    (
      authenticatedMember !== null &&
      !authenticatedMember.suspendedAt &&
      Boolean(billingRef?.stripeCustomerId) &&
      (ownPaidBillingActive || hasRecoverableBilling)
    );
  const canUpgradeToPulse =
    !hasScheduledPlanChange &&
    authenticatedMember !== null &&
    hasHostedMemberOwnActiveAccess(authenticatedMember) &&
    canUpgradeHostedBillingPlan({
      currentBillingPhase: billingRef?.currentBillingPhase,
      currentBillingPlanCode: billingRef?.currentBillingPlanCode,
      currentCheckoutOffer: billingRef?.currentCheckoutOffer,
      targetPlanCode: "launch_monthly",
    });
  const canUpgradeToEdge =
    !hasScheduledPlanChange &&
    authenticatedMember !== null &&
    hasHostedMemberOwnActiveAccess(authenticatedMember) &&
    canUpgradeHostedBillingPlan({
      currentBillingPhase: billingRef?.currentBillingPhase,
      currentBillingPlanCode: billingRef?.currentBillingPlanCode,
      currentCheckoutOffer: billingRef?.currentCheckoutOffer,
      targetPlanCode: "launch_edge_monthly",
    });
  const canUpgradeToMax =
    !hasScheduledPlanChange &&
    maxPlanConfigured &&
    authenticatedMember !== null &&
    hasHostedMemberOwnActiveAccess(authenticatedMember) &&
    canUpgradeHostedBillingPlan({
      currentBillingPhase: billingRef?.currentBillingPhase,
      currentBillingPlanCode: billingRef?.currentBillingPlanCode,
      currentCheckoutOffer: billingRef?.currentCheckoutOffer,
      targetPlanCode: "launch_max_monthly",
    });
  const canSwitchToEdge =
    !hasScheduledPlanChange &&
    authenticatedMember !== null &&
    canScheduleHostedBillingPlanChange({
      billingStatus: authenticatedMember.billingStatus,
      currentBillingPhase: billingRef?.currentBillingPhase,
      currentBillingPlanCode: billingRef?.currentBillingPlanCode,
      currentCheckoutOffer: billingRef?.currentCheckoutOffer,
      stripeCustomerId: billingRef?.stripeCustomerId,
      stripeSubscriptionId: billingRef?.stripeSubscriptionId,
      suspendedAt: authenticatedMember.suspendedAt,
      targetPlanCode: "launch_edge_monthly",
    });
  const canSwitchToGroup =
    !hasScheduledPlanChange &&
    authenticatedMember !== null &&
    groupPlanConfigured &&
    hasConfirmedGroupMembership &&
    canScheduleHostedBillingPlanChange({
      billingStatus: authenticatedMember.billingStatus,
      currentBillingPhase: billingRef?.currentBillingPhase,
      currentBillingPlanCode: billingRef?.currentBillingPlanCode,
      currentCheckoutOffer: billingRef?.currentCheckoutOffer,
      stripeCustomerId: billingRef?.stripeCustomerId,
      stripeSubscriptionId: billingRef?.stripeSubscriptionId,
      suspendedAt: authenticatedMember.suspendedAt,
      targetPlanCode: "launch_group_monthly",
    });
  const privySessionMatchesAppSession =
    freshPrivySession !== null && freshPrivySession.identity.userId === session?.privyUserId;
  const serverApprovedPrivyLinkedAccounts = privySessionMatchesAppSession
    ? freshPrivySession.linkedAccounts
    : null;
  const accountWithPrivyDisplay = account
    ? withServerApprovedPrivyAccountHints({
        snapshot: account,
        serverApprovedPrivyLinkedAccounts,
      })
    : account;
  const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim() || null;
  const privyClientId = process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID?.trim() || null;
  const murphPhoneNumber =
    routing?.linqRecipientPhone ?? routing?.pendingLinqRecipientPhone ?? null;
  // The member sends this to Murph right after picking a voice, so the reply
  // comes back as a voice memo in the new voice. Voice memos only deliver over
  // text and Telegram, so an email-only member gets no redirect.
  const resolvedVoiceTestOption = account
    ? resolveMurphContactOptions({
        contactChannels: {
          email: Boolean(account.email.murphEmailAddress),
          telegram: Boolean(account.telegram.telegramUserId),
          text: Boolean(account.phone.number),
        },
        message: {
          body: "just picked a new voice for you! send me a voice memo so I can hear it",
        },
        murphEmailAddress: account.email.murphEmailAddress ?? null,
        murphPhoneNumber: routing?.linqRecipientPhone ?? null,
        preferredKind: "text",
        userEmailAddress: account.email.address,
      })[0] ?? null
    : null;
  const voiceTestContactOption =
    resolvedVoiceTestOption && resolvedVoiceTestOption.kind !== "email"
      ? resolvedVoiceTestOption
      : null;
  // Shown after a fulfilled usage top-up so the payer can hop back into the
  // conversation without leaving the confirmation.
  const usageTopUpContactOptions = account
    ? resolveMurphContactOptions({
        contactChannels: {
          email: Boolean(account.email.murphEmailAddress),
          telegram: Boolean(account.telegram.telegramUserId),
          text: Boolean(account.phone.number),
        },
        message: {
          body: "Hey Murph, I just added more usage.",
        },
        murphEmailAddress: account.email.murphEmailAddress ?? null,
        murphPhoneNumber: routing?.linqRecipientPhone ?? null,
        userEmailAddress: account.email.address,
      })
    : [];
  const usageMissionContactOption =
    usageActivity?.missionsEnabled === true && account
      ? resolveMurphContactOptions({
          contactChannels: {
            email: false,
            telegram: Boolean(account.telegram.telegramUserId),
            text: Boolean(account.phone.number),
          },
          message: {
            body: "Hey Murph, what referral options can I choose from?",
          },
          murphEmailAddress: account.email.murphEmailAddress ?? null,
          murphPhoneNumber: routing?.linqRecipientPhone ?? null,
          preferredKind: "text",
          userEmailAddress: account.email.address,
        })[0] ?? null
      : null;
  const canStartUsageMissions =
    usageActivity?.missionsEnabled === true
    && usageMissionContactOption !== null;
  const visibleUsageActivity =
    usageActivity
    && (
      canStartUsageMissions
      || usageActivity.credits.length > 0
      || usageActivity.missions.length > 0
    )
      ? usageActivity
      : null;

  const settingsContent = (
    <div className="flex flex-col gap-12">
      <PageHeader
        eyebrow="Settings"
        title="Your account"
        description="Plan, AI usage, model, connected accounts, and data privacy."
      />

      <section id="subscription" className="flex scroll-mt-24 flex-col gap-4">
        <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Subscription
        </div>
        {directPlanUpdateTarget ? (
          <HostedPlanUpdateReturn
            active={directPlanUpdateActive}
            targetPlanCode={directPlanUpdateTarget}
          />
        ) : null}
        <HostedBillingSettings
          authenticated={authenticated}
          billingStatus={authenticatedMember?.billingStatus}
          canStartFamily={canStartFamily}
          canSwitchToEdge={canSwitchToEdge}
          canSwitchToGroup={canSwitchToGroup}
          familyBillingOwner={familyBillingOwner}
          familyDraftRecoveryState={familyDraftRecoveryState}
          familyInviteReturnPath={familyInviteReturnPath}
          familyState={activeFamilyOwner ? "owner" : sponsoredMember ? "sponsored" : "none"}
          groupPaymentMethodSaved={groupPaymentMethodSaved}
          planChangePending={planChangePending}
          canManageBilling={canManageBilling}
          canStartDirectPlan={canStartDirectPlan}
          canUpgradeToPulse={canUpgradeToPulse}
          canUpgradeToEdge={canUpgradeToEdge}
          canUpgradeToMax={canUpgradeToMax}
          showGroupPlan={showGroupPlan}
          showMaxPlan={showMaxPlan}
          canSwitchToPulse={
            !hasScheduledPlanChange &&
            canSwitchHostedBillingPlanToPulse({
              billingStatus: authenticatedMember?.billingStatus,
              currentBillingPhase: billingRef?.currentBillingPhase,
              currentBillingPlanCode: billingRef?.currentBillingPlanCode,
              stripeCustomerId: billingRef?.stripeCustomerId,
              stripeSubscriptionId: billingRef?.stripeSubscriptionId,
              suspendedAt: authenticatedMember?.suspendedAt,
            })
          }
          currentBillingPhase={billingRef?.currentBillingPhase}
          currentBillingPlanCode={billingRef?.currentBillingPlanCode}
          currentPeriodEnd={billingRef?.currentPeriodEnd}
          payerMemberId={authenticatedMember?.id}
          scheduledBillingEffectiveAt={billingRef?.scheduledBillingEffectiveAt}
          scheduledBillingPlanCode={billingRef?.scheduledBillingPlanCode}
          usageStatus={usageStatus}
          usageTopUpActivePurchase={billingUsageTopUpActivePurchase}
          usageTopUpCheckoutUrl={
            billingUsageTopUpUsesFamilyOwner && familyOwnerUsageTopUpMember
              ? `/api/settings/billing/family/members/${encodeURIComponent(familyOwnerUsageTopUpMember.memberId)}/usage-credit/checkout`
              : undefined
          }
          usageTopUpContactOptions={usageTopUpContactOptions}
          usageTopUpInitialOpen={
            billingUsageTopUpUsesFamilyOwner
              ? requestedFamilyOwnerUsageTopUp || openPersonalUsageTopUp
              : openPersonalUsageTopUp
          }
          usageTopUpOffers={billingUsageTopUpOffers}
          usageTopUpPurchaseReturn={billingUsageTopUpPurchaseReturn}
          usageTopUpScope={
            billingUsageTopUpUsesFamilyOwner ? "family" : "personal"
          }
          usageTopUpTargetLabel={
            billingUsageTopUpUsesFamilyOwner
              ? "you"
              : undefined
          }
          usageActivityDetail={visibleUsageActivity ? (
            <section id="ai-usage" className="flex scroll-mt-24 flex-col gap-4">
              <h2 className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                AI usage
              </h2>
              <HostedAiUsageActivity
                activity={visibleUsageActivity}
                missionContactOption={usageMissionContactOption}
              />
            </section>
          ) : null}
        />
      </section>

      <section className="flex flex-col gap-4">
        <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          AI model
        </div>
        <HostedAssistantModelSettings
          canUpgradeToEdge={canUpgradeToEdge && !planChangePending}
          chatCompletionsAvailable={isHostedCustomChatCompletionsEnabled()}
          configurationAvailable={account?.assistant?.configurationAvailable === true}
          customInferenceAvailable={isHostedCustomInferenceEnabled()}
          expectedCurrentPlanCode={
            currentPlanCode === "launch_group_monthly"
            || currentPlanCode === "launch_monthly"
              ? currentPlanCode
              : undefined
          }
          initialConnection={
            isHostedCustomInferenceEnabled() ? inferenceConnection : null
          }
          initialDormantSolPreference={
            account?.assistant?.dormantSolPreference === true
          }
          initialModel={account?.assistant?.model ?? HOSTED_ASSISTANT_TERRA_MODEL}
          initialProvider={
            account?.assistant?.provider ?? HOSTED_ASSISTANT_DEFAULT_PROVIDER
          }
          solAvailable={account?.assistant?.solAvailable === true}
          veniceAvailable={isHostedVeniceAssistantEnabled()}
        />
      </section>

      {familyOwner && authenticatedMember ? (
        <section id="family" className="flex scroll-mt-24 flex-col gap-4">
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Family
          </div>
          <HostedFamilySettings
            ownerSnapshot={familyOwner}
            payerMemberId={authenticatedMember.id}
            usageTopUpActiveMemberId={familyUsageTopUpActiveMemberId}
            usageTopUpActivePurchase={familyUsageTopUpActivePurchase}
            usageTopUpContactOptions={usageTopUpContactOptions}
            usageTopUpOffers={familyUsageTopUpOffers}
            usageTopUpPurchaseReturn={familySettingsUsageTopUpPurchaseReturn}
            usageTopUpReturnMemberId={familySettingsUsageTopUpReturnMemberId}
          />
        </section>
      ) : null}

      <section className="flex flex-col gap-4">
        <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Messaging
        </div>
        {accountWithPrivyDisplay ? (
          <HostedAccountSettingsCards
            account={accountWithPrivyDisplay}
            expectedPrivyUserId={session?.privyUserId ?? null}
            murphPhoneNumber={murphPhoneNumber}
            openEmailLink={openEmailLink}
            privySessionMatchesAppSession={privySessionMatchesAppSession}
          />
        ) : null}
      </section>

      {accountWithPrivyDisplay ? (
        <section className="flex flex-col gap-4">
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Customize your Murph
          </div>
          <CustomizeMurphSettings
            assistant={accountWithPrivyDisplay.assistant ?? null}
            murphPhoneNumber={murphPhoneNumber}
            openVoiceLink={openVoiceLink}
            voiceTestContactOption={voiceTestContactOption}
          />
        </section>
      ) : null}

      <section className="flex flex-col gap-4">
        <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Wearables
        </div>
        <Link
          href="/connect"
          className="relative inline-flex items-center gap-2.5 self-start text-sm font-medium text-primary underline-offset-4 hover:underline before:absolute before:-inset-x-2 before:-inset-y-2.5 before:content-['']"
        >
          <Watch className="size-[18px] shrink-0 text-muted-foreground" strokeWidth={1.6} aria-hidden="true" />
          Manage wearables
        </Link>
      </section>

      {privyAppId ? (
        <>
          <section className="flex flex-col gap-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              Security
            </div>
            <HostedPasskeySettings
              authenticated={authenticated}
              secureApprovalStatus={secureApprovalStatus}
            />
          </section>

          <section id="data-privacy" className="flex scroll-mt-24 flex-col gap-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              Data & privacy
            </div>
            <HostedHealthDataConsentSettings
              authenticated={authenticated}
              initialStatus={consentStatus}
            />
            <HostedDataPrivacySettings
              authenticated={authenticated}
              authorizationEnabled
            />
          </section>
        </>
      ) : (
        <section id="data-privacy" className="flex scroll-mt-24 flex-col gap-4">
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Data & privacy
          </div>
          <HostedHealthDataConsentSettings
            authenticated={authenticated}
            initialStatus={consentStatus}
          />
          <HostedDataPrivacySettings
            authenticated={authenticated}
            authorizationEnabled={false}
          />
        </section>
      )}
    </div>
  );

  return privyAppId ? (
    <HostedPrivyProvider appId={privyAppId} clientId={privyClientId}>
      {settingsContent}
    </HostedPrivyProvider>
  ) : settingsContent;
}

async function readSettingsPageData(input: {
  memberId: string;
  prisma: ReturnType<typeof getPrisma>;
  privyUserId: string | null | undefined;
  usageReturnPurchaseId: string | null;
}) {
  const { memberId, prisma } = input;
  // The Privy reads are network calls with no database cost, so they overlap
  // the database reads below.
  const freshPrivySessionPromise = getHostedPrivySession().catch(() => null);
  const secureApprovalStatusPromise = readHostedSecureApprovalStatus({
    privyUserId: input.privyUserId,
  });

  // The database-backed reads run sequentially on purpose: several of them
  // fan out parallel queries internally, and running the helpers concurrently
  // let one settings render exhaust the shared connection pool.
  const settingsSnapshot = await readHostedAccountSettingsPageSnapshot({
    memberId,
    prisma,
  });
  const inferenceConnection = isHostedCustomInferenceEnabled()
    ? await readHostedInferenceConnectionView({
        memberId,
        prisma,
      })
    : null;
  const consentStatus = await readHostedConsentStatus({
    memberId,
    prisma,
  }).catch(() => null);
  const familyOwner = await readHostedFamilyOwnerSnapshotForMember({
    memberId,
    prisma,
  });
  const familyDraftRecovery =
    familyOwner?.billingStatus === "not_started"
      ? await readHostedFamilyDraftRecoveryStateForOwner({
          ownerMemberId: memberId,
          prisma,
        })
      : null;
  const familyDraftRecoveryState: HostedFamilyDraftRecoveryState | null =
    familyDraftRecovery?.state ?? null;
  const familyAccess = await readHostedFamilyAccessForMember({
    memberId,
    prisma,
  });
  const hasConfirmedGroupMembership =
    await hasConfirmedHostedGroupMembership({
      memberId,
      prisma,
    });
  const groupPlanAvailable =
    hasConfirmedGroupMembership
    && await isHostedBillingPlanSelectionAvailable({
      billingPlanCode: "launch_group_monthly",
    });
  const maxPlanAvailable =
    isHostedBillingPlanChangePortalConfigured("launch_max_monthly")
    && await isHostedBillingPlanSelectionAvailable({
      billingPlanCode: "launch_max_monthly",
    });
  const usageStatus = await readHostedPersonalAiUsageStatus({
    memberId,
    prisma,
    publicBaseUrl: null,
  });
  const usageActivity = await readHostedAiUsageActivity({
    memberId,
    prisma,
  }).catch(() => null);
  const usageTopUpOfferCodes = await readHostedPersonalUsageCreditOfferCodes({
    memberId,
    prisma,
  }).catch(() => []);
  const payableUsageTopUpTargets: HostedUsageCreditPurchaseTargetProjection[] = [
    {
      beneficiaryMemberId: memberId,
      kind: "personal",
    },
    ...(familyOwner?.billingActive
      ? familyOwner.members.map((member) => ({
          beneficiaryMemberId: member.memberId,
          familyGroupId: familyOwner.groupId,
          kind: "family" as const,
        }))
      : []),
  ];
  const usageTopUpActivePurchase = await readHostedActiveUsageCreditPurchaseForPayer({
    serverApprovedPayableTargets: payableUsageTopUpTargets,
    payerMemberId: memberId,
    prisma,
  }).catch(() => null);
  const usageTopUpReturnTarget = input.usageReturnPurchaseId
    ? await readHostedUsageCreditPurchaseTargetForPayer({
        payerMemberId: memberId,
        prisma,
        purchaseId: input.usageReturnPurchaseId,
      }).catch(() => null)
    : null;
  return {
    consentStatus,
    familyAccess,
    familyDraftRecoveryState,
    familyOwner,
    groupPlanAvailable,
    hasConfirmedGroupMembership,
    inferenceConnection,
    freshPrivySession: await freshPrivySessionPromise,
    maxPlanAvailable,
    secureApprovalStatus: await secureApprovalStatusPromise,
    settingsSnapshot,
    usageActivity,
    usageStatus,
    usageTopUpActivePurchase,
    usageTopUpOfferCodes,
    usageTopUpReturnTarget,
  };
}

function resolveActiveFamilyOwnerUsageTopUpMember(
  snapshot: HostedFamilyOwnerSnapshot | null,
): HostedFamilyOwnerMemberRow | null {
  if (
    !snapshot?.billingActive ||
    snapshot.suspendedAt
  ) {
    return null;
  }

  const matches = snapshot.members.filter(
    (member) =>
      member.isOwner &&
      member.memberId === snapshot.ownerMemberId &&
      member.status === "active",
  );
  return matches.length === 1 ? matches[0] ?? null : null;
}

function readHostedConfiguredUsageCreditOfferCodesSafely(): readonly HostedUsageCreditOfferCode[] {
  try {
    return filterHostedNonGroupUsageCreditOfferCodes(
      readHostedConfiguredUsageCreditOfferCodes(),
    );
  } catch {
    return [];
  }
}

function readFirstSearchParamValue(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function readOnlySearchParamValue(
  value: string | string[] | undefined,
): string | undefined {
  if (!Array.isArray(value)) {
    return value;
  }

  return value.length === 1 ? value[0] : undefined;
}

function readUsageTopUpPurchaseReturn(
  searchParams: SettingsSearchParams,
): HostedUsageTopUpReturn | null {
  const kind = readOnlySearchParamValue(searchParams.usageCheckout);
  const purchaseId = readOnlySearchParamValue(searchParams.usagePurchase);

  if (
    (kind !== "success" && kind !== "cancel") ||
    typeof purchaseId !== "string" ||
    !HOSTED_USAGE_CREDIT_PURCHASE_ID_PATTERN.test(purchaseId)
  ) {
    return null;
  }

  return {
    kind,
    purchaseId,
  };
}

function projectHostedUsageTopUpOffers(
  offerCodes: readonly HostedUsageCreditOfferCode[],
): HostedUsageTopUpOffer[] {
  return offerCodes.map((offerCode) => {
    const offer = getHostedUsageCreditOfferDefinition(offerCode);

    return {
      amountLabel: formatUsageTopUpAmount(offer.cashAmountMinor),
      offerCode: offer.code,
    };
  });
}

function formatUsageTopUpAmount(amountUsdCents: number): string {
  const wholeDollars = Math.floor(amountUsdCents / 100);
  const cents = amountUsdCents % 100;

  return cents === 0
    ? `$${wholeDollars}`
    : `$${wholeDollars}.${String(cents).padStart(2, "0")}`;
}
