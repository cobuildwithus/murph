import type { ReactNode } from "react";
import { notFound } from "next/navigation";

import {
  listHealthCommonsExperimentRouteParams,
  resolveHealthCommonsExperimentProtocol,
} from "@/src/lib/health-commons/experiment-detail";
import { ExperimentLayoutClient } from "./experiment-layout-client";

export function generateStaticParams() {
  return listHealthCommonsExperimentRouteParams();
}

export default async function ExperimentDetailLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ experimentId: string }>;
}) {
  const { experimentId } = await params;
  const protocol = resolveHealthCommonsExperimentProtocol(experimentId);

  if (!protocol) {
    notFound();
  }

  return (
    <ExperimentLayoutClient
      key={protocol.commons?.pageRevisionId ?? protocol.id}
      protocol={protocol}
    >
      {children}
    </ExperimentLayoutClient>
  );
}
