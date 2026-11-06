import type { ReactNode } from "react";

import Link from "next/link";

import {
  LINK_PAGE_PILL_CLASS,
  LinkPageFrame,
  LinkPageScreen,
} from "@/src/components/link-page/link-page-shell";
import { HOSTED_APP_HOME_PATH } from "@/src/lib/hosted-onboarding/app-routes";

export function JoinInviteSignedInMismatchView({
  signOutAction,
}: {
  signOutAction: ReactNode;
}) {
  return (
    <LinkPageFrame>
      <JoinInviteSignedInMismatchScreen signOutAction={signOutAction} />
    </LinkPageFrame>
  );
}

export function JoinInviteSignedInMismatchScreen({
  signOutAction,
}: {
  signOutAction: ReactNode;
}) {
  return (
    <LinkPageScreen
      actions={
        <>
          <Link className={LINK_PAGE_PILL_CLASS} href={HOSTED_APP_HOME_PATH}>
            Go to Murph home
          </Link>
          {signOutAction}
        </>
      }
      detail="This browser is using a different Murph account. Return to that account, or sign out to continue with this invite."
      title="You’re already signed in."
    />
  );
}
