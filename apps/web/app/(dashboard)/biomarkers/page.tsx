import { Suspense } from "react";
import type { Metadata } from "next";

import {
  UploadLabsActionFallback,
  UploadLabsMurphContactAction,
} from "@/src/components/home/upload-labs-action";
import { getGeneratedBiomarkerIndex } from "@/src/lib/health-commons/generated-biomarker-artifacts";
import { resolveHealthCommonsBiomarkerOverview } from "@/src/lib/health-commons/biomarker-projections";
import { getHostedDashboardPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";

import {
  BiomarkersPageClient,
  type DeviceTrackedBiomarker,
} from "./biomarkers-page-client";

export const metadata: Metadata = createMurphPageMetadata({
  title: "Your biomarkers — Murph",
  description:
    "See every biomarker in your lab history and follow how each result changes over time.",
});

function listDeviceTrackedBiomarkers(): DeviceTrackedBiomarker[] {
  return getGeneratedBiomarkerIndex()
    .biomarkers
    .filter((entry) => entry.published && !entry.hidden)
    .flatMap((entry) => {
      const overview = resolveHealthCommonsBiomarkerOverview(entry.routeId);
      if (!overview || overview.privateMetricBindings.length === 0) {
        return [];
      }

      return [{
        category: entry.categories[0] ?? null,
        privateMetricBindings: overview.privateMetricBindings,
        routeId: entry.routeId,
        shortName: overview.shortName,
        summary: entry.summary,
        unit: overview.unit,
        valuePrecision: overview.valuePrecision,
      } satisfies DeviceTrackedBiomarker];
    })
    .sort((left, right) => left.shortName.localeCompare(right.shortName));
}

export default async function BiomarkersPage() {
  const auth = await getHostedDashboardPageAuthSnapshot();

  return (
    <BiomarkersPageClient
      authenticated={auth.authenticated}
      deviceBiomarkers={listDeviceTrackedBiomarkers()}
      uploadLabsAction={
        <Suspense fallback={<UploadLabsActionFallback />}>
          <UploadLabsMurphContactAction />
        </Suspense>
      }
    />
  );
}
