import type { Metadata } from "next";

import { PageHeader } from "@/src/components/ui/page-header";
import { getHostedDashboardPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";

import { RecordsConnectClient } from "./records-connect-client";

export const metadata: Metadata = createMurphPageMetadata({
  title: "Connect Epic | Murph",
  description: "Choose an Epic organization for a one-time medical records import.",
});

export default async function RecordsConnectPage() {
  const auth = await getHostedDashboardPageAuthSnapshot();

  return (
    <div className="flex w-full min-w-0 flex-col gap-8">
      <PageHeader
        eyebrow="Medical records"
        title="Connect Epic"
        description="Choose your Epic organization, then sign in on its website. Murph never receives your patient portal password."
      />
      <RecordsConnectClient authenticated={Boolean(auth.authenticatedMember)} />
    </div>
  );
}
