import { Suspense } from "react";
import type { Metadata } from "next";

import {
  UploadLabsActionFallback,
  UploadLabsMurphContactAction,
} from "@/src/components/home/upload-labs-action";
import { getHostedDashboardPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
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

  return (
    <LabBiomarkerDetailClient
      authenticated={auth.authenticated}
      metricKey={metricKey}
      uploadLabsAction={
        <Suspense fallback={<UploadLabsActionFallback />}>
          <UploadLabsMurphContactAction />
        </Suspense>
      }
    />
  );
}
