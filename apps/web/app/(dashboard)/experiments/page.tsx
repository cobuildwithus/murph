import type { Metadata } from "next";

import { listHealthCommonsExperimentProtocols } from "@/src/lib/health-commons/experiment-detail";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";
import { ExperimentsPageClient } from "./experiments-page-client";

export const metadata: Metadata = createMurphPageMetadata({
  title: "Experiments — Murph",
  description:
    "Browse evidence-backed health experiments and compare what changes against your own baseline.",
});

export default function ExperimentsPage() {
  const protocols = listHealthCommonsExperimentProtocols();

  return <ExperimentsPageClient protocols={protocols} />;
}
