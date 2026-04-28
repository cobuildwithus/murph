import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { resolveHealthCommonsExperimentProtocol } from "@/src/lib/health-commons/experiment-detail";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";
import { ResultsTabClient } from "./results-tab-client";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ experimentId: string }>;
}): Promise<Metadata> {
  const { experimentId } = await params;
  const protocol = resolveHealthCommonsExperimentProtocol(experimentId);

  if (!protocol) {
    return {};
  }

  return createMurphPageMetadata({
    title: `${protocol.title} results — Murph Experiments`,
    description: protocol.description,
    openGraph: {
      type: "article",
    },
  });
}

export default async function ExperimentResultsPage({
  params,
}: {
  params: Promise<{ experimentId: string }>;
}) {
  const { experimentId } = await params;
  const protocol = resolveHealthCommonsExperimentProtocol(experimentId);

  if (!protocol) {
    notFound();
  }

  return <ResultsTabClient protocol={protocol} />;
}
