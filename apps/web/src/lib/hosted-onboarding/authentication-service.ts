import {
  HostedBillingStatus,
  HostedInviteStatus,
  HostedMemberStatus,
  type PrismaClient,
} from "@prisma/client";

import { getPrisma } from "../prisma";
import { readHostedPhoneHint } from "./contact-privacy";
import { hostedOnboardingError } from "./errors";
import { type HostedPrivyIdentity } from "./privy";
import {
  buildHostedInviteUrl,
  issueHostedInvite,
  requireHostedInviteForAuthentication,
} from "./invite-service";
import {
  ensureHostedMemberForPrivyIdentity,
  reconcileHostedPrivyIdentityOnMember,
} from "./member-identity-service";
import { createHostedSession } from "./session";

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
    ? await reconcileHostedPrivyIdentityOnMember({
        expectedPhoneHint: readHostedPhoneHint(invite.member.maskedPhoneNumberHint),
        expectedPhoneLookupKey: invite.member.normalizedPhoneNumber,
        identity: input.identity,
        member: invite.member,
        prisma,
        now,
      })
    : await ensureHostedMemberForPrivyIdentity({
        identity: input.identity,
        prisma,
        now,
      });

  if (member.status === HostedMemberStatus.suspended) {
    throw hostedOnboardingError({
      code: "HOSTED_MEMBER_SUSPENDED",
      message: "This hosted account is suspended. Contact support to restore access.",
      httpStatus: 403,
    });
  }

  const activeInvite = invite ?? await issueHostedInvite({
    channel: "web",
    linqChatId: null,
    linqEventId: null,
    memberId: member.id,
    prisma,
    triggerText: null,
  });
  const stage = member.billingStatus === HostedBillingStatus.active ? "active" : "checkout";

  await prisma.hostedInvite.update({
    where: {
      id: activeInvite.id,
    },
    data: {
      authenticatedAt: now,
      status: stage === "active"
        ? HostedInviteStatus.paid
        : HostedInviteStatus.authenticated,
      ...(stage === "active" ? { paidAt: activeInvite.paidAt ?? now } : {}),
    },
  });

  const session = await createHostedSession({
    inviteId: activeInvite.id,
    memberId: member.id,
    now,
    prisma,
  });

  return {
    expiresAt: session.expiresAt,
    inviteCode: activeInvite.inviteCode,
    joinUrl: buildHostedInviteUrl(activeInvite.inviteCode),
    stage,
    token: session.token,
  };
}
