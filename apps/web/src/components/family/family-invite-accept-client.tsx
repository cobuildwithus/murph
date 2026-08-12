"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { AuthDialog } from "@/src/components/hosted-onboarding/auth-dialog";
import { navigateHostedAuthRedirect } from "@/src/components/hosted-onboarding/hosted-auth-navigation";
import {
  HostedOnboardingApiError,
  requestHostedOnboardingJson,
} from "@/src/components/hosted-onboarding/client-api";
import { toErrorMessage } from "@/src/components/settings/hosted-settings-sync-helpers";
import { Button } from "@/src/components/ui/button";
import {
  buildHostedFamilyInviteRecoveryPath,
  HOSTED_FAMILY_DRAFT_CHECKOUT_ACTIVE_ERROR_CODE,
} from "@/src/lib/hosted-onboarding/app-routes";

export type FamilyInviteWebAcceptInitialState = "draft_conflict" | "idle";

const HOSTED_FAMILY_DRAFT_CONFLICT_MESSAGE =
  "You already have an unfinished Family setup. Resolve it in Settings, then you’ll return here to try this invite again.";

export function FamilyInviteWebAcceptButton(props: {
  initialState?: FamilyInviteWebAcceptInitialState;
  inviteCode: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<"accepted" | "idle" | "submitting">("idle");
  const initialDraftConflict = props.initialState === "draft_conflict";
  const [errorMessage, setErrorMessage] = useState<string | null>(
    initialDraftConflict
      ? HOSTED_FAMILY_DRAFT_CONFLICT_MESSAGE
      : null,
  );
  const [recoveryPath, setRecoveryPath] = useState<string | null>(
    initialDraftConflict
      ? buildHostedFamilyInviteRecoveryPath(props.inviteCode)
      : null,
  );

  async function accept() {
    setErrorMessage(null);
    setRecoveryPath(null);
    setStatus("submitting");
    try {
      await requestHostedOnboardingJson({
        method: "POST",
        url: `/api/family/invites/${encodeURIComponent(props.inviteCode)}/accept`,
      });
      setStatus("accepted");
    } catch (error) {
      setStatus("idle");
      if (
        error instanceof HostedOnboardingApiError
        && error.code === HOSTED_FAMILY_DRAFT_CHECKOUT_ACTIVE_ERROR_CODE
      ) {
        setRecoveryPath(buildHostedFamilyInviteRecoveryPath(props.inviteCode));
        setErrorMessage(HOSTED_FAMILY_DRAFT_CONFLICT_MESSAGE);
        return;
      }
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
        <div className="flex flex-col gap-2">
          <p role="alert" className="text-sm text-destructive [overflow-wrap:anywhere]">
            {errorMessage}
          </p>
          {recoveryPath ? (
            <Button
              type="button"
              size="lg"
              variant="outline"
              onClick={() => router.push(recoveryPath)}
            >
              Open Family settings
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function FamilyInviteSignInButton(props: {
  bindingLabel: string;
  description?: string;
  variant?: "link" | "primary";
}) {
  const [open, setOpen] = useState(false);

  function handleCompleted() {
    navigateHostedAuthRedirect(readCurrentFamilyInvitePath());
  }

  return (
    <>
      {props.variant === "link" ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-fit"
          onClick={() => setOpen(true)}
        >
          Prefer not to text?
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
        description={props.description ?? `Use the same ${props.bindingLabel} this invite was sent to.`}
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
