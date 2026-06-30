"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";

import type {
  HostedInvitePhoneAuthTarget,
  HostedPrivyCompletionPayload,
} from "@/src/lib/hosted-onboarding/types";
import { maskPhoneNumber } from "@/src/lib/hosted-onboarding/phone";
import { ConsentSkeleton } from "@/src/components/legal/hosted-legal-consent-card";
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
  HostedInviteMaskedPhoneStep,
} from "./hosted-phone-auth-step-views";
import { HostedPrivyCaptcha } from "./hosted-privy-captcha";

const HOSTED_INVITE_MASKED_PHONE_HINT_PATTERN = /^\*{3}\s+\d{4}$/u;

interface InvitePhoneCodePayload {
  phoneHint: string;
  phoneNumber: string;
  sendAttemptId: string;
}

interface QueuedInvitePhoneCodeSend {
  inviteCode: string;
  phoneHint: string;
}

interface HostedInvitePhoneAuthProps {
  inviteCode: string;
  phoneAuthTarget?: HostedInvitePhoneAuthTarget | null;
  phoneHint?: string | null;
  sendCodeGated?: boolean;
  onCompleted?: (payload: HostedPrivyCompletionPayload) => Promise<void> | void;
  onSignOut?: () => Promise<void> | void;
}

export function HostedInvitePhoneAuth({
  inviteCode,
  phoneAuthTarget,
  phoneHint,
  sendCodeGated = false,
  onCompleted,
  onSignOut,
}: HostedInvitePhoneAuthProps) {
  const [manualEntryVisible, setManualEntryVisible] = useState(false);
  const [queuedInvitePhoneCodeSend, setQueuedInvitePhoneCodeSend] =
    useState<QueuedInvitePhoneCodeSend | null>(null);
  const invitePhoneCodeSendInFlightRef = useRef(false);
  const controller = useHostedPhoneAuthController({
    inviteCode,
    intent: "auth",
    onCompleted,
    onSignOut: async () => {
      setQueuedInvitePhoneCodeSend(null);
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
  const activeQueuedInvitePhoneCodeSend =
    queuedInvitePhoneCodeSend
    && inviteShortcutActive
    && !sendCodeGated
    && controller.authenticatedView === null
    && queuedInvitePhoneCodeSend.inviteCode === inviteCode
    && queuedInvitePhoneCodeSend.phoneHint === savedPhoneHint
      ? queuedInvitePhoneCodeSend
      : null;
  const inviteShortcutDisabled =
    sendCodeGated || controller.pendingAction !== null || activeQueuedInvitePhoneCodeSend !== null;

  useEffect(() => {
    void flushPendingInvitePhoneCodeMutation(inviteCode);
  }, [inviteCode]);

  async function handleInviteSendCode() {
    controller.setErrorMessage(null);

    if (sendCodeGated) {
      setQueuedInvitePhoneCodeSend(null);
      return;
    }

    if (!controller.privyReady) {
      if (savedPhoneHint) {
        setQueuedInvitePhoneCodeSend({
          inviteCode,
          phoneHint: savedPhoneHint,
        });
      }
      return;
    }

    await sendInvitePhoneCode();
  }

  async function sendInvitePhoneCode() {
    if (invitePhoneCodeSendInFlightRef.current) {
      return;
    }

    invitePhoneCodeSendInFlightRef.current = true;
    setQueuedInvitePhoneCodeSend(null);
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
      invitePhoneCodeSendInFlightRef.current = false;
    }
  }

  const drainQueuedInvitePhoneCodeSendEffect = useEffectEvent(() => {
    void sendInvitePhoneCode();
  });

  useEffect(() => {
    if (!activeQueuedInvitePhoneCodeSend) {
      return;
    }

    if (!controller.privyReady || controller.pendingAction !== null) {
      return;
    }

    drainQueuedInvitePhoneCodeSendEffect();
  }, [
    activeQueuedInvitePhoneCodeSend,
    controller.pendingAction,
    controller.privyReady,
  ]);

  async function handleResendCode() {
    if (inviteShortcutActive && controller.sharedFlowProps.activeAttempt) {
      await handleInviteSendCode();
      return;
    }

    await controller.handleResendCode();
  }

  function handleUseDifferentNumber() {
    setQueuedInvitePhoneCodeSend(null);
    controller.resetPhoneAuthFlow();
    setManualEntryVisible(true);
  }

  if (controller.authenticatedView === "loading") {
    return (
      <div aria-busy="true" aria-live="polite" role="status">
        <ConsentSkeleton />
      </div>
    );
  }

  return (
    <HostedPhoneAuthScaffold
      body={controller.authenticatedLoadingBody}
      description={controller.authenticatedSessionDescription}
      disabled={controller.flowDisabled}
      errorMessage={controller.errorMessage}
      pendingAction={controller.pendingAction}
      secondaryActionSize="sm"
      title={controller.authenticatedLoadingTitle}
      view={controller.authenticatedView}
      onContinue={controller.handleContinueAuthenticated}
      onUseDifferentNumber={controller.handleLogout}
    >
      <HostedPrivyCaptcha />
      {showMaskedPhoneHint && savedPhoneHint ? (
            <HostedInviteMaskedPhoneStep
              disabled={inviteShortcutDisabled}
              pendingAction={activeQueuedInvitePhoneCodeSend ? "send-code" : controller.pendingAction}
            phoneHint={savedPhoneHint}
            onSendCode={handleInviteSendCode}
            onUseDifferentNumber={handleUseDifferentNumber}
          />
      ) : (
        <HostedPhoneAuthFlow
          {...controller.sharedFlowProps}
          phoneFieldDescription={null}
          phoneFieldLabel="Phone number"
          phoneInputAutoFocus={manualEntryVisible}
          secondaryActionSize="sm"
          sendCodeDisabled={controller.sharedFlowProps.sendCodeDisabled || sendCodeGated}
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
