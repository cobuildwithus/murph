import { Prisma, type HostedMember, type PrismaClient } from "@prisma/client";
import {
  HostedBillingStatus,
  HostedMemberStatus,
} from "@prisma/client";

import { hostedOnboardingError } from "./errors";
import { type HostedPrivyIdentity } from "./privy";
import { getHostedOnboardingEnvironment, getHostedOnboardingSecretCodec } from "./runtime";
import {
  generateHostedBootstrapSecret,
  generateHostedMemberId,
  maskPhoneNumber,
} from "./shared";
import { normalizeHostedWalletAddress } from "./revnet";

export async function ensureHostedMemberForPhone(input: {
  linqChatId: string | null;
  normalizedPhoneNumber: string;
  prisma: PrismaClient | Prisma.TransactionClient;
}): Promise<HostedMember> {
  const existingMember = await input.prisma.hostedMember.findUnique({
    where: {
      normalizedPhoneNumber: input.normalizedPhoneNumber,
    },
  });

  if (existingMember) {
    return input.prisma.hostedMember.update({
      where: {
        id: existingMember.id,
      },
      data: {
        linqChatId: input.linqChatId ?? undefined,
        ...buildHostedMemberPhoneStorage(input.normalizedPhoneNumber),
        encryptedBootstrapSecret:
          existingMember.encryptedBootstrapSecret
            ? undefined
            : encryptHostedBootstrapSecret(),
        encryptionKeyVersion:
          existingMember.encryptionKeyVersion
            ? undefined
            : getHostedOnboardingEnvironment().encryptionKeyVersion,
      },
    });
  }

  return input.prisma.hostedMember.create({
    data: {
      id: generateHostedMemberId(),
      ...buildHostedMemberPhoneStorage(input.normalizedPhoneNumber),
      status: HostedMemberStatus.invited,
      billingStatus: HostedBillingStatus.not_started,
      linqChatId: input.linqChatId,
      encryptedBootstrapSecret: encryptHostedBootstrapSecret(),
      encryptionKeyVersion: getHostedOnboardingEnvironment().encryptionKeyVersion,
    },
  });
}

function buildHostedMemberPhoneStorage(normalizedPhoneNumber: string) {
  return {
    maskedPhoneNumberHint: maskPhoneNumber(normalizedPhoneNumber),
    normalizedPhoneNumber,
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
  expectedPhoneNumber?: string;
  identity: HostedPrivyIdentity;
  member: HostedMember;
  prisma: PrismaClient;
  now: Date;
}): Promise<HostedMember> {
  if (input.expectedPhoneNumber && input.identity.phone.number !== input.expectedPhoneNumber) {
    throw hostedOnboardingError({
      code: "PRIVY_PHONE_MISMATCH",
      message: `Enter the same phone number that received this invite (${maskPhoneNumber(input.expectedPhoneNumber)}).`,
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

  const memberByPhoneNumber = await input.prisma.hostedMember.findUnique({
    where: {
      normalizedPhoneNumber: input.identity.phone.number,
    },
  });

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
