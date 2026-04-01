import {
  HostedBillingStatus,
  HostedInviteStatus,
  type HostedInvite,
  type HostedMember,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";

import type { HostedInviteStatusPayload } from "./types";

import { getPrisma } from "../prisma";
import { readHostedPhoneHint } from "./contact-privacy";
import { hostedOnboardingError } from "./errors";
import { ensureHostedMemberForPhone } from "./member-identity-service";
import { hasHostedPrivyPhoneAuthConfig } from "./privy";
import {
  getHostedOnboardingEnvironment,
  requireHostedOnboardingPublicBaseUrl,
} from "./runtime";
import type { HostedSessionRecord } from "./session";
import {
  generateHostedInviteCode,
  generateHostedInviteId,
  inviteExpiresAt,
  lockHostedMemberRow,
  withHostedOnboardingTransaction,
} from "./shared";

export async function getHostedInviteStatus(input: {
  inviteCode: string;
  now?: Date;
  prisma?: PrismaClient;
  sessionRecord?: HostedSessionRecord | null;
}): Promise<HostedInviteStatusPayload> {
  const prisma = input.prisma ?? getPrisma();
  const environment = getHostedOnboardingEnvironment();
  const now = input.now ?? new Date();
  const invite = await findHostedInviteByCode(input.inviteCode, prisma);
  const billingReady = Boolean(environment.stripeSecretKey && environment.stripePriceId);
  const phoneAuthReady = hasHostedPrivyPhoneAuthConfig();

  if (!invite) {
    return {
      capabilities: {
        billingReady,
        phoneAuthReady,
      },
      invite: null,
      member: null,
      session: {
        authenticated: Boolean(input.sessionRecord),
        expiresAt: input.sessionRecord?.session.expiresAt.toISOString() ?? null,
        matchesInvite: false,
      },
      stage: "invalid",
    };
  }

  let inviteStatus = invite.status;

  if (invite.expiresAt <= now && invite.status !== HostedInviteStatus.expired) {
    await prisma.hostedInvite.update({
      where: { id: invite.id },
      data: {
        status: HostedInviteStatus.expired,
      },
    });
    inviteStatus = HostedInviteStatus.expired;
  } else if (!invite.openedAt) {
    const openedInvite = await prisma.hostedInvite.update({
      where: { id: invite.id },
      data: {
        openedAt: now,
        status:
          invite.status === HostedInviteStatus.pending
            ? HostedInviteStatus.opened
            : invite.status,
      },
      select: {
        openedAt: true,
        status: true,
      },
    });
    inviteStatus = openedInvite.status;
  }

  const sessionMatchesInvite = input.sessionRecord?.member.id === invite.memberId;
  const hasPrivyIdentity = Boolean(invite.member.privyUserId && invite.member.walletAddress);
  const isActive = invite.member.billingStatus === HostedBillingStatus.active;
  const stage =
    invite.expiresAt <= now || inviteStatus === HostedInviteStatus.expired
      ? "expired"
      : sessionMatchesInvite
        ? isActive
          ? "active"
          : "checkout"
        : hasPrivyIdentity
          ? "authenticate"
          : "register";

  return {
    capabilities: {
      billingReady,
      phoneAuthReady,
    },
    invite: {
      code: invite.inviteCode,
      expiresAt: invite.expiresAt.toISOString(),
      phoneHint: readHostedPhoneHint(invite.member.maskedPhoneNumberHint),
      status: inviteStatus,
    },
    member: {
      phoneHint: readHostedPhoneHint(invite.member.maskedPhoneNumberHint),
      status: invite.member.status,
    },
    session: {
      authenticated: Boolean(input.sessionRecord),
      expiresAt: input.sessionRecord?.session.expiresAt.toISOString() ?? null,
      matchesInvite: Boolean(sessionMatchesInvite),
    },
    stage,
  };
}

export async function buildHostedInvitePageData(input: {
  inviteCode: string;
  prisma?: PrismaClient;
  sessionRecord?: HostedSessionRecord | null;
}) {
  return getHostedInviteStatus(input);
}

export async function issueHostedInviteForPhone(input: {
  channel?: "share" | "web";
  phoneNumber: string;
  prisma?: PrismaClient;
}): Promise<{ invite: HostedInvite; inviteUrl: string; member: HostedMember }> {
  const prisma = input.prisma ?? getPrisma();

  return withHostedOnboardingTransaction(prisma, async (tx) => {
    const member = await ensureHostedMemberForPhone({
      phoneNumber: input.phoneNumber,
      prisma: tx,
    });
    const invite = await issueHostedInvite({
      channel: input.channel ?? "share",
      memberId: member.id,
      prisma: tx,
    });

    return {
      invite,
      inviteUrl: buildHostedInviteUrl(invite.inviteCode),
      member,
    };
  });
}

export async function issueHostedInvite(input: {
  channel: "linq" | "share" | "web";
  memberId: string;
  prisma: PrismaClient | Prisma.TransactionClient;
}): Promise<HostedInvite> {
  return withHostedOnboardingTransaction(input.prisma, async (tx) => {
    const now = new Date();

    await lockHostedMemberRow(tx, input.memberId);

    const existingInvite = await tx.hostedInvite.findFirst({
      where: {
        memberId: input.memberId,
        expiresAt: {
          gt: now,
        },
        status: {
          in: [
            HostedInviteStatus.pending,
            HostedInviteStatus.opened,
            HostedInviteStatus.authenticated,
            HostedInviteStatus.paid,
          ],
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    if (existingInvite) {
      return tx.hostedInvite.update({
        where: {
          id: existingInvite.id,
        },
        data: {
          channel: input.channel,
          linqChatId: null,
          linqEventId: null,
          triggerText: null,
        },
      });
    }

    return tx.hostedInvite.create({
      data: {
        id: generateHostedInviteId(),
        memberId: input.memberId,
        inviteCode: generateHostedInviteCode(),
        status: HostedInviteStatus.pending,
        channel: input.channel,
        triggerText: null,
        linqChatId: null,
        linqEventId: null,
        expiresAt: inviteExpiresAt(now, getHostedOnboardingEnvironment().inviteTtlHours),
      },
    });
  });
}

export function buildHostedInviteUrl(inviteCode: string): string {
  return `${requireHostedOnboardingPublicBaseUrl()}/join/${encodeURIComponent(inviteCode)}`;
}

export async function requireHostedInviteForAuthentication(
  inviteCode: string,
  prisma: PrismaClient,
  now: Date,
) {
  const invite = await findHostedInviteByCode(inviteCode, prisma);

  if (!invite) {
    throw hostedOnboardingError({
      code: "INVITE_NOT_FOUND",
      message: "That Murph invite link is no longer valid.",
      httpStatus: 404,
    });
  }

  if (invite.expiresAt <= now || invite.status === HostedInviteStatus.expired) {
    throw hostedOnboardingError({
      code: "INVITE_EXPIRED",
      message: "That Murph invite link has expired. Text the number again for a fresh link.",
      httpStatus: 410,
    });
  }

  return invite;
}

async function findHostedInviteByCode(inviteCode: string, prisma: PrismaClient) {
  return prisma.hostedInvite.findUnique({
    where: {
      inviteCode,
    },
    include: {
      member: true,
    },
  });
}
