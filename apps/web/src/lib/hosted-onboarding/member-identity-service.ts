import {
  HostedBillingStatus,
  Prisma,
  type PrismaClient,
} from "@prisma/client";

import { createHostedPhoneLookupKey } from "./contact-privacy";
import { assertHostedMemberNotSuspended } from "./entitlement";
import { getPrisma } from "../prisma";
import {
  hostedOnboardingError,
} from "./errors";
import { type HostedPrivyIdentity } from "./privy";
import { resolveHostedPrivyAuthMethodFromIdentity } from "./privy-auth-method";
import type { HostedPrivyAuthMethod } from "./types";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  generateHostedMemberId,
  lockHostedMemberRow,
} from "./shared";
import {
  createHostedMember,
  type HostedMemberCoreState,
  readHostedMemberCoreState,
} from "./hosted-member-store";
import {
  lookupHostedMemberRoutingByPendingLinqParticipantContact,
  tryCreateHostedMemberPendingLinqParticipantContactTx,
  upsertHostedMemberPendingLinqParticipantContactTx,
} from "./hosted-member-routing-store";
import {
  lookupHostedMemberIdentityByPhoneLookupKey,
  lookupHostedMemberIdentityByPhoneNumber,
  readHostedMemberIdentity,
  type HostedMemberIdentityWriteInput,
  type HostedMemberIdentityLookup,
  tryCreateHostedMemberIdentity,
  upsertHostedMemberIdentity,
} from "./hosted-member-identity-store";
import {
  assertHostedPrivyIdentityMatchesExpectedEmail,
  assertHostedPrivyIdentityMatchesExpectedPhone,
  buildHostedMemberPhoneIdentityFields,
  buildHostedPersistedPhoneIdentityFields,
} from "./member-identity-fields";
import {
  createHostedPrivyIdentityConflictError,
  hasHostedMemberPrivyIdentity,
  lookupHostedMemberForPrivyAuthAttempt,
  lookupHostedMemberForPrivyPrincipal,
  type HostedMemberPrivyIdentityLookup,
} from "./member-identity-lookup";
import { type HostedLinqParticipantContact } from "./linq-participant-contact";

export {
  createHostedPrivyIdentityConflictError,
  hasHostedMemberPrivyIdentity,
  lookupHostedMemberForPrivyAuthAttempt,
  lookupHostedMemberForPrivyPrincipal,
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
    await lookupHostedMemberRoutingByPendingLinqParticipantContact({
      contact: input.contact,
      prisma: input.prisma,
    });

  if (existingRoutingLookup) {
    assertHostedMemberNotSuspended(existingRoutingLookup.core);
    return existingRoutingLookup.core;
  }

  const existingIdentityLookup = input.contact.kind === "phone"
    ? await lookupHostedMemberIdentityByPhoneNumber({
        phoneNumber: input.contact.value,
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
    await lookupHostedMemberRoutingByPendingLinqParticipantContact({
      contact: input.contact,
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
  });
  return input.member;
}

export async function ensureHostedMemberForPrivyIdentity(input: {
  authMethod?: HostedPrivyAuthMethod;
  identity: HostedPrivyIdentity;
  now: Date;
  prisma?: PrismaClient;
}): Promise<HostedMemberCoreState> {
  const prisma = input.prisma ?? getPrisma();

  return prisma.$transaction((tx) => ensureHostedMemberForPrivyIdentityTx({
    authMethod: input.authMethod,
    identity: input.identity,
    now: input.now,
    prisma: tx,
  }), HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

export async function reconcileHostedPrivyIdentityOnMember(input: {
  authMethod?: HostedPrivyAuthMethod;
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
    authMethod: input.authMethod,
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
  authMethod?: HostedPrivyAuthMethod;
  identity: HostedPrivyIdentity;
  now: Date;
  prisma: Prisma.TransactionClient;
}): Promise<HostedMemberCoreState> {
  const resolution = await ensureHostedMemberForPrivyIdentityResolutionTx(input);
  return resolution.member;
}

export async function ensureHostedMemberForPrivyIdentityResolutionTx(input: {
  authMethod?: HostedPrivyAuthMethod;
  identity: HostedPrivyIdentity;
  now: Date;
  prisma: Prisma.TransactionClient;
}): Promise<{
  created: boolean;
  member: HostedMemberCoreState;
}> {
  const authMethod = resolveHostedPrivyAuthMethodFromIdentity({
    authMethod: input.authMethod,
    identity: input.identity,
  });
  const existingMemberLookup = await lookupHostedMemberForPrivyAuthAttempt({
    authMethod,
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
      phone: shouldPersistHostedPrivyPhoneIdentity({
        authMethod,
      })
        ? input.identity.phone
        : null,
    });

    await upsertHostedPrivyMemberIdentity({
      ...phoneIdentity,
      memberId,
      prisma: input.prisma,
      privyUserId: input.identity.userId,
      signupPhoneCodeSendAttemptId: null,
      signupPhoneCodeSendAttemptStartedAt: null,
      signupPhoneCodeSentAt: null,
      signupPhoneNumber: null,
    });
    return {
      created: true,
      member: createdMember,
    };
  }

  return {
    created: false,
    member: await reconcileHostedPrivyIdentityOnMemberTx({
      authMethod,
      identity: input.identity,
      member: existingMemberLookup.core,
      now: input.now,
      prisma: input.prisma,
    }),
  };
}

export async function reconcileHostedPrivyIdentityOnMemberTx(input: {
  authMethod?: HostedPrivyAuthMethod;
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

  const authMethod = resolveHostedPrivyAuthMethodFromIdentity({
    authMethod: input.authMethod,
    identity: input.identity,
  });

  if (currentIdentity?.privyUserId && currentIdentity.privyUserId !== input.identity.userId) {
    throw hostedOnboardingError({
      code: "PRIVY_USER_MISMATCH",
      message: "This phone number is already linked to a different Privy account.",
      httpStatus: 409,
    });
  }

  const nextPhoneIdentity = buildHostedPersistedPhoneIdentityFields({
    currentIdentity,
    now: input.now,
    phone: shouldPersistHostedPrivyPhoneIdentity({
      authMethod,
      expectedPhoneLookupKey: input.expectedPhoneLookupKey,
    })
      ? input.identity.phone
      : null,
  });

  await upsertHostedPrivyMemberIdentity({
    ...nextPhoneIdentity,
    memberId: currentMember.id,
    prisma: input.prisma,
    privyUserId: input.identity.userId,
    signupPhoneCodeSendAttemptId: null,
    signupPhoneCodeSendAttemptStartedAt: null,
    signupPhoneCodeSentAt: null,
    signupPhoneNumber: null,
  });
  return currentMember;
}

async function upsertHostedPrivyMemberIdentity(
  input: HostedMemberIdentityWriteInput,
): Promise<void> {
  try {
    await upsertHostedMemberIdentity(input);
  } catch (error) {
    throw mapHostedMemberIdentityUniqueConstraintError(error);
  }
}

function isHostedMemberIdentityUniqueConstraintError(
  error: unknown,
): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function mapHostedMemberIdentityUniqueConstraintError(error: unknown): unknown {
  if (isHostedMemberIdentityUniqueConstraintError(error)) {
    return createHostedPrivyIdentityConflictError();
  }

  return error;
}

function shouldPersistHostedPrivyPhoneIdentity(input: {
  authMethod: HostedPrivyAuthMethod;
  expectedPhoneLookupKey?: string;
}): boolean {
  return input.authMethod === "phone" || Boolean(input.expectedPhoneLookupKey);
}
