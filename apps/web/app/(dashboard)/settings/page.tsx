import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { HostedAccountSettingsCards } from "@/src/components/settings/hosted-account-settings-cards";
import { HostedBillingSettings } from "@/src/components/settings/hosted-billing-settings";
import { HostedDataPrivacySettings } from "@/src/components/settings/hosted-data-privacy-settings";
import Link from "next/link";
import { PageHeader } from "@/src/components/ui/page-header";
import {
  readHostedAccountSettingsSnapshot,
  withServerApprovedTelegramUsernameHint,
} from "@/src/lib/hosted-onboarding/account-settings-snapshot";
import {
  canStartHostedPulseTrialPaidPlan,
  canSwitchHostedBillingPlanToPulse,
  canUpgradeHostedBillingPlanToEdge,
} from "@/src/lib/hosted-onboarding/billing-plans";
import { readHostedMemberStripeBillingRef } from "@/src/lib/hosted-onboarding/hosted-member-billing-store";
import { readHostedMemberRoutingState } from "@/src/lib/hosted-onboarding/hosted-member-routing-store";
import { getHostedPrivySession } from "@/src/lib/hosted-onboarding/hosted-session";
import { getHostedPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import { getPrisma } from "@/src/lib/prisma";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";

export const metadata: Metadata = createMurphPageMetadata({
  title: "Settings — Murph",
  description: "Manage your Murph account settings.",
});

export default async function SettingsPage() {
  const { authenticated, authenticatedMember, session } = await getHostedPageAuthSnapshot();

  if (!authenticated) {
    redirect("/");
  }

  const prisma = getPrisma();
  const [routing, account, billingRef, freshPrivySession] = authenticatedMember
    ? await Promise.all([
        readHostedMemberRoutingState({
          memberId: authenticatedMember.id,
          prisma,
        }),
        readHostedAccountSettingsSnapshot({
          memberId: authenticatedMember.id,
        }),
        readHostedMemberStripeBillingRef({
          memberId: authenticatedMember.id,
          prisma,
        }),
        getHostedPrivySession().catch(() => null),
      ])
    : [null, null, null, null];
  const privySessionMatchesAppSession =
    freshPrivySession !== null && freshPrivySession.identity.userId === session?.privyUserId;
  const serverApprovedPrivyLinkedAccounts = privySessionMatchesAppSession
    ? freshPrivySession.linkedAccounts
    : null;
  const accountWithPrivyDisplay = account
    ? withServerApprovedTelegramUsernameHint({
        snapshot: account,
        serverApprovedPrivyLinkedAccounts,
      })
    : account;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Settings"
        title="Your account"
        description="Subscription, connected accounts, and data privacy."
      />

      <section className="flex flex-col gap-4">
        <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Billing
        </div>
        <HostedBillingSettings
          authenticated={authenticated}
          canStartPaidPulse={canStartHostedPulseTrialPaidPlan({
            billingStatus: authenticatedMember?.billingStatus,
            currentBillingPhase: billingRef?.currentBillingPhase,
            currentBillingPlanCode: billingRef?.currentBillingPlanCode,
            currentCheckoutOffer: billingRef?.currentCheckoutOffer,
            stripeCustomerId: billingRef?.stripeCustomerId,
            stripeSubscriptionId: billingRef?.stripeSubscriptionId,
            suspendedAt: authenticatedMember?.suspendedAt,
          })}
          canUpgradeToEdge={canUpgradeHostedBillingPlanToEdge({
            currentBillingPhase: billingRef?.currentBillingPhase,
            currentBillingPlanCode: billingRef?.currentBillingPlanCode,
            currentCheckoutOffer: billingRef?.currentCheckoutOffer,
          })}
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
        />
      </section>

      <section className="flex flex-col gap-4">
        <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Messaging
        </div>
        {accountWithPrivyDisplay ? (
          <HostedAccountSettingsCards
            account={accountWithPrivyDisplay}
            murphPhoneNumber={routing?.linqRecipientPhone ?? null}
          />
        ) : null}
      </section>

      <section className="flex flex-col gap-4">
        <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Wearables
        </div>
        <Link
          href="/connect"
          className="text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          Manage wearables
        </Link>
      </section>

      <section className="flex flex-col gap-4">
        <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Data & privacy
        </div>
        <HostedDataPrivacySettings authenticated={authenticated} />
      </section>
    </div>
  );
}
