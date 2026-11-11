import type { Metadata } from "next";
import type { ReactNode } from "react";

import { DashboardCriticalLoadError } from "@/src/components/dashboard/dashboard-critical-load-error";
import { DashboardShell } from "@/src/components/dashboard/dashboard-shell";
import { DashboardLegalConsentGate } from "@/src/components/legal/dashboard-legal-consent-gate";
import { LinkPageTakeoverHold } from "@/src/components/link-page/link-page-takeover";
import { LinkPageVeil } from "@/src/components/link-page/link-page-veil";
import { getHostedDashboardLayoutAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import {
  hasHostedHistoricalLaunchConsent,
  readHostedConsentStatus,
} from "@/src/lib/legal/consent";
import { getPrisma } from "@/src/lib/prisma";
import { MURPH_NOINDEX_PAGE_ROBOTS } from "@/src/lib/site-metadata";

export const metadata: Metadata = {
  robots: MURPH_NOINDEX_PAGE_ROBOTS,
};

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

  const authenticatedMember = auth.pageAuth.authenticatedMember;
  const consentStatus = authenticatedMember
    ? await readDashboardConsentReminderStatus(authenticatedMember.id)
    : null;
  return (
    <>
      <LinkPageVeil />
      <DashboardShell sidebarAuth={auth.sidebarAuth}>
        <LinkPageTakeoverHold held={Boolean(consentStatus && !consentStatus.launchGranted)}>
          {children}
        </LinkPageTakeoverHold>
        {consentStatus && !consentStatus.launchGranted ? (
          <DashboardLegalConsentGate
            initialStatus={consentStatus}
            variant={
              hasHostedHistoricalLaunchConsent(consentStatus)
                ? "update"
                : "initial"
            }
          />
        ) : null}
      </DashboardShell>
    </>
  );
}

async function readDashboardConsentReminderStatus(memberId: string) {
  try {
    return await readHostedConsentStatus({
      memberId,
      prisma: getPrisma(),
    });
  } catch {
    console.warn(
      "Dashboard legal consent reminder is temporarily unavailable.",
    );
    return null;
  }
}
