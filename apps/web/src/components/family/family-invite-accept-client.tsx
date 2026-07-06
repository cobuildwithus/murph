"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { AuthDialog } from "@/src/components/hosted-onboarding/auth-dialog";
import { navigateHostedAuthRedirect } from "@/src/components/hosted-onboarding/hosted-auth-navigation";
import { requestHostedOnboardingJson } from "@/src/components/hosted-onboarding/client-api";
import { toErrorMessage } from "@/src/components/settings/hosted-settings-sync-helpers";
import { Button } from "@/src/components/ui/button";
import type { HostedPrivyCompletionPayload } from "@/src/lib/hosted-onboarding/types";

export function FamilyInviteWebAcceptButton(props: { inviteCode: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<"accepted" | "idle" | "submitting">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function accept() {
    setErrorMessage(null);
    setStatus("submitting");
    try {
      await requestHostedOnboardingJson({
        method: "POST",
        url: `/api/family/invites/${encodeURIComponent(props.inviteCode)}/accept`,
      });
      setStatus("accepted");
    } catch (error) {
      setStatus("idle");
      setErrorMessage(toErrorMessage(error, "Could not accept the invite right now."));
    }
  }

  if (status === "accepted") {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm font-medium text-foreground">{"You're in. Welcome to Murph."}</p>
        <Button type="button" size="xl" onClick={() => router.push("/home")}>
          Open Murph
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        size="xl"
        onClick={() => void accept()}
        disabled={status === "submitting"}
      >
        {status === "submitting" ? "Joining..." : "Accept invite"}
      </Button>
      {errorMessage ? (
        <p role="alert" className="text-sm text-destructive [overflow-wrap:anywhere]">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}

export function FamilyInviteSignInButton(props: {
  bindingLabel: string;
  variant?: "link" | "primary";
}) {
  const [open, setOpen] = useState(false);

  function handleCompleted(_payload: HostedPrivyCompletionPayload) {
    navigateHostedAuthRedirect(readCurrentFamilyInvitePath());
  }

  return (
    <>
      {props.variant === "link" ? (
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto w-fit p-0 text-sm font-medium text-muted-foreground hover:text-foreground"
          onClick={() => setOpen(true)}
        >
          Sign in on the web instead
        </Button>
      ) : (
        <Button type="button" size="xl" onClick={() => setOpen(true)}>
          Sign in to join
        </Button>
      )}
      <AuthDialog
        open={open}
        onCompleted={handleCompleted}
        onOpenChange={setOpen}
        requireLaunchConsentOnCompletion
        title="Sign in to join Murph Family"
        description={`Use the same ${props.bindingLabel} this invite was sent to.`}
      />
    </>
  );
}

function readCurrentFamilyInvitePath(): string {
  if (typeof window === "undefined") {
    return "/home";
  }

  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}
