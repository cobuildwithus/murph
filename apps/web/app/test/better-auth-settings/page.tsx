import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { isHostedWebSmokeArtifactMode } from "@/next-artifacts";

export const metadata = { robots: { index: false, follow: false } };

// Browser-test fixture only. No production or ordinary dev request can mount
// these live controllers with synthetic account props. Tests own API responses.
export default async function BetterAuthSettingsHarness({ searchParams }: {
  searchParams: Promise<{ email?: string }>;
}) {
  if (process.env.NODE_ENV !== "development" || !isHostedWebSmokeArtifactMode()) notFound();
  const host = (await headers()).get("host") ?? "";
  if (!/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/u.test(host)) notFound();

  const { HostedLoginMethodSettings } = await import("@/src/components/settings/hosted-login-method-settings");
  const { HostedApprovalRecoverySettings } = await import("@/src/components/settings/hosted-approval-recovery-settings");
  const { email } = await searchParams;
  const verifiedAt = "2026-09-09T12:00:00Z";
  return <main className="mx-auto flex w-full max-w-xl flex-col gap-8 px-5 py-10">
    <section aria-label="Connected accounts">
      <HostedLoginMethodSettings account={{
        email: email === "none" ? { address: null, verifiedAt: null } : { address: "member@example.test", verifiedAt },
        phone: { number: "+12025550152", verifiedAt },
        telegram: { telegramUserId: null },
        referralIdentityKey: "synthetic-browser-proof",
      }} />
    </section>
    <section aria-label="Security"><HostedApprovalRecoverySettings enabled /></section>
  </main>;
}
