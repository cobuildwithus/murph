import { Prisma, type HostedMember } from "@prisma/client";
import {
  HostedBillingStatus,
} from "@prisma/client";

import {
  createHostedPhoneLookupKey,
  hostedPhoneLookupKeyMatchesValue,
  readHostedPhoneHint,
} from "./contact-privacy";
import { hostedOnboardingError } from "./errors";
import { type HostedPrivyIdentity } from "./privy";
import {
  generateHostedMemberId,
  lockHostedMemberRow,
  type HostedOnboardingPrismaClient,
  withHostedOnboardingTransaction,
} from "./shared";
import {
  isHostedOnboardingRevnetEnabled,
  normalizeHostedWalletAddress,
} from "./revnet";
import {
  createHostedMember,
  findHostedMemberByPhoneLookupKey,
  findHostedMemberByPhoneNumber,
  findHostedMemberByPrivyUserId,
  findHostedMemberByWalletAddress,
  readHostedMemberCoreState,
  readHostedMemberIdentity,
  upsertHostedMemberIdentity,
  upsertHostedMemberLinqChatBinding,
} from "./hosted-member-store";

export async function ensureHostedMemberForPhone(input: {
  phoneNumber: string;
  prisma: HostedOnboardingPrismaClient;
}): Promise<HostedMember> {
  const member = await withHostedOnboardingTransaction(input.prisma, async (tx) => {
    const phoneLookupKey = createHostedPhoneLookupKey(input.phoneNumber);

    if (!phoneLookupKey) {
      throw hostedOnboardingError({
        code: "PHONE_NUMBER_INVALID",
        message: "A valid phone number is required to issue a hosted invite.",
        httpStatus: 400,
      });
    }

    const existingMember = await findHostedMemberByPhoneNumber({
      phoneNumber: input.phoneNumber,
      prisma: tx,
    });

    if (existingMember) {
      return refreshHostedMemberForPhone({
        member: existingMember,
        phoneNumber: input.phoneNumber,
        prisma: tx,
      });
    }

    const memberId = generateHostedMemberId();

    try {
      const createdMember = await createHostedMember({
        billingStatus: HostedBillingStatus.not_started,
        memberId,
        prisma: tx,
      });
      await upsertHostedMemberIdentity({
        ...buildHostedMemberPhoneIdentity(input.phoneNumber),
        memberId,
        prisma: tx,
        signupPhoneCodeSendAttemptId: null,
        signupPhoneCodeSendAttemptStartedAt: null,
        signupPhoneCodeSentAt: null,
        signupPhoneNumber: input.phoneNumber,
      });
      return createdMember;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const concurrentMember = await findHostedMemberByPhoneLookupKey({
          phoneLookupKey: buildHostedMemberPhoneIdentity(input.phoneNumber).phoneLookupKey,
          prisma: tx,
        });

        if (concurrentMember) {
          return refreshHostedMemberForPhone({
            member: concurrentMember,
            phoneNumber: input.phoneNumber,
            prisma: tx,
          });
        }
      }

      throw error;
    }
  });

  return member;
}

async function refreshHostedMemberForPhone(input: {
  member: HostedMember;
  phoneNumber: string;
  prisma: HostedOnboardingPrismaClient;
}): Promise<HostedMember> {
  const currentIdentity = await readHostedMemberIdentity({
    memberId: input.member.id,
    prisma: input.prisma,
  });

  await upsertHostedMemberIdentity({
    ...buildHostedMemberPhoneIdentity(input.phoneNumber),
    memberId: input.member.id,
    phoneNumberVerifiedAt: currentIdentity?.phoneNumberVerifiedAt ?? null,
    prisma: input.prisma,
    privyUserId: currentIdentity?.privyUserId ?? null,
    signupPhoneCodeSendAttemptId: null,
    signupPhoneCodeSendAttemptStartedAt: null,
    signupPhoneCodeSentAt: null,
    signupPhoneNumber: input.phoneNumber,
    walletAddress: currentIdentity?.walletAddress ?? null,
    walletChainType: currentIdentity?.walletChainType ?? null,
    walletCreatedAt: currentIdentity?.walletCreatedAt ?? null,
    walletProvider: currentIdentity?.walletProvider ?? null,
  });
  return input.member;
}

function buildHostedMemberPhoneIdentity(phoneNumber: string) {
  const maskedPhoneNumberHint = readHostedPhoneHint(phoneNumber);
  const phoneLookupKey = createHostedPhoneLookupKey(phoneNumber);

  if (!phoneLookupKey) {
    throw hostedOnboardingError({
      code: "PHONE_NUMBER_INVALID",
      message: "A valid phone number is required to continue.",
      httpStatus: 400,
    });
  }

  return {
    maskedPhoneNumberHint,
    phoneLookupKey,
    phoneNumberVerifiedAt: null,
    phoneNumber: phoneNumber.trim(),
    privyUserId: null,
    walletAddress: null,
    walletChainType: null,
    walletCreatedAt: null,
    walletProvider: null,
  };
}

function buildHostedMemberWalletStorage(input: {
  existingWalletAddress?: string | null;
  existingWalletChainType?: string | null;
  existingWalletCreatedAt?: Date | null;
  existingWalletProvider?: string | null;
  now: Date;
  wallet: HostedPrivyIdentity["wallet"];
}) {
  if (!input.wallet) {
    return {
      walletAddress: input.existingWalletAddress ?? null,
      walletChainType: input.existingWalletChainType ?? null,
      walletCreatedAt: input.existingWalletCreatedAt ?? null,
      walletProvider: input.existingWalletProvider ?? null,
    };
  }

  return {
    walletAddress: normalizeHostedWalletAddress(input.wallet.address),
    walletChainType: input.wallet.chainType,
    walletCreatedAt: input.existingWalletCreatedAt ?? input.now,
    walletProvider: "privy" as const,
  };
}

function assertHostedPrivyWalletAvailableWhenRequired(identity: HostedPrivyIdentity): void {
  if (!identity.wallet && isHostedOnboardingRevnetEnabled()) {
    throw hostedOnboardingError({
      code: "PRIVY_WALLET_REQUIRED",
      message: "Finish setup before continuing.",
      httpStatus: 400,
    });
  }
}

export function hasHostedMemberPrivyIdentity(member: {
  privyUserId?: string | null | undefined;
  privyUserLookupKey?: string | null | undefined;
}): boolean {
  return Boolean(member.privyUserId ?? member.privyUserLookupKey);
}

export async function persistHostedMemberLinqChatBinding(input: {
  linqChatId: string | null;
  memberId: string;
  prisma: HostedOnboardingPrismaClient;
}): Promise<void> {
  await upsertHostedMemberLinqChatBinding({
    linqChatId: input.linqChatId,
    memberId: input.memberId,
    prisma: input.prisma,
  });
}

export async function ensureHostedMemberForPrivyIdentity(input: {
  identity: HostedPrivyIdentity;
  now: Date;
  prisma: HostedOnboardingPrismaClient;
}): Promise<HostedMember> {
  assertHostedPrivyWalletAvailableWhenRequired(input.identity);

  const member = await withHostedOnboardingTransaction(input.prisma, async (tx) => {
    const existingMember = await findHostedMemberForPrivyIdentity({
      identity: input.identity,
      prisma: tx,
    });

    if (!existingMember) {
      const memberId = generateHostedMemberId();

      const createdMember = await createHostedMember({
        billingStatus: HostedBillingStatus.not_started,
        memberId,
        prisma: tx,
      });
      await upsertHostedMemberIdentity({
        ...buildHostedMemberPhoneIdentity(input.identity.phone.number),
        memberId,
        phoneNumberVerifiedAt: input.now,
        prisma: tx,
        privyUserId: input.identity.userId,
        signupPhoneCodeSendAttemptId: null,
        signupPhoneCodeSendAttemptStartedAt: null,
        signupPhoneCodeSentAt: null,
        signupPhoneNumber: null,
        ...buildHostedMemberWalletStorage({
          now: input.now,
          wallet: input.identity.wallet,
        }),
      });
      return createdMember;
    }

    return reconcileHostedPrivyIdentityOnMember({
      identity: input.identity,
      member: existingMember,
      prisma: tx,
      now: input.now,
    });
  });

  return member;
}

export async function reconcileHostedPrivyIdentityOnMember(input: {
  expectedPhoneHint?: string;
  expectedPhoneLookupKey?: string;
  identity: HostedPrivyIdentity;
  member: HostedMember;
  prisma: HostedOnboardingPrismaClient;
  now: Date;
}): Promise<HostedMember> {
  assertHostedPrivyWalletAvailableWhenRequired(input.identity);

  const member = await withHostedOnboardingTransaction(input.prisma, async (tx) => {
    const phoneLookupKey = createHostedPhoneLookupKey(input.identity.phone.number);
    await lockHostedMemberRow(tx, input.member.id);

    const currentMember = await readHostedMemberCoreState({
      memberId: input.member.id,
      prisma: tx,
    });
    const currentIdentity = await readHostedMemberIdentity({
      memberId: input.member.id,
      prisma: tx,
    });

    if (!phoneLookupKey) {
      throw hostedOnboardingError({
        code: "PHONE_NUMBER_INVALID",
        message: "A valid phone number is required to continue.",
        httpStatus: 400,
      });
    }

    if (!currentMember) {
      throw hostedOnboardingError({
        code: "HOSTED_MEMBER_NOT_FOUND",
        message: "Finish signup from your latest Murph link before continuing.",
        httpStatus: 403,
      });
    }

    if (
      input.expectedPhoneLookupKey
      && !hostedPhoneLookupKeyMatchesValue(input.identity.phone.number, input.expectedPhoneLookupKey)
    ) {
      throw hostedOnboardingError({
        code: "PRIVY_PHONE_MISMATCH",
        message: `Enter the same phone number that received this invite (${input.expectedPhoneHint ?? "your invited number"}).`,
        httpStatus: 403,
      });
    }

    if (currentIdentity?.privyUserId && currentIdentity.privyUserId !== input.identity.userId) {
      throw hostedOnboardingError({
        code: "PRIVY_USER_MISMATCH",
        message: "This phone number is already linked to a different Privy account.",
        httpStatus: 409,
      });
    }

    const normalizedWalletAddress = input.identity.wallet
      ? normalizeHostedWalletAddress(input.identity.wallet.address)
      : null;

    if (
      currentIdentity?.walletAddress
      && normalizedWalletAddress
      && normalizeHostedWalletAddress(currentIdentity.walletAddress) !== normalizedWalletAddress
    ) {
      throw hostedOnboardingError({
        code: "PRIVY_WALLET_MISMATCH",
        message: "This phone number is already linked to different verified account details.",
        httpStatus: 409,
      });
    }

    try {
      await upsertHostedMemberIdentity({
        ...buildHostedMemberPhoneIdentity(input.identity.phone.number),
        memberId: currentMember.id,
        phoneNumberVerifiedAt: input.now,
        prisma: tx,
        privyUserId: input.identity.userId,
        signupPhoneCodeSendAttemptId: null,
        signupPhoneCodeSendAttemptStartedAt: null,
        signupPhoneCodeSentAt: null,
        signupPhoneNumber: null,
        ...buildHostedMemberWalletStorage({
          existingWalletAddress: currentIdentity?.walletAddress,
          existingWalletChainType: currentIdentity?.walletChainType,
          existingWalletCreatedAt: currentIdentity?.walletCreatedAt,
          existingWalletProvider: currentIdentity?.walletProvider,
          now: input.now,
          wallet: input.identity.wallet,
        }),
      });
      return currentMember;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw hostedOnboardingError({
          code: "PRIVY_IDENTITY_CONFLICT",
          message: "This verified phone session conflicts with an existing Murph account. Contact support so we can merge it safely.",
          httpStatus: 409,
        });
      }

      throw error;
    }
  });

  return member;
}

export async function findHostedMemberForPrivyIdentity(input: {
  identity: HostedPrivyIdentity;
  prisma: HostedOnboardingPrismaClient;
}): Promise<HostedMember | null> {
  const matches = new Map<string, HostedMember>();
  const normalizedWalletAddress = input.identity.wallet
    ? normalizeHostedWalletAddress(input.identity.wallet.address)
    : null;
  const phoneLookupKey = createHostedPhoneLookupKey(input.identity.phone.number);

  if (input.identity.userId) {
    const memberByPrivyUserId = await findHostedMemberByPrivyUserId({
      privyUserId: input.identity.userId,
      prisma: input.prisma,
    });

    if (memberByPrivyUserId) {
      matches.set(memberByPrivyUserId.id, memberByPrivyUserId);
    }
  }

  const memberByPhoneNumber = phoneLookupKey
    ? await findHostedMemberByPhoneNumber({
        phoneNumber: input.identity.phone.number,
        prisma: input.prisma,
      })
    : null;

  if (memberByPhoneNumber) {
    matches.set(memberByPhoneNumber.id, memberByPhoneNumber);
  }

  if (normalizedWalletAddress) {
    const memberByWalletAddress = await findHostedMemberByWalletAddress({
      prisma: input.prisma,
      walletAddress: normalizedWalletAddress,
    });

    if (memberByWalletAddress) {
      matches.set(memberByWalletAddress.id, memberByWalletAddress);
    }
  }

  if (matches.size > 1) {
    throw hostedOnboardingError({
      code: "PRIVY_IDENTITY_CONFLICT",
      message: "This verified phone session conflicts with an existing Murph account. Contact support so we can merge it safely.",
      httpStatus: 409,
    });
  }

  return matches.values().next().value ?? null;
}
