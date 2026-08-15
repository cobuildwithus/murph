import type { Metadata } from "next";
import Link from "next/link";

import { HostedPrivyProvider } from "@/src/components/hosted-onboarding/privy-provider";
import { HostedDataPrivacySettings } from "@/src/components/settings/hosted-data-privacy-settings";
import { PageHeader } from "@/src/components/ui/page-header";
import { getHostedPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";

import { SettingsDataPrivacyAuthRequired } from "./settings-data-privacy-auth-required";

export const metadata: Metadata = createMurphPageMetadata({
  title: "Data & privacy — Murph",
  description: "Export your Murph data or delete your account.",
});

export default async function SettingsDataPrivacyPage() {
  const { authenticated } = await getHostedPageAuthSnapshot();

  if (!authenticated) {
    return <SettingsDataPrivacyAuthRequired />;
  }

  const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim() || null;
  const privyClientId = process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID?.trim() || null;
  const content = (
    <main className="min-h-dvh bg-background px-4 py-10 text-foreground sm:px-6">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-8">
        <PageHeader
          eyebrow="Account privacy"
          title="Data & privacy"
          description="Export your hosted data or permanently delete your Murph account. These controls remain available without an active subscription or health-data consent."
        />

        <section id="data-privacy" className="flex flex-col gap-4">
          <HostedDataPrivacySettings
            authenticated
            authorizationEnabled={Boolean(privyAppId)}
          />
        </section>

        <p className="text-sm leading-6 text-muted-foreground">
          Need help? Email{" "}
          <a
            className="underline underline-offset-4"
            href="mailto:legal@justco.build"
          >
            legal@justco.build
          </a>
          {" "}
          or read the full{" "}
          <Link className="underline underline-offset-4" href="/legal/privacy">
            privacy policy
          </Link>
          .
        </p>
      </div>
    </main>
  );

  return privyAppId ? (
    <HostedPrivyProvider appId={privyAppId} clientId={privyClientId}>
      {content}
    </HostedPrivyProvider>
  ) : content;
}
