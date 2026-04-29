import type { ReactNode } from "react";
import { notFound } from "next/navigation";

import {
  listHealthCommonsExperimentRouteParams,
} from "@/src/lib/health-commons/experiment-browse";
import { resolveHealthCommonsExperimentShell } from "@/src/lib/health-commons/experiment-projections";
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
  const shell = resolveHealthCommonsExperimentShell(experimentId);

  if (!shell) {
    notFound();
  }

  return (
    <ExperimentLayoutClient
      key={shell.revision.pageRevisionId ?? shell.id}
      shell={shell}
    >
      {children}
    </ExperimentLayoutClient>
  );
}
