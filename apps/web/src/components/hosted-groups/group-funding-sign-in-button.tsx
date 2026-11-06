"use client";

import { useState } from "react";

import { AuthDialog } from "@/src/components/hosted-onboarding/auth-dialog";
import { navigateHostedAuthRedirect } from "@/src/components/hosted-onboarding/hosted-auth-navigation";
import {
  GroupFundingFrame,
  GroupFundingPill,
  GroupFundingScreen,
} from "./group-usage-funding-shell";

export function GroupFundingSignInRequired(props: {
  initiallyOpen?: boolean;
} = {}) {
  return (
    <GroupFundingFrame>
      <GroupFundingScreen
        actions={<GroupFundingSignInButton initiallyOpen={props.initiallyOpen} />}
        title="Sign in to continue."
      />
    </GroupFundingFrame>
  );
}

export function GroupFundingSignInButton(props: {
  initiallyOpen?: boolean;
} = {}) {
  const [open, setOpen] = useState(props.initiallyOpen ?? true);

  function handleCompleted() {
    navigateHostedAuthRedirect(readCurrentGroupFundingPath());
  }

  return (
    <>
      <GroupFundingPill onClick={() => setOpen(true)}>Sign in</GroupFundingPill>
      <AuthDialog
        open={open}
        onCompleted={handleCompleted}
        onOpenChange={setOpen}
        title="Sign in to Murph"
        description="We'll bring you straight back here."
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
