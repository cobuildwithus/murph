import { Suspense } from "react";
import type { Metadata } from "next";

import {
  UploadLabsActionFallback,
  UploadLabsMurphContactAction,
} from "@/src/components/home/upload-labs-action";
import { getHostedDashboardPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";

import { BiomarkersPageClient } from "./biomarkers-page-client";

export const metadata: Metadata = createMurphPageMetadata({
  title: "Your biomarkers — Murph",
  description:
    "See every biomarker in your lab history and follow how each result changes over time.",
});

export default async function BiomarkersPage() {
  const auth = await getHostedDashboardPageAuthSnapshot();

  return (
    <BiomarkersPageClient
      authenticated={auth.authenticated}
      uploadLabsAction={
        <Suspense fallback={<UploadLabsActionFallback />}>
          <UploadLabsMurphContactAction />
        </Suspense>
      }
    />
  );
}
