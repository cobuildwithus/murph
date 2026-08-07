import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";

import { PageHeader } from "@/src/components/ui/page-header";
import { getHostedDashboardPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";

import { RecordsConnectClient } from "./records-connect-client";

export const metadata: Metadata = createMurphPageMetadata({
  title: "Connect medical records | Murph",
  description: "Connect a supported patient portal to copy available lab results and report summaries into Murph.",
});

export default async function RecordsConnectPage({
  searchParams,
}: {
  searchParams: Promise<{ launch?: string | string[] }>;
}) {
  const auth = await getHostedDashboardPageAuthSnapshot();
  const resolvedSearchParams = await searchParams;
  const launch = Array.isArray(resolvedSearchParams.launch)
    ? resolvedSearchParams.launch[0]
    : resolvedSearchParams.launch;

  return (
    <div className="flex w-full min-w-0 flex-col gap-8">
      <div className="space-y-6">
        <Link
          href="/records"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
        >
          <ArrowLeftIcon aria-hidden="true" className="size-3.5" />
          Medical records
        </Link>
        <PageHeader
          eyebrow="Medical records"
          title="Connect medical records"
          description="Find a hospital or clinic Murph supports. You will sign in to its patient portal, then Murph will copy available lab results and report summaries once."
        />
      </div>
      <RecordsConnectClient
        authenticated={Boolean(auth.authenticatedMember)}
        launchConnectIntent={launch === "clinical-records"}
      />
    </div>
  );
}
