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
  readHostedMemberPrivateState,
  writeHostedMemberPrivateStatePatch,
  type HostedMemberPrivateState,
} from "./member-private-state";
import {
  type HostedOnboardingPrismaClient,
  lockHostedMemberRow,
  withHostedOnboardingTransaction,
} from "./shared";

type HostedMemberStoreClient = HostedOnboardingPrismaClient;
type HostedMemberCoreState = Pick<
  HostedMember,
  "billingMode" | "billingStatus" | "createdAt" | "id" | "status" | "updatedAt"
>;
type HostedMemberRecordWithRelations = Prisma.HostedMemberGetPayload<{
  include: {
    billingRef: true;
    identity: true;
    routing: true;
  };
}>;
type HostedMemberRoutingRecord = {
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

export type HostedMemberTelegramLookupSnapshot = Pick<
  HostedMember,
  "billingStatus" | "id" | "status"
>;

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
          status: true,
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

export async function readHostedMemberIdentity(input: {
  memberId: string;
  prisma: HostedMemberStoreClient;
}): Promise<HostedMemberIdentityState | null> {
  const [identityRecord, privateState] = await Promise.all([
    input.prisma.hostedMemberIdentity.findUnique({
      where: {
        memberId: input.memberId,
      },
    }),
    readHostedMemberPrivateState({
      memberId: input.memberId,
    }),
  ]);

  return identityRecord ? mapHostedMemberIdentityState(identityRecord, privateState) : null;
}

export async function readHostedMemberRoutingState(input: {
  memberId: string;
  prisma: HostedMemberStoreClient;
}): Promise<HostedMemberRoutingStateSnapshot | null> {
  const [routingRecord, privateState] = await Promise.all([
    input.prisma.hostedMemberRouting.findUnique({
      where: {
        memberId: input.memberId,
      },
      select: {
        linqChatLookupKey: true,
        memberId: true,
        telegramUserLookupKey: true,
      },
    }),
    readHostedMemberPrivateState({
      memberId: input.memberId,
    }),
  ]);

  return routingRecord ? mapHostedMemberRoutingState(routingRecord, privateState) : null;
}

export async function readHostedMemberStripeBillingRef(input: {
  memberId: string;
  prisma: HostedMemberStoreClient;
}): Promise<HostedMemberStripeBillingRefSnapshot | null> {
  const [billingRef, privateState] = await Promise.all([
    input.prisma.hostedMemberBillingRef.findUnique({
      where: {
        memberId: input.memberId,
      },
    }),
    readHostedMemberPrivateState({
      memberId: input.memberId,
    }),
  ]);

  return billingRef ? mapHostedMemberBillingRefSnapshot(billingRef, privateState) : null;
}

export async function readHostedMemberAggregate(input: {
  memberId: string;
  prisma: HostedMemberStoreClient;
}): Promise<HostedMemberAggregate | null> {
  const [memberRecord, privateState] = await Promise.all([
    input.prisma.hostedMember.findUnique({
      where: {
        id: input.memberId,
      },
      include: {
        billingRef: true,
        identity: true,
        routing: true,
      },
    }) as Promise<HostedMemberRecordWithRelations | null>,
    readHostedMemberPrivateState({
      memberId: input.memberId,
    }),
  ]);

  if (!memberRecord) {
    return null;
  }

  const identity = memberRecord.identity
    ? mapHostedMemberIdentityState(memberRecord.identity, privateState)
    : null;
  const routing = memberRecord.routing
    ? mapHostedMemberRoutingState(memberRecord.routing, privateState)
    : null;
  const billingRef = memberRecord.billingRef
    ? mapHostedMemberBillingRefSnapshot(memberRecord.billingRef, privateState)
    : null;

  return buildHostedMemberAggregate(memberRecord, {
    billingRef,
    identity,
    routing,
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
  const privateState = await writeHostedMemberPrivateStatePatch({
    memberId: input.memberId,
    patch: {
      privyUserId: input.privyUserId,
      walletAddress: input.walletAddress,
    },
  });

  return mapHostedMemberIdentityState(identity, privateState);
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
            linqChatLookupKey: null,
          },
        });

        await tx.hostedMemberRouting.upsert({
          where: {
            memberId: input.memberId,
          },
          create: {
            memberId: input.memberId,
            linqChatLookupKey,
            telegramUserLookupKey: null,
          },
          update: {
            linqChatLookupKey,
          },
        });

        await writeHostedMemberPrivateStatePatch({
          memberId: input.memberId,
          patch: {
            linqChatId: input.linqChatId,
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
    const privateState = await writeHostedMemberPrivateStatePatch({
      memberId: input.memberId,
      patch: {
        stripeCustomerId: input.stripeCustomerId,
        stripeLatestBillingEventId: input.stripeLatestBillingEventId,
        stripeLatestCheckoutSessionId: input.stripeLatestCheckoutSessionId,
        stripeSubscriptionId: input.stripeSubscriptionId,
      },
    });

    return mapHostedMemberBillingRefSnapshot(billingRef, privateState);
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
        memberId: input.memberId,
        stripeCustomerLookupKey,
        stripeLatestBillingEventCreatedAt: null,
        stripeSubscriptionLookupKey: null,
      },
      update: {
        stripeCustomerLookupKey,
      },
    });

    await writeHostedMemberPrivateStatePatch({
      memberId: input.memberId,
      patch: {
        stripeCustomerId: input.stripeCustomerId,
      },
    });

    return true;
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
  }
  if (input.stripeLatestBillingEventCreatedAt !== undefined) {
    data.stripeLatestBillingEventCreatedAt = input.stripeLatestBillingEventCreatedAt;
  }
  if (input.stripeSubscriptionId !== undefined) {
    data.stripeSubscriptionLookupKey = createHostedStripeSubscriptionLookupKey(
      input.stripeSubscriptionId,
    );
  }

  return data;
}

function isPrismaUniqueConstraintError(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function mapHostedMemberBillingRefSnapshot(
  billingRef: HostedMemberBillingRef,
  privateState: HostedMemberPrivateState | null,
): HostedMemberStripeBillingRefSnapshot {
  return {
    memberId: billingRef.memberId,
    stripeCustomerId: privateState?.stripeCustomerId ?? null,
    stripeLatestBillingEventCreatedAt: billingRef.stripeLatestBillingEventCreatedAt,
    stripeLatestBillingEventId: privateState?.stripeLatestBillingEventId ?? null,
    stripeLatestCheckoutSessionId: privateState?.stripeLatestCheckoutSessionId ?? null,
    stripeSubscriptionId: privateState?.stripeSubscriptionId ?? null,
  };
}

function mapHostedMemberIdentityState(
  identity: HostedMemberIdentity,
  privateState: HostedMemberPrivateState | null,
): HostedMemberIdentityState {
  return {
    maskedPhoneNumberHint: identity.maskedPhoneNumberHint,
    memberId: identity.memberId,
    phoneLookupKey: identity.phoneLookupKey,
    phoneNumberVerifiedAt: identity.phoneNumberVerifiedAt,
    privyUserId: privateState?.privyUserId ?? null,
    walletAddress: privateState?.walletAddress ?? null,
    walletChainType: identity.walletChainType,
    walletCreatedAt: identity.walletCreatedAt,
    walletProvider: identity.walletProvider,
  };
}

function mapHostedMemberRoutingState(
  routing: HostedMemberRoutingRecord,
  privateState: HostedMemberPrivateState | null,
): HostedMemberRoutingStateSnapshot {
  return {
    linqChatId: privateState?.linqChatId ?? null,
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
