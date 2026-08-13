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
import {
  provisionActiveHostedDomainRootEnvelopeForUserOnly,
  revalidatePreparedHostedDomainRootForWebTx,
  type PreparedHostedDomainRootForWeb,
} from "../hosted-crypto/domain-root-store";
import type { PreparedHostedWebEncryptionRoot } from "../hosted-web/encryption";

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

const hostedMemberIdentityCoreLookupSelect =
  Prisma.validator<Prisma.HostedMemberIdentitySelect>()({
    memberId: true,
    member: {
      select: {
        billingStatus: true,
        createdAt: true,
        id: true,
        suspendedAt: true,
        updatedAt: true,
      },
    },
  });

export interface HostedMemberIdentityCoreLookup {
  core: Prisma.HostedMemberIdentityGetPayload<{
    select: typeof hostedMemberIdentityCoreLookupSelect;
  }>["member"];
  matchedBy: "phoneNumber";
}

type HostedMemberIdentityCoreLookupRecord =
  Prisma.HostedMemberIdentityGetPayload<{
    select: typeof hostedMemberIdentityCoreLookupSelect;
  }>;

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
  preparedControlRoot?: PreparedHostedDomainRootForWeb;
  prisma: Prisma.TransactionClient;
  phoneNumber: string | null;
  privyUserId: string | null;
  signupPhoneCodeSendAttemptId: string | null;
  signupPhoneCodeSendAttemptStartedAt: Date | null;
  signupPhoneCodeSentAt: Date | null;
  signupPhoneNumber: string | null;
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

type HostedMemberIdentityByPhoneNumberInput = {
  phoneNumber: string;
  prisma: HostedOnboardingReadClient;
};

export async function lookupHostedMemberIdentityByPhoneNumber(
  input: HostedMemberIdentityByPhoneNumberInput & { projection: "core" },
): Promise<HostedMemberIdentityCoreLookup | null>;
export async function lookupHostedMemberIdentityByPhoneNumber(
  input: HostedMemberIdentityByPhoneNumberInput,
): Promise<HostedMemberIdentityLookup | null>;
export async function lookupHostedMemberIdentityByPhoneNumber(
  input: HostedMemberIdentityByPhoneNumberInput & { projection?: "core" },
): Promise<HostedMemberIdentityCoreLookup | HostedMemberIdentityLookup | null> {
  const phoneLookupKeys = createHostedPhoneLookupKeyReadCandidates(input.phoneNumber);

  if (phoneLookupKeys.length === 0) {
    return null;
  }

  if (input.projection === "core") {
    const records = await input.prisma.hostedMemberIdentity.findMany({
      where: {
        phoneLookupKey: {
          in: phoneLookupKeys,
        },
      },
      select: hostedMemberIdentityCoreLookupSelect,
    });
    return resolveHostedMemberIdentityCoreLookup(records, "phoneNumber");
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

/**
 * Reads only blind-index ownership for conflict suppression. Callers that need
 * no private identity fields must not decrypt a second member under their
 * transaction-local prepared-root scope.
 */
export async function lookupHostedMemberIdByPhoneNumber(input: {
  phoneNumber: string;
  prisma: HostedOnboardingReadClient;
}): Promise<string | null> {
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
    select: {
      memberId: true,
    },
  });
  const memberIds = new Set(identityRecords.map((identity) => identity.memberId));

  if (memberIds.size > 1) {
    throw hostedOnboardingError({
      code: "HOSTED_MEMBER_IDENTITY_LOOKUP_AMBIGUOUS",
      details: {
        matchCount: memberIds.size,
        matchedBy: "phoneNumber",
      },
      httpStatus: 500,
      message:
        "Hosted member identity lookup matched multiple accounts during blind-index rotation. Repair the duplicate binding before retrying.",
      retryable: true,
    });
  }

  return memberIds.values().next().value ?? null;
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
  const preparedRoot = await resolveHostedMemberIdentityControlRootTx({
    memberId: input.memberId,
    preparedControlRoot: input.preparedControlRoot,
    prisma: input.prisma,
  });

  const identity = await input.prisma.hostedMemberIdentity.upsert({
    where: {
      memberId: input.memberId,
    },
    create: await buildHostedMemberIdentityCreateData(input, preparedRoot),
    update: await buildHostedMemberIdentityUpdateData(input, preparedRoot),
  });

  return projectHostedMemberIdentityState(identity, input.prisma);
}

export async function tryCreateHostedMemberIdentity(
  input: HostedMemberIdentityWriteInput,
): Promise<boolean> {
  const preparedRoot = await resolveHostedMemberIdentityControlRootTx({
    memberId: input.memberId,
    preparedControlRoot: input.preparedControlRoot,
    prisma: input.prisma,
  });

  const result = await input.prisma.hostedMemberIdentity.createMany({
    data: await buildHostedMemberIdentityCreateData(input, preparedRoot),
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
    await resolveHostedMemberIdentityControlRootTx({
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

function resolveHostedMemberIdentityCoreLookup(
  records: readonly HostedMemberIdentityCoreLookupRecord[],
  matchedBy: "phoneNumber",
): HostedMemberIdentityCoreLookup | null {
  const coreByMemberId = new Map<string, HostedMemberIdentityCoreLookup["core"]>();
  for (const record of records) {
    coreByMemberId.set(record.memberId, record.member);
  }
  if (coreByMemberId.size === 0) {
    return null;
  }
  if (coreByMemberId.size !== 1) {
    throw hostedOnboardingError({
      code: "HOSTED_MEMBER_IDENTITY_LOOKUP_AMBIGUOUS",
      details: {
        matchCount: coreByMemberId.size,
        matchedBy,
      },
      httpStatus: 500,
      message:
        "Hosted member identity lookup matched multiple accounts during blind-index rotation. Repair the duplicate binding before retrying.",
      retryable: true,
    });
  }
  return {
    core: coreByMemberId.values().next().value!,
    matchedBy,
  };
}

async function buildHostedMemberIdentityCreateData(
  input: HostedMemberIdentityWriteInput,
  preparedRoot?: PreparedHostedWebEncryptionRoot,
): Promise<Prisma.HostedMemberIdentityUncheckedCreateInput> {
  return {
    memberId: input.memberId,
    ...(await buildHostedMemberIdentityMutationData(input, preparedRoot)),
  };
}

async function buildHostedMemberIdentityUpdateData(
  input: HostedMemberIdentityWriteInput,
  preparedRoot?: PreparedHostedWebEncryptionRoot,
): Promise<Prisma.HostedMemberIdentityUncheckedUpdateInput> {
  return buildHostedMemberIdentityMutationData(input, preparedRoot);
}

async function buildHostedMemberIdentityMutationData(
  input: HostedMemberIdentityWriteInput,
  preparedRoot?: PreparedHostedWebEncryptionRoot,
) {
  const privateColumns = await buildHostedMemberIdentityPrivateColumns({
    memberId: input.memberId,
    phoneNumber: input.phoneNumber,
    preparedRoot,
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

async function resolveHostedMemberIdentityControlRootTx(input: {
  memberId: string;
  preparedControlRoot?: PreparedHostedDomainRootForWeb;
  prisma: Prisma.TransactionClient;
}): Promise<PreparedHostedWebEncryptionRoot | undefined> {
  if (input.preparedControlRoot) {
    if (
      input.preparedControlRoot.domain !== "control"
      || input.preparedControlRoot.userId !== input.memberId
    ) {
      throw new TypeError(
        "Prepared hosted member identity root does not match the member.",
      );
    }
    const prepared = await revalidatePreparedHostedDomainRootForWebTx({
      prepared: input.preparedControlRoot,
      tx: input.prisma,
    });
    return {
      preparedRoot: prepared.root,
      preparedRootKeyId: prepared.rootKeyId,
    };
  }
  await provisionActiveHostedDomainRootEnvelopeForUserOnly({
    domain: "control",
    prisma: input.prisma,
    reason: "hosted-member.identity-private-fields",
    userId: input.memberId,
  });
  return undefined;
}
