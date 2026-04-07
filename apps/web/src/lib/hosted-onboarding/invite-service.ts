import {
  type HostedInvite,
  type HostedMember,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";

import type { HostedInviteStatusPayload } from "./types";

import { getPrisma } from "../prisma";
import { readHostedPhoneHint } from "./contact-privacy";
import { hostedOnboardingError, isHostedOnboardingError } from "./errors";
import { deriveHostedOnboardingStage } from "./lifecycle";
import {
  readHostedMemberPrivateState,
  writeHostedMemberPrivateStatePatch,
} from "./member-private-state";
import { ensureHostedMemberForPhone } from "./member-identity-service";
import { hasHostedPrivyPhoneAuthConfig } from "./privy";
import {
  getHostedOnboardingEnvironment,
  requireHostedOnboardingPublicBaseUrl,
} from "./runtime";
import {
  generateHostedInviteCode,
  generateHostedInviteId,
  inviteExpiresAt,
  lockHostedMemberRow,
  withHostedOnboardingTransaction,
} from "./shared";

const HOSTED_INVITE_SEND_CODE_COOLDOWN_MS = 60_000;

export async function getHostedInviteStatus(input: {
  authenticatedMember?: HostedMember | null;
  inviteCode: string;
  now?: Date;
  prisma?: PrismaClient;
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
      session: {
        authenticated: Boolean(input.authenticatedMember),
        expiresAt: null,
        matchesInvite: false,
      },
      stage: "invalid",
    };
  }

  const sessionMatchesInvite = input.authenticatedMember?.id === invite.memberId;
  const inviteIdentity = requireHostedInviteMemberIdentity(invite.member);

  return {
    capabilities: {
      billingReady,
      phoneAuthReady,
    },
    invite: {
      code: invite.inviteCode,
      expiresAt: invite.expiresAt.toISOString(),
      phoneHint: readHostedPhoneHint(inviteIdentity.maskedPhoneNumberHint),
    },
    session: {
      authenticated: Boolean(input.authenticatedMember),
      expiresAt: null,
      matchesInvite: Boolean(sessionMatchesInvite),
    },
    stage: deriveHostedOnboardingStage({
      billingStatus: invite.member.billingStatus,
      expiresAt: invite.expiresAt,
      now,
      sessionMatchesInvite,
      suspendedAt: invite.member.suspendedAt,
    }),
  };
}

export async function buildHostedInvitePageData(input: {
  authenticatedMember?: HostedMember | null;
  inviteCode: string;
  prisma?: PrismaClient;
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
        },
      });
    }

    return tx.hostedInvite.create({
      data: {
        id: generateHostedInviteId(),
        memberId: input.memberId,
        inviteCode: generateHostedInviteCode(),
        channel: input.channel,
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
  prisma: PrismaClient | Prisma.TransactionClient,
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

  if (invite.expiresAt <= now) {
    throw hostedOnboardingError({
      code: "INVITE_EXPIRED",
      message: "That Murph invite link has expired. Text the number again for a fresh link.",
      httpStatus: 410,
    });
  }

  return invite;
}

export async function prepareHostedInvitePhoneCode(input: {
  inviteCode: string;
  now?: Date;
  prisma?: PrismaClient;
}): Promise<{ phoneNumber: string }> {
  const prisma = input.prisma ?? getPrisma();
  const now = input.now ?? new Date();
  return withHostedOnboardingTransaction(prisma, async (tx) => {
    const invite = await requireHostedInviteForAuthentication(input.inviteCode, tx, now);
    await lockHostedMemberRow(tx, invite.memberId);

    const privateState = await readHostedInvitePrivateStateOrThrow(invite.memberId);
    const signupPhoneNumber = privateState?.signupPhoneNumber ?? null;

    if (!signupPhoneNumber) {
      throw hostedOnboardingError({
        code: "SIGNUP_PHONE_UNAVAILABLE",
        message: "Enter the number that messaged Murph to continue.",
        httpStatus: 409,
      });
    }

    const retryAfterMs = readPhoneCodeRetryAfterMs({
      now,
      sentAt: privateState?.signupPhoneCodeSentAt ?? null,
    });

    if (retryAfterMs > 0) {
      throw hostedOnboardingError({
        code: "PHONE_CODE_COOLDOWN",
        message: "Wait a moment before requesting another code.",
        httpStatus: 429,
        retryable: true,
        details: {
          retryAfterMs,
        },
      });
    }

    await writeHostedMemberPrivateStatePatch({
      memberId: invite.memberId,
      now: now.toISOString(),
      patch: {
        signupPhoneCodeSentAt: now.toISOString(),
      },
    });

    return {
      phoneNumber: signupPhoneNumber,
    };
  });
}

export function requireHostedInviteMemberIdentity(
  member: Prisma.HostedInviteGetPayload<{
    include: {
      member: {
        include: {
          identity: true;
        };
      };
    };
  }>["member"],
) {
  if (member.identity) {
    return member.identity;
  }

  throw hostedOnboardingError({
    code: "HOSTED_MEMBER_IDENTITY_MISSING",
    message: "Hosted invite identity state is missing.",
    httpStatus: 500,
  });
}

async function findHostedInviteByCode(inviteCode: string, prisma: PrismaClient) {
  return prisma.hostedInvite.findUnique({
    where: {
      inviteCode,
    },
    include: {
      member: {
        include: {
          identity: true,
        },
      },
    },
  });
}

async function readHostedInvitePrivateStateOrThrow(memberId: string) {
  try {
    return await readHostedMemberPrivateState({
      memberId,
    });
  } catch (error) {
    if (
      isHostedOnboardingError(error)
      && error.code === "HOSTED_MEMBER_PRIVATE_STATE_NOT_CONFIGURED"
    ) {
      throw hostedOnboardingError({
        code: "SIGNUP_PHONE_UNAVAILABLE",
        message: "Enter the number that messaged Murph to continue.",
        httpStatus: 409,
      });
    }

    throw error;
  }
}

function readPhoneCodeRetryAfterMs(input: {
  now: Date;
  sentAt: string | null;
}): number {
  if (!input.sentAt) {
    return 0;
  }

  const sentAtMs = Date.parse(input.sentAt);

  if (!Number.isFinite(sentAtMs)) {
    return 0;
  }

  return Math.max(0, sentAtMs + HOSTED_INVITE_SEND_CODE_COOLDOWN_MS - input.now.getTime());
}
