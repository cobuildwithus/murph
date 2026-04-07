import {
  type PrismaClient,
} from "@prisma/client";

import { getPrisma } from "../prisma";
import { readHostedPhoneHint } from "./contact-privacy";
import { isHostedMemberSuspended } from "./entitlement";
import { hostedOnboardingError } from "./errors";
import { deriveHostedPostVerificationStage } from "./lifecycle";
import { type HostedPrivyIdentity } from "./privy";
import {
  buildHostedInviteUrl,
  issueHostedInvite,
  requireHostedInviteMemberIdentity,
  requireHostedInviteForAuthentication,
} from "./invite-service";
import {
  ensureHostedMemberForPrivyIdentity,
  reconcileHostedPrivyIdentityOnMember,
} from "./member-identity-service";

export async function completeHostedPrivyVerification(input: {
  identity: HostedPrivyIdentity;
  inviteCode?: string | null;
  now?: Date;
  prisma?: PrismaClient;
}) {
  const prisma = input.prisma ?? getPrisma();
  const now = input.now ?? new Date();
  const invite = input.inviteCode
    ? await requireHostedInviteForAuthentication(input.inviteCode, prisma, now)
    : null;
  const member = invite
    ? await (async () => {
        const inviteIdentity = requireHostedInviteMemberIdentity(invite.member);
        return reconcileHostedPrivyIdentityOnMember({
          expectedPhoneHint: readHostedPhoneHint(inviteIdentity.maskedPhoneNumberHint),
          expectedPhoneLookupKey: inviteIdentity.phoneLookupKey,
          identity: input.identity,
          member: invite.member,
          prisma,
          now,
        });
      })()
    : await ensureHostedMemberForPrivyIdentity({
        identity: input.identity,
        prisma,
        now,
      });

  if (isHostedMemberSuspended(member.suspendedAt)) {
    throw hostedOnboardingError({
      code: "HOSTED_MEMBER_SUSPENDED",
      message: "This hosted account is suspended. Contact support to restore access.",
      httpStatus: 403,
    });
  }

  const activeInvite = invite ?? await issueHostedInvite({
    channel: "web",
    memberId: member.id,
    prisma,
  });
  const stage = deriveHostedPostVerificationStage({
    billingStatus: member.billingStatus,
    suspendedAt: member.suspendedAt,
  });

  return {
    inviteCode: activeInvite.inviteCode,
    joinUrl: buildHostedInviteUrl(activeInvite.inviteCode),
    stage,
  };
}
