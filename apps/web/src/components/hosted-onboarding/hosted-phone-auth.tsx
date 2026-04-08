"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { HostedPrivyCompletionPayload } from "@/src/lib/hosted-onboarding/types";

import {
  HostedAuthenticatedPhoneAuthState,
  HostedPhoneAuthFlow,
} from "./hosted-phone-auth-views";
import { useHostedPhoneAuthController } from "./hosted-phone-auth-controller";

interface HostedPhoneAuthProps {
  inviteCode?: string | null;
  intent?: HostedPhoneAuthIntent;
  mode: "invite" | "public";
  onCompleted?: (payload: HostedPrivyCompletionPayload) => Promise<void> | void;
  onSignOut?: () => Promise<void> | void;
  phoneHint?: string | null;
}
type HostedPhoneAuthIntent = "signup" | "signin";

export function HostedPhoneAuth(props: HostedPhoneAuthProps) {
  return <HostedPhoneAuthInner {...props} />;
}

function HostedPhoneAuthInner({
  inviteCode,
  intent = "signup",
  mode,
  onCompleted,
  onSignOut,
}: HostedPhoneAuthProps) {
  const controller = useHostedPhoneAuthController({
    inviteCode,
    intent,
    mode,
    onCompleted,
    onSignOut,
  });

  return (
    <div className="space-y-4">
      {controller.errorMessage ? (
        <Alert variant="destructive">
          <AlertTitle>Unable to continue</AlertTitle>
          <AlertDescription>{controller.errorMessage}</AlertDescription>
        </Alert>
      ) : null}

      {controller.authenticatedView ? (
        <HostedAuthenticatedPhoneAuthState
          body={controller.authenticatedLoadingBody}
          description={controller.authenticatedSessionDescription}
          disabled={controller.flowDisabled}
          intent={controller.effectiveIntent}
          mode={mode}
          pendingAction={controller.pendingAction}
          title={controller.authenticatedLoadingTitle}
          view={controller.authenticatedView}
          onContinue={controller.handleContinueAuthenticated}
          onUseDifferentNumber={controller.handleLogout}
        />
      ) : (
        <HostedPhoneAuthFlow
          {...controller.sharedFlowProps}
          shortcutVisible={mode === "invite" && !controller.manualEntryVisible}
          onSendCode={controller.handleInviteSendCode}
          onUseDifferentNumber={() => {
            controller.resetPhoneAuthFlow(mode === "invite");
          }}
        />
      )}
    </div>
  );
}

export {
  createHostedPhoneVerificationAttempt,
  finalizeInvitePhoneCodeSendConfirmation,
  isHostedPhoneVerificationCodeComplete,
  normalizeHostedPhoneVerificationCode,
  resolveHostedPhoneResendTarget,
  resolveHostedPhoneSubmission,
  resolveHostedPrivyCompletionRedirectUrl,
  runHostedPrivyFinalizationAttempt,
} from "./hosted-phone-auth-support";
export { resolveHostedAuthenticatedPhoneAuthView } from "./hosted-phone-auth-controller";
