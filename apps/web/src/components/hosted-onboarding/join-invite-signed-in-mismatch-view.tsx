import type { ReactNode } from "react";

import Link from "next/link";

import {
  LINK_PAGE_LINK_CLASS,
  LinkPageFrame,
  LinkPageScreen,
} from "@/src/components/link-page/link-page-shell";
import { HOSTED_APP_HOME_PATH } from "@/src/lib/hosted-onboarding/app-routes";
import { cn } from "@/src/lib/utils";

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
          {signOutAction}
          <Link
            className={cn(LINK_PAGE_LINK_CLASS, "inline-flex items-center")}
            href={HOSTED_APP_HOME_PATH}
          >
            Go to Murph home
          </Link>
        </>
      }
      announceDetail={false}
      detail="This link is for another Murph account. Sign out to use it."
      title="You’re on a different account."
    />
  );
}
