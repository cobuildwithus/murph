/**
 * Owns hosted member identity lookup, read, and write surfaces.
 */
import {
  type HostedMember,
  type HostedMemberIdentity,
  Prisma,
  type PrismaClient,
} from "@prisma/client";

import {
  createHostedPhoneLookupKeyReadCandidates,
  createHostedPrivyUserLookupKey,
  createHostedPrivyUserLookupKeyReadCandidates,
} from "./contact-privacy";
import { hostedOnboardingError } from "./errors";
import {
  buildHostedMemberIdentityPrivateColumns,
  readHostedMemberIdentityPrivateState,
} from "./member-private-codecs";
import {
  type HostedOnboardingReadClient,
  normalizeNullableString,
} from "./shared";
import { provisionActiveHostedDomainRootEnvelopeForUserOnly } from "../hosted-crypto/domain-root-store";

export interface HostedMemberIdentityState {
  maskedPhoneNumberHint: string | null;
  memberId: string;
  phoneNumber: string | null;
  phoneLookupKey: string | null;
  signupPhoneCodeSendAttemptId: string | null;
  signupPhoneCodeSendAttemptStartedAt: Date | null;
  signupPhoneCodeSentAt: Date | null;
  signupPhoneNumber: string | null;
  phoneNumberVerifiedAt: Date | null;
  privyUserId: string | null;
  walletAddress: string | null;
  walletChainType: string | null;
  walletCreatedAt: Date | null;
  walletProvider: string | null;
}

export type HostedMemberIdentityLookupState = Omit<HostedMemberIdentityState, "phoneLookupKey">;

export type HostedMemberIdentityLookupMatch =
  | "phoneLookupKey"
  | "phoneNumber"
  | "privyUserId";

export interface HostedMemberIdentityLookup {
  core: HostedMember;
  identity: HostedMemberIdentityLookupState;
  matchedBy: HostedMemberIdentityLookupMatch;
}

type HostedMemberIdentityRecordWithMember = HostedMemberIdentity & {
  member: HostedMember;
};

// Lookup helpers return the matched identity slice with the core row so auth
// and onboarding flows do not need to round-trip through readHostedMemberIdentity.

export interface HostedMemberIdentityWriteInput {
  maskedPhoneNumberHint: string | null;
  memberId: string;
  phoneLookupKey: string | null;
  phoneNumberVerifiedAt: Date | null;
  prisma: HostedOnboardingReadClient;
  phoneNumber: string | null;
  privyUserId: string | null;
  signupPhoneCodeSendAttemptId: string | null;
  signupPhoneCodeSendAttemptStartedAt: Date | null;
  signupPhoneCodeSentAt: Date | null;
  signupPhoneNumber: string | null;
}

export interface PreparedHostedMemberIdentityWrite {
  create: Prisma.HostedMemberIdentityUncheckedCreateInput;
  update: Prisma.HostedMemberIdentityUncheckedUpdateInput;
}

export async function prepareHostedMemberIdentityWrite(input: Omit<
  HostedMemberIdentityWriteInput,
  "prisma"
> & { prisma: PrismaClient }): Promise<PreparedHostedMemberIdentityWrite> {
  await ensureHostedMemberIdentityControlRootTx({
    memberId: input.memberId,
    prisma: input.prisma,
  });
  const mutation = await buildHostedMemberIdentityMutationData(input);
  return {
    create: { memberId: input.memberId, ...mutation },
    update: mutation,
  };
}

export async function commitPreparedHostedMemberIdentityWriteTx(input: {
  memberId: string;
  prepared: PreparedHostedMemberIdentityWrite;
  prisma: Prisma.TransactionClient;
}): Promise<void> {
  await input.prisma.hostedMemberIdentity.upsert({
    create: input.prepared.create,
    update: input.prepared.update,
    where: { memberId: input.memberId },
  });
}

export interface HostedMemberSignupPhoneStateWriteInput {
  memberId: string;
  prisma: Prisma.TransactionClient;
  signupPhoneCodeSendAttemptId?: string | null;
  signupPhoneCodeSendAttemptStartedAt?: Date | null;
  signupPhoneCodeSentAt?: Date | null;
  signupPhoneNumber?: string | null;
}

export async function lookupHostedMemberIdentityByPrivyUserId(input: {
  prisma: HostedOnboardingReadClient;
  privyUserId: string;
}): Promise<HostedMemberIdentityLookup | null> {
  const privyUserLookupKeys = createHostedPrivyUserLookupKeyReadCandidates(input.privyUserId);

  if (privyUserLookupKeys.length === 0) {
    return null;
  }

  const identityRecords = await input.prisma.hostedMemberIdentity.findMany({
    where: {
      privyUserLookupKey: {
        in: privyUserLookupKeys,
      },
    },
    include: {
      member: true,
    },
  });

  return resolveHostedMemberIdentityLookup(identityRecords, "privyUserId", input.prisma);
}

export async function lookupHostedMemberIdentityByPhoneLookupKey(input: {
  phoneLookupKey: string;
  prisma: HostedOnboardingReadClient;
}): Promise<HostedMemberIdentityLookup | null> {
  const identityRecord = await input.prisma.hostedMemberIdentity.findUnique({
    where: {
      phoneLookupKey: input.phoneLookupKey,
    },
    include: {
      member: true,
    },
  });

  return identityRecord
    ? await projectHostedMemberIdentityLookup(identityRecord, "phoneLookupKey", input.prisma)
    : null;
}

export async function lookupHostedMemberIdentityByPhoneNumber(input: {
  phoneNumber: string;
  prisma: HostedOnboardingReadClient;
}): Promise<HostedMemberIdentityLookup | null> {
  const phoneLookupKeys = createHostedPhoneLookupKeyReadCandidates(input.phoneNumber);

  if (phoneLookupKeys.length === 0) {
    return null;
  }

  const identityRecords = await input.prisma.hostedMemberIdentity.findMany({
    where: {
      phoneLookupKey: {
        in: phoneLookupKeys,
      },
    },
    include: {
      member: true,
    },
  });

  return resolveHostedMemberIdentityLookup(identityRecords, "phoneNumber", input.prisma);
}

export async function readHostedMemberIdentity(input: {
  memberId: string;
  prisma: HostedOnboardingReadClient;
}): Promise<HostedMemberIdentityState | null> {
  const identityRecord = await input.prisma.hostedMemberIdentity.findUnique({
    where: {
      memberId: input.memberId,
    },
  });

  return identityRecord ? await projectHostedMemberIdentityState(identityRecord, input.prisma) : null;
}

export async function upsertHostedMemberIdentity(
  input: HostedMemberIdentityWriteInput,
): Promise<HostedMemberIdentityState> {
  await ensureHostedMemberIdentityControlRootTx({
    memberId: input.memberId,
    prisma: input.prisma,
  });

  const identity = await input.prisma.hostedMemberIdentity.upsert({
    where: {
      memberId: input.memberId,
    },
    create: await buildHostedMemberIdentityCreateData(input),
    update: await buildHostedMemberIdentityUpdateData(input),
  });

  return projectHostedMemberIdentityState(identity, input.prisma);
}

export async function tryCreateHostedMemberIdentity(
  input: HostedMemberIdentityWriteInput,
): Promise<boolean> {
  await ensureHostedMemberIdentityControlRootTx({
    memberId: input.memberId,
    prisma: input.prisma,
  });

  const result = await input.prisma.hostedMemberIdentity.createMany({
    data: await buildHostedMemberIdentityCreateData(input),
    skipDuplicates: true,
  });

  return result.count > 0;
}

export async function writeHostedMemberSignupPhoneState(
  input: HostedMemberSignupPhoneStateWriteInput,
): Promise<void> {
  const data: Prisma.HostedMemberIdentityUncheckedUpdateInput = {};

  if (input.signupPhoneCodeSendAttemptId !== undefined) {
    data.signupPhoneCodeSendAttemptId = normalizeNullableString(input.signupPhoneCodeSendAttemptId);
  }
  if (input.signupPhoneCodeSendAttemptStartedAt !== undefined) {
    data.signupPhoneCodeSendAttemptStartedAt = input.signupPhoneCodeSendAttemptStartedAt;
  }
  if (input.signupPhoneCodeSentAt !== undefined) {
    data.signupPhoneCodeSentAt = input.signupPhoneCodeSentAt;
  }
  if (input.signupPhoneNumber !== undefined) {
    await ensureHostedMemberIdentityControlRootTx({
      memberId: input.memberId,
      prisma: input.prisma,
    });
    data.signupPhoneNumberEncrypted = (await buildHostedMemberIdentityPrivateColumns({
      memberId: input.memberId,
      phoneNumber: null,
      prisma: input.prisma,
      privyUserId: null,
      signupPhoneCodeSendAttemptId: null,
      signupPhoneCodeSendAttemptStartedAt: null,
      signupPhoneCodeSentAt: null,
      signupPhoneNumber: input.signupPhoneNumber,
    })).signupPhoneNumberEncrypted;
  }

  if (Object.keys(data).length === 0) {
    throw new TypeError("Hosted member signup phone updates require at least one field.");
  }

  await input.prisma.hostedMemberIdentity.update({
    where: {
      memberId: input.memberId,
    },
    data,
  });
}

export async function projectHostedMemberIdentityState(
  identity: HostedMemberIdentity,
  prisma?: HostedOnboardingReadClient,
): Promise<HostedMemberIdentityState> {
  const privateState = await readHostedMemberIdentityPrivateState(identity, prisma);

  return {
    maskedPhoneNumberHint: identity.maskedPhoneNumberHint,
    memberId: identity.memberId,
    phoneNumber: privateState.phoneNumber,
    phoneLookupKey: identity.phoneLookupKey,
    signupPhoneCodeSendAttemptId: privateState.signupPhoneCodeSendAttemptId,
    signupPhoneCodeSendAttemptStartedAt: privateState.signupPhoneCodeSendAttemptStartedAt,
    signupPhoneCodeSentAt: privateState.signupPhoneCodeSentAt,
    signupPhoneNumber: privateState.signupPhoneNumber,
    phoneNumberVerifiedAt: identity.phoneNumberVerifiedAt,
    privyUserId: privateState.privyUserId,
    walletAddress: privateState.walletAddress,
    walletChainType: identity.walletChainType,
    walletCreatedAt: identity.walletCreatedAt,
    walletProvider: identity.walletProvider,
  };
}

async function projectHostedMemberIdentityLookup(
  identity: HostedMemberIdentityRecordWithMember,
  matchedBy: HostedMemberIdentityLookupMatch,
  prisma?: HostedOnboardingReadClient,
): Promise<HostedMemberIdentityLookup> {
  const identityState = await projectHostedMemberIdentityState(identity, prisma);

  return {
    core: identity.member,
    identity: {
      maskedPhoneNumberHint: identityState.maskedPhoneNumberHint,
      memberId: identityState.memberId,
      phoneNumber: identityState.phoneNumber,
      phoneNumberVerifiedAt: identityState.phoneNumberVerifiedAt,
      privyUserId: identityState.privyUserId,
      signupPhoneCodeSendAttemptId: identityState.signupPhoneCodeSendAttemptId,
      signupPhoneCodeSendAttemptStartedAt: identityState.signupPhoneCodeSendAttemptStartedAt,
      signupPhoneCodeSentAt: identityState.signupPhoneCodeSentAt,
      signupPhoneNumber: identityState.signupPhoneNumber,
      walletAddress: identityState.walletAddress,
      walletChainType: identityState.walletChainType,
      walletCreatedAt: identityState.walletCreatedAt,
      walletProvider: identityState.walletProvider,
    },
    matchedBy,
  };
}

async function resolveHostedMemberIdentityLookup(
  identityRecords: HostedMemberIdentityRecordWithMember[],
  matchedBy: HostedMemberIdentityLookupMatch,
  prisma?: HostedOnboardingReadClient,
): Promise<HostedMemberIdentityLookup | null> {
  if (identityRecords.length === 0) {
    return null;
  }

  const identityRecordByMemberId = new Map<string, HostedMemberIdentityRecordWithMember>();

  for (const identityRecord of identityRecords) {
    if (!identityRecordByMemberId.has(identityRecord.memberId)) {
      identityRecordByMemberId.set(identityRecord.memberId, identityRecord);
    }
  }

  if (identityRecordByMemberId.size !== 1) {
    throw hostedOnboardingError({
      code: "HOSTED_MEMBER_IDENTITY_LOOKUP_AMBIGUOUS",
      details: {
        matchCount: identityRecordByMemberId.size,
        matchedBy,
      },
      httpStatus: 500,
      message:
        "Hosted member identity lookup matched multiple accounts during blind-index rotation. Repair the duplicate binding before retrying.",
      retryable: true,
    });
  }

  const identityRecord = identityRecordByMemberId.values().next().value;

  if (!identityRecord) {
    return null;
  }

  return projectHostedMemberIdentityLookup(identityRecord, matchedBy, prisma);
}

async function buildHostedMemberIdentityCreateData(
  input: HostedMemberIdentityWriteInput,
): Promise<Prisma.HostedMemberIdentityUncheckedCreateInput> {
  return {
    memberId: input.memberId,
    ...(await buildHostedMemberIdentityMutationData(input)),
  };
}

async function buildHostedMemberIdentityUpdateData(
  input: HostedMemberIdentityWriteInput,
): Promise<Prisma.HostedMemberIdentityUncheckedUpdateInput> {
  return buildHostedMemberIdentityMutationData(input);
}

async function buildHostedMemberIdentityMutationData(input: HostedMemberIdentityWriteInput) {
  const privateColumns = await buildHostedMemberIdentityPrivateColumns({
    memberId: input.memberId,
    phoneNumber: input.phoneNumber,
    prisma: input.prisma,
    privyUserId: input.privyUserId,
    signupPhoneCodeSendAttemptId: input.signupPhoneCodeSendAttemptId,
    signupPhoneCodeSendAttemptStartedAt: input.signupPhoneCodeSendAttemptStartedAt,
    signupPhoneCodeSentAt: input.signupPhoneCodeSentAt,
    signupPhoneNumber: input.signupPhoneNumber,
  });

  return {
    maskedPhoneNumberHint: input.maskedPhoneNumberHint,
    phoneLookupKey: input.phoneLookupKey,
    phoneNumberVerifiedAt: input.phoneNumberVerifiedAt,
    privyUserLookupKey: createHostedPrivyUserLookupKey(input.privyUserId),
    ...privateColumns,
  };
}

async function ensureHostedMemberIdentityControlRootTx(input: {
  memberId: string;
  prisma: Prisma.TransactionClient;
}): Promise<void> {
  await provisionActiveHostedDomainRootEnvelopeForUserOnly({
    domain: "control",
    prisma: input.prisma,
    reason: "hosted-member.identity-private-fields",
    userId: input.memberId,
  });
}
