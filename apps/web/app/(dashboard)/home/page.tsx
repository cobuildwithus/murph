import { Suspense } from "react";
import type { Metadata } from "next";

import { FeatureHighlights } from "@/src/components/home/feature-highlights";
import { OnboardingSteps } from "@/src/components/home/onboarding-steps";
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
      <div>
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Live Well
        </span>
        <h1 className="font-serif text-3xl font-semibold tracking-tight text-foreground">
          Welcome to Murph
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Connect your data, pick an experiment, and see what actually makes you
          healthier.
        </p>
      </div>

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
