import type { ReactNode } from "react";

import { DashboardShell } from "@/src/components/dashboard/dashboard-shell";
import { HostedPrivyBoundary } from "@/src/components/hosted-onboarding/hosted-privy-boundary";
import { getHostedSidebarAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";

export default async function BiomarkersLayout({
  children,
}: {
  children: ReactNode;
}) {
  const sidebarAuth = await getHostedSidebarAuthSnapshot();

  return (
    <HostedPrivyBoundary>
      <DashboardShell sidebarAuth={sidebarAuth}>{children}</DashboardShell>
    </HostedPrivyBoundary>
  );
}
