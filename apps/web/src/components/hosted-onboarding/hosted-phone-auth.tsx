"use client";

import type { HostedPrivyCompletionPayload } from "@/src/lib/hosted-onboarding/types";

import {
  HostedPhoneAuthFlow,
  HostedPhoneAuthScaffold,
} from "./hosted-phone-auth-views";
import { useHostedPhoneAuthController } from "./hosted-phone-auth-controller";
import type { HostedPhoneAuthIntent, HostedPhoneLinkPayload } from "./hosted-phone-auth-types";

interface HostedPhoneAuthProps {
  intent?: HostedPhoneAuthIntent;
  onCompleted?: (payload: HostedPrivyCompletionPayload) => Promise<void> | void;
  onLinked?: (payload: HostedPhoneLinkPayload) => Promise<void> | void;
  onSignOut?: () => Promise<void> | void;
  showPassiveConsentNotice?: boolean;
}

export function HostedPhoneAuth({
  intent = "signup",
  onCompleted,
  onLinked,
  onSignOut,
  showPassiveConsentNotice = true,
}: HostedPhoneAuthProps) {
  const controller = useHostedPhoneAuthController({
    intent,
    onCompleted,
    onLinked,
    onSignOut,
  });

  return (
    <HostedPhoneAuthScaffold
      body={controller.authenticatedLoadingBody}
      description={controller.authenticatedSessionDescription}
      disabled={controller.flowDisabled}
      errorMessage={controller.errorMessage}
      intent={intent}
      pendingAction={controller.pendingAction}
      secondaryActionSize="lg"
      title={controller.authenticatedLoadingTitle}
      view={controller.authenticatedView}
      onContinue={controller.handleContinueAuthenticated}
      onUseDifferentNumber={controller.handleLogout}
    >
      <HostedPhoneAuthFlow
        {...controller.sharedFlowProps}
        showPassiveConsentNotice={showPassiveConsentNotice}
      />
    </HostedPhoneAuthScaffold>
  );
}
