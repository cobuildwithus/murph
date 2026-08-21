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

export default async function HostedOpsUsagePage({
  searchParams,
}: {
  searchParams: Promise<{
    after?: string | string[];
    before?: string | string[];
    q?: string | string[];
  }>;
}) {
  await getHostedDashboardPageAuthSnapshot();
  await requireHostedOpsPageAccess();
  const resolvedSearchParams = await searchParams;
  const after = readFirstSearchParam(resolvedSearchParams.after);
  const before = readFirstSearchParam(resolvedSearchParams.before);
  const search = readFirstSearchParam(resolvedSearchParams.q);

  return (
    <MemberUsageClient
      dashboard={await readHostedOpsMemberUsage({ after, before, search })}
    />
  );
}

function readFirstSearchParam(
  value: string | string[] | undefined,
): string | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}
