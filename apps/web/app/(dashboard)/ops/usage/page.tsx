import type { Metadata } from "next";

import { requireHostedOpsPageAccess } from "@/src/lib/hosted-ops/access";
import { readHostedOpsMemberUsage } from "@/src/lib/hosted-ops/member-usage";
import { getHostedDashboardPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";

import { MemberUsageClient } from "./member-usage-client";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

export const metadata: Metadata = {
  robots: {
    follow: false,
    index: false,
  },
  title: "Usage - Murph",
};

export default async function HostedOpsUsagePage() {
  await getHostedDashboardPageAuthSnapshot();
  await requireHostedOpsPageAccess();

  return <MemberUsageClient dashboard={await readHostedOpsMemberUsage()} />;
}
