import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { HOSTED_ASSISTANT_TERRA_MODEL } from "@murphai/hosted-execution/assistant-model";
import { assistantPersonalityCausalWritesEnabled } from "@murphai/contracts";

import { HostedPrivyProvider } from "@/src/components/hosted-onboarding/privy-provider";
import { CustomizeMurphSettings } from "@/src/components/settings/customize-murph-settings";
import { HostedAccountSettingsCards } from "@/src/components/settings/hosted-account-settings-cards";
import { HostedAssistantModelSettings } from "@/src/components/settings/hosted-assistant-model-settings";
import { HostedBillingSettings } from "@/src/components/settings/hosted-billing-settings";
import type {
  HostedUsageTopUpOffer,
  HostedUsageTopUpReturn,
} from "@/src/components/settings/hosted-usage-top-up-dialog";
import { HostedDataPrivacySettings } from "@/src/components/settings/hosted-data-privacy-settings";
import { HostedFamilySettings } from "@/src/components/settings/hosted-family-settings";
import { HostedPasskeySettings } from "@/src/components/settings/hosted-passkey-settings";
import { Watch } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/src/components/ui/page-header";
import {
  readHostedAccountSettingsPageSnapshot,
  withServerApprovedPrivyAccountHints,
} from "@/src/lib/hosted-onboarding/account-settings-snapshot";
import {
  canStartHostedPulseTrialPaidPlan,
  canSwitchHostedBillingPlanToPulse,
  canUpgradeHostedBillingPlanToEdge,
  isHostedPulseTrialBillingState,
  parseHostedBillingPhase,
  parseHostedBillingPlanCode,
} from "@/src/lib/hosted-onboarding/billing-plans";
import { hasHostedMemberOwnActiveBilling } from "@/src/lib/hosted-onboarding/entitlement";
import {
  readHostedFamilyAccessForMember,
  readHostedFamilyOwnerSnapshotForMember,
} from "@/src/lib/hosted-onboarding/family-plan";
import { getHostedPrivySession } from "@/src/lib/hosted-onboarding/hosted-session";
import { getHostedDashboardPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import { getHostedOnboardingEnvironment } from "@/src/lib/hosted-onboarding/runtime";
import { getPrisma } from "@/src/lib/prisma";
import { readHostedSecureApprovalStatus } from "@/src/lib/sensitive-actions/secure-approval-status";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";
import { readHostedPersonalAiUsageStatus } from "@/src/lib/hosted-execution/usage-status";
import { readHostedUsageCreditProjection } from "@/src/lib/hosted-execution/usage-credits";
import {
  getHostedUsageCreditOfferDefinition,
  HOSTED_USAGE_CREDIT_OFFER_CODES,
} from "@/src/lib/hosted-onboarding/usage-credit-offers";
import { resolveMurphContactOptions } from "@/src/lib/murph-contact-routing";

export const metadata: Metadata = createMurphPageMetadata({
  title: "Settings — Murph",
  description: "Manage your Murph account settings.",
});

type SettingsSearchParams = {
  addEmail?: string | string[] | undefined;
  addUsage?: string | string[] | undefined;
  usageCheckout?: string | string[] | undefined;
  usagePurchase?: string | string[] | undefined;
  voice?: string | string[] | undefined;
};

const HOSTED_USAGE_CREDIT_PURCHASE_ID_PATTERN = /^hucp_[A-Za-z0-9_-]{16}$/u;

export default async function SettingsPage({
  searchParams,
}: {
  searchParams?: Promise<SettingsSearchParams>;
} = {}) {
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const openEmailLink =
    readFirstSearchParamValue(resolvedSearchParams.addEmail) === "true";
  const openUsageTopUp =
    readOnlySearchParamValue(resolvedSearchParams.addUsage) === "true";
  const openVoiceLink =
    readFirstSearchParamValue(resolvedSearchParams.voice) === "true";
  const usageTopUpPurchaseReturn = readUsageTopUpPurchaseReturn(
    resolvedSearchParams,
  );
  const { authenticated, authenticatedMember, session } =
    await getHostedDashboardPageAuthSnapshot();

  if (!authenticated) {
    redirect("/");
  }

  const prisma = getPrisma();
  const [
    settingsSnapshot,
    freshPrivySession,
    familyOwner,
    familyAccess,
    secureApprovalStatus,
    usageStatus,
    usageCreditProjection,
  ] =
    authenticatedMember
      ? await Promise.all([
          readHostedAccountSettingsPageSnapshot({
            memberId: authenticatedMember.id,
            prisma,
          }),
          getHostedPrivySession().catch(() => null),
          readHostedFamilyOwnerSnapshotForMember({
            memberId: authenticatedMember.id,
            prisma,
          }),
          readHostedFamilyAccessForMember({
            memberId: authenticatedMember.id,
            prisma,
          }),
          readHostedSecureApprovalStatus({
            privyUserId: session?.privyUserId,
          }),
          readHostedPersonalAiUsageStatus({
            memberId: authenticatedMember.id,
            prisma,
          }),
          readHostedUsageCreditProjection({
            beneficiaryMemberId: authenticatedMember.id,
            prisma,
          }),
        ])
      : [
          null,
          null,
          null,
          null,
          { status: "unavailable" } as const,
          null,
          null,
        ];
  const account = settingsSnapshot?.account ?? null;
  const billingRef = settingsSnapshot?.billingRef ?? null;
  const routing = settingsSnapshot?.routing ?? null;
  const activeFamilyOwner = familyOwner?.billingActive === true;
  const sponsoredMember = familyAccess !== null && familyOwner === null;
  const usageTopUpOffers = resolveHostedUsageTopUpOffers({
    billingRef,
    familyAccess,
    familyOwner,
    member: authenticatedMember,
    usageStatus,
  });
  const canStartFamily =
    authenticatedMember != null &&
    !activeFamilyOwner &&
    !sponsoredMember &&
    !authenticatedMember.suspendedAt;
  const canUpgradeToEdge =
    authenticatedMember !== null &&
    hasHostedMemberOwnActiveBilling(authenticatedMember) &&
    canUpgradeHostedBillingPlanToEdge({
      currentBillingPhase: billingRef?.currentBillingPhase,
      currentBillingPlanCode: billingRef?.currentBillingPlanCode,
      currentCheckoutOffer: billingRef?.currentCheckoutOffer,
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

  return (
    <div className="flex flex-col gap-12">
      <PageHeader
        eyebrow="Settings"
        title="Your account"
        description="Plan, model, connected accounts, and data privacy."
      />

      <section id="subscription" className="flex scroll-mt-24 flex-col gap-4">
        <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Subscription
        </div>
        <HostedBillingSettings
          authenticated={authenticated}
          billingStatus={authenticatedMember?.billingStatus}
          canStartFamily={canStartFamily}
          familyState={activeFamilyOwner ? "owner" : sponsoredMember ? "sponsored" : "none"}
          canStartPaidPulse={canStartHostedPulseTrialPaidPlan({
            billingStatus: authenticatedMember?.billingStatus,
            currentBillingPhase: billingRef?.currentBillingPhase,
            currentBillingPlanCode: billingRef?.currentBillingPlanCode,
            currentCheckoutOffer: billingRef?.currentCheckoutOffer,
            hasStripeCustomerId: Boolean(billingRef?.stripeCustomerId),
            hasStripeSubscriptionId: Boolean(billingRef?.stripeSubscriptionId),
            suspendedAt: authenticatedMember?.suspendedAt,
          })}
          canUpgradeToEdge={canUpgradeToEdge}
          canSwitchToPulse={canSwitchHostedBillingPlanToPulse({
            billingStatus: authenticatedMember?.billingStatus,
            currentBillingPhase: billingRef?.currentBillingPhase,
            currentBillingPlanCode: billingRef?.currentBillingPlanCode,
            stripeCustomerId: billingRef?.stripeCustomerId,
            stripeSubscriptionId: billingRef?.stripeSubscriptionId,
            suspendedAt: authenticatedMember?.suspendedAt,
          })}
          currentBillingPhase={billingRef?.currentBillingPhase}
          currentCheckoutOffer={billingRef?.currentCheckoutOffer}
          currentBillingPlanCode={billingRef?.currentBillingPlanCode}
          currentPeriodEnd={billingRef?.currentPeriodEnd}
          scheduledBillingEffectiveAt={billingRef?.scheduledBillingEffectiveAt}
          scheduledBillingPlanCode={billingRef?.scheduledBillingPlanCode}
          usageCreditBalanceUsdMicros={
            usageCreditProjection?.balanceUsdMicros.toString() ?? null
          }
          usageStatus={usageStatus}
          usageTopUpInitialOpen={openUsageTopUp}
          usageTopUpOffers={usageTopUpOffers}
          usageTopUpPurchaseReturn={usageTopUpPurchaseReturn}
        />
      </section>

      <section className="flex flex-col gap-4">
        <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          AI model
        </div>
        <HostedAssistantModelSettings
          canUpgradeToEdge={canUpgradeToEdge}
          configurationAvailable={account?.assistant?.configurationAvailable === true}
          initialDormantSolPreference={
            account?.assistant?.dormantSolPreference === true
          }
          initialModel={account?.assistant?.model ?? HOSTED_ASSISTANT_TERRA_MODEL}
          solAvailable={account?.assistant?.solAvailable === true}
        />
      </section>

      {familyOwner ? (
        <section className="flex flex-col gap-4">
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Family
          </div>
          <HostedFamilySettings ownerSnapshot={familyOwner} />
        </section>
      ) : null}

      <section className="flex flex-col gap-4">
        <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Messaging
        </div>
        {accountWithPrivyDisplay ? (
          <HostedAccountSettingsCards
            account={accountWithPrivyDisplay}
            murphPhoneNumber={murphPhoneNumber}
            openEmailLink={openEmailLink}
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
            personalitySettingsEnabled={assistantPersonalityCausalWritesEnabled(process.env)}
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
        <HostedPrivyProvider appId={privyAppId} clientId={privyClientId}>
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
            <HostedDataPrivacySettings authenticated={authenticated} authorizationEnabled />
          </section>
        </HostedPrivyProvider>
      ) : (
        <section id="data-privacy" className="flex scroll-mt-24 flex-col gap-4">
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Data & privacy
          </div>
          <HostedDataPrivacySettings authenticated={authenticated} authorizationEnabled={false} />
        </section>
      )}
    </div>
  );
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

function resolveHostedUsageTopUpOffers(input: {
  billingRef: {
    currentBillingPhase?: unknown;
    currentBillingPlanCode?: unknown;
    currentCheckoutOffer?: unknown;
    stripeCustomerId?: unknown;
    stripeSubscriptionId?: unknown;
  } | null;
  familyAccess: unknown;
  familyOwner: unknown;
  member: Parameters<typeof hasHostedMemberOwnActiveBilling>[0] | null;
  usageStatus: Awaited<ReturnType<typeof readHostedPersonalAiUsageStatus>> | null;
}): HostedUsageTopUpOffer[] {
  const planCode = parseHostedBillingPlanCode(
    input.billingRef?.currentBillingPlanCode,
  );
  const directPaidPlan =
    input.member !== null &&
    hasHostedMemberOwnActiveBilling({
      billingStatus: input.member.billingStatus,
      suspendedAt: input.member.suspendedAt,
    }) &&
    input.familyAccess === null &&
    input.familyOwner === null &&
    input.usageStatus?.status !== "unavailable" &&
    input.usageStatus?.accessKind === "paid" &&
    parseHostedBillingPhase(input.billingRef?.currentBillingPhase) === "paid" &&
    (planCode === "launch_monthly" || planCode === "launch_edge_monthly") &&
    !isHostedPulseTrialBillingState({
      currentBillingPhase: input.billingRef?.currentBillingPhase,
      currentCheckoutOffer: input.billingRef?.currentCheckoutOffer,
    }) &&
    typeof input.billingRef?.stripeCustomerId === "string" &&
    input.billingRef.stripeCustomerId.length > 0 &&
    typeof input.billingRef?.stripeSubscriptionId === "string" &&
    input.billingRef.stripeSubscriptionId.length > 0;

  if (!directPaidPlan) {
    return [];
  }

  const activePriceIds =
    getHostedOnboardingEnvironment().stripeUsageCreditPriceIdsByOffer;

  return HOSTED_USAGE_CREDIT_OFFER_CODES.flatMap((offerCode) => {
    const offer = getHostedUsageCreditOfferDefinition(offerCode);

    return activePriceIds[offerCode]
      ? [{
          amountLabel: formatUsageTopUpAmount(offer.cashAmountMinor),
          amountUsdCents: offer.cashAmountMinor,
          offerCode: offer.code,
        }]
      : [];
  });
}

function formatUsageTopUpAmount(amountUsdCents: number): string {
  const wholeDollars = Math.floor(amountUsdCents / 100);
  const cents = amountUsdCents % 100;

  return cents === 0
    ? `$${wholeDollars}`
    : `$${wholeDollars}.${String(cents).padStart(2, "0")}`;
}
