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
  maskedPhoneNumberHint: string | null;
  memberId: string;
  phoneLookupKey: string | null;
  phoneNumberVerifiedAt: Date | null;
  prisma: Prisma.TransactionClient;
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
    ? await projectHostedMemberIdentityLookup(identityRecord, "privyUserId", input.prisma)
    : null;
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
    ? await projectHostedMemberIdentityLookup(identityRecord, "phoneNumber", input.prisma)
    : null;
}

export async function lookupHostedMemberIdentityByWalletAddress(input: {
  prisma: HostedOnboardingReadClient;
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
    ? await projectHostedMemberIdentityLookup(identityRecord, "walletAddress", input.prisma)
    : null;
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
      walletAddress: null,
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
  identity: HostedMemberIdentity & {
    member: HostedMember;
  },
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
