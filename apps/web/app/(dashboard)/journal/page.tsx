import { getHostedDashboardPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import { resolveHostedMurphContactOptions } from "@/src/components/murph/hosted-murph-contact-action";

import JournalPageClient from "./journal-page-client";

export default async function JournalPage() {
  await getHostedDashboardPageAuthSnapshot();
  const contactOptions = await resolveJournalContactOptions();
  return <JournalPageClient contactOptions={contactOptions} />;
}

async function resolveJournalContactOptions() {
  try {
    const options = await resolveHostedMurphContactOptions();
    return options.filter(
      (option) => option.kind === "text" || option.kind === "telegram",
    );
  } catch {
    return [];
  }
}
