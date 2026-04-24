import {
  HostedBillingStatus,
  Prisma,
  type HostedMember,
  type PrismaClient,
} from "@prisma/client";

import {
  createHostedPhoneLookupKey,
} from "./contact-privacy";
import { assertHostedMemberNotSuspended } from "./entitlement";
import { getPrisma } from "../prisma";
import { hostedOnboardingError } from "./errors";
import { type HostedPrivyIdentity } from "./privy";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  generateHostedMemberId,
  lockHostedMemberRow,
} from "./shared";
import {
  normalizeHostedWalletAddress,
} from "./revnet";
import { createHostedMember, readHostedMemberCoreState } from "./hosted-member-store";
import {
  lookupHostedMemberIdentityByPhoneLookupKey,
  lookupHostedMemberIdentityByPhoneNumber,
  readHostedMemberIdentity,
  type HostedMemberIdentityLookup,
  upsertHostedMemberIdentity,
} from "./hosted-member-identity-store";
import {
  assertHostedPrivyIdentityMatchesExpectedPhone,
  assertHostedPrivyWalletAvailableWhenRequired,
  buildHostedMemberPhoneIdentityFields,
  buildHostedMemberWalletIdentityFields,
  buildHostedPersistedPhoneIdentityFields,
} from "./member-identity-fields";
import {
  createHostedPrivyIdentityConflictError,
  hasHostedMemberPrivyIdentity,
  lookupHostedMemberForPrivyIdentity,
  type HostedMemberPrivyIdentityLookup,
} from "./member-identity-lookup";

export {
  hasHostedMemberPrivyIdentity,
  lookupHostedMemberForPrivyIdentity,
};
export type { HostedMemberPrivyIdentityLookup };

export async function ensureHostedMemberForPhone(input: {
  phoneNumber: string;
  prisma?: PrismaClient;
}): Promise<HostedMember> {
  const prisma = input.prisma ?? getPrisma();

  return prisma.$transaction((tx) => ensureHostedMemberForPhoneTx({
    phoneNumber: input.phoneNumber,
    prisma: tx,
  }), HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

export async function ensureHostedMemberForPhoneTx(input: {
  phoneNumber: string;
  prisma: Prisma.TransactionClient;
}): Promise<HostedMember> {
  const phoneLookupKey = createHostedPhoneLookupKey(input.phoneNumber);

  if (!phoneLookupKey) {
    throw hostedOnboardingError({
      code: "PHONE_NUMBER_INVALID",
      message: "A valid phone number is required to issue a hosted invite.",
      httpStatus: 400,
    });
  }

  const existingIdentity = await lookupHostedMemberIdentityByPhoneNumber({
    phoneNumber: input.phoneNumber,
    prisma: input.prisma,
  });

  if (existingIdentity) {
    return refreshHostedMemberForPhoneTx({
      currentIdentity: existingIdentity.identity,
      member: existingIdentity.core,
      phoneNumber: input.phoneNumber,
      prisma: input.prisma,
    });
  }

  const phoneIdentityFields = buildHostedMemberPhoneIdentityFields(input.phoneNumber);
  const memberId = generateHostedMemberId();

  try {
    const createdMember = await createHostedMember({
      billingStatus: HostedBillingStatus.not_started,
      memberId,
      prisma: input.prisma,
    });
    await upsertHostedMemberIdentity({
      ...phoneIdentityFields,
      memberId,
      prisma: input.prisma,
      signupPhoneCodeSendAttemptId: null,
      signupPhoneCodeSendAttemptStartedAt: null,
      signupPhoneCodeSentAt: null,
      signupPhoneNumber: input.phoneNumber,
    });
    return createdMember;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const concurrentIdentity = await lookupHostedMemberIdentityByPhoneLookupKey({
        phoneLookupKey: phoneIdentityFields.phoneLookupKey,
        prisma: input.prisma,
      });

      if (concurrentIdentity) {
        return refreshHostedMemberForPhoneTx({
          currentIdentity: concurrentIdentity.identity,
          member: concurrentIdentity.core,
          phoneNumber: input.phoneNumber,
          prisma: input.prisma,
        });
      }
    }

    throw error;
  }
}

async function refreshHostedMemberForPhoneTx(input: {
  currentIdentity: HostedMemberIdentityLookup["identity"] | null;
  member: HostedMember;
  phoneNumber: string;
  prisma: Prisma.TransactionClient;
}): Promise<HostedMember> {
  await upsertHostedMemberIdentity({
    ...buildHostedMemberPhoneIdentityFields(input.phoneNumber),
    memberId: input.member.id,
    phoneNumberVerifiedAt: input.currentIdentity?.phoneNumberVerifiedAt ?? null,
    prisma: input.prisma,
    privyUserId: input.currentIdentity?.privyUserId ?? null,
    signupPhoneCodeSendAttemptId: null,
    signupPhoneCodeSendAttemptStartedAt: null,
    signupPhoneCodeSentAt: null,
    signupPhoneNumber: input.phoneNumber,
    walletAddress: input.currentIdentity?.walletAddress ?? null,
    walletChainType: input.currentIdentity?.walletChainType ?? null,
    walletCreatedAt: input.currentIdentity?.walletCreatedAt ?? null,
    walletProvider: input.currentIdentity?.walletProvider ?? null,
  });
  return input.member;
}

export async function ensureHostedMemberForPrivyIdentity(input: {
  identity: HostedPrivyIdentity;
  now: Date;
  prisma?: PrismaClient;
}): Promise<HostedMember> {
  const prisma = input.prisma ?? getPrisma();

  return prisma.$transaction((tx) => ensureHostedMemberForPrivyIdentityTx({
    identity: input.identity,
    now: input.now,
    prisma: tx,
  }), HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

export async function requireExistingHostedMemberForPrivyIdentity(input: {
  identity: HostedPrivyIdentity;
  now: Date;
  prisma?: PrismaClient;
}): Promise<HostedMember> {
  const prisma = input.prisma ?? getPrisma();

  return prisma.$transaction((tx) => requireExistingHostedMemberForPrivyIdentityTx({
    identity: input.identity,
    now: input.now,
    prisma: tx,
  }), HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

export async function reconcileHostedPrivyIdentityOnMember(input: {
  expectedPhoneHint?: string;
  expectedPhoneLookupKey?: string;
  identity: HostedPrivyIdentity;
  member: HostedMember;
  prisma?: PrismaClient;
  now: Date;
}): Promise<HostedMember> {
  assertHostedPrivyWalletAvailableWhenRequired(input.identity);

  const prisma = input.prisma ?? getPrisma();

  return prisma.$transaction((tx) => reconcileHostedPrivyIdentityOnMemberTx({
    expectedPhoneHint: input.expectedPhoneHint,
    expectedPhoneLookupKey: input.expectedPhoneLookupKey,
    identity: input.identity,
    member: input.member,
    now: input.now,
    prisma: tx,
  }), HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

export async function ensureHostedMemberForPrivyIdentityTx(input: {
  identity: HostedPrivyIdentity;
  now: Date;
  prisma: Prisma.TransactionClient;
}): Promise<HostedMember> {
  assertHostedPrivyWalletAvailableWhenRequired(input.identity);

  const existingMemberLookup = await lookupHostedMemberForPrivyIdentity({
    identity: input.identity,
    prisma: input.prisma,
  });

  if (!existingMemberLookup) {
    const memberId = generateHostedMemberId();

    const createdMember = await createHostedMember({
      billingStatus: HostedBillingStatus.not_started,
      memberId,
      prisma: input.prisma,
    });
    const phoneIdentity = buildHostedPersistedPhoneIdentityFields({
      now: input.now,
      phone: input.identity.phone,
    });
    await upsertHostedMemberIdentity({
      ...phoneIdentity,
      memberId,
      prisma: input.prisma,
      privyUserId: input.identity.userId,
      signupPhoneCodeSendAttemptId: null,
      signupPhoneCodeSendAttemptStartedAt: null,
      signupPhoneCodeSentAt: null,
      signupPhoneNumber: null,
      ...buildHostedMemberWalletIdentityFields({
        now: input.now,
        wallet: input.identity.wallet,
      }),
    });
    return createdMember;
  }

  return reconcileHostedPrivyIdentityOnMemberTx({
    identity: input.identity,
    member: existingMemberLookup.core,
    now: input.now,
    prisma: input.prisma,
  });
}

export async function requireExistingHostedMemberForPrivyIdentityTx(input: {
  identity: HostedPrivyIdentity;
  now: Date;
  prisma: Prisma.TransactionClient;
}): Promise<HostedMember> {
  assertHostedPrivyWalletAvailableWhenRequired(input.identity);

  const existingMemberLookup = await lookupHostedMemberForPrivyIdentity({
    identity: input.identity,
    prisma: input.prisma,
  });

  if (!existingMemberLookup) {
    throw hostedOnboardingError({
      code: "HOSTED_SIGNIN_MEMBER_NOT_FOUND",
      message:
        "We could not find an existing Murph account for this verified sign-in method. Use a previously linked phone number, email address, or Telegram account, or sign up first.",
      httpStatus: 403,
    });
  }

  return reconcileHostedPrivyIdentityOnMemberTx({
    identity: input.identity,
    member: existingMemberLookup.core,
    now: input.now,
    prisma: input.prisma,
  });
}

export async function reconcileHostedPrivyIdentityOnMemberTx(input: {
  expectedPhoneHint?: string;
  expectedPhoneLookupKey?: string;
  identity: HostedPrivyIdentity;
  member: HostedMember;
  prisma: Prisma.TransactionClient;
  now: Date;
}): Promise<HostedMember> {
  assertHostedPrivyWalletAvailableWhenRequired(input.identity);
  await lockHostedMemberRow(input.prisma, input.member.id);

  const currentMember = await readHostedMemberCoreState({
    memberId: input.member.id,
    prisma: input.prisma,
  });
  const currentIdentity = await readHostedMemberIdentity({
    memberId: input.member.id,
    prisma: input.prisma,
  });

  if (!currentMember) {
    throw hostedOnboardingError({
      code: "HOSTED_MEMBER_NOT_FOUND",
      message: "Finish signup from your latest Murph link before continuing.",
      httpStatus: 403,
    });
  }
  assertHostedMemberNotSuspended(currentMember);

  assertHostedPrivyIdentityMatchesExpectedPhone({
    expectedPhoneHint: input.expectedPhoneHint,
    expectedPhoneLookupKey: input.expectedPhoneLookupKey,
    identity: input.identity,
  });

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

  const nextPhoneIdentity = buildHostedPersistedPhoneIdentityFields({
    currentIdentity,
    now: input.now,
    phone: input.identity.phone,
  });

  try {
    await upsertHostedMemberIdentity({
      ...nextPhoneIdentity,
      memberId: currentMember.id,
      prisma: input.prisma,
      privyUserId: input.identity.userId,
      signupPhoneCodeSendAttemptId: null,
      signupPhoneCodeSendAttemptStartedAt: null,
      signupPhoneCodeSentAt: null,
      signupPhoneNumber: null,
      ...buildHostedMemberWalletIdentityFields({
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
      throw createHostedPrivyIdentityConflictError();
    }

    throw error;
  }
}
