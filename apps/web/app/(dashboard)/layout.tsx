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

  // One persistent provider owns the decrypted replica for every dashboard
  // route, so route-local wrappers are redundant and navigation reuses the
  // in-memory client instead of reloading and re-decrypting per page.
  return (
    <BrowserVaultProvider authenticated={sidebarAuth.authenticated}>
      <DashboardShell sidebarAuth={sidebarAuth}>{children}</DashboardShell>
    </BrowserVaultProvider>
  );
}
