import { Suspense } from "react";
import type { Metadata } from "next";

import { FeatureHighlights } from "@/src/components/home/feature-highlights";
import { OnboardingSteps } from "@/src/components/home/onboarding-steps";
import { PageHeader } from "@/src/components/ui/page-header";
import {
  UploadLabsActionFallback,
  UploadLabsMurphContactAction,
} from "@/src/components/home/upload-labs-action";
import { hasActiveHostedDeviceSyncConnectionForMember } from "@/src/lib/device-sync/settings-service";
import type { HostedMemberCoreState } from "@/src/lib/hosted-onboarding/hosted-member-store";
import { getHostedPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";

export const metadata: Metadata = createMurphPageMetadata({
  title: "Home — Murph",
  description: "Your personal health dashboard.",
});

export default async function HomePage() {
  const auth = await getHostedPageAuthSnapshot();
  const devicesConnected = auth.authenticatedMember
    ? await resolveHomeDevicesConnected(auth.authenticatedMember)
    : false;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Live Well"
        title="Welcome to Murph"
        description="Sync your signals, pick an experiment, and see what actually makes you healthier."
      />

      <OnboardingSteps
        devicesConnected={devicesConnected}
        uploadLabsAction={
          <Suspense
            fallback={<UploadLabsActionFallback isPrimary={devicesConnected} />}
          >
            <UploadLabsMurphContactAction isPrimary={devicesConnected} />
          </Suspense>
        }
      />
      <FeatureHighlights />
    </div>
  );
}

export async function resolveHomeDevicesConnected(
  member: Pick<HostedMemberCoreState, "billingStatus" | "id" | "suspendedAt">,
): Promise<boolean> {
  try {
    return await hasActiveHostedDeviceSyncConnectionForMember({ member });
  } catch {
    return false;
  }
}
