import "server-only";

import {
  HostedBillingStatus,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";

import { getPrisma } from "../prisma";
import { assertHostedMemberNotSuspended } from "../hosted-onboarding/entitlement";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import {
  readHostedMemberIdentity,
  type HostedMemberIdentityState,
  upsertHostedMemberIdentity,
} from "../hosted-onboarding/hosted-member-identity-store";
import { createHostedMember } from "../hosted-onboarding/hosted-member-store";
import {
  getHostedOnboardingEnvironment,
  requireHostedOnboardingPublicBaseUrl,
} from "../hosted-onboarding/runtime";
import {
  generateHostedInviteCode,
  generateHostedInviteId,
  generateHostedMemberId,
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  inviteExpiresAt,
  lockHostedMemberRow,
} from "../hosted-onboarding/shared";

export interface HostedSignupReferralLink {
  expiresAt: Date;
  signupUrl: string;
}

type HostedReusableSignupReferralInvite = {
  expiresAt: Date;
  id: string;
  inviteCode: string;
  memberId: string;
};

export function buildHostedSignupReferralUrl(
  inviteCode: string,
  publicBaseUrl = requireHostedOnboardingPublicBaseUrl(),
): string {
  return new URL(
    `/join/${encodeURIComponent(inviteCode)}`,
    publicBaseUrl,
  ).toString();
}

export async function issueHostedSignupReferralLink(input: {
  now?: Date;
  prisma?: PrismaClient;
  publicBaseUrl?: string;
  referrerMemberId: string;
}): Promise<HostedSignupReferralLink> {
  const now = input.now ?? new Date();
  const prisma = input.prisma ?? getPrisma();
  const invite = await prisma.$transaction(
    (tx) => issueHostedSignupReferralInviteTx({
      now,
      prisma: tx,
      referrerMemberId: input.referrerMemberId,
    }),
    HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  );

  return {
    expiresAt: invite.expiresAt,
    signupUrl: buildHostedSignupReferralUrl(
      invite.inviteCode,
      input.publicBaseUrl,
    ),
  };
}

async function issueHostedSignupReferralInviteTx(input: {
  now: Date;
  prisma: Prisma.TransactionClient;
  referrerMemberId: string;
}): Promise<HostedReusableSignupReferralInvite> {
  await lockHostedMemberRow(input.prisma, input.referrerMemberId);

  const referrer = await input.prisma.hostedMember.findUnique({
    select: {
      id: true,
      suspendedAt: true,
    },
    where: {
      id: input.referrerMemberId,
    },
  });
  if (!referrer) {
    throw hostedOnboardingError({
      code: "HOSTED_SIGNUP_REFERRER_NOT_FOUND",
      httpStatus: 404,
      message: "The referring Murph account is no longer available.",
    });
  }
  assertHostedMemberNotSuspended(referrer);

  const reusable = await reuseOrRefreshHostedSignupReferralInviteTx(input);
  if (reusable) {
    return reusable;
  }

  const targetMemberId = generateHostedMemberId();
  await createHostedMember({
    billingStatus: HostedBillingStatus.not_started,
    memberId: targetMemberId,
    prisma: input.prisma,
  });
  await upsertHostedMemberIdentity({
    maskedPhoneNumberHint: null,
    memberId: targetMemberId,
    phoneLookupKey: null,
    phoneNumber: null,
    phoneNumberVerifiedAt: null,
    prisma: input.prisma,
    privyUserId: null,
    signupPhoneCodeSendAttemptId: null,
    signupPhoneCodeSendAttemptStartedAt: null,
    signupPhoneCodeSentAt: null,
    signupPhoneNumber: null,
  });

  return input.prisma.hostedInvite.create({
    data: {
      channel: "share",
      expiresAt: inviteExpiresAt(
        input.now,
        getHostedOnboardingEnvironment().inviteTtlHours,
      ),
      id: generateHostedInviteId(),
      inviteCode: generateHostedInviteCode(),
      memberId: targetMemberId,
      referrerMemberId: input.referrerMemberId,
    },
    select: {
      expiresAt: true,
      id: true,
      inviteCode: true,
      memberId: true,
    },
  });
}

async function reuseOrRefreshHostedSignupReferralInviteTx(input: {
  now: Date;
  prisma: Prisma.TransactionClient;
  referrerMemberId: string;
}): Promise<HostedReusableSignupReferralInvite | null> {
  const invite = await input.prisma.hostedInvite.findFirst({
    orderBy: {
      createdAt: "desc",
    },
    select: {
      expiresAt: true,
      id: true,
      inviteCode: true,
      memberId: true,
    },
    where: {
      referrerMemberId: input.referrerMemberId,
    },
  });
  if (!invite) {
    return null;
  }

  // Signup mutations take this same member-row lock. Read the complete domain
  // identity under the lock so a link is reused only before any recipient has
  // started onboarding—not merely before Privy identity binding completes.
  await lockHostedMemberRow(input.prisma, invite.memberId);
  const identity = await readHostedMemberIdentity({
    memberId: invite.memberId,
    prisma: input.prisma,
  });
  if (!isPristineHostedSignupReferralIdentity(identity)) {
    return null;
  }

  if (invite.expiresAt > input.now) {
    return invite;
  }

  return input.prisma.hostedInvite.update({
    data: {
      channel: "share",
      expiresAt: inviteExpiresAt(
        input.now,
        getHostedOnboardingEnvironment().inviteTtlHours,
      ),
      inviteCode: generateHostedInviteCode(),
    },
    select: {
      expiresAt: true,
      id: true,
      inviteCode: true,
      memberId: true,
    },
    where: {
      id: invite.id,
    },
  });
}

function isPristineHostedSignupReferralIdentity(
  identity: HostedMemberIdentityState | null,
): boolean {
  if (!identity) {
    return false;
  }

  const { memberId: _memberId, ...recipientState } = identity;
  return Object.values(recipientState).every((value) => value === null);
}
