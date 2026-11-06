"use client";

import { useState } from "react";

import { AuthDialog } from "@/src/components/hosted-onboarding/auth-dialog";
import { navigateHostedAuthRedirect } from "@/src/components/hosted-onboarding/hosted-auth-navigation";
import { Button } from "@/src/components/ui/button";

import {
  GroupFundingFrame,
  GroupFundingMessage,
} from "./group-usage-funding-shell";

export function GroupFundingSignInRequired(props: {
  initiallyOpen?: boolean;
} = {}) {
  return (
    <GroupFundingFrame>
      <GroupFundingMessage
        action={<GroupFundingSignInButton initiallyOpen={props.initiallyOpen} />}
        description="We’ll bring you straight back here."
        title="Sign in to continue"
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
      <Button
        className="w-full"
        onClick={() => setOpen(true)}
        size="xl"
        type="button"
      >
        Sign in
      </Button>
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
