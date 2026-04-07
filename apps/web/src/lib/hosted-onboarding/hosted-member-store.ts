import {
  type HostedMember,
  type HostedMemberBillingRef,
  type HostedMemberIdentity,
  Prisma,
} from "@prisma/client";

import {
  createHostedLinqChatLookupKey,
  createHostedPrivyUserLookupKey,
  createHostedStripeCustomerLookupKey,
  createHostedStripeSubscriptionLookupKey,
  createHostedWalletAddressLookupKey,
} from "./contact-privacy";
import {
  type HostedOnboardingPrismaClient,
  lockHostedMemberRow,
  normalizeNullableString,
  withHostedOnboardingTransaction,
} from "./shared";
import {
  buildHostedMemberBillingPrivateColumns,
  buildHostedMemberIdentityPrivateColumns,
  buildHostedMemberRoutingPrivateColumns,
  readHostedMemberBillingPrivateState,
  readHostedMemberIdentityPrivateState,
  readHostedMemberRoutingPrivateState,
} from "./member-private-codecs";

type HostedMemberStoreClient = HostedOnboardingPrismaClient;
const hostedMemberCoreStateSelect = Prisma.validator<Prisma.HostedMemberSelect>()({
  billingStatus: true,
  createdAt: true,
  id: true,
  suspendedAt: true,
  updatedAt: true,
});

export type HostedMemberCoreState = Prisma.HostedMemberGetPayload<{
  select: typeof hostedMemberCoreStateSelect;
}>;
type HostedMemberRecordWithRelations = Prisma.HostedMemberGetPayload<{
  include: {
    billingRef: true;
    identity: true;
    routing: true;
  };
}>;
type HostedMemberRoutingRecord = {
  linqChatIdEncrypted: string | null;
  linqChatLookupKey: string | null;
  memberId: string;
  telegramUserLookupKey: string | null;
};

export interface HostedMemberStripeBillingRefSnapshot {
  memberId: string;
  stripeCustomerId: string | null;
  stripeLatestBillingEventCreatedAt: Date | null;
  stripeLatestBillingEventId: string | null;
  stripeLatestCheckoutSessionId: string | null;
  stripeSubscriptionId: string | null;
}

export interface HostedMemberIdentityState {
  maskedPhoneNumberHint: string;
  memberId: string;
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

export interface HostedMemberIdentityWriteInput {
  maskedPhoneNumberHint: string;
  memberId: string;
  phoneLookupKey: string;
  phoneNumberVerifiedAt: Date | null;
  prisma: HostedMemberStoreClient;
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

export interface HostedMemberStripeBillingRefWriteInput {
  memberId: string;
  prisma: HostedMemberStoreClient;
  stripeCustomerId?: string | null;
  stripeLatestBillingEventCreatedAt?: Date | null;
  stripeLatestBillingEventId?: string | null;
  stripeLatestCheckoutSessionId?: string | null;
  stripeSubscriptionId?: string | null;
}

export interface HostedMemberRoutingStateSnapshot {
  linqChatId: string | null;
  memberId: string;
  telegramUserLookupKey: string | null;
}

export interface HostedMemberAggregate extends HostedMemberCoreState {
  billingRef: HostedMemberStripeBillingRefSnapshot | null;
  identity: HostedMemberIdentityState | null;
  linqChatId: string | null;
  maskedPhoneNumberHint: string | null;
  phoneLookupKey: string | null;
  phoneNumberVerifiedAt: Date | null;
  privyUserId: string | null;
  routing: HostedMemberRoutingStateSnapshot | null;
  stripeCustomerId: string | null;
  stripeLatestBillingEventCreatedAt: Date | null;
  stripeLatestBillingEventId: string | null;
  stripeLatestCheckoutSessionId: string | null;
  stripeSubscriptionId: string | null;
  telegramUserLookupKey: string | null;
  walletAddress: string | null;
  walletChainType: string | null;
  walletCreatedAt: Date | null;
  walletProvider: string | null;
}

export interface HostedMemberSignupPhoneStateWriteInput {
  memberId: string;
  prisma: HostedMemberStoreClient;
  signupPhoneCodeSendAttemptId?: string | null;
  signupPhoneCodeSendAttemptStartedAt?: Date | null;
  signupPhoneCodeSentAt?: Date | null;
  signupPhoneNumber?: string | null;
}

export type HostedMemberTelegramLookupSnapshot = Pick<
  HostedMember,
  "billingStatus" | "id" | "suspendedAt"
>;

export async function createHostedMember(input: {
  billingStatus: HostedMember["billingStatus"];
  memberId: string;
  prisma: HostedMemberStoreClient;
  suspendedAt?: Date | null;
}): Promise<HostedMemberCoreState> {
  return input.prisma.hostedMember.create({
    data: {
      billingStatus: input.billingStatus,
      id: input.memberId,
      ...(input.suspendedAt !== undefined
        ? {
            suspendedAt: input.suspendedAt,
          }
        : {}),
    },
    select: hostedMemberCoreStateSelect,
  });
}

export async function findHostedMemberByPrivyUserId(input: {
  prisma: HostedMemberStoreClient;
  privyUserId: string;
}): Promise<HostedMember | null> {
  const privyUserLookupKey = createHostedPrivyUserLookupKey(input.privyUserId);

  if (!privyUserLookupKey) {
    return null;
  }

  const identityRecord = await input.prisma.hostedMemberIdentity.findUnique({
    where: {
      privyUserLookupKey,
    },
    include: {
      member: true,
    },
  });

  return identityRecord?.member ?? null;
}

export async function findHostedMemberByPhoneLookupKey(input: {
  phoneLookupKey: string;
  prisma: HostedMemberStoreClient;
}): Promise<HostedMember | null> {
  const identityRecord = await input.prisma.hostedMemberIdentity.findUnique({
    where: {
      phoneLookupKey: input.phoneLookupKey,
    },
    include: {
      member: true,
    },
  });

  return identityRecord?.member ?? null;
}

export async function findHostedMemberByWalletAddress(input: {
  prisma: HostedMemberStoreClient;
  walletAddress: string;
}): Promise<HostedMember | null> {
  const walletAddressLookupKey = createHostedWalletAddressLookupKey(input.walletAddress);

  if (!walletAddressLookupKey) {
    return null;
  }

  const identityRecord = await input.prisma.hostedMemberIdentity.findUnique({
    where: {
      walletAddressLookupKey,
    },
    include: {
      member: true,
    },
  });

  return identityRecord?.member ?? null;
}

export async function findHostedMemberByTelegramUserLookupKey(input: {
  prisma: HostedMemberStoreClient;
  telegramUserLookupKey: string;
}): Promise<HostedMemberTelegramLookupSnapshot | null> {
  const routingRecord = await input.prisma.hostedMemberRouting.findUnique({
    where: {
      telegramUserLookupKey: input.telegramUserLookupKey,
    },
    select: {
      member: {
        select: {
          billingStatus: true,
          id: true,
          suspendedAt: true,
        },
      },
    },
  });

  return routingRecord?.member ?? null;
}

export async function findHostedMemberByStripeCustomerId(input: {
  prisma: HostedMemberStoreClient;
  stripeCustomerId: string;
}): Promise<HostedMember | null> {
  const stripeCustomerLookupKey = createHostedStripeCustomerLookupKey(input.stripeCustomerId);

  if (!stripeCustomerLookupKey) {
    return null;
  }

  const billingRefRecord = await input.prisma.hostedMemberBillingRef.findUnique({
    where: {
      stripeCustomerLookupKey,
    },
    include: {
      member: true,
    },
  });

  return billingRefRecord?.member ?? null;
}

export async function findHostedMemberByStripeSubscriptionId(input: {
  prisma: HostedMemberStoreClient;
  stripeSubscriptionId: string;
}): Promise<HostedMember | null> {
  const stripeSubscriptionLookupKey = createHostedStripeSubscriptionLookupKey(
    input.stripeSubscriptionId,
  );

  if (!stripeSubscriptionLookupKey) {
    return null;
  }

  const billingRefRecord = await input.prisma.hostedMemberBillingRef.findUnique({
    where: {
      stripeSubscriptionLookupKey,
    },
    include: {
      member: true,
    },
  });

  return billingRefRecord?.member ?? null;
}

export async function readHostedMemberCoreState(input: {
  memberId: string;
  prisma: HostedMemberStoreClient;
}): Promise<HostedMemberCoreState | null> {
  return input.prisma.hostedMember.findUnique({
    where: {
      id: input.memberId,
    },
    select: hostedMemberCoreStateSelect,
  });
}

export async function readHostedMemberIdentity(input: {
  memberId: string;
  prisma: HostedMemberStoreClient;
}): Promise<HostedMemberIdentityState | null> {
  const identityRecord = await input.prisma.hostedMemberIdentity.findUnique({
    where: {
      memberId: input.memberId,
    },
  });

  return identityRecord ? mapHostedMemberIdentityState(identityRecord) : null;
}

export async function readHostedMemberRoutingState(input: {
  memberId: string;
  prisma: HostedMemberStoreClient;
}): Promise<HostedMemberRoutingStateSnapshot | null> {
  const routingRecord = await input.prisma.hostedMemberRouting.findUnique({
    where: {
      memberId: input.memberId,
    },
    select: {
      linqChatIdEncrypted: true,
      linqChatLookupKey: true,
      memberId: true,
      telegramUserLookupKey: true,
    },
  });

  return routingRecord ? mapHostedMemberRoutingState(routingRecord) : null;
}

export async function readHostedMemberStripeBillingRef(input: {
  memberId: string;
  prisma: HostedMemberStoreClient;
}): Promise<HostedMemberStripeBillingRefSnapshot | null> {
  const billingRef = await input.prisma.hostedMemberBillingRef.findUnique({
    where: {
      memberId: input.memberId,
    },
  });

  return billingRef ? mapHostedMemberBillingRefSnapshot(billingRef) : null;
}

export async function readHostedMemberAggregate(input: {
  memberId: string;
  prisma: HostedMemberStoreClient;
}): Promise<HostedMemberAggregate | null> {
  const memberRecord = await input.prisma.hostedMember.findUnique({
    where: {
      id: input.memberId,
    },
    include: {
      billingRef: true,
      identity: true,
      routing: true,
    },
  });

  if (!memberRecord) {
    return null;
  }

  const identity = memberRecord.identity ? mapHostedMemberIdentityState(memberRecord.identity) : null;
  const routing = memberRecord.routing ? mapHostedMemberRoutingState(memberRecord.routing) : null;
  const billingRef = memberRecord.billingRef
    ? mapHostedMemberBillingRefSnapshot(memberRecord.billingRef)
    : null;

  return buildHostedMemberAggregate(memberRecord, {
    billingRef,
    identity,
    routing,
  });
}

export async function updateHostedMemberCoreState(input: {
  billingStatus?: HostedMember["billingStatus"];
  memberId: string;
  prisma: HostedMemberStoreClient;
  suspendedAt?: Date | null;
}): Promise<HostedMemberCoreState> {
  const data = {
    ...(input.billingStatus !== undefined
      ? {
          billingStatus: input.billingStatus,
        }
      : {}),
    ...(input.suspendedAt !== undefined
      ? {
          suspendedAt: input.suspendedAt,
        }
      : {}),
  };

  if (Object.keys(data).length === 0) {
    throw new TypeError("Hosted member core state updates require at least one field.");
  }

  return input.prisma.hostedMember.update({
    where: {
      id: input.memberId,
    },
    data,
    select: hostedMemberCoreStateSelect,
  });
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

  return mapHostedMemberIdentityState(identity);
}

export async function upsertHostedMemberLinqChatBinding(input: {
  linqChatId: string | null;
  memberId: string;
  prisma: HostedMemberStoreClient;
}): Promise<void> {
  const linqChatLookupKey = createHostedLinqChatLookupKey(input.linqChatId);

  if (!linqChatLookupKey) {
    return;
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await withHostedOnboardingTransaction(input.prisma, async (tx) => {
        // Hosted Linq replies and activation welcomes reuse the direct thread id, so
        // the latest observed chat binding must be exclusive to one member.
        await tx.hostedMemberRouting.updateMany({
          where: {
            linqChatLookupKey,
            NOT: {
              memberId: input.memberId,
            },
          },
          data: {
            linqChatIdEncrypted: null,
            linqChatLookupKey: null,
          },
        });

        await tx.hostedMemberRouting.upsert({
          where: {
            memberId: input.memberId,
          },
          create: {
            ...buildHostedMemberRoutingPrivateColumns({
              linqChatId: input.linqChatId,
              memberId: input.memberId,
            }),
            memberId: input.memberId,
            linqChatLookupKey,
            telegramUserLookupKey: null,
          },
          update: {
            ...buildHostedMemberRoutingPrivateColumns({
              linqChatId: input.linqChatId,
              memberId: input.memberId,
            }),
            linqChatLookupKey,
          },
        });
      });
      return;
    } catch (error) {
      if (attempt === 0 && isPrismaUniqueConstraintError(error)) {
        continue;
      }

      throw error;
    }
  }
}

export async function upsertHostedMemberTelegramRoutingBinding(input: {
  memberId: string;
  prisma: HostedMemberStoreClient;
  telegramUserLookupKey: string;
}): Promise<void> {
  await withHostedOnboardingTransaction(input.prisma, async (tx) => {
    await tx.hostedMemberRouting.upsert({
      where: {
        memberId: input.memberId,
      },
      create: {
        memberId: input.memberId,
        linqChatLookupKey: null,
        telegramUserLookupKey: input.telegramUserLookupKey,
      },
      update: {
        telegramUserLookupKey: input.telegramUserLookupKey,
      },
    });
  });
}

export async function writeHostedMemberStripeBillingRef(
  input: HostedMemberStripeBillingRefWriteInput,
): Promise<HostedMemberStripeBillingRefSnapshot> {
  return withHostedOnboardingTransaction(input.prisma, async (tx) => {
    const billingRef = await tx.hostedMemberBillingRef.upsert({
      where: {
        memberId: input.memberId,
      },
      create: buildHostedMemberBillingRefCreateData(input),
      update: buildHostedMemberBillingRefUpdateData(input),
    });

    return mapHostedMemberBillingRefSnapshot(billingRef);
  });
}

export async function bindHostedMemberStripeCustomerIdIfMissing(input: {
  memberId: string;
  prisma: HostedMemberStoreClient;
  stripeCustomerId: string;
}): Promise<boolean> {
  const stripeCustomerLookupKey = createHostedStripeCustomerLookupKey(input.stripeCustomerId);

  if (!stripeCustomerLookupKey) {
    return false;
  }

  return withHostedOnboardingTransaction(input.prisma, async (tx) => {
    await lockHostedMemberRow(tx, input.memberId);

    const currentBillingRef = await tx.hostedMemberBillingRef.findUnique({
      where: {
        memberId: input.memberId,
      },
    });

    if (currentBillingRef?.stripeCustomerLookupKey) {
      return false;
    }

    await tx.hostedMemberBillingRef.upsert({
      where: {
        memberId: input.memberId,
      },
      create: {
        ...buildHostedMemberBillingPrivateColumns({
          memberId: input.memberId,
          stripeCustomerId: input.stripeCustomerId,
          stripeLatestBillingEventId: null,
          stripeLatestCheckoutSessionId: null,
          stripeSubscriptionId: null,
        }),
        memberId: input.memberId,
        stripeCustomerLookupKey,
        stripeLatestBillingEventCreatedAt: null,
        stripeSubscriptionLookupKey: null,
      },
      update: {
        stripeCustomerIdEncrypted: buildHostedMemberBillingPrivateColumns({
          memberId: input.memberId,
          stripeCustomerId: input.stripeCustomerId,
          stripeLatestBillingEventId: null,
          stripeLatestCheckoutSessionId: null,
          stripeSubscriptionId: null,
        }).stripeCustomerIdEncrypted,
        stripeCustomerLookupKey,
      },
    });

    return true;
  });
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

function buildHostedMemberIdentityCreateData(
  input: HostedMemberIdentityWriteInput,
): Prisma.HostedMemberIdentityUncheckedCreateInput {
  return {
    maskedPhoneNumberHint: input.maskedPhoneNumberHint,
    memberId: input.memberId,
    phoneLookupKey: input.phoneLookupKey,
    phoneNumberVerifiedAt: input.phoneNumberVerifiedAt,
    privyUserLookupKey: createHostedPrivyUserLookupKey(input.privyUserId),
    ...buildHostedMemberIdentityPrivateColumns({
      memberId: input.memberId,
      privyUserId: input.privyUserId,
      signupPhoneCodeSendAttemptId: input.signupPhoneCodeSendAttemptId,
      signupPhoneCodeSendAttemptStartedAt: input.signupPhoneCodeSendAttemptStartedAt,
      signupPhoneCodeSentAt: input.signupPhoneCodeSentAt,
      signupPhoneNumber: input.signupPhoneNumber,
      walletAddress: input.walletAddress,
    }),
    walletAddressLookupKey: createHostedWalletAddressLookupKey(input.walletAddress),
    walletChainType: input.walletChainType,
    walletCreatedAt: input.walletCreatedAt,
    walletProvider: input.walletProvider,
  };
}

function buildHostedMemberIdentityUpdateData(
  input: HostedMemberIdentityWriteInput,
): Prisma.HostedMemberIdentityUncheckedUpdateInput {
  return {
    maskedPhoneNumberHint: input.maskedPhoneNumberHint,
    phoneLookupKey: input.phoneLookupKey,
    phoneNumberVerifiedAt: input.phoneNumberVerifiedAt,
    privyUserLookupKey: createHostedPrivyUserLookupKey(input.privyUserId),
    ...buildHostedMemberIdentityPrivateColumns({
      memberId: input.memberId,
      privyUserId: input.privyUserId,
      signupPhoneCodeSendAttemptId: input.signupPhoneCodeSendAttemptId,
      signupPhoneCodeSendAttemptStartedAt: input.signupPhoneCodeSendAttemptStartedAt,
      signupPhoneCodeSentAt: input.signupPhoneCodeSentAt,
      signupPhoneNumber: input.signupPhoneNumber,
      walletAddress: input.walletAddress,
    }),
    walletAddressLookupKey: createHostedWalletAddressLookupKey(input.walletAddress),
    walletChainType: input.walletChainType,
    walletCreatedAt: input.walletCreatedAt,
    walletProvider: input.walletProvider,
  };
}

function buildHostedMemberBillingRefCreateData(
  input: HostedMemberStripeBillingRefWriteInput,
): Prisma.HostedMemberBillingRefUncheckedCreateInput {
  return {
    memberId: input.memberId,
    ...buildHostedMemberBillingPrivateColumns({
      memberId: input.memberId,
      stripeCustomerId: input.stripeCustomerId ?? null,
      stripeLatestBillingEventId: input.stripeLatestBillingEventId ?? null,
      stripeLatestCheckoutSessionId: input.stripeLatestCheckoutSessionId ?? null,
      stripeSubscriptionId: input.stripeSubscriptionId ?? null,
    }),
    stripeCustomerLookupKey: createHostedStripeCustomerLookupKey(input.stripeCustomerId ?? null),
    stripeLatestBillingEventCreatedAt: input.stripeLatestBillingEventCreatedAt ?? null,
    stripeSubscriptionLookupKey: createHostedStripeSubscriptionLookupKey(
      input.stripeSubscriptionId ?? null,
    ),
  };
}

function buildHostedMemberBillingRefUpdateData(
  input: HostedMemberStripeBillingRefWriteInput,
): Prisma.HostedMemberBillingRefUncheckedUpdateInput {
  const data: Prisma.HostedMemberBillingRefUncheckedUpdateInput = {};

  if (input.stripeCustomerId !== undefined) {
    data.stripeCustomerLookupKey = createHostedStripeCustomerLookupKey(input.stripeCustomerId);
    data.stripeCustomerIdEncrypted = buildHostedMemberBillingPrivateColumns({
      memberId: input.memberId,
      stripeCustomerId: input.stripeCustomerId,
      stripeLatestBillingEventId: null,
      stripeLatestCheckoutSessionId: null,
      stripeSubscriptionId: null,
    }).stripeCustomerIdEncrypted;
  }
  if (input.stripeLatestBillingEventCreatedAt !== undefined) {
    data.stripeLatestBillingEventCreatedAt = input.stripeLatestBillingEventCreatedAt;
  }
  if (input.stripeLatestBillingEventId !== undefined) {
    data.stripeLatestBillingEventIdEncrypted = buildHostedMemberBillingPrivateColumns({
      memberId: input.memberId,
      stripeCustomerId: null,
      stripeLatestBillingEventId: input.stripeLatestBillingEventId,
      stripeLatestCheckoutSessionId: null,
      stripeSubscriptionId: null,
    }).stripeLatestBillingEventIdEncrypted;
  }
  if (input.stripeLatestCheckoutSessionId !== undefined) {
    data.stripeLatestCheckoutSessionIdEncrypted = buildHostedMemberBillingPrivateColumns({
      memberId: input.memberId,
      stripeCustomerId: null,
      stripeLatestBillingEventId: null,
      stripeLatestCheckoutSessionId: input.stripeLatestCheckoutSessionId,
      stripeSubscriptionId: null,
    }).stripeLatestCheckoutSessionIdEncrypted;
  }
  if (input.stripeSubscriptionId !== undefined) {
    data.stripeSubscriptionLookupKey = createHostedStripeSubscriptionLookupKey(
      input.stripeSubscriptionId,
    );
    data.stripeSubscriptionIdEncrypted = buildHostedMemberBillingPrivateColumns({
      memberId: input.memberId,
      stripeCustomerId: null,
      stripeLatestBillingEventId: null,
      stripeLatestCheckoutSessionId: null,
      stripeSubscriptionId: input.stripeSubscriptionId,
    }).stripeSubscriptionIdEncrypted;
  }

  return data;
}

function isPrismaUniqueConstraintError(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function mapHostedMemberBillingRefSnapshot(
  billingRef: HostedMemberBillingRef,
): HostedMemberStripeBillingRefSnapshot {
  const privateState = readHostedMemberBillingPrivateState(billingRef);

  return {
    memberId: billingRef.memberId,
    stripeCustomerId: privateState.stripeCustomerId,
    stripeLatestBillingEventCreatedAt: billingRef.stripeLatestBillingEventCreatedAt,
    stripeLatestBillingEventId: privateState.stripeLatestBillingEventId,
    stripeLatestCheckoutSessionId: privateState.stripeLatestCheckoutSessionId,
    stripeSubscriptionId: privateState.stripeSubscriptionId,
  };
}

function mapHostedMemberIdentityState(
  identity: HostedMemberIdentity,
): HostedMemberIdentityState {
  const privateState = readHostedMemberIdentityPrivateState(identity);

  return {
    maskedPhoneNumberHint: identity.maskedPhoneNumberHint,
    memberId: identity.memberId,
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

function mapHostedMemberRoutingState(
  routing: HostedMemberRoutingRecord,
): HostedMemberRoutingStateSnapshot {
  const privateState = readHostedMemberRoutingPrivateState(routing);

  return {
    linqChatId: privateState.linqChatId,
    memberId: routing.memberId,
    telegramUserLookupKey: routing.telegramUserLookupKey ?? null,
  };
}

function buildHostedMemberAggregate(
  member: HostedMemberCoreState,
  input: {
    billingRef: HostedMemberStripeBillingRefSnapshot | null;
    identity: HostedMemberIdentityState | null;
    routing: HostedMemberRoutingStateSnapshot | null;
  },
): HostedMemberAggregate {
  return {
    ...member,
    billingRef: input.billingRef,
    identity: input.identity,
    linqChatId: input.routing?.linqChatId ?? null,
    maskedPhoneNumberHint: input.identity?.maskedPhoneNumberHint ?? null,
    phoneLookupKey: input.identity?.phoneLookupKey ?? null,
    phoneNumberVerifiedAt: input.identity?.phoneNumberVerifiedAt ?? null,
    privyUserId: input.identity?.privyUserId ?? null,
    routing: input.routing,
    stripeCustomerId: input.billingRef?.stripeCustomerId ?? null,
    stripeLatestBillingEventCreatedAt: input.billingRef?.stripeLatestBillingEventCreatedAt ?? null,
    stripeLatestBillingEventId: input.billingRef?.stripeLatestBillingEventId ?? null,
    stripeLatestCheckoutSessionId: input.billingRef?.stripeLatestCheckoutSessionId ?? null,
    stripeSubscriptionId: input.billingRef?.stripeSubscriptionId ?? null,
    telegramUserLookupKey: input.routing?.telegramUserLookupKey ?? null,
    walletAddress: input.identity?.walletAddress ?? null,
    walletChainType: input.identity?.walletChainType ?? null,
    walletCreatedAt: input.identity?.walletCreatedAt ?? null,
    walletProvider: input.identity?.walletProvider ?? null,
  };
}
