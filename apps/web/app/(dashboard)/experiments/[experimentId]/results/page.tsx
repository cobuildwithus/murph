import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  resolveHealthCommonsExperimentResultsPublic,
  resolveHealthCommonsExperimentShell,
} from "@/src/lib/health-commons/experiment-projections";
import { getHostedDashboardPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";
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

  return createMurphPageMetadata({
    title: `${shell.title} results | Murph Experiments`,
    description: shell.description,
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
