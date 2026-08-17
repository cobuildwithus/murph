import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ProtocolTab } from "@/src/components/experiments/experiment-detail/protocol-tab";
import { ResultsSummarySkeleton } from "@/src/components/experiments/experiment-detail/results-summary";
import {
  resolveHealthCommonsExperimentProtocolTab,
  resolveHealthCommonsExperimentResultsPublic,
  resolveHealthCommonsExperimentShell,
} from "@/src/lib/health-commons/experiment-projections";
import { getHostedDashboardPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import {
  createMurphPageMetadata,
  MURPH_INDEXABLE_PAGE_ROBOTS,
} from "@/src/lib/site-metadata";
import { ActiveRunSummaryClient } from "./active-run-summary-client";

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

  const ogImage = {
    alt: `${shell.title}, a Murph experiment.`,
    height: 630,
    type: "image/png",
    url: `/experiments/${encodeURIComponent(experimentId)}/opengraph-image`,
    width: 1200,
  } as const;

  return createMurphPageMetadata({
    alternates: {
      canonical: `/experiments/${encodeURIComponent(shell.id)}`,
    },
    title: `${shell.title} | Murph Experiments`,
    description: shell.description,
    openGraph: {
      images: [ogImage],
      type: "article",
    },
    twitter: {
      images: [ogImage],
    },
    robots: MURPH_INDEXABLE_PAGE_ROBOTS,
  });
}

export default async function ExperimentDetailPage({
  params,
}: {
  params: Promise<{ experimentId: string }>;
}) {
  await getHostedDashboardPageAuthSnapshot();
  const { experimentId } = await params;
  const protocolTab = resolveHealthCommonsExperimentProtocolTab(experimentId);

  if (!protocolTab) {
    notFound();
  }

  const resultsPublic = resolveHealthCommonsExperimentResultsPublic(experimentId);

  return (
    <div className="flex flex-col gap-10">
      {resultsPublic && (
        <Suspense fallback={<ResultsSummarySkeleton />}>
          <ActiveRunSummaryClient
            protocol={resultsPublic}
            protocolFacts={protocolTab.protocolFacts}
          />
        </Suspense>
      )}
      <ProtocolTab
        key={protocolTab.revision.pageRevisionId ?? protocolTab.id}
        experiment={protocolTab}
        researchHref={`/experiments/${protocolTab.id}/research`}
      />
    </div>
  );
}
