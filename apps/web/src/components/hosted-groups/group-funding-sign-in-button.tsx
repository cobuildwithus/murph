"use client";

import { useState } from "react";

import { AuthDialog } from "@/src/components/hosted-onboarding/auth-dialog";
import { navigateHostedAuthRedirect } from "@/src/components/hosted-onboarding/hosted-auth-navigation";
import {
  LinkPageFrame,
  LinkPagePill,
  LinkPageScreen,
} from "@/src/components/link-page/link-page-shell";

export function GroupFundingSignInRequired(props: {
  initiallyOpen?: boolean;
} = {}) {
  return (
    <LinkPageFrame>
      <LinkPageScreen
        actions={<GroupFundingSignInButton initiallyOpen={props.initiallyOpen} />}
        title="Sign in to continue."
      />
    </LinkPageFrame>
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
      <LinkPagePill onClick={() => setOpen(true)}>Sign in</LinkPagePill>
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
