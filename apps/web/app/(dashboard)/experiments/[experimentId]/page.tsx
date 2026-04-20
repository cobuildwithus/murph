import { notFound } from "next/navigation";

import { resolveHealthCommonsExperimentProtocol } from "@/src/lib/health-commons/experiment-detail";
import { ExperimentDetailClient } from "./experiment-detail-client";

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

  return <ExperimentDetailClient protocol={protocol} />;
}
