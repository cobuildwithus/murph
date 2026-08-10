"use client";

import { UsersRound } from "lucide-react";
import { useCallback, useState } from "react";

import { AuthDialog } from "@/src/components/hosted-onboarding/auth-dialog";
import { HostedAuthRequiredScreenView } from "@/src/components/hosted-onboarding/hosted-auth-required-screen";
import {
  navigateHostedAuthRedirect,
  reloadCurrentHostedAuthDocument,
} from "@/src/components/hosted-onboarding/hosted-auth-navigation";
import { isHostedOnboardingAccessibleStage } from "@/src/lib/hosted-onboarding/stage";
import type { HostedPrivyCompletionPayload } from "@/src/lib/hosted-onboarding/types";

const FAMILY_SETUP_AUTH_COPY = {
  description:
    "Sign in or create your Murph account to open your private Family settings.",
  eyebrow: "Murph Family",
  eyebrowIcon: UsersRound,
  footer:
    "Family billing, membership, and invitations stay private to your account.",
  title: "Set up Family",
} as const;

export function FamilySetupAuthRequired() {
  const [open, setOpen] = useState(true);
  const handleAuthCompleted = useCallback(
    (payload: HostedPrivyCompletionPayload) => {
      if (isHostedOnboardingAccessibleStage(payload.stage)) {
        reloadCurrentHostedAuthDocument();
        return;
      }

      navigateHostedAuthRedirect(payload.joinUrl);
    },
    [],
  );

  return (
    <>
      <HostedAuthRequiredScreenView
        {...FAMILY_SETUP_AUTH_COPY}
        onLogin={() => setOpen(true)}
      />
      <AuthDialog
        description="Sign in to continue to your private Family settings."
        onCompleted={handleAuthCompleted}
        onOpenChange={setOpen}
        open={open}
        requireLaunchConsentOnCompletion
        title="Set up Murph Family"
      />
    </>
  );
}

export function FamilySetupAuthRequiredView() {
  return <HostedAuthRequiredScreenView {...FAMILY_SETUP_AUTH_COPY} />;
}
