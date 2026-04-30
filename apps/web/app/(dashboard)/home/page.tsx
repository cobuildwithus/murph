import { Suspense } from "react";
import type { Metadata } from "next";

import { FeatureHighlights } from "@/src/components/home/feature-highlights";
import { OnboardingSteps } from "@/src/components/home/onboarding-steps";
import { PageHeader } from "@/src/components/ui/page-header";
import {
  UploadLabsActionFallback,
  UploadLabsMurphContactAction,
} from "@/src/components/home/upload-labs-action";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";

export const metadata: Metadata = createMurphPageMetadata({
  title: "Home — Murph",
  description: "Your personal health dashboard.",
});

export default function HomePage() {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Live Well"
        title="Welcome to Murph"
        description="Connect your data, pick an experiment, and see what actually makes you healthier."
      />

      <OnboardingSteps
        uploadLabsAction={
          <Suspense fallback={<UploadLabsActionFallback />}>
            <UploadLabsMurphContactAction />
          </Suspense>
        }
      />
      <FeatureHighlights />
    </div>
  );
}
