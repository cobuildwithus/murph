import { getHostedDashboardPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";

import PatternsPageClient from "./patterns-page-client";

export default async function PatternsPage() {
  await getHostedDashboardPageAuthSnapshot();

  return <PatternsPageClient />;
}
