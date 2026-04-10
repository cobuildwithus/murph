import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { HostedSharePreview } from "@/src/lib/hosted-share/service";
import type { HostedInviteStatusPayload, HostedPrivyCompletionPayload } from "@/src/lib/hosted-onboarding/types";

import {
  formatHostedSharePreviewSummary,
} from "../hosted-share/hosted-share-preview";
import type { JoinInviteShareImportState } from "./join-invite-state";
import {
  JoinInviteActivePanel,
  JoinInviteActivatingPanel,
  JoinInviteBlockedAlert,
  JoinInviteCheckoutButton,
  JoinInviteSignedInMismatchAlert,
  JoinInviteVerificationPanel,
} from "./join-invite-stage-panels";
import { describeHostedSharePreview } from "../hosted-share/hosted-share-preview";

interface JoinInviteSharePreviewAlertProps {
  sharePreview: HostedSharePreview;
}

interface JoinInviteStageContentProps {
  awaitingInviteSessionResolution: boolean;
  inviteCode: string;
  pendingAction: "checkout" | "share" | null;
  shareImportState: JoinInviteShareImportState;
  sharePreview: HostedSharePreview | null;
  status: HostedInviteStatusPayload;
  statusRefreshErrorMessage: string | null;
  statusRefreshRetryPending: boolean;
  onAcceptShare: () => Promise<void>;
  onCheckout: () => Promise<void>;
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
  inviteCode,
  pendingAction,
  shareImportState,
  sharePreview,
  status,
  statusRefreshErrorMessage,
  statusRefreshRetryPending,
  onAcceptShare,
  onCheckout,
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
          statusRefreshErrorMessage={statusRefreshErrorMessage}
          statusRefreshRetryPending={statusRefreshRetryPending}
          onPhoneVerified={onPhoneVerified}
          onRefreshStatus={onRefreshStatus}
          onRetryStatusRefresh={onRetryStatusRefresh}
        />
      ) : null}

      {status.stage === "blocked" ? <JoinInviteBlockedAlert /> : null}

      {status.stage === "checkout" ? (
        <JoinInviteCheckoutButton
          billingReady={status.capabilities.billingReady}
          pendingAction={pendingAction}
          onCheckout={onCheckout}
        />
      ) : null}

      {status.stage === "activating" ? <JoinInviteActivatingPanel sharePreview={sharePreview} /> : null}

      {status.stage === "active" ? (
        <JoinInviteActivePanel
          pendingAction={pendingAction}
          shareImportState={shareImportState}
          sharePreview={sharePreview}
          onAcceptShare={onAcceptShare}
        />
      ) : null}
    </>
  );
}
