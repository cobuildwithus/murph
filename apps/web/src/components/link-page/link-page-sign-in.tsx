"use client";

import { useState, type ReactNode } from "react";

import { useAuth } from "@/src/components/hosted-onboarding/auth-dialog-provider";
import {
  HostedFirstPartyAuthPanel,
  type HostedFirstPartyAuthPanelProps,
  type HostedFirstPartyAuthPanelView,
} from "@/src/components/hosted-onboarding/hosted-first-party-auth-panel";
import {
  LINK_PAGE_FORM_CLASS,
  LINK_PAGE_NIGHT_TOKENS,
  LinkPageFrame,
  LinkPageLink,
  LinkPageScreen,
} from "@/src/components/link-page/link-page-shell";
import { cn } from "@/src/lib/utils";

type LinkPageSignInProps = {
  children?: ReactNode;
  detail?: ReactNode;
  inviteCode?: string | null;
  /** The only ways in, for a link that can't finish any other way. */
  methods?: HostedFirstPartyAuthPanelProps["methods"];
  /** A page with its own finish, rather than the app-wide one. */
  onCompleted?: HostedFirstPartyAuthPanelProps["onCompleted"];
  /** Settings skips this: a member may be there to change that very consent. */
  requireLaunchConsent?: boolean;
  title: string;
};

/**
 * The signed-out state of a private link. Sign-in sits on the page, so the
 * headline keeps saying what the link is for. It finishes the way the app-wide
 * sign-in dialog does, and returns to this same URL.
 */
export function LinkPageSignIn(props: LinkPageSignInProps) {
  return (
    <LinkPageFrame>
      <LinkPageSignInScreen {...props} />
    </LinkPageFrame>
  );
}

export function LinkPageSignInScreen({
  children,
  detail,
  inviteCode,
  methods,
  onCompleted,
  requireLaunchConsent = true,
  title,
}: LinkPageSignInProps) {
  const { completeAuthentication } = useAuth();
  // Telegram prepares itself when it mounts, so a page view alone must not mount it.
  const [otherMethods, setOtherMethods] = useState(false);
  const [view, setView] = useState<HostedFirstPartyAuthPanelView>("auth");

  return (
    <LinkPageScreen
      actions={
        <div
          className={cn("flex w-full flex-col items-center gap-1", LINK_PAGE_FORM_CLASS)}
          style={LINK_PAGE_NIGHT_TOKENS}
        >
          <div className="w-full">
            <HostedFirstPartyAuthPanel
              {...(inviteCode !== undefined ? { inviteCode } : {})}
              methods={methods ?? (otherMethods ? ["phone", "telegram", "email"] : ["phone"])}
              onCompleted={onCompleted ?? completeAuthentication}
              onViewChange={setView}
              requireLaunchConsentOnCompletion={requireLaunchConsent}
            />
          </div>
          {!methods && !otherMethods && view === "auth" ? (
            <LinkPageLink onClick={() => setOtherMethods(true)}>
              Use Telegram or email
            </LinkPageLink>
          ) : null}
        </div>
      }
      detail={detail}
      title={title}
    >
      {children}
    </LinkPageScreen>
  );
}
