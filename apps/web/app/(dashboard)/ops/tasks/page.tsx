import type { Metadata } from "next";

import { requireHostedOpsPageAccess } from "@/src/lib/hosted-ops/access";
import { listHostedOperatorTasks } from "@/src/lib/hosted-ops/operator-task";
import { getHostedDashboardPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";

import { OperatorTasksClient } from "./operator-tasks-client";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "Murph tasks - Ops",
};

export default async function HostedOperatorTasksPage() {
  await getHostedDashboardPageAuthSnapshot();
  const session = await requireHostedOpsPageAccess();
  const tasks = await listHostedOperatorTasks({
    requestedByMemberId: session.member.id,
  });
  return <OperatorTasksClient initialTasks={tasks} />;
}
