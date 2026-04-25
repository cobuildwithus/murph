"use client";

import { useEffect, useState } from "react";

import type {
  HostedInvitePhoneAuthTarget,
  HostedPrivyCompletionPayload,
} from "@/src/lib/hosted-onboarding/types";
import { maskPhoneNumber } from "@/src/lib/hosted-onboarding/phone";
import { useHostedPhoneAuthController } from "./hosted-phone-auth-controller";
import { HostedOnboardingApiError, requestHostedOnboardingJson } from "./client-api";
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
import {
  HostedInviteMaskedPhoneLoadingStep,
  HostedInviteMaskedPhoneStep,
} from "./hosted-phone-auth-step-views";
import { HostedPrivyCaptcha } from "./hosted-privy-captcha";

const HOSTED_INVITE_MASKED_PHONE_HINT_PATTERN = /^\*{3}\s+\d{4}$/u;

interface InvitePhoneCodePayload {
  phoneHint: string;
  phoneNumber: string;
  sendAttemptId: string;
}

interface HostedInvitePhoneAuthProps {
  inviteCode: string;
  phoneAuthTarget?: HostedInvitePhoneAuthTarget | null;
  phoneHint?: string | null;
  onCompleted?: (payload: HostedPrivyCompletionPayload) => Promise<void> | void;
  onSignOut?: () => Promise<void> | void;
}

export function HostedInvitePhoneAuth({
  inviteCode,
  phoneAuthTarget,
  phoneHint,
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
  const resolvedPhoneAuthTarget = readHostedInvitePhoneAuthTarget({
    phoneAuthTarget,
    phoneHint,
  });
  const savedPhoneHint = resolvedPhoneAuthTarget.kind === "saved"
    ? resolvedPhoneAuthTarget.phoneHint
    : null;
  const showMaskedPhoneHint =
    !manualEntryVisible
    && !controller.sharedFlowProps.activeAttempt
    && savedPhoneHint !== null;
  const inviteShortcutActive =
    !manualEntryVisible && savedPhoneHint !== null;

  useEffect(() => {
    void flushPendingInvitePhoneCodeMutation(inviteCode);
  }, [inviteCode]);

  async function handleInviteSendCode() {
    controller.setErrorMessage(null);

    if (!controller.privyReady) {
      controller.setErrorMessage(
        "Phone verification is still loading. Try again in a moment.",
      );
      return;
    }

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
    if (inviteShortcutActive && controller.sharedFlowProps.activeAttempt) {
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
      <HostedPrivyCaptcha />
      {showMaskedPhoneHint && savedPhoneHint ? (
        controller.privyReady ? (
          <HostedInviteMaskedPhoneStep
            disabled={controller.flowDisabled}
            pendingAction={controller.pendingAction}
            phoneHint={savedPhoneHint}
            onSendCode={handleInviteSendCode}
            onUseDifferentNumber={handleUseDifferentNumber}
          />
        ) : (
          <HostedInviteMaskedPhoneLoadingStep
            phoneHint={savedPhoneHint}
            onUseDifferentNumber={handleUseDifferentNumber}
          />
        )
      ) : (
        <HostedPhoneAuthFlow
          {...controller.sharedFlowProps}
          phoneFieldDescription="Enter the number that received your Murph invite."
          phoneFieldLabel="Phone number"
          phoneInputAutoFocus={manualEntryVisible}
          secondaryActionSize="sm"
          onResendCode={handleResendCode}
          onUseDifferentNumber={handleUseDifferentNumber}
        />
      )}
    </HostedPhoneAuthScaffold>
  );
}

function readHostedInvitePhoneAuthTarget(input: {
  phoneAuthTarget?: HostedInvitePhoneAuthTarget | null;
  phoneHint?: string | null;
}): HostedInvitePhoneAuthTarget {
  if (input.phoneAuthTarget?.kind === "manual") {
    return {
      kind: "manual",
    };
  }

  const phoneHint = readHostedInvitePhoneHint(
    input.phoneAuthTarget?.kind === "saved"
      ? input.phoneAuthTarget.phoneHint
      : input.phoneHint,
  );

  return phoneHint
    ? {
        kind: "saved",
        phoneHint,
      }
    : {
        kind: "manual",
      };
}

function readHostedInvitePhoneHint(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (!normalized || normalized === "your number") {
    return null;
  }

  if (HOSTED_INVITE_MASKED_PHONE_HINT_PATTERN.test(normalized)) {
    return normalized;
  }

  const masked = maskPhoneNumber(normalized);
  return masked === "your number" ? null : masked;
}
