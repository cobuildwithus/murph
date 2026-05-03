import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { HostedAccountSettingsCards } from "@/src/components/settings/hosted-account-settings-cards";
import { HostedBillingSettings } from "@/src/components/settings/hosted-billing-settings";
import { HostedDataPrivacySettings } from "@/src/components/settings/hosted-data-privacy-settings";
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
          description="Subscription, connected accounts, data sources, and data privacy."
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
          <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Data sources
          </div>
          <Link
            className="inline-flex w-fit items-center justify-center rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            href="/connect"
          >
            Connect devices
          </Link>
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
