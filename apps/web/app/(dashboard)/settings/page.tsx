import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { HostedAccountSettingsCards } from "@/src/components/settings/hosted-account-settings-cards";
import { HostedBillingSettings } from "@/src/components/settings/hosted-billing-settings";
import { HostedDataPrivacySettings } from "@/src/components/settings/hosted-data-privacy-settings";
import { HostedDeviceSyncSettings } from "@/src/components/settings/hosted-device-sync-settings";
import { PageHeader } from "@/src/components/ui/page-header";
import { getPrisma } from "@/src/lib/prisma";
import { getHostedPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import { readHostedMemberRoutingState } from "@/src/lib/hosted-onboarding/hosted-member-routing-store";
import { readHostedAccountSettingsSnapshot } from "@/src/lib/hosted-onboarding/account-settings-snapshot";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";

export const metadata: Metadata = createMurphPageMetadata({
  title: "Settings — Murph",
  description: "Manage your Murph account settings.",
});

export default async function SettingsPage() {
  const { authenticated, authenticatedMember } = await getHostedPageAuthSnapshot();

  if (!authenticated) {
    redirect("/");
  }

  const [routing, account] = authenticatedMember
    ? await Promise.all([
        readHostedMemberRoutingState({
          memberId: authenticatedMember.id,
          prisma: getPrisma(),
        }),
        readHostedAccountSettingsSnapshot({
          memberId: authenticatedMember.id,
        }),
      ])
    : [null, null];

  return (
    <div className="flex flex-col gap-8">
        <PageHeader
          eyebrow="Settings"
          title="Your account"
          description="Subscription, connected accounts, and data privacy."
        />

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
          {account ? (
            <HostedAccountSettingsCards
              account={account}
              murphPhoneNumber={routing?.linqRecipientPhone ?? null}
            />
          ) : null}
        </section>

        <section className="flex flex-col gap-4">
          <HostedDeviceSyncSettings
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
  );
}
