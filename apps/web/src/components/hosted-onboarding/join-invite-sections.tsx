import { Alert, AlertDescription, AlertTitle } from "@/src/components/ui/alert";
import type { HostedSharePreview } from "@/src/lib/hosted-share/service";
import { isHostedOnboardingAccessibleStage } from "@/src/lib/hosted-onboarding/stage";
import type { HostedInviteStatusPayload, HostedPrivyCompletionPayload } from "@/src/lib/hosted-onboarding/types";
import type { PrivyLinkedAccountLike } from "@/src/lib/hosted-onboarding/privy-shared";

import {
  formatHostedSharePreviewSummary,
} from "../hosted-share/hosted-share-preview";
import type { JoinInviteShareImportState } from "./join-invite-state";
import {
  JoinInviteActivePanel,
  JoinInviteCheckoutPanel,
  JoinInviteMessagingSetupPanel,
  JoinInviteSignedInMismatchAlert,
  JoinInviteVerificationPanel,
} from "./join-invite-stage-panels";
import { describeHostedSharePreview } from "../hosted-share/hosted-share-preview";

interface JoinInviteSharePreviewAlertProps {
  sharePreview: HostedSharePreview;
}

interface JoinInviteStageContentProps {
  awaitingInviteSessionResolution: boolean;
  billingPlanCode: HostedInviteStatusPayload["billing"]["defaultPlanCode"];
  checkoutPending: boolean;
  initialLinkedAccounts: readonly PrivyLinkedAccountLike[];
  inviteCode: string;
  pendingAction: "checkout" | "share" | null;
  shareImportState: JoinInviteShareImportState;
  sharePreview: HostedSharePreview | null;
  status: HostedInviteStatusPayload;
  statusRefreshErrorMessage: string | null;
  statusRefreshRetryPending: boolean;
  onAcceptShare: () => Promise<void>;
  onCheckout: () => Promise<void>;
  onSelectBillingPlan: (
    billingPlanCode: NonNullable<HostedInviteStatusPayload["billing"]["defaultPlanCode"]>,
  ) => void;
  onPhoneVerified: (payload: HostedPrivyCompletionPayload) => Promise<void>;
  onRefreshStatus: () => Promise<HostedInviteStatusPayload>;
  onRetryStatusRefresh: () => Promise<void>;
  onSignOut: () => Promise<void>;
}

export function JoinInviteSharePreviewAlert({ sharePreview }: JoinInviteSharePreviewAlertProps) {
  const sharePreviewSummary = formatHostedSharePreviewSummary(sharePreview);

  return (
    <Alert className="border-green-200 bg-green-50 text-green-800">
      <AlertTitle>Add after signup: {describeHostedSharePreview(sharePreview)}</AlertTitle>
      {sharePreviewSummary ? (
        <AlertDescription className="text-green-700">
          {sharePreviewSummary}
        </AlertDescription>
      ) : null}
      {sharePreview.logMealAfterImport ? (
        <AlertDescription className="text-green-700">
          Murph will also log the shared food after import.
        </AlertDescription>
      ) : null}
    </Alert>
  );
}

export function JoinInviteStageContent({
  awaitingInviteSessionResolution,
  billingPlanCode,
  checkoutPending,
  initialLinkedAccounts,
  inviteCode,
  pendingAction,
  shareImportState,
  sharePreview,
  status,
  statusRefreshErrorMessage,
  statusRefreshRetryPending,
  onAcceptShare,
  onCheckout,
  onSelectBillingPlan,
  onPhoneVerified,
  onRefreshStatus,
  onRetryStatusRefresh,
  onSignOut,
}: JoinInviteStageContentProps) {
  return (
    <>
      {status.session.authenticated && !status.session.matchesInvite ? (
        <JoinInviteSignedInMismatchAlert onSignOut={onSignOut} />
      ) : null}

      {status.stage === "verify" ? (
        <JoinInviteVerificationPanel
          awaitingInviteSessionResolution={awaitingInviteSessionResolution}
          inviteCode={inviteCode}
          phoneAuthTarget={status.invite?.phoneAuthTarget ?? null}
          phoneHint={status.invite?.phoneHint ?? null}
          statusRefreshErrorMessage={statusRefreshErrorMessage}
          statusRefreshRetryPending={statusRefreshRetryPending}
          onPhoneVerified={onPhoneVerified}
          onRefreshStatus={onRefreshStatus}
          onRetryStatusRefresh={onRetryStatusRefresh}
        />
      ) : null}

      {status.stage === "blocked" ? (
        <div className="text-sm leading-relaxed text-muted-foreground">
          Email{" "}
          <a href="mailto:support@withmurph.ai" className="font-semibold text-olive underline-offset-4 hover:underline">
            support@withmurph.ai
          </a>{" "}
          to restore access.
        </div>
      ) : null}

      {status.stage === "checkout" && status.messagingSetupRequired ? (
        <JoinInviteMessagingSetupPanel
          authenticated={status.session.authenticated}
          initialLinkedAccounts={initialLinkedAccounts}
          onRefreshStatus={onRefreshStatus}
        />
      ) : null}

      {status.stage === "checkout" && !status.messagingSetupRequired ? (
        <JoinInviteCheckoutPanel
          billingReady={status.capabilities.billingReady}
          billingPlanCode={billingPlanCode}
          billingPlans={status.billing.plans}
          checkoutPending={checkoutPending}
          onCheckout={onCheckout}
          onSelectBillingPlan={onSelectBillingPlan}
        />
      ) : null}

      {isHostedOnboardingAccessibleStage(status.stage) ? (
        <JoinInviteActivePanel
          murphPhoneNumber={status.murphPhoneNumber ?? null}
          pendingAction={pendingAction}
          shareImportState={shareImportState}
          sharePreview={sharePreview}
          stage={status.stage}
          onAcceptShare={onAcceptShare}
        />
      ) : null}
    </>
  );
}
