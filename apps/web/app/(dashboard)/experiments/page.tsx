import type { Metadata } from "next";

import { listHealthCommonsExperimentBrowseProtocols } from "@/src/lib/health-commons/experiment-browse";
import { getHostedDashboardPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";
import { ExperimentsPageClient } from "./experiments-page-client";

export const metadata: Metadata = createMurphPageMetadata({
  title: "Experiments — Murph",
  description:
    "Browse evidence-backed health experiments and compare what changes against your own baseline.",
});

export default async function ExperimentsPage() {
  await getHostedDashboardPageAuthSnapshot();
  const protocols = listHealthCommonsExperimentBrowseProtocols();

  return <ExperimentsPageClient protocols={protocols} />;
}
