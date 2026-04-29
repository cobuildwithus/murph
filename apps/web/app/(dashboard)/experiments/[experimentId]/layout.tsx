import type { ReactNode } from "react";
import { notFound } from "next/navigation";

import { getPrisma } from "@/src/lib/prisma";
import { getHostedPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import { readHostedMemberRoutingState } from "@/src/lib/hosted-onboarding/hosted-member-routing-store";
import { resolveExperimentStartContactChannels } from "@/src/lib/experiments/start-experiment-contact";
import { resolveHealthCommonsExperimentProtocol } from "@/src/lib/health-commons/experiment-detail";
import { ExperimentLayoutClient } from "./experiment-layout-client";

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

  const authSnapshot = await getHostedPageAuthSnapshot();
  const routing = authSnapshot.authenticatedMember
    ? await readHostedMemberRoutingState({
      memberId: authSnapshot.authenticatedMember.id,
      prisma: getPrisma(),
    })
    : null;

  return (
    <ExperimentLayoutClient
      initialContactChannels={resolveExperimentStartContactChannels({
        linkedAccounts: authSnapshot.linkedAccounts,
      })}
      key={protocol.commons?.pageRevisionId ?? protocol.id}
      murphPhoneNumber={routing?.linqRecipientPhone ?? null}
      protocol={protocol}
    >
      {children}
    </ExperimentLayoutClient>
  );
}
