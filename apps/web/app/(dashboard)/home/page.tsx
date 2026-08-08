import { Suspense } from "react";
import type { Metadata } from "next";

import { DeviceSyncCompletionDialog } from "./device-sync-completion-dialog";
import { HomeInitialVisitPersonaPickerClient } from "./initial-visit-persona-picker-client";

import { FeatureHighlights } from "@/src/components/home/feature-highlights";
import { resolveHostedMurphContactOption } from "@/src/components/murph/hosted-murph-contact-action";
import { BrowserVaultOnboardingStepsContent } from "@/src/components/home/browser-vault-onboarding-steps";
import { HomeDataLoadAlert } from "@/src/components/home/home-data-load-alert";
import {
  MessageMurphActionFallback,
  MessageMurphContactAction,
} from "@/src/components/home/message-murph-action";
import { PageHeader } from "@/src/components/ui/page-header";
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
import { readHostedAiUsageGate } from "@/src/lib/hosted-execution/usage-allowance";
import { projectHostedPersonalAiUsageStatus } from "@/src/lib/hosted-execution/usage-status";
import { readHostedMemberMessagingSetupState } from "@/src/lib/hosted-onboarding/hosted-member-store";
import { readHostedInitialOnboardingState } from "@/src/lib/hosted-onboarding/initial-onboarding";
import { resolveHostedMemberMessagingState } from "@/src/lib/hosted-onboarding/messaging-state";
import { getHostedDashboardPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import { getPrisma } from "@/src/lib/prisma";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";

export const metadata: Metadata = createMurphPageMetadata({
  title: "Home — Murph",
  description: "Your personal health dashboard.",
});

type HomeSearchParams =
  & DeviceSyncCompletionSearchParams
  & ConnectedAppCompletionSearchParams;

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<HomeSearchParams>;
}) {
  const resolvedSearchParams = await searchParams;
  const auth = await getHostedDashboardPageAuthSnapshot();
  const member = auth.authenticatedMember;

  const prisma = getPrisma();
  const usageGateCheckedAt = new Date();
  const homeProjectionResults = await Promise.allSettled([
    shouldShowHomeDeviceSyncStep({
      member,
      prisma,
    }),
    member
      ? readHostedAiUsageGate({
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
    member
      ? (async () => {
          const state = await readHostedInitialOnboardingState({
            memberId: member.id,
            prisma,
          });
          return {
            contactAction: state.status === "pending"
              ? await resolveHomeInitialVisitContactAction()
              : null,
            state,
          };
        })()
      : Promise.resolve(null),
    member
      ? readHostedMemberMessagingSetupState({
          memberId: member.id,
          prisma,
        })
      : Promise.resolve(null),
  ]);
  const [
    showDeviceStepResult,
    usageGateResult,
    deviceSyncCompletionDialogResult,
    connectedAppCompletionDialogResult,
    initialVisitProjectionResult,
    messagingSetupStateResult,
  ] = homeProjectionResults;
  const showDeviceStep = readSettledValue(showDeviceStepResult, false);
  const usageGate = readSettledValue(usageGateResult, null);
  const deviceSyncCompletionDialog = readSettledValue(
    deviceSyncCompletionDialogResult,
    null,
  );
  const connectedAppCompletionDialog = readSettledValue(
    connectedAppCompletionDialogResult,
    null,
  );
  const initialVisitProjection = readSettledValue(
    initialVisitProjectionResult,
    null,
  );
  const messagingSetupState = readSettledValue(messagingSetupStateResult, null);
  // Telegram bots cannot open a conversation, so a member can finish signup
  // with a linked account Murph still cannot send to. Keep asking for that
  // first message until it arrives, since Murph cannot ask for it itself.
  const awaitingFirstMemberMessage = Boolean(
    messagingSetupState
    && !resolveHostedMemberMessagingState(messagingSetupState)
      .hasDirectMessagingChannel,
  );
  // Each marker uses its own query key, so only one model is non-null per
  // home load in normal use; device-sync wins the tiebreak if both fire.
  const completionDialog = deviceSyncCompletionDialog ?? connectedAppCompletionDialog;
  const shouldRenderInitialVisitPersonaPicker =
    completionDialog === null
    && initialVisitProjectionResult.status === "fulfilled"
    && initialVisitProjection?.state.status === "pending";
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
  const dependentProjectionResults = await Promise.allSettled([
    member && usageGate && usageLimitNotice
      ? projectHostedPersonalAiUsageStatus({
          decision: usageGate,
          memberId: member.id,
          now: usageGateCheckedAt,
          prisma,
        })
      : Promise.resolve(null),
  ]);
  const [projectedUsageStatusResult] = dependentProjectionResults;
  const projectedUsageStatus = readSettledValue(
    projectedUsageStatusResult,
    null,
  );
  const hasHomeDataLoadError =
    hasRejectedProjection(homeProjectionResults)
    || hasRejectedProjection(dependentProjectionResults);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Live Well"
        title="Welcome to Murph"
        description="Connect your health data, pick an experiment, and see what actually works for you."
      />

      {hasHomeDataLoadError ? <HomeDataLoadAlert /> : null}

      {completionDialog ? (
        <DeviceSyncCompletionDialog model={completionDialog} />
      ) : null}

      {shouldRenderInitialVisitPersonaPicker ? (
        <HomeInitialVisitPersonaPickerClient
          contactAction={initialVisitProjection.contactAction}
          initialPreferences={initialVisitProjection.state.preferences}
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

      <BrowserVaultOnboardingStepsContent
        protocols={listHealthCommonsExperimentBrowseProtocols()}
        messageMurphAction={
          awaitingFirstMemberMessage ? (
            <Suspense fallback={<MessageMurphActionFallback />}>
              <MessageMurphContactAction />
            </Suspense>
          ) : null
        }
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

function readSettledValue<T>(
  result: PromiseSettledResult<T>,
  fallback: T,
): T {
  return result.status === "fulfilled" ? result.value : fallback;
}

function hasRejectedProjection(
  results: readonly PromiseSettledResult<unknown>[],
): boolean {
  return results.some((result) => result.status === "rejected");
}

async function resolveHomeInitialVisitContactAction() {
  try {
    return await resolveHostedMurphContactOption({
      message: {
        body: "Hey Murph, do your thing",
        subject: "Hey Murph, do your thing",
      },
    });
  } catch {
    // Contact-card setup is optional. Canonical onboarding must remain usable
    // when its advisory contact projection is unavailable.
    console.warn("Home initial onboarding contact projection unavailable.");
    return null;
  }
}
