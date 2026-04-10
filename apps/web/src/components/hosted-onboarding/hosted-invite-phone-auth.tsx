"use client";

import { useEffect, useState } from "react";

import type { HostedPrivyCompletionPayload } from "@/src/lib/hosted-onboarding/types";

import {
  HostedOnboardingApiError,
  requestHostedOnboardingJson,
} from "./client-api";
import { useHostedPhoneAuthController } from "./hosted-phone-auth-controller";
import {
  HostedInviteShortcutStep,
} from "./hosted-phone-auth-step-views";
import {
  abortInvitePhoneCodeSend,
  finalizeInvitePhoneCodeSendConfirmation,
  flushPendingInvitePhoneCodeMutation,
  queuePendingInvitePhoneCodeMutation,
  toErrorMessage,
} from "./hosted-phone-auth-support";
import {
  HostedPhoneAuthFlow,
  HostedPhoneAuthScaffold,
} from "./hosted-phone-auth-views";

interface InvitePhoneCodePayload {
  phoneNumber: string;
  sendAttemptId: string;
}

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
    controller.setErrorMessage(null);
    controller.setPendingAction("send-code");

    try {
      await flushPendingInvitePhoneCodeMutation(inviteCode);
      const payload = await requestHostedOnboardingJson<InvitePhoneCodePayload>({
        method: "POST",
        url: `/api/hosted-onboarding/invites/${encodeURIComponent(inviteCode)}/send-code`,
      });

      try {
        await controller.sendVerificationCode(payload.phoneNumber);
      } catch (error) {
        const abortSucceeded = await abortInvitePhoneCodeSend({
          inviteCode,
          sendAttemptId: payload.sendAttemptId,
        });
        if (!abortSucceeded) {
          queuePendingInvitePhoneCodeMutation({
            inviteCode,
            kind: "abort",
            sendAttemptId: payload.sendAttemptId,
          });
        }
        throw error;
      }

      void finalizeInvitePhoneCodeSendConfirmation({
        inviteCode,
        sendAttemptId: payload.sendAttemptId,
      });
    } catch (error) {
      if (error instanceof HostedOnboardingApiError && error.code === "SIGNUP_PHONE_UNAVAILABLE") {
        controller.resetPhoneAuthFlow();
        setManualEntryVisible(true);
        controller.setErrorMessage("Enter the number that messaged Murph to continue.");
        return;
      }

      controller.setErrorMessage(toErrorMessage(error, "We could not send a verification code."));
    } finally {
      controller.setPendingAction(null);
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
    controller.resetPhoneAuthFlow();
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
        <HostedInviteShortcutStep
          disabled={controller.flowDisabled}
          pendingAction={controller.pendingAction}
          onSendCode={handleInviteSendCode}
          onUseDifferentNumber={handleUseDifferentNumber}
        />
      ) : (
        <HostedPhoneAuthFlow
          {...controller.sharedFlowProps}
          phoneFieldDescription="Enter the number that messaged Murph."
          phoneFieldLabel="Phone number"
          secondaryActionSize="sm"
          onResendCode={handleResendCode}
          onUseDifferentNumber={handleUseDifferentNumber}
        />
      )}
    </HostedPhoneAuthScaffold>
  );
}
