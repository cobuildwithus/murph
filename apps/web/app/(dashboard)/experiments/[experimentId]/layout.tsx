import { Suspense, type ReactNode } from "react";
import { notFound } from "next/navigation";

import {
  listHealthCommonsExperimentRouteParams,
} from "@/src/lib/health-commons/experiment-browse";
import {
  resolveHealthCommonsExperimentResultsPublic,
  resolveHealthCommonsExperimentShell,
} from "@/src/lib/health-commons/experiment-projections";
import { ExperimentLayoutClient } from "./experiment-layout-client";
import {
  ExperimentStartButtonFallback,
  HostedExperimentStartButton,
} from "./experiment-start-button-server";

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

  const resultsPublic = resolveHealthCommonsExperimentResultsPublic(experimentId);
  const protocolDays = Math.max(1, shell.durationDays - shell.baselineDays);

  return (
    <ExperimentLayoutClient
      headerStartAction={
        <Suspense
          fallback={(
            <ExperimentStartButtonFallback
              protocolDays={protocolDays}
              protocolTitle={shell.title}
            />
          )}
        >
          <HostedExperimentStartButton
            activeRunProtocol={resultsPublic}
            protocolDays={protocolDays}
            protocolTitle={shell.title}
          />
        </Suspense>
      }
      key={shell.revision.pageRevisionId ?? shell.id}
      shell={shell}
    >
      {children}
    </ExperimentLayoutClient>
  );
}
