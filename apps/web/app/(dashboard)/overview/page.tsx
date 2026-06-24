import { getHostedDashboardPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";

import OverviewPageClient from "./overview-page-client";

export default async function OverviewPage() {
  await getHostedDashboardPageAuthSnapshot();

  return <OverviewPageClient />;
}
