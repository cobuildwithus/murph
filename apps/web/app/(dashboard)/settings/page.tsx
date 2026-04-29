import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { HostedPhoneCountryCodeBoundary } from "@/src/components/hosted-onboarding/hosted-phone-country-code-boundary";
import { HostedBillingSettings } from "@/src/components/settings/hosted-billing-settings";
import { HostedDataPrivacySettings } from "@/src/components/settings/hosted-data-privacy-settings";
import { HostedDeviceSyncSettings } from "@/src/components/settings/hosted-device-sync-settings";
import { HostedEmailSettings } from "@/src/components/settings/hosted-email-settings";
import { HostedPhoneSettings } from "@/src/components/settings/hosted-phone-settings";
import { HostedTelegramSettings } from "@/src/components/settings/hosted-telegram-settings";
import { HostedVaultSyncSettings } from "@/src/components/settings/hosted-vault-sync-settings";
import { getPrisma } from "@/src/lib/prisma";
import { getHostedPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import { readHostedMemberRoutingState } from "@/src/lib/hosted-onboarding/hosted-member-routing-store";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";

export const metadata: Metadata = createMurphPageMetadata({
  title: "Settings — Murph",
  description: "Manage your Murph account settings.",
});

export default async function SettingsPage() {
  const { authenticated, authenticatedMember, linkedAccounts } = await getHostedPageAuthSnapshot();

  if (!authenticated) {
    redirect("/");
  }

  const routing = authenticatedMember
    ? await readHostedMemberRoutingState({
        memberId: authenticatedMember.id,
        prisma: getPrisma(),
      })
    : null;

  return (
    <HostedPhoneCountryCodeBoundary>
      <div className="flex flex-col gap-8">
        <div>
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Settings
          </span>
          <h1 className="font-serif text-3xl font-semibold tracking-tight text-foreground">
            Your account
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Subscription, connected accounts, vault sync, wearables, and data privacy.
          </p>
        </div>

        <section className="flex flex-col gap-4">
          <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Billing
          </div>
          <HostedBillingSettings authenticated={authenticated} />
        </section>

        <section className="flex flex-col gap-4">
          <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Messaging
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <HostedPhoneSettings
              authenticated={authenticated}
              initialLinkedAccounts={linkedAccounts}
              murphPhoneNumber={routing?.linqRecipientPhone ?? null}
            />
            <HostedTelegramSettings authenticated={authenticated} initialLinkedAccounts={linkedAccounts} />
            <HostedEmailSettings authenticated={authenticated} initialLinkedAccounts={linkedAccounts} />
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Wearables
          </div>
          <HostedDeviceSyncSettings
            authenticated={authenticated}
            member={authenticatedMember}
          />
        </section>

        <section className="flex flex-col gap-4">
          <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Vault
          </div>
          <HostedVaultSyncSettings
            authenticated={authenticated}
            member={authenticatedMember}
          />
        </section>

        <section className="flex flex-col gap-4">
          <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Data & privacy
          </div>
          <HostedDataPrivacySettings authenticated={authenticated} />
        </section>
      </div>
    </HostedPhoneCountryCodeBoundary>
  );
}
