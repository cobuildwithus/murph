import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  resolveHealthCommonsExperimentResultsPublic,
  resolveHealthCommonsExperimentShell,
} from "@/src/lib/health-commons/experiment-projections";
import { getHostedDashboardPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import {
  createMurphOgImageRef,
  createMurphPageMetadata,
} from "@/src/lib/site-metadata";
import {
  ExperimentStartButtonFallback,
  HostedExperimentStartButton,
} from "../experiment-start-button-server";
import { ResultsTabClient } from "./results-tab-client";

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

  // Pass the parent experiment card through explicitly: createMurphPageMetadata
  // otherwise injects the site default, which overrides the parent segment's
  // file-convention image and unfurls the homepage card here.
  const ogImage = createMurphOgImageRef({
    alt: `${shell.title}, a Murph experiment.`,
    url: `/experiments/${encodeURIComponent(experimentId)}/opengraph-image`,
  });

  return createMurphPageMetadata({
    title: `${shell.title} results | Murph Experiments`,
    description: shell.description,
    openGraph: {
      type: "article",
      images: [ogImage],
    },
    twitter: { images: [ogImage] },
  });
}

export default async function ExperimentResultsPage({
  params,
}: {
  params: Promise<{ experimentId: string }>;
}) {
  await getHostedDashboardPageAuthSnapshot();
  const { experimentId } = await params;
  const protocol = resolveHealthCommonsExperimentResultsPublic(experimentId);

  if (!protocol) {
    notFound();
  }

  const protocolDays = Math.max(1, protocol.durationDays - protocol.baselineDays);

  return (
    <ResultsTabClient
      protocol={protocol}
      startAction={
        <Suspense
          fallback={(
            <ExperimentStartButtonFallback
              protocolDays={protocolDays}
              protocolTitle={protocol.title}
            />
          )}
        >
          <HostedExperimentStartButton
            protocolDays={protocolDays}
            protocolTitle={protocol.title}
          />
        </Suspense>
      }
    />
  );
}
