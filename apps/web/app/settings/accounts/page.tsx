import type { Metadata } from "next";
import Link from "next/link";
import { AuthButton } from "@/src/components/ui/auth-button";
import { PageHeader } from "@/src/components/ui/page-header";
import { HostedLoginMethodSettings } from "@/src/components/settings/hosted-login-method-settings";
import { HostedPasskeySettings } from "@/src/components/settings/hosted-passkey-settings";
import { getHostedPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import { readHostedAccountSettingsPageSnapshot } from "@/src/lib/hosted-onboarding/account-settings-snapshot";
import { isApprovalPasskeyEnrollmentEnabled } from "@/src/lib/sensitive-actions/passkey-rollout";
import { readHostedSecureApprovalStatus } from "@/src/lib/sensitive-actions/secure-approval-status";
import { getPrisma } from "@/src/lib/prisma";
import { createMurphPageMetadata, MURPH_NOINDEX_PAGE_ROBOTS } from "@/src/lib/site-metadata";

export const metadata: Metadata = {
  ...createMurphPageMetadata({ title: "Connected accounts — Murph", description: "Manage how you sign in and message Murph." }),
  robots: MURPH_NOINDEX_PAGE_ROBOTS,
};

// Account authority is available before billing or messaging setup. The main
// dashboard's paid-access redirect cannot own this onboarding/native entry.
export default async function AccountSettingsPage({ searchParams }: {
  searchParams: Promise<{ companion?: string | string[] }>;
}) {
  const { companion } = await searchParams;
  const auth = await getHostedPageAuthSnapshot();
  const memberId = auth.authenticatedMember?.id;
  let controls;
  if (!auth.authenticated || !memberId) {
    controls = <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">Sign in with the account you use in Murph to manage your connections.</p>
      <AuthButton authSatisfied={false}>Sign in</AuthButton>
    </div>;
  } else {
    const prisma = getPrisma();
    const { account } = await readHostedAccountSettingsPageSnapshot({ memberId, prisma });
    const status = await readHostedSecureApprovalStatus({ memberId, prisma });
    controls = <>
      <section className="flex flex-col gap-4" aria-label="Connected accounts">
        <HostedLoginMethodSettings account={{ phone: account.phone, email: account.email, telegram: account.telegram, referralIdentityKey: account.referralIdentityKey }} />
      </section>
      <section id="security" className="flex scroll-mt-8 flex-col gap-4" aria-label="Security">
        <h2 className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Security</h2>
        <HostedPasskeySettings authenticated enrollmentEnabled={isApprovalPasskeyEnrollmentEnabled()} secureApprovalStatus={status} />
      </section>
    </>;
  }
  // These fixed callbacks carry no token or member identity. Native admission
  // rereads canonical setup after return; arbitrary redirect URLs are rejected.
  const callback = companion === "ios" ? "ai.withmurph.app://account-settings"
    : companion === "ios-dev" ? "ai.withmurph.app.dev://account-settings" : null;
  const content = <main className="min-h-dvh bg-background px-5 py-10 text-foreground sm:px-8">
    <div className="mx-auto flex w-full max-w-xl flex-col gap-8">
      <PageHeader eyebrow="Account" title="Stay connected" description="Choose how you sign in and message Murph." />
      {controls}
      {callback ? <a href={callback} className="self-start text-sm underline underline-offset-4">Return to the Murph app</a>
        : <Link href="/join" className="self-start text-sm underline underline-offset-4">Continue to Murph</Link>}
    </div>
  </main>;
  return content;
}
