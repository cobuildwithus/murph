import type { Metadata } from "next";

import { LinkPageFrame } from "@/src/components/link-page/link-page-shell";
import { getHostedDashboardPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import {
  createMurphPageMetadata,
  MURPH_NOINDEX_PAGE_ROBOTS,
} from "@/src/lib/site-metadata";

import { RecordsConnectClient } from "./records-connect-client";

export const metadata: Metadata = {
  ...createMurphPageMetadata({
    title: "Connect medical records | Murph",
    description: "Connect a supported patient portal to copy available lab results and report summaries into Murph.",
  }),
  robots: MURPH_NOINDEX_PAGE_ROBOTS,
};

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
    <LinkPageFrame>
      <RecordsConnectClient
        authenticated={Boolean(auth.authenticatedMember)}
        launchConnectIntent={launch === "clinical-records"}
      />
    </LinkPageFrame>
  );
}
