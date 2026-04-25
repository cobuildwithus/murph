"use client";

import { useEffect } from "react";

import type { HostedPrivyCompletionPayload } from "@/src/lib/hosted-onboarding/types";
import { useHostedPhoneAuthController } from "./hosted-phone-auth-controller";
import { flushPendingInvitePhoneCodeMutation } from "./hosted-phone-auth-support";
import {
  HostedPhoneAuthFlow,
  HostedPhoneAuthScaffold,
} from "./hosted-phone-auth-views";
import { HostedPrivyCaptcha } from "./hosted-privy-captcha";

interface HostedInvitePhoneAuthProps {
  initialPhoneNumber?: string | null;
  inviteCode: string;
  onCompleted?: (payload: HostedPrivyCompletionPayload) => Promise<void> | void;
  onSignOut?: () => Promise<void> | void;
}

export function HostedInvitePhoneAuth({
  initialPhoneNumber,
  inviteCode,
  onCompleted,
  onSignOut,
}: HostedInvitePhoneAuthProps) {
  const controller = useHostedPhoneAuthController({
    initialPhoneNumber,
    inviteCode,
    intent: "signup",
    onCompleted,
    onSignOut,
  });

  useEffect(() => {
    void flushPendingInvitePhoneCodeMutation(inviteCode);
  }, [inviteCode]);

  function handleUseDifferentNumber() {
    controller.handleResetPhoneAuthFlow();
  }

  return (
    <HostedPhoneAuthScaffold
      body={controller.authenticatedLoadingBody}
      description={controller.authenticatedSessionDescription}
      disabled={controller.flowDisabled}
      errorMessage={controller.errorMessage}
      intent="signup"
      pendingAction={controller.pendingAction}
      secondaryActionSize="sm"
      title={controller.authenticatedLoadingTitle}
      view={controller.authenticatedView}
      onContinue={controller.handleContinueAuthenticated}
      onUseDifferentNumber={controller.handleLogout}
    >
      <HostedPrivyCaptcha />
      <HostedPhoneAuthFlow
        {...controller.sharedFlowProps}
        phoneFieldDescription="Enter the number that received your Murph invite."
        phoneFieldLabel="Phone number"
        secondaryActionSize="sm"
        onResendCode={controller.handleResendCode}
        onUseDifferentNumber={handleUseDifferentNumber}
      />
    </HostedPhoneAuthScaffold>
  );
}
