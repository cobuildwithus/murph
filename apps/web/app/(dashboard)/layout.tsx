import type { ReactNode } from "react";

import { DashboardShell } from "@/src/components/dashboard/dashboard-shell";
import { BrowserVaultProvider } from "@/src/lib/browser-vault/context";
import { getHostedSidebarAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const sidebarAuth = await getHostedSidebarAuthSnapshot();

  return (
    <BrowserVaultProvider>
      <DashboardShell sidebarAuth={sidebarAuth}>{children}</DashboardShell>
    </BrowserVaultProvider>
  );
}
