import { Suspense } from "react";
import type { Metadata } from "next";

import { DeviceSyncCompletionDialog } from "./device-sync-completion-dialog";

import { FeatureHighlights } from "@/src/components/home/feature-highlights";
import { BrowserVaultOnboardingSteps } from "@/src/components/home/browser-vault-onboarding-steps";
import { PageHeader } from "@/src/components/ui/page-header";
import {
  resolveHomeTrialBillingBannerVariant,
  TrialBillingBanner,
} from "@/src/components/home/trial-billing-banner";
import { UsageLimitBanner } from "@/src/components/home/usage-limit-banner";
import {
  UploadLabsActionFallback,
  UploadLabsMurphContactAction,
} from "@/src/components/home/upload-labs-action";
import {
  resolveDeviceSyncCompletionDialogModel,
  type DeviceSyncCompletionSearchParams,
} from "@/src/lib/device-sync/connect-completion";
import { shouldShowHomeDeviceSyncStep } from "@/src/lib/device-sync/home-onboarding";
import { listHealthCommonsExperimentBrowseProtocols } from "@/src/lib/health-commons/experiment-browse";
import { resolveHostedAiUsageGate } from "@/src/lib/hosted-execution/usage-allowance";
import { readHostedMemberStripeBillingRef } from "@/src/lib/hosted-onboarding/hosted-member-billing-store";
import { getHostedPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import { getPrisma } from "@/src/lib/prisma";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";

export const metadata: Metadata = createMurphPageMetadata({
  title: "Home — Murph",
  description: "Your personal health dashboard.",
});

export default async function HomePage({
  searchParams,
}: {
  searchParams?: Promise<DeviceSyncCompletionSearchParams>;
} = {}) {
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const auth = await getHostedPageAuthSnapshot();
  const prisma = getPrisma();
  const usageGateCheckedAt = new Date();
  const [showDeviceStep, usageGate, completionDialog, billingRef] = await Promise.all([
    shouldShowHomeDeviceSyncStep({
      member: auth.authenticatedMember,
    }),
    auth.authenticatedMember
      ? resolveHostedAiUsageGate({
          memberId: auth.authenticatedMember.id,
          now: usageGateCheckedAt,
          prisma,
        })
      : Promise.resolve(null),
    resolveDeviceSyncCompletionDialogModel({
      member: auth.authenticatedMember,
      searchParams: resolvedSearchParams,
    }),
    auth.authenticatedMember
      ? readHostedMemberStripeBillingRef({
          memberId: auth.authenticatedMember.id,
          prisma,
        })
      : Promise.resolve(null),
  ]);
  const usageLimitNotice =
    usageGate && !usageGate.allowed && usageGate.userNotice
      ? usageGate.userNotice
      : null;
  const usageLimitResetAt =
    usageLimitNotice
    && usageGate
    && !usageGate.allowed
    && usageGate.reason === "ai_usage_limit_exceeded"
    ? usageGate.retryAfter
    : null;
  const trialBillingBannerVariant = usageLimitNotice
    ? null
    : resolveHomeTrialBillingBannerVariant({
        billingRef,
        billingStatus: auth.authenticatedMember?.billingStatus,
        suspendedAt: auth.authenticatedMember?.suspendedAt,
      });

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Live Well"
        title="Welcome to Murph"
        description="Sync your signals, pick an experiment, and see what actually makes you healthier."
      />

      {completionDialog ? (
        <DeviceSyncCompletionDialog model={completionDialog} />
      ) : null}

      {usageLimitNotice ? (
        <UsageLimitBanner
          noticeCode={usageLimitNotice.code}
          now={usageGateCheckedAt}
          resetAt={usageLimitResetAt}
        />
      ) : null}

      {trialBillingBannerVariant ? (
        <TrialBillingBanner />
      ) : null}

      <BrowserVaultOnboardingSteps
        protocols={listHealthCommonsExperimentBrowseProtocols()}
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
