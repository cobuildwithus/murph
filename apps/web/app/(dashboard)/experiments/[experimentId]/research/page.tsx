import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  ResearchTab,
  type ResearchTabExperiment,
} from "@/src/components/experiments/experiment-detail/research-tab";
import {
  resolveHealthCommonsExperimentResearchTab,
  type ExperimentResearchTabProjection,
} from "@/src/lib/health-commons/experiment-projections";
import { getHostedDashboardPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import {
  createMurphOgImageRef,
  createMurphPageMetadata,
} from "@/src/lib/site-metadata";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ experimentId: string }>;
}): Promise<Metadata> {
  const { experimentId } = await params;
  const research = resolveHealthCommonsExperimentResearchTab(experimentId);

  if (!research) {
    return {};
  }

  // Pass the parent experiment card through explicitly: createMurphPageMetadata
  // otherwise injects the site default, which overrides the parent segment's
  // file-convention image and unfurls the homepage card here.
  const ogImage = createMurphOgImageRef({
    alt: `${research.title}, a Murph experiment.`,
    url: `/experiments/${encodeURIComponent(experimentId)}/opengraph-image`,
  });

  return createMurphPageMetadata({
    title: `${research.title} research — Murph Experiments`,
    description: research.description,
    openGraph: {
      type: "article",
      images: [ogImage],
    },
    twitter: { images: [ogImage] },
  });
}

export default async function ExperimentResearchPage({
  params,
}: {
  params: Promise<{ experimentId: string }>;
}) {
  await getHostedDashboardPageAuthSnapshot();
  const { experimentId } = await params;
  const research = resolveHealthCommonsExperimentResearchTab(experimentId);

  if (!research) {
    notFound();
  }

  return <ResearchTab experiment={toResearchTabExperiment(research)} />;
}

function toResearchTabExperiment(
  research: ExperimentResearchTabProjection,
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
