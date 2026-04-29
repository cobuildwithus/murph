import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ProtocolTab } from "@/src/components/experiments/experiment-detail/protocol-tab";
import {
  resolveHealthCommonsExperimentProtocolTab,
  resolveHealthCommonsExperimentShell,
} from "@/src/lib/health-commons/experiment-projections";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ experimentId: string }>;
}): Promise<Metadata> {
  const { experimentId } = await params;
  const shell = resolveHealthCommonsExperimentShell(experimentId);

  if (!shell) {
    return {};
  }

  return createMurphPageMetadata({
    title: `${shell.title} — Murph Experiments`,
    description: shell.description,
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
  const protocolTab = resolveHealthCommonsExperimentProtocolTab(experimentId);

  if (!protocolTab) {
    notFound();
  }

  return (
    <ProtocolTab
      key={protocolTab.revision.pageRevisionId ?? protocolTab.id}
      experiment={protocolTab}
      researchHref={`/experiments/${protocolTab.id}/research`}
    />
  );
}
