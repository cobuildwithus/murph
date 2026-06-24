import type { Metadata } from "next";

import { requireHostedOpsPageAccess } from "@/src/lib/hosted-ops/access";
import { readHostedRuntimeMaintenanceOverview } from "@/src/lib/hosted-ops/runtime-maintenance";
import { getHostedDashboardPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";

import { RuntimeMaintenanceClient } from "./runtime-maintenance-client";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

export const metadata: Metadata = {
  robots: {
    follow: false,
    index: false,
  },
  title: "Runtime maintenance - Murph",
};

export default async function RuntimeMaintenanceOpsPage() {
  await getHostedDashboardPageAuthSnapshot();
  await requireHostedOpsPageAccess();
  const overview = await readHostedRuntimeMaintenanceOverview();

  return <RuntimeMaintenanceClient initialOverview={overview} />;
}
