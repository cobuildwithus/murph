import type { ReactNode } from "react";

import { DashboardShell } from "@/src/components/dashboard/dashboard-shell";
import { DashboardLegalConsentGate } from "@/src/components/legal/dashboard-legal-consent-gate";
import { BrowserVaultProvider } from "@/src/lib/browser-vault/context";
import {
  getHostedPageAuthSnapshot,
  getHostedSidebarAuthSnapshot,
} from "@/src/lib/hosted-onboarding/page-auth";
import { readHostedConsentStatus } from "@/src/lib/legal/consent";
import { getPrisma } from "@/src/lib/prisma";

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const [pageAuth, sidebarAuth] = await Promise.all([
    getHostedPageAuthSnapshot(),
    getHostedSidebarAuthSnapshot(),
  ]);
  const consentStatus = pageAuth.authenticatedMember
    ? await readHostedConsentStatus({
        memberId: pageAuth.authenticatedMember.id,
        prisma: getPrisma(),
      })
    : null;

  if (consentStatus && !consentStatus.launchGranted) {
    return (
      <DashboardShell sidebarAuth={sidebarAuth}>
        <DashboardLegalConsentGate initialStatus={consentStatus} />
      </DashboardShell>
    );
  }

  return (
    <BrowserVaultProvider
      initialMemberId={pageAuth.authenticatedMember?.id ?? null}
    >
      <DashboardShell sidebarAuth={sidebarAuth}>{children}</DashboardShell>
    </BrowserVaultProvider>
  );
}
