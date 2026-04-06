import { Prisma, type HostedMember, type PrismaClient } from "@prisma/client";
import {
  HostedBillingStatus,
  HostedMemberStatus,
} from "@prisma/client";

import {
  createHostedPhoneLookupKey,
  readHostedPhoneHint,
} from "./contact-privacy";
import { hostedOnboardingError } from "./errors";
import { type HostedPrivyIdentity } from "./privy";
import {
  generateHostedMemberId,
  withHostedOnboardingTransaction,
} from "./shared";
import { normalizeHostedWalletAddress } from "./revnet";
import {
  findHostedMemberByPhoneLookupKey,
  findHostedMemberByPrivyUserId,
  findHostedMemberByWalletAddress,
  readHostedMemberIdentity,
  syncHostedMemberPrivacyFoundationFromMember,
  upsertHostedMemberLinqChatBinding,
} from "./hosted-member-store";

export async function ensureHostedMemberForPhone(input: {
  phoneNumber: string;
  prisma: PrismaClient | Prisma.TransactionClient;
}): Promise<HostedMember> {
  return withHostedOnboardingTransaction(input.prisma, async (tx) => {
    const phoneLookupKey = createHostedPhoneLookupKey(input.phoneNumber);

    if (!phoneLookupKey) {
      throw hostedOnboardingError({
        code: "PHONE_NUMBER_INVALID",
        message: "A valid phone number is required to issue a hosted invite.",
        httpStatus: 400,
      });
    }

    const existingMember = await findHostedMemberByPhoneLookupKey({
      phoneLookupKey,
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
      const createdMember = await tx.hostedMember.create({
        data: {
          ...buildHostedMemberPhoneStorage(input.phoneNumber),
          id: memberId,
          status: HostedMemberStatus.invited,
          billingStatus: HostedBillingStatus.not_started,
        },
      });
      await syncHostedMemberPrivacyFoundationFromMember({
        member: createdMember,
        prisma: tx,
      });
      return createdMember;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const concurrentMember = await findHostedMemberByPhoneLookupKey({
          phoneLookupKey,
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
}

async function refreshHostedMemberForPhone(input: {
  member: HostedMember;
  phoneNumber: string;
  prisma: PrismaClient | Prisma.TransactionClient;
}): Promise<HostedMember> {
  const updatedMember = await input.prisma.hostedMember.update({
    where: {
      id: input.member.id,
    },
    data: {
      ...buildHostedMemberPhoneStorage(input.phoneNumber),
    },
  });
  await syncHostedMemberPrivacyFoundationFromMember({
    member: updatedMember,
    prisma: input.prisma,
  });
  return updatedMember;
}

function buildHostedMemberPhoneStorage(phoneNumber: string) {
  const phoneLookupKey = createHostedPhoneLookupKey(phoneNumber);
  if (!phoneLookupKey) {
    throw hostedOnboardingError({
      code: "PHONE_NUMBER_INVALID",
      message: "A valid phone number is required to continue.",
      httpStatus: 400,
    });
  }

  return {
    maskedPhoneNumberHint: readHostedPhoneHint(phoneNumber),
    normalizedPhoneNumber: phoneLookupKey,
  };
}

export async function persistHostedMemberLinqChatBinding(input: {
  linqChatId: string | null;
  memberId: string;
  prisma: PrismaClient | Prisma.TransactionClient;
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
  prisma: PrismaClient;
}): Promise<HostedMember> {
  const existingMember = await findHostedMemberForPrivyIdentity({
    identity: input.identity,
    prisma: input.prisma,
  });

  if (!existingMember) {
    const memberId = generateHostedMemberId();

    const createdMember = await input.prisma.hostedMember.create({
      data: {
        id: memberId,
        ...buildHostedMemberPhoneStorage(input.identity.phone.number),
        phoneNumberVerifiedAt: input.now,
        privyUserId: input.identity.userId,
        status: HostedMemberStatus.registered,
        billingStatus: HostedBillingStatus.not_started,
        walletAddress: normalizeHostedWalletAddress(input.identity.wallet.address),
        walletChainType: input.identity.wallet.chainType,
        walletProvider: "privy",
        walletCreatedAt: input.now,
      },
    });
    await syncHostedMemberPrivacyFoundationFromMember({
      member: createdMember,
      prisma: input.prisma,
    });
    return createdMember;
  }

  return reconcileHostedPrivyIdentityOnMember({
    identity: input.identity,
    member: existingMember,
    prisma: input.prisma,
    now: input.now,
  });
}

export async function reconcileHostedPrivyIdentityOnMember(input: {
  expectedPhoneHint?: string;
  expectedPhoneLookupKey?: string;
  identity: HostedPrivyIdentity;
  member: HostedMember;
  prisma: PrismaClient;
  now: Date;
}): Promise<HostedMember> {
  const phoneLookupKey = createHostedPhoneLookupKey(input.identity.phone.number);
  const currentIdentity = await readHostedMemberIdentity({
    memberId: input.member.id,
    prisma: input.prisma,
  }) ?? {
    privyUserId: input.member.privyUserId,
    walletAddress: input.member.walletAddress,
    walletCreatedAt: input.member.walletCreatedAt,
  };

  if (!phoneLookupKey) {
    throw hostedOnboardingError({
      code: "PHONE_NUMBER_INVALID",
      message: "A valid phone number is required to continue.",
      httpStatus: 400,
    });
  }

  if (
    input.expectedPhoneLookupKey
    && input.expectedPhoneLookupKey !== phoneLookupKey
  ) {
    throw hostedOnboardingError({
      code: "PRIVY_PHONE_MISMATCH",
      message: `Enter the same phone number that received this invite (${input.expectedPhoneHint ?? "your invited number"}).`,
      httpStatus: 403,
    });
  }

  if (currentIdentity.privyUserId && currentIdentity.privyUserId !== input.identity.userId) {
    throw hostedOnboardingError({
      code: "PRIVY_USER_MISMATCH",
      message: "This phone number is already linked to a different Privy account.",
      httpStatus: 409,
    });
  }

  const normalizedWalletAddress = normalizeHostedWalletAddress(input.identity.wallet.address);

  if (
    currentIdentity.walletAddress
    && normalizeHostedWalletAddress(currentIdentity.walletAddress) !== normalizedWalletAddress
  ) {
    throw hostedOnboardingError({
      code: "PRIVY_WALLET_MISMATCH",
      message: "This phone number is already linked to different verified account details.",
      httpStatus: 409,
    });
  }

  try {
    const updatedMember = await input.prisma.hostedMember.update({
      where: {
        id: input.member.id,
      },
      data: {
        ...buildHostedMemberPhoneStorage(input.identity.phone.number),
        phoneNumberVerifiedAt: input.now,
        privyUserId: input.identity.userId,
        status:
          input.member.status === HostedMemberStatus.suspended
            ? HostedMemberStatus.suspended
            : HostedMemberStatus.registered,
        walletAddress: normalizedWalletAddress,
        walletChainType: input.identity.wallet.chainType,
        walletProvider: "privy",
        walletCreatedAt: currentIdentity.walletCreatedAt ?? input.now,
      },
    });
    await syncHostedMemberPrivacyFoundationFromMember({
      member: updatedMember,
      prisma: input.prisma,
    });
    return updatedMember;
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
}

export async function findHostedMemberForPrivyIdentity(input: {
  identity: HostedPrivyIdentity;
  prisma: PrismaClient;
}): Promise<HostedMember | null> {
  const matches = new Map<string, HostedMember>();
  const normalizedWalletAddress = normalizeHostedWalletAddress(input.identity.wallet.address);
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
    ? await findHostedMemberByPhoneLookupKey({
        phoneLookupKey,
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
