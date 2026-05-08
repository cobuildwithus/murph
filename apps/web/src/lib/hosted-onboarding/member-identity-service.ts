import {
  HostedBillingStatus,
  Prisma,
  type PrismaClient,
} from "@prisma/client";

import { createHostedPhoneLookupKey } from "./contact-privacy";
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
} from "./wallet-address";
import {
  createHostedMember,
  type HostedMemberCoreState,
  readHostedMemberCoreState,
} from "./hosted-member-store";
import {
  lookupHostedMemberRoutingByPendingLinqParticipantContactLookupKey,
  tryCreateHostedMemberPendingLinqParticipantContactTx,
  upsertHostedMemberPendingLinqParticipantContactTx,
} from "./hosted-member-routing-store";
import {
  lookupHostedMemberIdentityByPhoneLookupKey,
  lookupHostedMemberIdentityByPhoneNumber,
  readHostedMemberIdentity,
  type HostedMemberIdentityLookup,
  tryCreateHostedMemberIdentity,
  upsertHostedMemberIdentity,
} from "./hosted-member-identity-store";
import {
  assertHostedPrivyIdentityMatchesExpectedEmail,
  assertHostedPrivyIdentityMatchesExpectedPhone,
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
import type { HostedLinqParticipantContact } from "./linq-participant-contact";

export {
  hasHostedMemberPrivyIdentity,
  lookupHostedMemberForPrivyIdentity,
};
export type { HostedMemberPrivyIdentityLookup };

export async function ensureHostedMemberForPhone(input: {
  phoneNumber: string;
  prisma?: PrismaClient;
}): Promise<HostedMemberCoreState> {
  const prisma = input.prisma ?? getPrisma();

  return prisma.$transaction((tx) => ensureHostedMemberForPhoneTx({
    phoneNumber: input.phoneNumber,
    prisma: tx,
  }), HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

export async function ensureHostedMemberForPhoneTx(input: {
  phoneNumber: string;
  prisma: Prisma.TransactionClient;
}): Promise<HostedMemberCoreState> {
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

  const createdMember = await createHostedMember({
    billingStatus: HostedBillingStatus.not_started,
    memberId,
    prisma: input.prisma,
  });
  const identityCreated = await tryCreateHostedMemberIdentity({
    ...phoneIdentityFields,
    memberId,
    prisma: input.prisma,
    signupPhoneCodeSendAttemptId: null,
    signupPhoneCodeSendAttemptStartedAt: null,
    signupPhoneCodeSentAt: null,
    signupPhoneNumber: input.phoneNumber,
  });

  if (identityCreated) {
    return createdMember;
  }

  await input.prisma.hostedMember.delete({
    where: {
      id: memberId,
    },
  });
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

  throw new Prisma.PrismaClientKnownRequestError(
    "Hosted member phone identity was not created and no concurrent identity was found.",
    {
      clientVersion: Prisma.prismaVersion.client,
      code: "P2002",
    },
  );
}

export async function ensureHostedMemberForPendingLinqParticipantContactTx(input: {
  contact: HostedLinqParticipantContact;
  observedAt: Date;
  prisma: Prisma.TransactionClient;
}): Promise<HostedMemberCoreState> {
  if (Number.isNaN(input.observedAt.getTime())) {
    throw new TypeError("Hosted Linq participant contact observed timestamp must be valid.");
  }

  const existingRoutingLookup =
    await lookupHostedMemberRoutingByPendingLinqParticipantContactLookupKey({
      lookupKey: input.contact.lookupKey,
      prisma: input.prisma,
    });

  if (existingRoutingLookup) {
    assertHostedMemberNotSuspended(existingRoutingLookup.core);
    return existingRoutingLookup.core;
  }

  const existingIdentityLookup = input.contact.kind === "phone"
    ? await lookupHostedMemberIdentityByPhoneLookupKey({
        phoneLookupKey: input.contact.lookupKey,
        prisma: input.prisma,
      })
    : null;

  if (existingIdentityLookup) {
    assertHostedMemberNotSuspended(existingIdentityLookup.core);
    await upsertHostedMemberPendingLinqParticipantContactTx({
      contact: input.contact,
      memberId: existingIdentityLookup.core.id,
      observedAt: input.observedAt,
      prisma: input.prisma,
    });
    return existingIdentityLookup.core;
  }

  const memberId = generateHostedMemberId();

  const createdMember = await createHostedMember({
    billingStatus: HostedBillingStatus.not_started,
    memberId,
    prisma: input.prisma,
  });
  await upsertHostedMemberIdentity({
    maskedPhoneNumberHint: null,
    memberId,
    phoneLookupKey: null,
    phoneNumber: null,
    phoneNumberVerifiedAt: null,
    prisma: input.prisma,
    privyUserId: null,
    signupPhoneCodeSendAttemptId: null,
    signupPhoneCodeSendAttemptStartedAt: null,
    signupPhoneCodeSentAt: null,
    signupPhoneNumber: null,
    walletAddress: null,
    walletChainType: null,
    walletCreatedAt: null,
    walletProvider: null,
  });
  const routingCreated = await tryCreateHostedMemberPendingLinqParticipantContactTx({
    contact: input.contact,
    memberId,
    observedAt: input.observedAt,
    prisma: input.prisma,
  });

  if (routingCreated) {
    return createdMember;
  }

  await input.prisma.hostedMember.delete({
    where: {
      id: memberId,
    },
  });
  const concurrentRoutingLookup =
    await lookupHostedMemberRoutingByPendingLinqParticipantContactLookupKey({
      lookupKey: input.contact.lookupKey,
      prisma: input.prisma,
    });

  if (concurrentRoutingLookup) {
    assertHostedMemberNotSuspended(concurrentRoutingLookup.core);
    return concurrentRoutingLookup.core;
  }

  throw new Prisma.PrismaClientKnownRequestError(
    "Hosted member pending Linq route was not created and no concurrent route was found.",
    {
      clientVersion: Prisma.prismaVersion.client,
      code: "P2002",
    },
  );
}

async function refreshHostedMemberForPhoneTx(input: {
  currentIdentity: HostedMemberIdentityLookup["identity"] | null;
  member: HostedMemberCoreState;
  phoneNumber: string;
  prisma: Prisma.TransactionClient;
}): Promise<HostedMemberCoreState> {
  assertHostedMemberNotSuspended(input.member);
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
}): Promise<HostedMemberCoreState> {
  const prisma = input.prisma ?? getPrisma();

  return prisma.$transaction((tx) => ensureHostedMemberForPrivyIdentityTx({
    identity: input.identity,
    now: input.now,
    prisma: tx,
  }), HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

export async function reconcileHostedPrivyIdentityOnMember(input: {
  expectedEmailLookupKey?: string;
  expectedPhoneHint?: string;
  expectedPhoneLookupKey?: string;
  identity: HostedPrivyIdentity;
  member: HostedMemberCoreState;
  prisma?: PrismaClient;
  now: Date;
}): Promise<HostedMemberCoreState> {
  const prisma = input.prisma ?? getPrisma();

  return prisma.$transaction((tx) => reconcileHostedPrivyIdentityOnMemberTx({
    expectedPhoneHint: input.expectedPhoneHint,
    expectedPhoneLookupKey: input.expectedPhoneLookupKey,
    expectedEmailLookupKey: input.expectedEmailLookupKey,
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
}): Promise<HostedMemberCoreState> {
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

export async function reconcileHostedPrivyIdentityOnMemberTx(input: {
  expectedEmailLookupKey?: string;
  expectedPhoneHint?: string;
  expectedPhoneLookupKey?: string;
  identity: HostedPrivyIdentity;
  member: HostedMemberCoreState;
  prisma: Prisma.TransactionClient;
  now: Date;
}): Promise<HostedMemberCoreState> {
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
  assertHostedPrivyIdentityMatchesExpectedEmail({
    expectedEmailLookupKey: input.expectedEmailLookupKey,
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
