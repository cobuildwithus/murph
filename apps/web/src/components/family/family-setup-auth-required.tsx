"use client";

import { useCallback, useState } from "react";

import { AuthDialog } from "@/src/components/hosted-onboarding/auth-dialog";
import {
  navigateHostedAuthRedirect,
  reloadCurrentHostedAuthDocument,
} from "@/src/components/hosted-onboarding/hosted-auth-navigation";
import {
  LinkPageFrame,
  LinkPagePill,
  LinkPageScreen,
  LinkPageSurface,
} from "@/src/components/link-page/link-page-shell";
import { isHostedOnboardingAccessibleStage } from "@/src/lib/hosted-onboarding/stage";
import type { HostedAuthenticationCompletionPayload } from "@/src/lib/hosted-onboarding/types";

export function FamilySetupAuthRequired() {
  const [open, setOpen] = useState(true);
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

  return (
    <LinkPageFrame>
      <FamilySetupAuthRequiredScreen onLogin={() => setOpen(true)} />
      <AuthDialog
        description="Sign in to continue to your private Family settings."
        onCompleted={handleAuthCompleted}
        onOpenChange={setOpen}
        open={open}
        requireLaunchConsentOnCompletion
        title="Set up Murph Family"
      />
    </LinkPageFrame>
  );
}

export function FamilySetupAuthRequiredView() {
  return (
    <LinkPageSurface>
      <FamilySetupAuthRequiredScreen />
    </LinkPageSurface>
  );
}

function FamilySetupAuthRequiredScreen({ onLogin }: { onLogin?: () => void }) {
  return (
    <LinkPageScreen
      actions={<LinkPagePill onClick={onLogin}>Log in or sign up</LinkPagePill>}
      announceDetail={false}
      detail="Family billing, membership, and invitations stay private to your account."
      title="Set up Family."
    />
  );
}
