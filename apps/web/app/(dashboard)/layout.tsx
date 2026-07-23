import type { ReactNode } from "react";

import { DashboardCriticalLoadError } from "@/src/components/dashboard/dashboard-critical-load-error";
import { DashboardShell } from "@/src/components/dashboard/dashboard-shell";
import { DashboardLegalConsentGate } from "@/src/components/legal/dashboard-legal-consent-gate";
import { BrowserVaultProvider } from "@/src/lib/browser-vault/context";
import { getHostedDashboardLayoutAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import { readHostedConsentStatus } from "@/src/lib/legal/consent";
import { getPrisma } from "@/src/lib/prisma";

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const auth = await getHostedDashboardLayoutAuthSnapshot();

  if (auth.status === "unavailable") {
    return (
      <main className="mx-auto w-full max-w-7xl px-4 py-8 md:px-14 md:py-10">
        <DashboardCriticalLoadError />
      </main>
    );
  }

  const consentStatus = auth.pageAuth.authenticatedMember
    ? await readDashboardConsentReminderStatus(auth.pageAuth.authenticatedMember.id)
    : null;

  return (
    <BrowserVaultProvider
      initialMemberId={auth.pageAuth.authenticatedMember?.id ?? null}
    >
      <DashboardShell sidebarAuth={auth.sidebarAuth}>
        {consentStatus && !consentStatus.launchGranted ? (
          <DashboardLegalConsentGate initialStatus={consentStatus} />
        ) : null}
        {children}
      </DashboardShell>
    </BrowserVaultProvider>
  );
}

async function readDashboardConsentReminderStatus(memberId: string) {
  try {
    return await readHostedConsentStatus({
      memberId,
      prisma: getPrisma(),
    });
  } catch {
    console.warn("Dashboard legal consent reminder is temporarily unavailable.");
    return null;
  }
}
