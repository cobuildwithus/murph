import type { Metadata } from "next";

import { requireHostedOpsPageAccess } from "@/src/lib/hosted-ops/access";
import { getHostedDashboardPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";

import { TrialExtensionClient } from "./trial-extension-client";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

export const metadata: Metadata = {
  robots: {
    follow: false,
    index: false,
  },
  title: "Trials - Murph",
};

export default async function HostedOpsTrialsPage() {
  await getHostedDashboardPageAuthSnapshot();
  await requireHostedOpsPageAccess();

  return <TrialExtensionClient />;
}
