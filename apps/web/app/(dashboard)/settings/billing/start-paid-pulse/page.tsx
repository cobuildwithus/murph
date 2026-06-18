import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { HostedStartPaidPulseFinishAction } from "@/src/components/settings/hosted-start-paid-pulse-finish-action";
import { PageHeader } from "@/src/components/ui/page-header";
import { getHostedPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";

export const metadata: Metadata = createMurphPageMetadata({
  title: "Start Pulse — Murph",
  description: "Finish starting your Pulse subscription.",
});

export default async function StartPaidPulseReturnPage() {
  const { authenticated } = await getHostedPageAuthSnapshot();

  if (!authenticated) {
    redirect("/");
  }

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <PageHeader
        eyebrow="Billing"
        title="Start Pulse"
        description="Finish billing setup to begin Pulse."
      />
      <HostedStartPaidPulseFinishAction />
    </div>
  );
}

