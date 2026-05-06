import { Suspense } from "react";
import type { Metadata } from "next";

import { FeatureHighlights } from "@/src/components/home/feature-highlights";
import { OnboardingSteps } from "@/src/components/home/onboarding-steps";
import { PageHeader } from "@/src/components/ui/page-header";
import { UsageLimitBanner } from "@/src/components/home/usage-limit-banner";
import {
  UploadLabsActionFallback,
  UploadLabsMurphContactAction,
} from "@/src/components/home/upload-labs-action";
import { shouldShowHomeDeviceSyncStep } from "@/src/lib/device-sync/home-onboarding";
import { resolveHostedAiUsageGate } from "@/src/lib/hosted-execution/usage-allowance";
import { getHostedPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import { getPrisma } from "@/src/lib/prisma";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";

export const metadata: Metadata = createMurphPageMetadata({
  title: "Home — Murph",
  description: "Your personal health dashboard.",
});

export default async function HomePage() {
  const auth = await getHostedPageAuthSnapshot();
  const [showDeviceStep, usageGate] = await Promise.all([
    shouldShowHomeDeviceSyncStep({
      member: auth.authenticatedMember,
    }),
    auth.authenticatedMember
      ? resolveHostedAiUsageGate({
          memberId: auth.authenticatedMember.id,
          prisma: getPrisma(),
        })
      : Promise.resolve(null),
  ]);
  const usageLimitNotice =
    usageGate && !usageGate.allowed && usageGate.reason === "ai_usage_limit_exceeded"
    && usageGate.userNotice
      ? usageGate.userNotice
      : null;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Live Well"
        title="Welcome to Murph"
        description="Sync your signals, pick an experiment, and see what actually makes you healthier."
      />

      {usageLimitNotice ? (
        <UsageLimitBanner noticeCode={usageLimitNotice.code} />
      ) : null}

      <OnboardingSteps
        showDeviceStep={showDeviceStep}
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
