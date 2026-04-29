import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadGeneratedHealthCommonsWebExperimentResearchTab } from "@murphai/health-commons/runtime";

import {
  ResearchTab,
  type ResearchTabExperiment,
} from "@/src/components/experiments/experiment-detail/research-tab";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ experimentId: string }>;
}): Promise<Metadata> {
  const { experimentId } = await params;
  const research = loadGeneratedHealthCommonsWebExperimentResearchTab({
    routeId: experimentId,
  });

  if (!research) {
    return {};
  }

  return createMurphPageMetadata({
    title: `${research.title} research — Murph Experiments`,
    description: research.description,
    openGraph: {
      type: "article",
    },
  });
}

export default async function ExperimentResearchPage({
  params,
}: {
  params: Promise<{ experimentId: string }>;
}) {
  const { experimentId } = await params;
  const research = loadGeneratedHealthCommonsWebExperimentResearchTab({
    routeId: experimentId,
  });

  if (!research) {
    notFound();
  }

  return <ResearchTab experiment={toResearchTabExperiment(research)} />;
}

function toResearchTabExperiment(
  research: NonNullable<ReturnType<typeof loadGeneratedHealthCommonsWebExperimentResearchTab>>,
): ResearchTabExperiment {
  return {
    id: research.route.routeId,
    protocolKeepInMind: research.protocolKeepInMind,
    ...(research.researchGroups ? { researchGroups: research.researchGroups } : {}),
    ...(research.researchLandscape ? { researchLandscape: research.researchLandscape } : {}),
    researchStats: research.researchStats,
    studies: research.studies,
  };
}
