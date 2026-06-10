"use client";

import type { HostedAuthCompletionResult } from "./hosted-auth-completion";

import {
  HostedPhoneAuthFlow,
  HostedPhoneAuthScaffold,
} from "./hosted-phone-auth-views";
import { useHostedPhoneAuthController } from "./hosted-phone-auth-controller";
import { HostedPrivyCaptcha } from "./hosted-privy-captcha";
import type { HostedPhoneAuthIntent, HostedPhoneLinkPayload } from "./hosted-phone-auth-types";

interface HostedPhoneAuthProps {
  disableSignup?: boolean;
  intent?: HostedPhoneAuthIntent;
  onAuthCompleted?: (result: HostedAuthCompletionResult) => Promise<void> | void;
  onCodeSent?: () => void;
  onLinked?: (payload: HostedPhoneLinkPayload) => Promise<void> | void;
  onSignOut?: () => Promise<void> | void;
  phoneFieldLabel?: string | null;
  phoneInputAutoFocus?: boolean;
  renderCaptcha?: boolean;
  sendCodeGated?: boolean;
  size?: "default" | "compact";
  suppressAuthenticatedSessionIssue?: boolean;
}

export function HostedPhoneAuth({
  disableSignup = false,
  intent = "auth",
  onAuthCompleted,
  onCodeSent,
  onLinked,
  onSignOut,
  phoneFieldLabel,
  phoneInputAutoFocus = false,
  renderCaptcha = true,
  sendCodeGated = false,
  size,
  suppressAuthenticatedSessionIssue = false,
}: HostedPhoneAuthProps) {
  const controller = useHostedPhoneAuthController({
    disableSignup,
    intent,
    onAuthCompleted,
    onCodeSent,
    onLinked,
    onSignOut,
    suppressAuthenticatedSessionIssue,
  });

  return (
    <HostedPhoneAuthScaffold
      body={controller.authenticatedLoadingBody}
      description={controller.authenticatedSessionDescription}
      disabled={controller.flowDisabled}
      errorMessage={controller.errorMessage}
      pendingAction={controller.pendingAction}
      secondaryActionSize="lg"
      title={controller.authenticatedLoadingTitle}
      view={controller.authenticatedView}
      onContinue={controller.handleContinueAuthenticated}
      onUseDifferentNumber={controller.handleLogout}
    >
      {renderCaptcha ? <HostedPrivyCaptcha /> : null}
      <HostedPhoneAuthFlow
        {...controller.sharedFlowProps}
        phoneFieldLabel={phoneFieldLabel ?? controller.sharedFlowProps.phoneFieldLabel}
        phoneInputAutoFocus={phoneInputAutoFocus}
        sendCodeDisabled={controller.sharedFlowProps.sendCodeDisabled || sendCodeGated}
        size={size}
      />
    </HostedPhoneAuthScaffold>
  );
}
