import type { Metadata } from "next";
import { cookies } from "next/headers";
import type { ReactNode } from "react";

import { DashboardCriticalLoadError } from "@/src/components/dashboard/dashboard-critical-load-error";
import { DashboardShell } from "@/src/components/dashboard/dashboard-shell";
import { DevelopmentPersonaSwitcher } from "@/src/components/dashboard/development-persona-switcher";
import { DashboardLegalConsentGate } from "@/src/components/legal/dashboard-legal-consent-gate";
import { BrowserVaultProvider } from "@/src/lib/browser-vault/context";
import {
  DEVELOPMENT_PERSONA_COOKIE,
  isDevelopmentPersonaId,
} from "@/src/lib/browser-vault/development-personas";
import { buildDevelopmentPersonaReplica } from "@/src/lib/browser-vault/development-personas.server";
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
  const developmentPersona =
    process.env.NODE_ENV === "development"
      ? await readDevelopmentPersona()
      : null;
  const developmentReplica = developmentPersona
    ? await buildDevelopmentPersonaReplica(developmentPersona)
    : null;
  const consentStatus = authenticatedMember
    ? await readDashboardConsentReminderStatus(authenticatedMember.id)
    : null;
  // A signed-out visitor has no vault to load. Without this the provider would
  // post a session request that can only be rejected, and the dashboard would
  // tell someone who never signed in that their session expired.
  const browserVaultLoadEnabled = authenticatedMember
    ? consentStatus?.launchGranted ?? true
    : false;

  return (
    <BrowserVaultProvider
      developmentReplica={developmentReplica}
      initialMemberId={authenticatedMember?.id ?? null}
      loadEnabled={browserVaultLoadEnabled}
    >
      <DashboardShell sidebarAuth={auth.sidebarAuth}>
        {children}
        {process.env.NODE_ENV === "development" ? (
          <DevelopmentPersonaSwitcher activePersona={developmentPersona} />
        ) : null}
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
    </BrowserVaultProvider>
  );
}

async function readDevelopmentPersona() {
  const cookieStore = await cookies();
  const value = cookieStore.get(DEVELOPMENT_PERSONA_COOKIE)?.value ?? null;
  return isDevelopmentPersonaId(value) ? value : null;
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
