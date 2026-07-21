"use client";

import { useState } from "react";

import { AuthDialog } from "@/src/components/hosted-onboarding/auth-dialog";
import { navigateHostedAuthRedirect } from "@/src/components/hosted-onboarding/hosted-auth-navigation";
import { Button } from "@/src/components/ui/button";

export function GroupFundingSignInButton() {
  const [open, setOpen] = useState(true);

  function handleCompleted() {
    navigateHostedAuthRedirect(readCurrentGroupFundingPath());
  }

  return (
    <>
      <Button type="button" size="xl" onClick={() => setOpen(true)}>
        Continue to add usage
      </Button>
      <AuthDialog
        open={open}
        onCompleted={handleCompleted}
        onOpenChange={setOpen}
        requireLaunchConsentOnCompletion
        title="Add usage to this Murph group"
        description="Create or open your private Murph account, then we'll bring you back here."
      />
    </>
  );
}

function readCurrentGroupFundingPath(): string {
  if (typeof window === "undefined") {
    return "/";
  }
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}
