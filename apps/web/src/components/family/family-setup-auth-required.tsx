"use client";

import { useCallback } from "react";

import {
  navigateHostedAuthRedirect,
  reloadCurrentHostedAuthDocument,
} from "@/src/components/hosted-onboarding/hosted-auth-navigation";
import { LinkPageSurface } from "@/src/components/link-page/link-page-shell";
import {
  LinkPageSignIn,
  LinkPageSignInScreen,
} from "@/src/components/link-page/link-page-sign-in";
import { isHostedOnboardingAccessibleStage } from "@/src/lib/hosted-onboarding/stage";
import type { HostedAuthenticationCompletionPayload } from "@/src/lib/hosted-onboarding/types";

const FAMILY_SETUP_COPY = {
  detail: "Family billing, membership, and invitations stay private to your account.",
  title: "Sign in to set up Family.",
};

export function FamilySetupAuthRequired() {
  const handleAuthCompleted = useCallback(
    (payload: HostedAuthenticationCompletionPayload) => {
      if (isHostedOnboardingAccessibleStage(payload.stage)) {
        reloadCurrentHostedAuthDocument();
        return;
      }

      navigateHostedAuthRedirect(payload.joinUrl);
    },
    [],
  );

  return <LinkPageSignIn {...FAMILY_SETUP_COPY} onCompleted={handleAuthCompleted} />;
}

export function FamilySetupAuthRequiredView() {
  return (
    <LinkPageSurface>
      <LinkPageSignInScreen {...FAMILY_SETUP_COPY} />
    </LinkPageSurface>
  );
}
