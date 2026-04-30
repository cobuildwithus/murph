import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { HostedPhoneCountryCodeBoundary } from "@/src/components/hosted-onboarding/hosted-phone-country-code-boundary";
import { HostedBillingSettings } from "@/src/components/settings/hosted-billing-settings";
import { HostedDataPrivacySettings } from "@/src/components/settings/hosted-data-privacy-settings";
import { HostedEmailSettings } from "@/src/components/settings/hosted-email-settings";
import { HostedPhoneSettings } from "@/src/components/settings/hosted-phone-settings";
import { HostedTelegramCardSettings } from "@/src/components/settings/hosted-telegram-card-settings";
import { PageHeader } from "@/src/components/ui/page-header";
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
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <HostedPhoneSettings
              authenticated={authenticated}
              initialLinkedAccounts={linkedAccounts}
              murphPhoneNumber={routing?.linqRecipientPhone ?? null}
            />
            <HostedTelegramCardSettings authenticated={authenticated} initialLinkedAccounts={linkedAccounts} />
            <HostedEmailSettings authenticated={authenticated} initialLinkedAccounts={linkedAccounts} />
          </div>
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
    </HostedPhoneCountryCodeBoundary>
  );
}
