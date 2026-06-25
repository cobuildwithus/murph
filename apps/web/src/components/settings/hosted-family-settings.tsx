import type { HostedFamilyOwnerSnapshot } from "@/src/lib/hosted-onboarding/family-plan";

import {
  HostedFamilyManager,
  type FamilyManagerInvite,
  type FamilyManagerMember,
} from "./hosted-family-settings-actions";

const OWNER_PRIVACY_COPY =
  "You pay for your family's access, but you can't see their Murph conversations, health data, vault, exports, or deletion controls.";

export function HostedFamilySettings(props: { ownerSnapshot: HostedFamilyOwnerSnapshot }) {
  const snapshot = props.ownerSnapshot;

  const members: FamilyManagerMember[] = snapshot.members.map((member) => ({
    isOwner: member.isOwner,
    joinedAtIso: member.joinedAt ? member.joinedAt.toISOString() : null,
    label: member.label,
    memberId: member.memberId,
  }));
  const invites: FamilyManagerInvite[] = snapshot.invites.map((invite) => ({
    acceptUrl: invite.acceptUrl,
    channel: invite.channel,
    expiresAtIso: invite.expiresAt.toISOString(),
    id: invite.id,
    targetEmail: invite.targetEmail,
    targetLabel: invite.targetLabel,
    targetPhoneHint: invite.targetPhoneHint,
    targetTelegramUsername: invite.targetTelegramUsername,
    telegramInviteUrl: invite.telegramInviteUrl,
  }));

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-pretty text-muted-foreground">{OWNER_PRIVACY_COPY}</p>
      <HostedFamilyManager
        billingActive={snapshot.billingActive}
        invites={invites}
        members={members}
        seats={snapshot.seats}
      />
    </div>
  );
}
