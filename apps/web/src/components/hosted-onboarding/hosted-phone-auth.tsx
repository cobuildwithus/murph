"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { HostedPrivyCompletionPayload } from "@/src/lib/hosted-onboarding/types";

import {
  HostedAuthenticatedPhoneAuthState,
  HostedPhoneAuthFlow,
} from "./hosted-phone-auth-views";
import { useHostedPhoneAuthController } from "./hosted-phone-auth-controller";
import { HostedPrivyProvider } from "./privy-provider";

interface HostedPhoneAuthProps {
  inviteCode?: string | null;
  intent?: HostedPhoneAuthIntent;
  mode: "invite" | "public";
  onCompleted?: (payload: HostedPrivyCompletionPayload) => Promise<void> | void;
  onSignOut?: () => Promise<void> | void;
  phoneHint?: string | null;
  privyAppId: string;
  privyClientId?: string | null;
  wrapProvider?: boolean;
}
type HostedPhoneAuthIntent = "signup" | "signin";

export function HostedPhoneAuth({ privyAppId, privyClientId, wrapProvider = true, ...props }: HostedPhoneAuthProps) {
  const content = <HostedPhoneAuthInner {...props} />;

  if (!wrapProvider) {
    return content;
  }

  return (
    <HostedPrivyProvider appId={privyAppId} clientId={privyClientId}>
      {content}
    </HostedPrivyProvider>
  );
}

function HostedPhoneAuthInner({
  inviteCode,
  intent = "signup",
  mode,
  onCompleted,
  onSignOut,
}: Omit<HostedPhoneAuthProps, "privyAppId" | "wrapProvider">) {
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
