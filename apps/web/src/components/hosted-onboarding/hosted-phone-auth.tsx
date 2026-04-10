"use client";

import type { HostedPrivyCompletionPayload } from "@/src/lib/hosted-onboarding/types";

import {
  HostedPhoneAuthFlow,
  HostedPhoneAuthScaffold,
} from "./hosted-phone-auth-views";
import { useHostedPhoneAuthController } from "./hosted-phone-auth-controller";

interface HostedPhoneAuthProps {
  intent?: HostedPhoneAuthIntent;
  onCompleted?: (payload: HostedPrivyCompletionPayload) => Promise<void> | void;
  onSignOut?: () => Promise<void> | void;
}
type HostedPhoneAuthIntent = "signup" | "signin";

export function HostedPhoneAuth({
  intent = "signup",
  onCompleted,
  onSignOut,
}: HostedPhoneAuthProps) {
  const controller = useHostedPhoneAuthController({
    intent,
    onCompleted,
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
      <HostedPhoneAuthFlow {...controller.sharedFlowProps} />
    </HostedPhoneAuthScaffold>
  );
}
