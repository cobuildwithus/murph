import { getHostedDashboardPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";

import HistoryPageClient from "./history-page-client";

export default async function HistoryPage() {
  await getHostedDashboardPageAuthSnapshot();

  return <HistoryPageClient />;
}
