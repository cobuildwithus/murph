import type { ReactNode } from "react";

import { DashboardShell } from "@/src/components/dashboard/dashboard-shell";
import { BrowserVaultProvider } from "@/src/lib/browser-vault/context";
import {
  getHostedPageAuthSnapshot,
  getHostedSidebarAuthSnapshot,
} from "@/src/lib/hosted-onboarding/page-auth";

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const [pageAuth, sidebarAuth] = await Promise.all([
    getHostedPageAuthSnapshot(),
    getHostedSidebarAuthSnapshot(),
  ]);

  return (
    <BrowserVaultProvider
      initialMemberId={pageAuth.authenticatedMember?.id ?? null}
    >
      <DashboardShell sidebarAuth={sidebarAuth}>{children}</DashboardShell>
    </BrowserVaultProvider>
  );
}
