import { notFound } from "next/navigation";

import { resolveHealthCommonsExperimentDetail } from "@/src/lib/health-commons/experiment-detail";
import { ExperimentDetailClient } from "./experiment-detail-client";

export default async function ExperimentDetailPage({
  params,
}: {
  params: Promise<{ experimentId: string }>;
}) {
  const { experimentId } = await params;
  const experiment = resolveHealthCommonsExperimentDetail(experimentId);

  if (!experiment) {
    notFound();
  }

  return <ExperimentDetailClient experiment={experiment} />;
}
