import type { Metadata } from "next";
import Link from "next/link";

import { HostedPrivyBoundary } from "@/src/components/hosted-onboarding/hosted-privy-boundary";
import { HostedDataPrivacySettings } from "@/src/components/settings/hosted-data-privacy-settings";
import { PageHeader } from "@/src/components/ui/page-header";
import { getHostedPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";
import { readApprovalPasskeyState } from "@/src/lib/sensitive-actions/passkey-store";
import { getPrisma } from "@/src/lib/prisma";

import { SettingsDataPrivacyAuthRequired } from "./settings-data-privacy-auth-required";

export const metadata: Metadata = createMurphPageMetadata({
  title: "Data & privacy — Murph",
  description: "Export your Murph data or delete your account.",
});

export default async function SettingsDataPrivacyPage() {
  const { authenticated, session } = await getHostedPageAuthSnapshot();

  if (!authenticated) {
    return <SettingsDataPrivacyAuthRequired />;
  }

  const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim() || null;
  // This optional client hint must not make identity-only deletion depend on
  // a provider read or on approval storage availability.
  const legacyApprovalRequired = privyAppId && session?.privyUserId
    ? await readApprovalPasskeyState({ memberId: session.member.id, prisma: getPrisma() })
      .then((state) => state.credentials.length === 0).catch(() => false)
    : false;
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
            authorizationEnabled
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

  return privyAppId && legacyApprovalRequired ? (
    <HostedPrivyBoundary>
      {content}
    </HostedPrivyBoundary>
  ) : content;
}
