import type { Metadata } from "next";

import { getHostedDashboardPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";
import { PrivateRunResultsClient } from "./private-run-results-client";

export const metadata: Metadata = createMurphPageMetadata({
  title: "Private experiment | Murph",
  description: "Review the private progress, measurements, and conclusions saved in your Murph vault.",
});

export default async function PrivateExperimentRunPage({
  params,
}: {
  params: Promise<{ experimentId: string }>;
}) {
  await getHostedDashboardPageAuthSnapshot();
  const { experimentId } = await params;

  return <PrivateRunResultsClient experimentId={experimentId} />;
}
