"use client";

import { useState } from "react";

import { AuthDialog } from "@/src/components/hosted-onboarding/auth-dialog";
import { navigateHostedAuthRedirect } from "@/src/components/hosted-onboarding/hosted-auth-navigation";
import { Button } from "@/src/components/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/src/components/ui/card";

export function GroupFundingSignInRequired(props: {
  initiallyOpen?: boolean;
} = {}) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-16">
      <Card>
        <CardHeader>
          <CardTitle>
            Sign in to continue
          </CardTitle>
          <CardDescription>
            Open your private Murph account, then we&apos;ll bring you back to this group funding link.
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <GroupFundingSignInButton initiallyOpen={props.initiallyOpen} />
        </CardFooter>
      </Card>
    </main>
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
      <Button type="button" size="xl" onClick={() => setOpen(true)}>
        Continue to group funding
      </Button>
      <AuthDialog
        open={open}
        onCompleted={handleCompleted}
        onOpenChange={setOpen}
        title="Open group funding"
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
