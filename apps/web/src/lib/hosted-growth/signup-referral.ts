import "server-only";

import {
  HostedBillingStatus,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";

import { getPrisma } from "../prisma";
import { assertHostedMemberNotSuspended } from "../hosted-onboarding/entitlement";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { createHostedMember } from "../hosted-onboarding/hosted-member-store";
import { upsertHostedMemberIdentity } from "../hosted-onboarding/hosted-member-identity-store";
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

  const reusable = await readReusableHostedSignupReferralInviteTx(input);
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
      inviteCode: true,
      memberId: true,
    },
  });
}

async function readReusableHostedSignupReferralInviteTx(input: {
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
      inviteCode: true,
      memberId: true,
    },
    where: {
      expiresAt: {
        gt: input.now,
      },
      referrerMemberId: input.referrerMemberId,
    },
  });
  if (!invite) {
    return null;
  }

  // Signup reconciliation takes this same member-row lock before binding Privy.
  // Re-read the identity under the lock so an invite is never handed out again
  // after another browser has claimed it.
  await lockHostedMemberRow(input.prisma, invite.memberId);
  const identity = await input.prisma.hostedMemberIdentity.findUnique({
    select: {
      privyUserLookupKey: true,
    },
    where: {
      memberId: invite.memberId,
    },
  });

  return identity?.privyUserLookupKey === null ? invite : null;
}
