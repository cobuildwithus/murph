import type { Metadata } from "next";

import { GroupsWorkspacePrototype } from "@/src/components/hosted-groups/groups-workspace-prototype";
import { getHostedDashboardPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";

export const metadata: Metadata = {
  title: "Groups prototype | Murph",
};

export default async function GroupsPrototypePage() {
  await getHostedDashboardPageAuthSnapshot();

  return <GroupsWorkspacePrototype />;
}
