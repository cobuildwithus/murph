"use client";

import { useState, type ReactNode } from "react";

import { useAuth } from "@/src/components/hosted-onboarding/auth-dialog-provider";
import {
  HostedFirstPartyAuthPanel,
  type HostedFirstPartyAuthPanelView,
} from "@/src/components/hosted-onboarding/hosted-first-party-auth-panel";
import {
  LINK_PAGE_NIGHT_TOKENS,
  LinkPageFrame,
  LinkPageLink,
  LinkPageScreen,
} from "@/src/components/link-page/link-page-shell";

type LinkPageSignInProps = {
  children?: ReactNode;
  detail?: ReactNode;
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

export function LinkPageSignInScreen({ children, detail, title }: LinkPageSignInProps) {
  const { completeAuthentication } = useAuth();
  // Telegram prepares itself when it mounts, so a page view alone must not mount it.
  const [otherMethods, setOtherMethods] = useState(false);
  const [view, setView] = useState<HostedFirstPartyAuthPanelView>("auth");

  return (
    <LinkPageScreen
      actions={
        <div
          className="flex w-full flex-col items-center gap-1 [&_button[data-slot=button]]:rounded-full [&_input]:border-[#FFFCF6]/15 [&_input]:bg-[#2A2622] [&_input]:text-[#FFFCF6]"
          style={LINK_PAGE_NIGHT_TOKENS}
        >
          <div className="w-full">
            <HostedFirstPartyAuthPanel
              methods={otherMethods ? ["phone", "telegram", "email"] : ["phone"]}
              onCompleted={completeAuthentication}
              onViewChange={setView}
              requireLaunchConsentOnCompletion
            />
          </div>
          {!otherMethods && view === "auth" ? (
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
