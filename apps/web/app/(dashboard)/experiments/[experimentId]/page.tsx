import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { resolveHealthCommonsExperimentProtocol } from "@/src/lib/health-commons/experiment-detail";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";
import { ExperimentDetailClient } from "./experiment-detail-client";

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
    title: `${protocol.title} — Murph Experiments`,
    description: protocol.description,
    openGraph: {
      type: "article",
    },
  });
}

export default async function ExperimentDetailPage({
  params,
}: {
  params: Promise<{ experimentId: string }>;
}) {
  const { experimentId } = await params;
  const protocol = resolveHealthCommonsExperimentProtocol(experimentId);

  if (!protocol) {
    notFound();
  }

  return (
    <ExperimentDetailClient
      key={protocol.commons?.pageRevisionId ?? protocol.id}
      protocol={protocol}
    />
  );
}
