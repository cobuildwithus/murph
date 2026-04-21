import type { HostedMember } from "@prisma/client";

import { listHostedVaultSyncSessions } from "@/src/lib/vault-sync/session-service";
import type { HostedVaultSyncSessionView } from "@/src/lib/vault-sync/shared";
import { isHostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

import { HostedVaultSyncSettingsClient } from "./hosted-vault-sync-settings-client";

export async function HostedVaultSyncSettings(props: {
  authenticated: boolean;
  member: Pick<HostedMember, "id"> | null;
}) {
  let initialSessions: HostedVaultSyncSessionView[] = [];
  let initialError: string | null = null;

  if (props.authenticated && props.member) {
    try {
      initialSessions = await listHostedVaultSyncSessions({
        memberId: props.member.id,
      });
    } catch (error) {
      initialError = isHostedOnboardingError(error)
        ? error.message
        : "Could not load vault sync sessions right now.";
    }
  }

  return (
    <HostedVaultSyncSettingsClient
      authenticated={props.authenticated}
      initialError={initialError}
      initialSessions={initialSessions}
    />
  );
}
