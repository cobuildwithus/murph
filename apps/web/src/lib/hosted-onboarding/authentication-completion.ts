import "server-only";
import { HostedBillingStatus, type PrismaClient } from "@prisma/client";
import { assertHostedMemberNotSuspended } from "./entitlement";
import { deriveHostedPostVerificationStage } from "./lifecycle";
import { isHostedMemberActivationPending } from "./activation-progress";
import { readHostedMemberMessagingSetupState, readHostedMemberEmailAuthorization, type HostedMemberCoreState } from "./hosted-member-store";
import { isHostedMemberMessagingSetupRequired } from "./messaging-state";
import { buildHostedInviteUrl, issueHostedInvite, type requireHostedInviteForAuthentication } from "./invite-service";
import { readActiveHostedMemberAccess } from "./member-access";

// Product bootstrap is shared by every authenticated transport. It never
// verifies a provider credential, creates a member, or grants access.
export async function readHostedAuthenticationCompletion(input: {
  member: HostedMemberCoreState;
  prisma: PrismaClient;
  invite?: Awaited<ReturnType<typeof requireHostedInviteForAuthentication>> | null;
  emailLinked?: boolean;
}) {
  const { member, prisma } = input;
  assertHostedMemberNotSuspended(member);
  const emailLinked = input.emailLinked ?? Boolean((await readHostedMemberEmailAuthorization({ memberId: member.id, prisma }))?.verifiedEmail);
  const messagingSetupState = await readHostedMemberMessagingSetupState({
    memberId: member.id,
    prisma,
  });

  const activeInvite = input.invite ?? await issueHostedInvite({
    channel: "web",
    memberId: member.id,
    prisma,
  });
  const accessActive = await readActiveHostedMemberAccess({
    memberId: member.id,
    prisma,
  });
  const activationPending = accessActive
    ? await isHostedMemberActivationPending({
        billingStatus: HostedBillingStatus.active,
        memberId: member.id,
        prisma,
      })
    : false;
  const stage = deriveHostedPostVerificationStage({
    activationPending,
    billingStatus: member.billingStatus,
    sponsoredAccessActive: accessActive,
    suspendedAt: member.suspendedAt,
  });
  const messagingSetupRequired = isHostedMemberMessagingSetupRequired({
    identity: {
      ...(messagingSetupState?.identity ?? {}),
      emailLinked,
    },
    routing: messagingSetupState?.routing ?? null,
  });

  return {
    inviteCode: activeInvite.inviteCode,
    joinUrl: buildHostedInviteUrl(activeInvite.inviteCode),
    member,
    memberId: member.id,
    messagingSetupRequired,
    stage,
  };
}
