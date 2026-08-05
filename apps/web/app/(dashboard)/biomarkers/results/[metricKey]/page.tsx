import { Suspense } from "react";
import type { Metadata } from "next";

import {
  LabBiomarkerChatAction,
  LabBiomarkerChatActionFallback,
} from "@/src/components/biomarkers/lab-biomarker-chat-action";
import {
  UploadLabsActionFallback,
  UploadLabsMurphContactAction,
} from "@/src/components/home/upload-labs-action";
import { getHostedDashboardPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";

import { LabBiomarkerDetailClient } from "./lab-biomarker-detail-client";
import { resolveLabBiomarkerContext } from "./lab-biomarker-context";

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
      fallbackRanges={context.fallbackRanges}
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
