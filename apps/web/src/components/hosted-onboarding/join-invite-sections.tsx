import { isHostedOnboardingAccessibleStage } from "@/src/lib/hosted-onboarding/stage";
import type { HostedInviteStatusPayload, HostedPrivyCompletionPayload } from "@/src/lib/hosted-onboarding/types";
import type { PrivyLinkedAccountLike } from "@/src/lib/hosted-onboarding/privy-shared";

import {
  JoinInviteActivePanel,
  JoinInviteCheckoutPanel,
  JoinInviteMessagingSetupPanel,
  JoinInviteSignedInMismatchAlert,
  JoinInviteVerificationPanel,
} from "./join-invite-stage-panels";

interface JoinInviteStageContentProps {
  awaitingInviteSessionResolution: boolean;
  billingPlanCode: HostedInviteStatusPayload["billing"]["defaultPlanCode"];
  initialLinkedAccounts: readonly PrivyLinkedAccountLike[];
  inviteCode: string;
  status: HostedInviteStatusPayload;
  statusRefreshErrorMessage: string | null;
  statusRefreshRetryPending: boolean;
  onCheckout: (
    billingPlanCode?: HostedInviteStatusPayload["billing"]["defaultPlanCode"],
  ) => Promise<void>;
  onCheckoutSuccess: () => void;
  onCheckoutError: (error: unknown) => void;
  onSelectBillingPlan: (
    billingPlanCode: NonNullable<HostedInviteStatusPayload["billing"]["defaultPlanCode"]>,
  ) => void;
  onPhoneVerified: (payload: HostedPrivyCompletionPayload) => Promise<void>;
  onRefreshStatus: () => Promise<HostedInviteStatusPayload>;
  onRetryStatusRefresh: () => Promise<void>;
  onSignOut: () => Promise<void>;
}

export function JoinInviteStageContent({
  awaitingInviteSessionResolution,
  billingPlanCode,
  initialLinkedAccounts,
  inviteCode,
  status,
  statusRefreshErrorMessage,
  statusRefreshRetryPending,
  onCheckout,
  onCheckoutSuccess,
  onCheckoutError,
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
          onCheckout={onCheckout}
          onCheckoutSuccess={onCheckoutSuccess}
          onCheckoutError={onCheckoutError}
          onSelectBillingPlan={onSelectBillingPlan}
        />
      ) : null}

      {isHostedOnboardingAccessibleStage(status.stage) ? (
        <JoinInviteActivePanel
          murphPhoneNumber={status.murphPhoneNumber ?? null}
          stage={status.stage}
        />
      ) : null}
    </>
  );
}
