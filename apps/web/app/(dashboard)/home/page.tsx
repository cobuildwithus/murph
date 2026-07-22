import { Suspense } from "react";
import type { Metadata } from "next";

import { DeviceSyncCompletionDialog } from "./device-sync-completion-dialog";
import { HomeInitialVisitPersonaPickerClient } from "./initial-visit-persona-picker-client";

import { FeatureHighlights } from "@/src/components/home/feature-highlights";
import { resolveHostedMurphContactOption } from "@/src/components/murph/hosted-murph-contact-action";
import { BrowserVaultOnboardingStepsContent } from "@/src/components/home/browser-vault-onboarding-steps";
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
  type ConnectedAppCompletionSearchParams,
  resolveConnectedAppCompletionDialogModel,
} from "@/src/lib/connected-apps/connect-completion";
import {
  resolveDeviceSyncCompletionDialogModel,
  type DeviceSyncCompletionSearchParams,
} from "@/src/lib/device-sync/connect-completion";
import { shouldShowHomeDeviceSyncStep } from "@/src/lib/device-sync/home-onboarding";
import { listHealthCommonsExperimentBrowseProtocols } from "@/src/lib/health-commons/experiment-browse";
import { resolveHostedAiUsageGate } from "@/src/lib/hosted-execution/usage-allowance";
import { projectHostedPersonalAiUsageStatus } from "@/src/lib/hosted-execution/usage-status";
import { readHostedMemberBillingEligibilityState } from "@/src/lib/hosted-onboarding/hosted-member-billing-store";
import { getHostedDashboardPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import { getPrisma } from "@/src/lib/prisma";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";

export const metadata: Metadata = createMurphPageMetadata({
  title: "Home — Murph",
  description: "Your personal health dashboard.",
});

type HomeSearchParams =
  & DeviceSyncCompletionSearchParams
  & ConnectedAppCompletionSearchParams
  & {
    initialVisit?: string | string[] | undefined;
  };

export default async function HomePage({
  searchParams,
}: {
  searchParams?: Promise<HomeSearchParams>;
} = {}) {
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const showInitialVisitPersonaPicker =
    readFirstSearchParamValue(resolvedSearchParams.initialVisit) === "true";
  const auth = await getHostedDashboardPageAuthSnapshot();
  const member = auth.authenticatedMember;

  const prisma = getPrisma();
  const usageGateCheckedAt = new Date();
  const [
    showDeviceStep,
    usageGate,
    deviceSyncCompletionDialog,
    connectedAppCompletionDialog,
    showInitialVisitContactCard,
  ] = await Promise.all([
    shouldShowHomeDeviceSyncStep({
      member,
      prisma,
    }),
    member
      ? resolveHostedAiUsageGate({
          memberId: member.id,
          now: usageGateCheckedAt,
          prisma,
        })
      : Promise.resolve(null),
    resolveDeviceSyncCompletionDialogModel({
      member,
      searchParams: resolvedSearchParams,
    }),
    resolveConnectedAppCompletionDialogModel({
      member,
      searchParams: resolvedSearchParams,
    }),
    showInitialVisitPersonaPicker
      ? resolveHomeInitialVisitShowsContactCard()
      : Promise.resolve(false),
  ]);
  // Each marker uses its own query key, so only one model is non-null per
  // home load in normal use; device-sync wins the tiebreak if both fire.
  const completionDialog = deviceSyncCompletionDialog ?? connectedAppCompletionDialog;
  const usageLimitNotice =
    usageGate && "userNotice" in usageGate && usageGate.userNotice
      ? usageGate.userNotice
      : null;
  const usageLimitResetAt =
    usageLimitNotice
    && usageGate
    && "reason" in usageGate
    && usageGate.reason === "ai_usage_limit_exceeded"
    ? usageGate.retryAfter
    : null;
  const projectedUsageStatus = member && usageGate && usageLimitNotice
    ? await projectHostedPersonalAiUsageStatus({
        decision: usageGate,
        memberId: member.id,
        now: usageGateCheckedAt,
        prisma,
      })
    : null;
  const trialBillingState = !usageLimitNotice && member
    ? await readHostedMemberBillingEligibilityState({
        memberId: member.id,
        prisma,
      })
    : null;
  const trialBillingBannerVariant = usageLimitNotice
    ? null
    : resolveHomeTrialBillingBannerVariant({
        billingState: trialBillingState,
        billingStatus: member?.billingStatus,
        suspendedAt: member?.suspendedAt,
      });

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Live Well"
        title="Welcome to Murph"
        description="Connect your health data, pick an experiment, and see what actually works for you."
      />

      {completionDialog ? (
        <DeviceSyncCompletionDialog model={completionDialog} />
      ) : null}

      {showInitialVisitPersonaPicker ? (
        <HomeInitialVisitPersonaPickerClient
          showContactCard={showInitialVisitContactCard}
        />
      ) : null}

      {usageLimitNotice ? (
        <UsageLimitBanner
          noticeCode={usageLimitNotice.code}
          now={usageGateCheckedAt}
          recommendedAction={projectedUsageStatus?.recommendedAction ?? null}
          resetAt={usageLimitResetAt}
        />
      ) : null}

      {trialBillingBannerVariant ? (
        <TrialBillingBanner />
      ) : null}

      <BrowserVaultOnboardingStepsContent
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

function readFirstSearchParamValue(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

async function resolveHomeInitialVisitShowsContactCard(): Promise<boolean> {
  const option = await resolveHostedMurphContactOption({
    message: {
      body: "Hey Murph, do your thing",
      subject: "Hey Murph, do your thing",
    },
  });

  return option?.kind === "text";
}
