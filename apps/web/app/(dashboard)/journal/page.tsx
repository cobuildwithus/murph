import { getHostedDashboardPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";

import JournalPageClient from "./journal-page-client";

export default async function JournalPage() {
  await getHostedDashboardPageAuthSnapshot();
  return <JournalPageClient />;
}
