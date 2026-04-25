"use client";

import { useEffect, useState } from "react";

import type { HostedPrivyCompletionPayload } from "@/src/lib/hosted-onboarding/types";
import { maskPhoneNumber } from "@/src/lib/hosted-onboarding/phone";
import { useHostedPhoneAuthController } from "./hosted-phone-auth-controller";
import { flushPendingInvitePhoneCodeMutation } from "./hosted-phone-auth-support";
import {
  HostedPhoneAuthFlow,
  HostedPhoneAuthScaffold,
} from "./hosted-phone-auth-views";
import { HostedInviteMaskedPhoneStep } from "./hosted-phone-auth-step-views";
import { HostedPrivyCaptcha } from "./hosted-privy-captcha";

const HOSTED_INVITE_MASKED_PHONE_HINT_PATTERN = /^\*{3}\s+\d{4}$/u;

interface HostedInvitePhoneAuthProps {
  inviteCode: string;
  phoneHint?: string | null;
  onCompleted?: (payload: HostedPrivyCompletionPayload) => Promise<void> | void;
  onSignOut?: () => Promise<void> | void;
}

export function HostedInvitePhoneAuth({
  inviteCode,
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
  const normalizedPhoneHint = readHostedInvitePhoneHint(phoneHint);
  const showMaskedPhoneHint =
    !manualEntryVisible
    && !controller.sharedFlowProps.activeAttempt
    && normalizedPhoneHint !== null;

  useEffect(() => {
    void flushPendingInvitePhoneCodeMutation(inviteCode);
  }, [inviteCode]);

  function handleEnterFullNumber() {
    controller.handleResetPhoneAuthFlow();
    setManualEntryVisible(true);
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
      <HostedPrivyCaptcha />
      {showMaskedPhoneHint ? (
        <HostedInviteMaskedPhoneStep
          disabled={controller.flowDisabled}
          phoneHint={normalizedPhoneHint}
          onEnterNumber={handleEnterFullNumber}
        />
      ) : (
        <HostedPhoneAuthFlow
          {...controller.sharedFlowProps}
          phoneFieldDescription="Enter the number that received your Murph invite."
          phoneFieldLabel="Phone number"
          phoneInputAutoFocus={manualEntryVisible}
          secondaryActionSize="sm"
          onResendCode={controller.handleResendCode}
          onUseDifferentNumber={handleUseDifferentNumber}
        />
      )}
    </HostedPhoneAuthScaffold>
  );
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
