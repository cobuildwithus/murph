import type { ReactNode } from "react";

import { DashboardCriticalLoadError } from "@/src/components/dashboard/dashboard-critical-load-error";
import { DashboardShell } from "@/src/components/dashboard/dashboard-shell";
import { BrowserVaultProvider } from "@/src/lib/browser-vault/context";
import { getHostedDashboardLayoutAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";

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

  return (
    <BrowserVaultProvider
      initialMemberId={auth.pageAuth.authenticatedMember?.id ?? null}
    >
      <DashboardShell sidebarAuth={auth.sidebarAuth}>{children}</DashboardShell>
    </BrowserVaultProvider>
  );
}
