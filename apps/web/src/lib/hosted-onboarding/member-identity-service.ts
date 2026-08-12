import {
  HostedBillingStatus,
  Prisma,
  type PrismaClient,
} from "@prisma/client";

import {
  createHostedEmailLookupKeyReadCandidates,
  createHostedPhoneLookupKey,
  createHostedPrivyUserLookupKeyReadCandidates,
  hostedPhoneLookupKeyMatchesValue,
} from "./contact-privacy";
import { assertHostedMemberNotSuspended } from "./entitlement";
import { getPrisma } from "../prisma";
import {
  HostedDomainRootPreparationMismatchError,
  type PreparedHostedDomainRootForWeb,
} from "../hosted-crypto/domain-root-store";
import {
  hostedOnboardingError,
} from "./errors";
import {
  readHostedPrivyUserById,
  resolveHostedPrivyIdentityFromVerifiedUser,
  type HostedPrivyIdentity,
} from "./privy";
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
import {
  acquireHostedLinqParticipantPhoneLockTx,
  type HostedLinqParticipantContact,
} from "./linq-participant-contact";

export {
  createHostedPrivyIdentityConflictError,
  hasHostedMemberPrivyIdentity,
  lookupHostedMemberForPrivyAuthAttempt,
  lookupHostedMemberForPrivyPrincipal,
};
export type { HostedMemberPrivyIdentityLookup };

const HOSTED_PRIVY_AUTHORITY_TIMEOUT_MS = 5_000;

export async function ensureHostedMemberForPhone(input: {
  phoneNumber: string;
  prisma?: PrismaClient;
  phoneNumberVerifiedAt?: Date | null;
}): Promise<HostedMemberCoreState> {
  const prisma = input.prisma ?? getPrisma();

  return prisma.$transaction((tx) => ensureHostedMemberForPhoneTx({
    phoneNumber: input.phoneNumber,
    phoneNumberVerifiedAt: input.phoneNumberVerifiedAt,
    prisma: tx,
  }), HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

export async function ensureHostedMemberForPhoneTx(input: {
  phoneNumber: string;
  phoneNumberVerifiedAt?: Date | null;
  prisma: Prisma.TransactionClient;
}): Promise<HostedMemberCoreState> {
  const resolution = await ensureHostedMemberForPhoneResolutionTx(input);
  return resolution.member;
}

export async function ensureHostedMemberForPhoneResolutionTx(input: {
  phoneNumber: string;
  phoneNumberVerifiedAt?: Date | null;
  prisma: Prisma.TransactionClient;
}): Promise<{
  created: boolean;
  member: HostedMemberCoreState;
}> {
  const phoneLookupKey = createHostedPhoneLookupKey(input.phoneNumber);

  if (!phoneLookupKey) {
    throw hostedOnboardingError({
      code: "PHONE_NUMBER_INVALID",
      message: "A valid phone number is required to issue a hosted invite.",
      httpStatus: 400,
    });
  }

  await acquireHostedLinqParticipantPhoneLockTx({
    phoneNumber: input.phoneNumber,
    tx: input.prisma,
  });

  const existingIdentity = await lookupHostedMemberIdentityByPhoneNumber({
    phoneNumber: input.phoneNumber,
    prisma: input.prisma,
  });

  if (existingIdentity) {
    return {
      created: false,
      member: await refreshHostedMemberForPhoneTx({
        currentIdentity: existingIdentity.identity,
        member: existingIdentity.core,
        phoneNumber: input.phoneNumber,
        phoneNumberVerifiedAt: input.phoneNumberVerifiedAt,
        prisma: input.prisma,
      }),
    };
  }

  const phoneIdentityFields = {
    ...buildHostedMemberPhoneIdentityFields(input.phoneNumber),
    phoneNumberVerifiedAt: input.phoneNumberVerifiedAt ?? null,
  };
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
    return {
      created: true,
      member: createdMember,
    };
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
    return {
      created: false,
      member: await refreshHostedMemberForPhoneTx({
        currentIdentity: concurrentIdentity.identity,
        member: concurrentIdentity.core,
        phoneNumber: input.phoneNumber,
        phoneNumberVerifiedAt: input.phoneNumberVerifiedAt,
        prisma: input.prisma,
      }),
    };
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
  phoneNumberVerifiedAt?: Date | null;
  prisma: Prisma.TransactionClient;
}): Promise<HostedMemberCoreState> {
  assertHostedMemberNotSuspended(input.member);
  await upsertHostedMemberIdentity({
    ...buildHostedMemberPhoneIdentityFields(input.phoneNumber),
    memberId: input.member.id,
    phoneNumberVerifiedAt:
      input.phoneNumberVerifiedAt ?? input.currentIdentity?.phoneNumberVerifiedAt ?? null,
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
  allowVerifiedEmailRebinding?: boolean;
  authMethod?: HostedPrivyAuthMethod;
  identity: HostedPrivyIdentity;
  now: Date;
  prisma?: PrismaClient;
}): Promise<HostedMemberCoreState> {
  const prisma = input.prisma ?? getPrisma();

  return prisma.$transaction((tx) => ensureHostedMemberForPrivyIdentityTx({
    allowVerifiedEmailRebinding: input.allowVerifiedEmailRebinding,
    authMethod: input.authMethod,
    identity: input.identity,
    now: input.now,
    prisma: tx,
  }), HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

export async function reconcileHostedPrivyIdentityOnMember(input: {
  allowVerifiedEmailRebinding?: boolean;
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

  return prisma.$transaction(async (tx) => (
    await reconcileHostedPrivyIdentityOnMemberResolutionTx({
      allowVerifiedEmailRebinding: input.allowVerifiedEmailRebinding,
      authMethod: input.authMethod,
      expectedPhoneHint: input.expectedPhoneHint,
      expectedPhoneLookupKey: input.expectedPhoneLookupKey,
      expectedEmailLookupKey: input.expectedEmailLookupKey,
      identity: input.identity,
      member: input.member,
      now: input.now,
      prisma: tx,
    })
  ).member, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

export async function ensureHostedMemberForPrivyIdentityTx(input: {
  allowVerifiedEmailRebinding?: boolean;
  authMethod?: HostedPrivyAuthMethod;
  identity: HostedPrivyIdentity;
  now: Date;
  prisma: Prisma.TransactionClient;
}): Promise<HostedMemberCoreState> {
  const resolution = await ensureHostedMemberForPrivyIdentityResolutionTx(input);
  return resolution.member;
}

export async function ensureHostedMemberForPrivyIdentityResolutionTx(input: {
  allowVerifiedEmailRebinding?: boolean;
  authMethod?: HostedPrivyAuthMethod;
  identity: HostedPrivyIdentity;
  preparedControlRoot?: PreparedHostedDomainRootForWeb;
  preparedLiveIdentity?: HostedPrivyIdentity;
  preparedNewMemberId?: string;
  now: Date;
  prisma: Prisma.TransactionClient;
}): Promise<{
  created: boolean;
  identity: HostedPrivyIdentity;
  member: HostedMemberCoreState;
}> {
  const authMethod = resolveHostedPrivyAuthMethodFromIdentity({
    authMethod: input.authMethod,
    identity: input.identity,
  });
  if (
    shouldPersistHostedPrivyPhoneIdentity({ authMethod })
    && input.identity.phone
  ) {
    await acquireHostedLinqParticipantPhoneLockTx({
      phoneNumber: input.identity.phone.number,
      tx: input.prisma,
    });
  }
  const memberByPrincipal = input.allowVerifiedEmailRebinding
    ? await lookupHostedMemberForPrivyPrincipal({
        identity: input.identity,
        prisma: input.prisma,
      })
    : null;
  const existingMember = memberByPrincipal ?? (await lookupHostedMemberForPrivyAuthAttempt({
    authMethod,
    identity: input.identity,
    prisma: input.prisma,
  }))?.core ?? null;

  if (
    existingMember
    && input.preparedControlRoot
    && input.preparedControlRoot.userId !== existingMember.id
  ) {
    throw new HostedDomainRootPreparationMismatchError();
  }

  if (!existingMember) {
    await assertHostedPrivyAccountDeletionNotPending({
      prisma: input.prisma,
      privyUserId: input.identity.userId,
    });
    const identity = await resolveHostedPrivyLiveIdentity({
      allowVerifiedEmailRebinding: input.allowVerifiedEmailRebinding,
      bearerIdentity: input.identity,
      preparedLiveIdentity: input.preparedLiveIdentity,
      requireLiveAuthority: true,
    });
    const memberId = input.preparedNewMemberId ?? generateHostedMemberId();

    const createdMember = await createHostedMember({
      billingStatus: HostedBillingStatus.not_started,
      memberId,
      prisma: input.prisma,
    });
    const phoneIdentity = buildHostedPersistedPhoneIdentityFields({
      now: input.now,
      phone: shouldPersistHostedPrivyPhoneIdentity({
        authMethod,
      }) && canPersistHostedInteractiveLivePhone({
        allowLiveAuthority: input.allowVerifiedEmailRebinding,
        bearerIdentity: input.identity,
        liveIdentity: identity,
      })
        ? identity.phone
        : null,
    });

    await upsertHostedPrivyMemberIdentity({
      ...phoneIdentity,
      memberId,
      preparedControlRoot: input.preparedControlRoot,
      prisma: input.prisma,
      privyUserId: identity.userId,
      signupPhoneCodeSendAttemptId: null,
      signupPhoneCodeSendAttemptStartedAt: null,
      signupPhoneCodeSentAt: null,
      signupPhoneNumber: null,
    });
    return {
      created: true,
      identity,
      member: createdMember,
    };
  }

  const reconciliation = await reconcileHostedPrivyIdentityOnMemberResolutionTx({
    allowVerifiedEmailRebinding: input.allowVerifiedEmailRebinding,
    authMethod,
    identity: input.identity,
    member: existingMember,
    now: input.now,
    preparedLiveIdentity: input.preparedLiveIdentity,
    preparedControlRoot: input.preparedControlRoot,
    prisma: input.prisma,
  });
  return {
    created: false,
    identity: reconciliation.identity,
    member: reconciliation.member,
  };
}

export async function reconcileHostedPrivyIdentityOnMemberTx(input: {
  allowVerifiedEmailRebinding?: boolean;
  authMethod?: HostedPrivyAuthMethod;
  expectedEmailLookupKey?: string;
  expectedPhoneHint?: string;
  expectedPhoneLookupKey?: string;
  identity: HostedPrivyIdentity;
  member: HostedMemberCoreState;
  prisma: Prisma.TransactionClient;
  now: Date;
}): Promise<HostedMemberCoreState> {
  return (await reconcileHostedPrivyIdentityOnMemberResolutionTx(input)).member;
}

export async function reconcileHostedPrivyIdentityOnMemberResolutionTx(input: {
  allowVerifiedEmailRebinding?: boolean;
  authMethod?: HostedPrivyAuthMethod;
  expectedEmailLookupKey?: string;
  expectedPhoneHint?: string;
  expectedPhoneLookupKey?: string;
  identity: HostedPrivyIdentity;
  member: HostedMemberCoreState;
  preparedControlRoot?: PreparedHostedDomainRootForWeb;
  preparedLiveIdentity?: HostedPrivyIdentity;
  prisma: Prisma.TransactionClient;
  now: Date;
}): Promise<{
  identity: HostedPrivyIdentity;
  member: HostedMemberCoreState;
}> {
  if (
    input.identity.phone
    && (
      !input.authMethod
      || input.authMethod === "phone"
      || Boolean(input.expectedPhoneLookupKey)
    )
  ) {
    await acquireHostedLinqParticipantPhoneLockTx({
      phoneNumber: input.identity.phone.number,
      tx: input.prisma,
    });
  }

  await lockHostedMemberRow(input.prisma, input.member.id);
  await assertHostedPrivyAccountDeletionNotPending({
    prisma: input.prisma,
    privyUserId: input.identity.userId,
  });

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

  const privyUserChanged = Boolean(
    currentIdentity?.privyUserId
    && currentIdentity.privyUserId !== input.identity.userId,
  );
  const identity = await resolveHostedPrivyLiveIdentity({
    allowVerifiedEmailRebinding: input.allowVerifiedEmailRebinding,
    bearerIdentity: input.identity,
    preparedLiveIdentity: input.preparedLiveIdentity,
  });

  assertHostedPrivyIdentityMatchesExpectedPhone({
    expectedPhoneHint: input.expectedPhoneHint,
    expectedPhoneLookupKey: input.expectedPhoneLookupKey,
    identity,
  });
  assertHostedPrivyIdentityMatchesExpectedEmail({
    expectedEmailLookupKey: input.expectedEmailLookupKey,
    identity,
  });

  const authMethod = resolveHostedPrivyAuthMethodFromIdentity({
    authMethod: input.authMethod,
    identity,
  });
  const verifiedEmailAuthorizesRebinding = privyUserChanged && input.allowVerifiedEmailRebinding
    ? await hasHostedVerifiedEmailRebindingAuthorityTx({
        identity,
        memberId: currentMember.id,
        prisma: input.prisma,
      })
    : false;
  if (privyUserChanged && !verifiedEmailAuthorizesRebinding) {
    throw hostedOnboardingError({
      code: "PRIVY_USER_MISMATCH",
      message: "This phone number is already linked to a different Privy account.",
      httpStatus: 409,
    });
  }

  const canPersistPhone = shouldPersistHostedPrivyPhoneIdentity({
    authMethod,
    expectedPhoneLookupKey: input.expectedPhoneLookupKey,
  }) && !privyUserChanged && canPersistHostedInteractiveLivePhone({
    allowLiveAuthority: input.allowVerifiedEmailRebinding,
    bearerIdentity: input.identity,
    currentIdentity,
    liveIdentity: identity,
  });
  let phoneToPersist = canPersistPhone ? identity.phone : null;
  if (
    phoneToPersist
    && !currentIdentity?.phoneLookupKey
    && !currentIdentity?.phoneNumber
  ) {
    const phoneOwner = await lookupHostedMemberIdentityByPhoneNumber({
      phoneNumber: phoneToPersist.number,
      prisma: input.prisma,
    });
    if (phoneOwner && phoneOwner.core.id !== currentMember.id) {
      phoneToPersist = null;
    }
  }

  const nextPhoneIdentity = buildHostedPersistedPhoneIdentityFields({
    currentIdentity,
    now: input.now,
    phone: phoneToPersist,
  });

  await upsertHostedPrivyMemberIdentity({
    ...nextPhoneIdentity,
    memberId: currentMember.id,
    preparedControlRoot: input.preparedControlRoot,
    prisma: input.prisma,
    privyUserId: identity.userId,
    signupPhoneCodeSendAttemptId: null,
    signupPhoneCodeSendAttemptStartedAt: null,
    signupPhoneCodeSentAt: null,
    signupPhoneNumber: null,
  });
  return {
    identity,
    member: currentMember,
  };
}

async function resolveHostedPrivyLiveIdentity(input: {
  allowVerifiedEmailRebinding?: boolean;
  bearerIdentity: HostedPrivyIdentity;
  preparedLiveIdentity?: HostedPrivyIdentity;
  requireLiveAuthority?: boolean;
}): Promise<HostedPrivyIdentity> {
  if (input.preparedLiveIdentity) {
    if (input.preparedLiveIdentity.userId !== input.bearerIdentity.userId) {
      throw new TypeError(
        "Prepared hosted Privy identity does not match the bearer principal.",
      );
    }
    return input.allowVerifiedEmailRebinding
      ? input.preparedLiveIdentity
      : input.bearerIdentity;
  }

  if (!input.allowVerifiedEmailRebinding && !input.requireLiveAuthority) {
    return input.bearerIdentity;
  }

  const liveUser = await readHostedPrivyUserById(input.bearerIdentity.userId, {
    maxRetries: 0,
    timeout: HOSTED_PRIVY_AUTHORITY_TIMEOUT_MS,
  });
  return input.allowVerifiedEmailRebinding
    ? resolveHostedPrivyIdentityFromVerifiedUser(liveUser)
    : input.bearerIdentity;
}

function canPersistHostedInteractiveLivePhone(input: {
  allowLiveAuthority?: boolean;
  bearerIdentity: HostedPrivyIdentity;
  currentIdentity?: {
    phoneLookupKey: string | null;
    phoneNumber: string | null;
  } | null;
  liveIdentity: HostedPrivyIdentity;
}): boolean {
  if (!input.allowLiveAuthority || !input.liveIdentity.phone) {
    return true;
  }

  if (input.currentIdentity?.phoneLookupKey) {
    return hostedPhoneLookupKeyMatchesValue(
      input.liveIdentity.phone.number,
      input.currentIdentity.phoneLookupKey,
    );
  }

  if (input.currentIdentity?.phoneNumber) {
    return input.currentIdentity.phoneNumber === input.liveIdentity.phone.number;
  }

  return input.bearerIdentity.phone?.number === input.liveIdentity.phone.number;
}

async function hasHostedVerifiedEmailRebindingAuthorityTx(input: {
  identity: HostedPrivyIdentity;
  memberId: string;
  prisma: Prisma.TransactionClient;
}): Promise<boolean> {
  if (!input.identity.email?.verifiedAt) {
    return false;
  }

  const lookupKeys = createHostedEmailLookupKeyReadCandidates(
    input.identity.email.address,
  );
  if (lookupKeys.length === 0) {
    return false;
  }

  const records = await input.prisma.$queryRaw<Array<{ memberId: string }>>(Prisma.sql`
    SELECT "member_id" AS "memberId"
    FROM "hosted_member_email_authorization"
    WHERE "verified_email_lookup_key" IN (${Prisma.join(lookupKeys)})
      AND "verified_email_verified_at" IS NOT NULL
    FOR UPDATE
  `);
  const matchedMemberIds = new Set(records.map((record) => record.memberId));

  return matchedMemberIds.size === 1 && matchedMemberIds.has(input.memberId);
}

export async function assertHostedPrivyAccountDeletionNotPending(input: {
  prisma: Pick<PrismaClient, "hostedAccountDeletionCleanup">;
  privyUserId: string;
}): Promise<void> {
  const privyUserLookupKeys = createHostedPrivyUserLookupKeyReadCandidates(
    input.privyUserId,
  );
  if (privyUserLookupKeys.length === 0) {
    return;
  }

  const pendingCleanup = await input.prisma.hostedAccountDeletionCleanup.findFirst({
    select: { id: true },
    where: {
      privyCompletedAt: null,
      privyUserLookupKey: {
        in: privyUserLookupKeys,
      },
    },
  });
  if (pendingCleanup) {
    throw hostedOnboardingError({
      code: "PRIVY_ACCOUNT_DELETION_IN_PROGRESS",
      httpStatus: 409,
      message: "Your previous account deletion is still finishing. Wait a moment and try again.",
      retryable: true,
    });
  }
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
