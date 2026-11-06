"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import { AuthDialog } from "@/src/components/hosted-onboarding/auth-dialog";
import { navigateHostedAuthRedirect } from "@/src/components/hosted-onboarding/hosted-auth-navigation";
import {
  HostedOnboardingApiError,
  requestHostedOnboardingJson,
} from "@/src/components/hosted-onboarding/client-api";
import {
  LinkPageError,
  LinkPageLink,
  LinkPagePill,
  LinkPageScreen,
  LinkPageTicket,
} from "@/src/components/link-page/link-page-shell";
import { toErrorMessage } from "@/src/components/settings/hosted-settings-sync-helpers";
import {
  buildHostedFamilyInviteRecoveryPath,
  HOSTED_FAMILY_DRAFT_CHECKOUT_ACTIVE_ERROR_CODE,
} from "@/src/lib/hosted-onboarding/app-routes";

export type FamilyInviteWebAcceptInitialState = "draft_conflict" | "idle";

const HOSTED_FAMILY_DRAFT_CONFLICT_MESSAGE =
  "You already have an unfinished Family setup. Resolve it in Settings, then you’ll return here to try this invite again.";

export function FamilyInviteWebAcceptScreen(props: {
  children?: ReactNode;
  initialState?: FamilyInviteWebAcceptInitialState;
  inviteCode: string;
  secondaryActions?: ReactNode;
  title: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<"accepted" | "idle" | "submitting">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [recoveryPath, setRecoveryPath] = useState<string | null>(
    props.initialState === "draft_conflict"
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
        return;
      }
      setErrorMessage(toErrorMessage(error, "Could not accept the invite right now."));
    }
  }

  if (status === "accepted") {
    return <FamilyInviteJoinedScreen onOpenMurph={() => router.push("/home")} />;
  }

  if (recoveryPath) {
    return (
      <LinkPageScreen
        actions={
          <LinkPagePill onClick={() => router.push(recoveryPath)}>
            Open Family settings
          </LinkPagePill>
        }
        detail={HOSTED_FAMILY_DRAFT_CONFLICT_MESSAGE}
        title="Finish your Family setup first."
      />
    );
  }

  return (
    <LinkPageScreen
      actions={
        <>
          {errorMessage ? <LinkPageError>{errorMessage}</LinkPageError> : null}
          <LinkPagePill
            disabled={status === "submitting"}
            onClick={() => void accept()}
          >
            {status === "submitting" ? "Joining..." : "Accept invite"}
          </LinkPagePill>
          {props.secondaryActions}
        </>
      }
      title={props.title}
    >
      {props.children}
    </LinkPageScreen>
  );
}

export function FamilyInviteJoinedScreen({
  onOpenMurph,
}: {
  onOpenMurph?: () => void;
}) {
  return (
    <LinkPageScreen
      actions={<LinkPagePill onClick={onOpenMurph}>Open Murph</LinkPagePill>}
      detail="Welcome to Murph."
      title="You're in."
    >
      <LinkPageTicket className="mt-0" kicker="Murph Family" title="Welcome" />
    </LinkPageScreen>
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
        <LinkPageLink onClick={() => setOpen(true)}>
          Prefer not to text?
        </LinkPageLink>
      ) : (
        <LinkPagePill onClick={() => setOpen(true)}>
          Sign in to join
        </LinkPagePill>
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
