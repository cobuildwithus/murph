/**
 * Owns hosted member identity lookup, read, and write surfaces.
 */
import {
  type HostedMember,
  type HostedMemberIdentity,
  Prisma,
} from "@prisma/client";

import {
  createHostedPhoneLookupKeyReadCandidates,
  createHostedPrivyUserLookupKey,
  createHostedPrivyUserLookupKeyReadCandidates,
  createHostedWalletAddressLookupKey,
  createHostedWalletAddressLookupKeyReadCandidates,
} from "./contact-privacy";
import {
  buildHostedMemberIdentityPrivateColumns,
  readHostedMemberIdentityPrivateState,
} from "./member-private-codecs";
import {
  normalizeNullableString,
  type HostedOnboardingPrismaClient,
} from "./shared";

export interface HostedMemberIdentityState {
  maskedPhoneNumberHint: string;
  memberId: string;
  phoneNumber: string | null;
  phoneLookupKey: string;
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
  | "privyUserId"
  | "walletAddress";

export interface HostedMemberIdentityLookup {
  core: HostedMember;
  identity: HostedMemberIdentityLookupState;
  matchedBy: HostedMemberIdentityLookupMatch;
}

// Lookup helpers return the matched identity slice with the core row so auth
// and onboarding flows do not need to round-trip through readHostedMemberIdentity.

export interface HostedMemberIdentityWriteInput {
  maskedPhoneNumberHint: string;
  memberId: string;
  phoneLookupKey: string;
  phoneNumberVerifiedAt: Date | null;
  prisma: HostedOnboardingPrismaClient;
  phoneNumber: string | null;
  privyUserId: string | null;
  signupPhoneCodeSendAttemptId: string | null;
  signupPhoneCodeSendAttemptStartedAt: Date | null;
  signupPhoneCodeSentAt: Date | null;
  signupPhoneNumber: string | null;
  walletAddress: string | null;
  walletChainType: string | null;
  walletCreatedAt: Date | null;
  walletProvider: string | null;
}

export interface HostedMemberSignupPhoneStateWriteInput {
  memberId: string;
  prisma: HostedOnboardingPrismaClient;
  signupPhoneCodeSendAttemptId?: string | null;
  signupPhoneCodeSendAttemptStartedAt?: Date | null;
  signupPhoneCodeSentAt?: Date | null;
  signupPhoneNumber?: string | null;
}

export async function lookupHostedMemberIdentityByPrivyUserId(input: {
  prisma: HostedOnboardingPrismaClient;
  privyUserId: string;
}): Promise<HostedMemberIdentityLookup | null> {
  const privyUserLookupKeys = createHostedPrivyUserLookupKeyReadCandidates(input.privyUserId);

  if (privyUserLookupKeys.length === 0) {
    return null;
  }

  const identityRecord = await input.prisma.hostedMemberIdentity.findFirst({
    where: {
      privyUserLookupKey: {
        in: privyUserLookupKeys,
      },
    },
    include: {
      member: true,
    },
  });

  return identityRecord
    ? projectHostedMemberIdentityLookup(identityRecord, "privyUserId")
    : null;
}

export async function lookupHostedMemberIdentityByPhoneLookupKey(input: {
  phoneLookupKey: string;
  prisma: HostedOnboardingPrismaClient;
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
    ? projectHostedMemberIdentityLookup(identityRecord, "phoneLookupKey")
    : null;
}

export async function lookupHostedMemberIdentityByPhoneNumber(input: {
  phoneNumber: string;
  prisma: HostedOnboardingPrismaClient;
}): Promise<HostedMemberIdentityLookup | null> {
  const phoneLookupKeys = createHostedPhoneLookupKeyReadCandidates(input.phoneNumber);

  if (phoneLookupKeys.length === 0) {
    return null;
  }

  const identityRecord = await input.prisma.hostedMemberIdentity.findFirst({
    where: {
      phoneLookupKey: {
        in: phoneLookupKeys,
      },
    },
    include: {
      member: true,
    },
  });

  return identityRecord
    ? projectHostedMemberIdentityLookup(identityRecord, "phoneNumber")
    : null;
}

export async function lookupHostedMemberIdentityByWalletAddress(input: {
  prisma: HostedOnboardingPrismaClient;
  walletAddress: string;
}): Promise<HostedMemberIdentityLookup | null> {
  const walletAddressLookupKeys = createHostedWalletAddressLookupKeyReadCandidates(
    input.walletAddress,
  );

  if (walletAddressLookupKeys.length === 0) {
    return null;
  }

  const identityRecord = await input.prisma.hostedMemberIdentity.findFirst({
    where: {
      walletAddressLookupKey: {
        in: walletAddressLookupKeys,
      },
    },
    include: {
      member: true,
    },
  });

  return identityRecord
    ? projectHostedMemberIdentityLookup(identityRecord, "walletAddress")
    : null;
}

export async function readHostedMemberIdentity(input: {
  memberId: string;
  prisma: HostedOnboardingPrismaClient;
}): Promise<HostedMemberIdentityState | null> {
  const identityRecord = await input.prisma.hostedMemberIdentity.findUnique({
    where: {
      memberId: input.memberId,
    },
  });

  return identityRecord ? projectHostedMemberIdentityState(identityRecord) : null;
}

export async function upsertHostedMemberIdentity(
  input: HostedMemberIdentityWriteInput,
): Promise<HostedMemberIdentityState> {
  const identity = await input.prisma.hostedMemberIdentity.upsert({
    where: {
      memberId: input.memberId,
    },
    create: buildHostedMemberIdentityCreateData(input),
    update: buildHostedMemberIdentityUpdateData(input),
  });

  return projectHostedMemberIdentityState(identity);
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
    data.signupPhoneNumberEncrypted = buildHostedMemberIdentityPrivateColumns({
      memberId: input.memberId,
      phoneNumber: null,
      privyUserId: null,
      signupPhoneCodeSendAttemptId: null,
      signupPhoneCodeSendAttemptStartedAt: null,
      signupPhoneCodeSentAt: null,
      signupPhoneNumber: input.signupPhoneNumber,
      walletAddress: null,
    }).signupPhoneNumberEncrypted;
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

export function projectHostedMemberIdentityState(
  identity: HostedMemberIdentity,
): HostedMemberIdentityState {
  const privateState = readHostedMemberIdentityPrivateState(identity);

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

function projectHostedMemberIdentityLookup(
  identity: HostedMemberIdentity & {
    member: HostedMember;
  },
  matchedBy: HostedMemberIdentityLookupMatch,
): HostedMemberIdentityLookup {
  const identityState = projectHostedMemberIdentityState(identity);

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

function buildHostedMemberIdentityCreateData(
  input: HostedMemberIdentityWriteInput,
): Prisma.HostedMemberIdentityUncheckedCreateInput {
  return {
    memberId: input.memberId,
    ...buildHostedMemberIdentityMutationData(input),
  };
}

function buildHostedMemberIdentityUpdateData(
  input: HostedMemberIdentityWriteInput,
): Prisma.HostedMemberIdentityUncheckedUpdateInput {
  return buildHostedMemberIdentityMutationData(input);
}

function buildHostedMemberIdentityMutationData(input: HostedMemberIdentityWriteInput) {
  const privateColumns = buildHostedMemberIdentityPrivateColumns({
    memberId: input.memberId,
    phoneNumber: input.phoneNumber,
    privyUserId: input.privyUserId,
    signupPhoneCodeSendAttemptId: input.signupPhoneCodeSendAttemptId,
    signupPhoneCodeSendAttemptStartedAt: input.signupPhoneCodeSendAttemptStartedAt,
    signupPhoneCodeSentAt: input.signupPhoneCodeSentAt,
    signupPhoneNumber: input.signupPhoneNumber,
    walletAddress: input.walletAddress,
  });

  return {
    maskedPhoneNumberHint: input.maskedPhoneNumberHint,
    phoneLookupKey: input.phoneLookupKey,
    phoneNumberVerifiedAt: input.phoneNumberVerifiedAt,
    privyUserLookupKey: createHostedPrivyUserLookupKey(input.privyUserId),
    ...privateColumns,
    walletAddressLookupKey: createHostedWalletAddressLookupKey(input.walletAddress),
    walletChainType: input.walletChainType,
    walletCreatedAt: input.walletCreatedAt,
    walletProvider: input.walletProvider,
  };
}
