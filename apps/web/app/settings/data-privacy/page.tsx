import type { Metadata } from "next";
import Link from "next/link";

import { HostedDataPrivacySettings } from "@/src/components/settings/hosted-data-privacy-settings";
import { PageHeader } from "@/src/components/ui/page-header";
import { getHostedAccountDeletionPageSession } from "@/src/lib/hosted-onboarding/app-session";
import { isHostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { countHostedFamilySponsoredMembers } from "@/src/lib/hosted-onboarding/family-plan";
import { readHostedMemberPhoneHint } from "@/src/lib/hosted-onboarding/hosted-member-identity-store";
import { getHostedPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import { getPrisma } from "@/src/lib/prisma";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";

import { SettingsDataPrivacyAuthRequired } from "./settings-data-privacy-auth-required";

export const metadata: Metadata = createMurphPageMetadata({
  title: "Data & privacy — Murph",
  description: "Export your Murph data or delete your account.",
});

export default async function SettingsDataPrivacyPage() {
  const { authenticated, authenticatedMember } = await getHostedPageAuthSnapshot().catch(async (error: unknown) => {
    if (!isHostedOnboardingError(error) || error.code !== "HOSTED_MEMBER_SUSPENDED") throw error;
    const session = await getHostedAccountDeletionPageSession();
    return { authenticated: Boolean(session), authenticatedMember: session?.member ?? null };
  });

  if (!authenticated) {
    return <SettingsDataPrivacyAuthRequired />;
  }

  const exportEnabled = !authenticatedMember?.suspendedAt;
  // The app opens this page in the browser, which may hold someone else's
  // session on a shared phone: say whose account deletion would remove.
  const [accountHint, familyCovered] = authenticatedMember
    ? await Promise.all([
      readHostedMemberPhoneHint({ memberId: authenticatedMember.id, prisma: getPrisma() }),
      // Deleting an owner ends Family for everyone it covers: the
      // confirmation says so.
      countHostedFamilySponsoredMembers({ ownerMemberId: authenticatedMember.id, prisma: getPrisma() }),
    ])
    : [null, 0];
  const content = (
    <main className="min-h-dvh bg-background px-4 py-10 text-foreground sm:px-6">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-8">
        <PageHeader
          eyebrow="Account privacy"
          title="Data & privacy"
          description={exportEnabled ? "Export your hosted data or permanently delete your Murph account. These controls remain available without an active subscription or health-data consent." : undefined}
        />

        <section id="data-privacy" className="flex flex-col gap-4">
          <HostedDataPrivacySettings
            accountHint={accountHint}
            authenticated
            familyCovered={familyCovered}
            authorizationEnabled={exportEnabled}
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

  return content;
}
