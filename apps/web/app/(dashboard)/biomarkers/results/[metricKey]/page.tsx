import { Suspense } from "react";
import type { Metadata } from "next";
import {
  resolveHealthCommonsBiomarkerEntityKey,
} from "@murphai/health-commons/biomarker-entity-mappings";
import { resolveLabResultMetricDefinition } from "@murphai/health-metrics";

import {
  LabBiomarkerChatAction,
  LabBiomarkerChatActionFallback,
} from "@/src/components/biomarkers/lab-biomarker-chat-action";
import {
  UploadLabsActionFallback,
  UploadLabsMurphContactAction,
} from "@/src/components/home/upload-labs-action";
import { getHostedDashboardPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import { getGeneratedBiomarkerIndex } from "@/src/lib/health-commons/generated-biomarker-artifacts";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";

import { LabBiomarkerDetailClient } from "./lab-biomarker-detail-client";

export const metadata: Metadata = createMurphPageMetadata({
  title: "Biomarker history — Murph",
  description: "Review how one of your lab biomarkers has changed over time.",
});

export default async function LabBiomarkerResultPage({
  params,
}: {
  params: Promise<{ metricKey: string }>;
}) {
  const { metricKey } = await params;
  const auth = await getHostedDashboardPageAuthSnapshot();
  const context = resolveLabBiomarkerContext(metricKey);

  return (
    <LabBiomarkerDetailClient
      authenticated={auth.authenticated}
      chatAction={
        <Suspense fallback={<LabBiomarkerChatActionFallback />}>
          <LabBiomarkerChatAction
            authenticated={auth.authenticated}
            displayName={context.displayName}
          />
        </Suspense>
      }
      metricKey={metricKey}
      summary={context.summary}
      uploadLabsAction={
        <Suspense fallback={<UploadLabsActionFallback />}>
          <UploadLabsMurphContactAction />
        </Suspense>
      }
    />
  );
}

export function resolveLabBiomarkerContext(metricKey: string): {
  displayName: string;
  summary: string | null;
} {
  const normalizedMetricKey = metricKey.trim().toLowerCase();
  const definition = resolveLabResultMetricDefinition(normalizedMetricKey);
  const entityKeys = new Set([
    definition?.biomarkerKey,
    ...(definition?.biomarkerAliases ?? []),
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => resolveHealthCommonsBiomarkerEntityKey(value)));
  const entry = getGeneratedBiomarkerIndex().biomarkers.find((candidate) =>
    entityKeys.has(candidate.key)
      || candidate.routeId === normalizedMetricKey
      || candidate.aliases.includes(normalizedMetricKey)
  );

  return {
    displayName: definition?.displayName
      ?? entry?.shortName
      ?? entry?.title
      ?? normalizedMetricKey.replaceAll("-", " "),
    summary: entry?.summary ?? null,
  };
}
