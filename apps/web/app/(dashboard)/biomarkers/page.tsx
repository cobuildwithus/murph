import { Suspense } from "react";
import type { Metadata } from "next";

import {
  UploadLabsActionFallback,
  UploadLabsMurphContactAction,
} from "@/src/components/home/upload-labs-action";
import { shouldShowHomeDeviceSyncStep } from "@/src/lib/device-sync/home-onboarding";
import { getGeneratedBiomarkerIndex } from "@/src/lib/health-commons/generated-biomarker-artifacts";
import { getHostedDashboardPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";

import {
  BiomarkersPageClient,
  type BiomarkerBrowseEntry,
} from "./biomarkers-page-client";

export const metadata: Metadata = createMurphPageMetadata({
  title: "Biomarkers — Murph",
  description:
    "Browse the biomarker library. Track and understand the signals that move your health, then run experiments to see what changes.",
});

export default async function BiomarkersPage() {
  const auth = await getHostedDashboardPageAuthSnapshot();
  const index = getGeneratedBiomarkerIndex();
  const biomarkers: BiomarkerBrowseEntry[] = index.biomarkers
    .filter((entry) => entry.published && !entry.hidden)
    .map((entry) => ({
      key: entry.key,
      routeId: entry.routeId,
      title: entry.title,
      shortName: entry.shortName,
      summary: entry.summary,
      unit: entry.unit,
      categories: entry.categories,
      aliases: entry.aliases,
    }))
    .sort((a, b) => a.title.localeCompare(b.title));

  const showDeviceStep = await shouldShowHomeDeviceSyncStep({
    member: auth.authenticatedMember,
  });

  return (
    <BiomarkersPageClient
      biomarkers={biomarkers}
      showDeviceStep={showDeviceStep}
      uploadLabsAction={
        <Suspense fallback={<UploadLabsActionFallback />}>
          <UploadLabsMurphContactAction />
        </Suspense>
      }
    />
  );
}
