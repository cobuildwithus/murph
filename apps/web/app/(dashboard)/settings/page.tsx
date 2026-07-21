import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { HOSTED_ASSISTANT_TERRA_MODEL } from "@murphai/hosted-execution/assistant-model";

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
import { PulseTrialBillingContinuation } from "@/src/components/settings/hosted-start-paid-pulse-button";
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
} from "@/src/lib/hosted-onboarding/billing-plans";
import { readHostedPulseTrialContinuationCookie } from "@/src/lib/hosted-onboarding/billing-pulse-trial-continuation";
import {
  HOSTED_START_PAID_PULSE_RETURN_PARAM,
  HOSTED_START_PAID_PULSE_RETURN_VALUE,
} from "@/src/lib/hosted-onboarding/billing-pulse-trial-continuation-contract";
import { hasHostedMemberOwnActiveBilling } from "@/src/lib/hosted-onboarding/entitlement";
import {
  readHostedFamilyAccessForMember,
  readHostedFamilyOwnerSnapshotForMember,
} from "@/src/lib/hosted-onboarding/family-plan";
import { getHostedPrivySession } from "@/src/lib/hosted-onboarding/hosted-session";
import { getHostedDashboardPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import { readHostedPersonalUsageCreditOfferCodes } from "@/src/lib/hosted-onboarding/personal-usage-credit-eligibility";
import { getPrisma } from "@/src/lib/prisma";
import { readHostedSecureApprovalStatus } from "@/src/lib/sensitive-actions/secure-approval-status";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";
import { readHostedPersonalAiUsageStatus } from "@/src/lib/hosted-execution/usage-status";
import { readHostedUsageCreditProjection } from "@/src/lib/hosted-execution/usage-credits";
import {
  getHostedUsageCreditOfferDefinition,
  type HostedUsageCreditOfferCode,
} from "@/src/lib/hosted-onboarding/usage-credit-offers";
import { readHostedActiveUsageCreditPurchaseForPayer } from "@/src/lib/hosted-onboarding/usage-credit-purchase-service";
import { resolveMurphContactOptions } from "@/src/lib/murph-contact-routing";

export const metadata: Metadata = createMurphPageMetadata({
  title: "Settings — Murph",
  description: "Manage your Murph account settings.",
});

type SettingsSearchParams = {
  addEmail?: string | string[] | undefined;
  addUsage?: string | string[] | undefined;
  startPulse?: string | string[] | undefined;
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

  const pulseTrialBillingContinuationPending =
    readFirstSearchParamValue(
      resolvedSearchParams[HOSTED_START_PAID_PULSE_RETURN_PARAM],
    ) === HOSTED_START_PAID_PULSE_RETURN_VALUE
    && authenticatedMember !== null
    && session !== null
    && await readHostedPulseTrialContinuationCookie({
      memberId: authenticatedMember.id,
      sessionId: session.sessionId,
    }) !== null;

  const prisma = getPrisma();
  const settingsData = authenticatedMember
    ? await readSettingsPageData({
        memberId: authenticatedMember.id,
        prisma,
        privyUserId: session?.privyUserId,
      })
    : null;
  const settingsSnapshot = settingsData?.settingsSnapshot ?? null;
  const freshPrivySession = settingsData?.freshPrivySession ?? null;
  const familyOwner = settingsData?.familyOwner ?? null;
  const familyAccess = settingsData?.familyAccess ?? null;
  const secureApprovalStatus =
    settingsData?.secureApprovalStatus ?? ({ status: "unavailable" } as const);
  const usageStatus = settingsData?.usageStatus ?? null;
  const usageCreditProjection = settingsData?.usageCreditProjection ?? null;
  const usageTopUpOfferCodes = settingsData?.usageTopUpOfferCodes ?? [];
  const usageTopUpActivePurchase = settingsData?.usageTopUpActivePurchase ?? null;
  const account = settingsSnapshot?.account ?? null;
  const billingRef = settingsSnapshot?.billingRef ?? null;
  const routing = settingsSnapshot?.routing ?? null;
  const activeFamilyOwner = familyOwner?.billingActive === true;
  const sponsoredMember = familyAccess !== null && familyOwner === null;
  const usageTopUpOffers = projectHostedUsageTopUpOffers(usageTopUpOfferCodes);
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
        {pulseTrialBillingContinuationPending ? <PulseTrialBillingContinuation /> : null}
        <HostedBillingSettings
          authenticated={authenticated}
          billingStatus={authenticatedMember?.billingStatus}
          canStartFamily={canStartFamily}
          familyState={activeFamilyOwner ? "owner" : sponsoredMember ? "sponsored" : "none"}
          pulseTrialBillingContinuationPending={pulseTrialBillingContinuationPending}
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
          usageTopUpActivePurchase={usageTopUpActivePurchase}
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

async function readSettingsPageData(input: {
  memberId: string;
  prisma: ReturnType<typeof getPrisma>;
  privyUserId: string | null | undefined;
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
  const familyOwner = await readHostedFamilyOwnerSnapshotForMember({
    memberId,
    prisma,
  });
  const familyAccess = await readHostedFamilyAccessForMember({
    memberId,
    prisma,
  });
  const usageStatus = await readHostedPersonalAiUsageStatus({
    memberId,
    prisma,
  });
  const usageCreditProjection = await readHostedUsageCreditProjection({
    beneficiaryMemberId: memberId,
    prisma,
  });
  const usageTopUpOfferCodes = await readHostedPersonalUsageCreditOfferCodes({
    memberId,
    prisma,
  }).catch(() => []);
  const usageTopUpActivePurchase = await readHostedActiveUsageCreditPurchaseForPayer({
    beneficiaryMemberId: memberId,
    payerMemberId: memberId,
    prisma,
  }).catch(() => null);

  return {
    familyAccess,
    familyOwner,
    freshPrivySession: await freshPrivySessionPromise,
    secureApprovalStatus: await secureApprovalStatusPromise,
    settingsSnapshot,
    usageCreditProjection,
    usageStatus,
    usageTopUpActivePurchase,
    usageTopUpOfferCodes,
  };
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
