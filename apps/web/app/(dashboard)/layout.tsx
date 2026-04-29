import type { ReactNode } from "react";

import { DashboardShell } from "@/src/components/dashboard/dashboard-shell";
import { getHostedSidebarAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const sidebarAuth = await getHostedSidebarAuthSnapshot();

  return <DashboardShell sidebarAuth={sidebarAuth}>{children}</DashboardShell>;
}
