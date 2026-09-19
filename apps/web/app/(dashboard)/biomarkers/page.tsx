import { Suspense } from "react";
import type { Metadata } from "next";

import {
  UploadLabsActionFallback,
  UploadLabsMurphContactAction,
} from "@/src/components/home/upload-labs-action";
import { getGeneratedBiomarkerIndex } from "@/src/lib/health-commons/generated-biomarker-artifacts";
import { cleanHealthCommonsUserFacingCopy } from "@/src/lib/health-commons/user-facing-copy";
import { getHostedDashboardPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";

import {
  BiomarkersPageClient,
  type DeviceTrackedBiomarker,
} from "./biomarkers-page-client";

export const metadata: Metadata = createMurphPageMetadata({
  title: "Your biomarkers — Murph",
  description:
    "See recognized biomarkers from your devices and saved lab results, organized for private longitudinal review.",
});

function listDeviceTrackedBiomarkers(): DeviceTrackedBiomarker[] {
  return getGeneratedBiomarkerIndex()
    .biomarkers
    .filter((entry) => entry.published && !entry.hidden && entry.privateMetricBindings.length > 0)
    .map((entry) => ({
      category: entry.categories[0] ?? null,
      privateMetricBindings: entry.privateMetricBindings,
      routeId: entry.routeId,
      shortName: cleanHealthCommonsUserFacingCopy(entry.shortName),
      summary: entry.summary,
      unit: cleanHealthCommonsUserFacingCopy(entry.unit ?? "value"),
      valuePrecision: entry.valuePrecision,
    } satisfies DeviceTrackedBiomarker))
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
