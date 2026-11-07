import { LinkPageFrame } from "@/src/components/link-page/link-page-shell";

import { buildJoinInviteStatusRefreshSnapshot } from "./join-invite-state";
import type { JoinInvitePageModel } from "./join-invite-page-model";
import {
  JoinInviteSignOutButtonIsland,
  JoinInviteStatusRefreshIsland,
} from "./join-invite-islands";
import { JoinInviteSignedInMismatchView } from "./join-invite-signed-in-mismatch-view";
import { JoinInviteStageServer } from "./join-invite-stage-server";

export function JoinInvitePageView({ model }: { model: JoinInvitePageModel }) {
  const signedInWithDifferentAccount = model.status.stage === "verify"
    && model.status.session.authenticated
    && !model.status.session.matchesInvite;

  if (signedInWithDifferentAccount) {
    return (
      <JoinInviteSignedInMismatchView
        signOutAction={
          <JoinInviteSignOutButtonIsland
            appearance="pill"
            idleLabel="Sign out and continue"
          />
        }
      />
    );
  }

  return (
    <LinkPageFrame>
      <JoinInviteStageServer model={model} />
      <JoinInviteStatusRefreshIsland
        current={buildJoinInviteStatusRefreshSnapshot(
          model.status,
          model.familyBillingRecovery,
        )}
        disabled={model.preview}
        inviteCode={model.inviteCode}
        legalGateActive={model.launchConsent.gateActive}
      />
    </LinkPageFrame>
  );
}
