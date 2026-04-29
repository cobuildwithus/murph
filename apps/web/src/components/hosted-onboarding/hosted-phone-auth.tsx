"use client";

import type { HostedPrivyCompletionPayload } from "@/src/lib/hosted-onboarding/types";

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
  onCompleted?: (payload: HostedPrivyCompletionPayload) => Promise<void> | void;
  onLinked?: (payload: HostedPhoneLinkPayload) => Promise<void> | void;
  onSignOut?: () => Promise<void> | void;
  renderCaptcha?: boolean;
  showPassiveConsentNotice?: boolean;
  suppressAuthenticatedSessionIssue?: boolean;
}

export function HostedPhoneAuth({
  disableSignup = false,
  intent = "auth",
  onCompleted,
  onLinked,
  onSignOut,
  renderCaptcha = true,
  showPassiveConsentNotice = true,
  suppressAuthenticatedSessionIssue = false,
}: HostedPhoneAuthProps) {
  const controller = useHostedPhoneAuthController({
    disableSignup,
    intent,
    onCompleted,
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
        showPassiveConsentNotice={showPassiveConsentNotice}
      />
    </HostedPhoneAuthScaffold>
  );
}
