"use client";

import { useEffect, useState } from "react";

import type { HostedPrivyCompletionPayload } from "@/src/lib/hosted-onboarding/types";
import { useHostedPhoneAuthController } from "./hosted-phone-auth-controller";
import {
  HostedInviteShortcutStep,
} from "./hosted-phone-auth-step-views";
import { flushPendingInvitePhoneCodeMutation } from "./hosted-phone-auth-support";
import {
  HostedPhoneAuthFlow,
  HostedPhoneAuthScaffold,
} from "./hosted-phone-auth-views";
import { HostedPrivyCaptcha } from "./hosted-privy-captcha";

interface HostedInvitePhoneAuthProps {
  inviteCode: string;
  onCompleted?: (payload: HostedPrivyCompletionPayload) => Promise<void> | void;
  onSignOut?: () => Promise<void> | void;
}

export function HostedInvitePhoneAuth({
  inviteCode,
  onCompleted,
  onSignOut,
}: HostedInvitePhoneAuthProps) {
  const [manualEntryVisible, setManualEntryVisible] = useState(false);
  const controller = useHostedPhoneAuthController({
    inviteCode,
    intent: "signup",
    onCompleted,
    onSignOut: async () => {
      setManualEntryVisible(false);
      await onSignOut?.();
    },
  });
  const inviteShortcutActive = !manualEntryVisible;
  const inviteCodeAttempt = controller.sharedFlowProps.activeAttempt;

  useEffect(() => {
    void flushPendingInvitePhoneCodeMutation(inviteCode);
  }, [inviteCode]);

  async function handleInviteSendCode() {
    const result = await controller.handleInviteSendCode();

    if (result === "manual-entry-required") {
      setManualEntryVisible(true);
    }
  }

  async function handleResendCode() {
    if (inviteShortcutActive && inviteCodeAttempt) {
      await handleInviteSendCode();
      return;
    }

    await controller.handleResendCode();
  }

  function handleUseDifferentNumber() {
    controller.handleResetPhoneAuthFlow();
    setManualEntryVisible(true);
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
      {inviteShortcutActive && !inviteCodeAttempt ? (
        <>
          <HostedPrivyCaptcha />
          <HostedInviteShortcutStep
            disabled={controller.flowDisabled}
            pendingAction={controller.pendingAction}
            onSendCode={handleInviteSendCode}
            onUseDifferentNumber={handleUseDifferentNumber}
          />
        </>
      ) : (
        <>
          <HostedPrivyCaptcha />
          <HostedPhoneAuthFlow
            {...controller.sharedFlowProps}
            phoneFieldDescription="Enter the number that messaged Murph."
            phoneFieldLabel="Phone number"
            secondaryActionSize="sm"
            showPassiveConsentNotice={false}
            onResendCode={handleResendCode}
            onUseDifferentNumber={handleUseDifferentNumber}
          />
        </>
      )}
    </HostedPhoneAuthScaffold>
  );
}
