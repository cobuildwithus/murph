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
import { getHostedOnboardingEnvironment, getHostedOnboardingSecretCodec } from "./runtime";
import {
  generateHostedBootstrapSecret,
  generateHostedMemberId,
} from "./shared";
import { normalizeHostedWalletAddress } from "./revnet";

export async function ensureHostedMemberForPhone(input: {
  phoneNumber: string;
  prisma: PrismaClient | Prisma.TransactionClient;
}): Promise<HostedMember> {
  const phoneLookupKey = createHostedPhoneLookupKey(input.phoneNumber);

  if (!phoneLookupKey) {
    throw hostedOnboardingError({
      code: "PHONE_NUMBER_INVALID",
      message: "A valid phone number is required to issue a hosted invite.",
      httpStatus: 400,
    });
  }

  const existingMember = await input.prisma.hostedMember.findUnique({
    where: {
      normalizedPhoneNumber: phoneLookupKey,
    },
  });

  if (existingMember) {
    return refreshHostedMemberForPhone({
      member: existingMember,
      phoneNumber: input.phoneNumber,
      prisma: input.prisma,
    });
  }

  try {
    return await input.prisma.hostedMember.create({
      data: {
        ...buildHostedMemberPhoneStorage(input.phoneNumber),
        id: generateHostedMemberId(),
        status: HostedMemberStatus.invited,
        billingStatus: HostedBillingStatus.not_started,
        linqChatId: null,
        encryptedBootstrapSecret: encryptHostedBootstrapSecret(),
        encryptionKeyVersion: getHostedOnboardingEnvironment().encryptionKeyVersion,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const concurrentMember = await input.prisma.hostedMember.findUnique({
        where: {
          normalizedPhoneNumber: phoneLookupKey,
        },
      });

      if (concurrentMember) {
        return refreshHostedMemberForPhone({
          member: concurrentMember,
          phoneNumber: input.phoneNumber,
          prisma: input.prisma,
        });
      }
    }

    throw error;
  }
}

async function refreshHostedMemberForPhone(input: {
  member: HostedMember;
  phoneNumber: string;
  prisma: PrismaClient | Prisma.TransactionClient;
}): Promise<HostedMember> {
  return input.prisma.hostedMember.update({
    where: {
      id: input.member.id,
    },
    data: {
      linqChatId: null,
      ...buildHostedMemberPhoneStorage(input.phoneNumber),
      encryptedBootstrapSecret:
        input.member.encryptedBootstrapSecret
          ? undefined
          : encryptHostedBootstrapSecret(),
      encryptionKeyVersion:
        input.member.encryptionKeyVersion
          ? undefined
          : getHostedOnboardingEnvironment().encryptionKeyVersion,
    },
  });
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
    return input.prisma.hostedMember.create({
      data: {
        id: generateHostedMemberId(),
        ...buildHostedMemberPhoneStorage(input.identity.phone.number),
        phoneNumberVerifiedAt: input.now,
        privyUserId: input.identity.userId,
        status: HostedMemberStatus.registered,
        billingStatus: HostedBillingStatus.not_started,
        walletAddress: normalizeHostedWalletAddress(input.identity.wallet.address),
        walletChainType: input.identity.wallet.chainType,
        walletProvider: "privy",
        walletCreatedAt: input.now,
        encryptedBootstrapSecret: encryptHostedBootstrapSecret(),
        encryptionKeyVersion: getHostedOnboardingEnvironment().encryptionKeyVersion,
      },
    });
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

  if (input.member.privyUserId && input.member.privyUserId !== input.identity.userId) {
    throw hostedOnboardingError({
      code: "PRIVY_USER_MISMATCH",
      message: "This phone number is already linked to a different Privy account.",
      httpStatus: 409,
    });
  }

  const normalizedWalletAddress = normalizeHostedWalletAddress(input.identity.wallet.address);

  if (
    input.member.walletAddress
    && normalizeHostedWalletAddress(input.member.walletAddress) !== normalizedWalletAddress
  ) {
    throw hostedOnboardingError({
      code: "PRIVY_WALLET_MISMATCH",
      message: "This phone number is already linked to different verified account details.",
      httpStatus: 409,
    });
  }

  try {
    return await input.prisma.hostedMember.update({
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
            : input.member.billingStatus === HostedBillingStatus.active
              ? HostedMemberStatus.active
              : HostedMemberStatus.registered,
        walletAddress: normalizedWalletAddress,
        walletChainType: input.identity.wallet.chainType,
        walletProvider: "privy",
        walletCreatedAt: input.member.walletCreatedAt ?? input.now,
        encryptedBootstrapSecret:
          input.member.encryptedBootstrapSecret
            ? undefined
            : encryptHostedBootstrapSecret(),
        encryptionKeyVersion:
          input.member.encryptionKeyVersion
            ? undefined
            : getHostedOnboardingEnvironment().encryptionKeyVersion,
      },
    });
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

async function findHostedMemberForPrivyIdentity(input: {
  identity: HostedPrivyIdentity;
  prisma: PrismaClient;
}): Promise<HostedMember | null> {
  const matches = new Map<string, HostedMember>();
  const normalizedWalletAddress = normalizeHostedWalletAddress(input.identity.wallet.address);
  const phoneLookupKey = createHostedPhoneLookupKey(input.identity.phone.number);

  if (input.identity.userId) {
    const memberByPrivyUserId = await input.prisma.hostedMember.findUnique({
      where: {
        privyUserId: input.identity.userId,
      },
    });

    if (memberByPrivyUserId) {
      matches.set(memberByPrivyUserId.id, memberByPrivyUserId);
    }
  }

  const memberByPhoneNumber = phoneLookupKey
    ? await input.prisma.hostedMember.findUnique({
      where: {
        normalizedPhoneNumber: phoneLookupKey,
      },
    })
    : null;

  if (memberByPhoneNumber) {
    matches.set(memberByPhoneNumber.id, memberByPhoneNumber);
  }

  if (normalizedWalletAddress) {
    const memberByWalletAddress = await input.prisma.hostedMember.findUnique({
      where: {
        walletAddress: normalizedWalletAddress,
      },
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

function encryptHostedBootstrapSecret(): string {
  return getHostedOnboardingSecretCodec().encrypt(generateHostedBootstrapSecret());
}
