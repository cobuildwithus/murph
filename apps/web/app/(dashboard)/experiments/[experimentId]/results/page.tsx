import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  resolveHealthCommonsExperimentResultsPublic,
  resolveHealthCommonsExperimentShell,
} from "@/src/lib/health-commons/experiment-projections";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";
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
    title: `${shell.title} results — Murph Experiments`,
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
  const { experimentId } = await params;
  const protocol = resolveHealthCommonsExperimentResultsPublic(experimentId);

  if (!protocol) {
    notFound();
  }

  return <ResultsTabClient protocol={protocol} />;
}
