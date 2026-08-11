import type { ReactNode } from "react";

import Link from "next/link";

import { buttonVariants } from "@/src/components/ui/button";
import { PageHeader } from "@/src/components/ui/page-header";
import { HOSTED_APP_HOME_PATH } from "@/src/lib/hosted-onboarding/app-routes";

import { JoinInviteEyebrow } from "./join-invite-eyebrow";
import { JoinInviteCenteredShell } from "./join-invite-shell";

export function JoinInviteSignedInMismatchView({
  signOutAction,
}: {
  signOutAction: ReactNode;
}) {
  return (
    <JoinInviteCenteredShell>
      <div className="flex w-full max-w-lg flex-col gap-6">
        <PageHeader
          eyebrow={<JoinInviteEyebrow label="Murph invite" tone="default" />}
          title="You’re already signed in"
          description="This browser is using a different Murph account. Return to that account, or sign out to continue with this invite."
        />

        <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
          <Link className={buttonVariants({ size: "lg" })} href={HOSTED_APP_HOME_PATH}>
            Go to Murph home
          </Link>
          {signOutAction}
        </div>
      </div>
    </JoinInviteCenteredShell>
  );
}
