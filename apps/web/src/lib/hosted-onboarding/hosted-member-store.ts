import {
  type HostedMember,
  type HostedMemberBillingRef,
  type HostedMemberIdentity,
  Prisma,
} from "@prisma/client";

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
  normalizedPhoneNumber: string;
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
  normalizedPhoneNumber: string;
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
  telegramUserId: string | null;
}

export interface HostedMemberAggregate extends HostedMemberCoreState {
  billingRef: HostedMemberStripeBillingRefSnapshot | null;
  identity: HostedMemberIdentityState | null;
  linqChatId: string | null;
  maskedPhoneNumberHint: string | null;
  normalizedPhoneNumber: string | null;
  phoneNumberVerifiedAt: Date | null;
  privyUserId: string | null;
  routing: HostedMemberRoutingStateSnapshot | null;
  stripeCustomerId: string | null;
  stripeLatestBillingEventCreatedAt: Date | null;
  stripeLatestBillingEventId: string | null;
  stripeLatestCheckoutSessionId: string | null;
  stripeSubscriptionId: string | null;
  telegramUserId: string | null;
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
  const identityRecord = await input.prisma.hostedMemberIdentity.findUnique({
    where: {
      privyUserId: input.privyUserId,
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
      normalizedPhoneNumber: input.phoneLookupKey,
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
  const identityRecord = await input.prisma.hostedMemberIdentity.findUnique({
    where: {
      walletAddress: input.walletAddress,
    },
    include: {
      member: true,
    },
  });

  return identityRecord?.member ?? null;
}

export async function findHostedMemberByTelegramUserLookupKey(input: {
  prisma: HostedMemberStoreClient;
  telegramUserId: string;
}): Promise<HostedMemberTelegramLookupSnapshot | null> {
  const routingRecord = await input.prisma.hostedMemberRouting.findUnique({
    where: {
      telegramUserId: input.telegramUserId,
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
  const billingRefRecord = await input.prisma.hostedMemberBillingRef.findUnique({
    where: {
      stripeCustomerId: input.stripeCustomerId,
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
  const billingRefRecord = await input.prisma.hostedMemberBillingRef.findUnique({
    where: {
      stripeSubscriptionId: input.stripeSubscriptionId,
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
  return input.prisma.hostedMemberRouting.findUnique({
    where: {
      memberId: input.memberId,
    },
    select: {
      linqChatId: true,
      memberId: true,
      telegramUserId: true,
    },
  });
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
  }) as HostedMemberRecordWithRelations | null;

  if (!memberRecord) {
    return null;
  }

  const identity = memberRecord.identity
    ? mapHostedMemberIdentityState(memberRecord.identity)
    : null;
  const routing = memberRecord.routing
    ? mapHostedMemberRoutingState(memberRecord.routing)
    : null;
  const billingRef = memberRecord.billingRef
    ? mapHostedMemberBillingRefSnapshot(memberRecord.billingRef)
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

  return mapHostedMemberIdentityState(identity);
}

export async function upsertHostedMemberLinqChatBinding(input: {
  linqChatId: string | null;
  memberId: string;
  prisma: HostedMemberStoreClient;
}): Promise<void> {
  if (!input.linqChatId) {
    return;
  }

  await withHostedOnboardingTransaction(input.prisma, async (tx) => {
    await tx.hostedMemberRouting.upsert({
      where: {
        memberId: input.memberId,
      },
      create: {
        memberId: input.memberId,
        linqChatId: input.linqChatId,
        telegramUserId: null,
      },
      update: {
        linqChatId: input.linqChatId,
      },
    });
  });
}

export async function upsertHostedMemberTelegramRoutingBinding(input: {
  memberId: string;
  prisma: HostedMemberStoreClient;
  telegramUserId: string;
}): Promise<void> {
  await withHostedOnboardingTransaction(input.prisma, async (tx) => {
    await tx.hostedMemberRouting.upsert({
      where: {
        memberId: input.memberId,
      },
      create: {
        memberId: input.memberId,
        linqChatId: null,
        telegramUserId: input.telegramUserId,
      },
      update: {
        telegramUserId: input.telegramUserId,
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
  return withHostedOnboardingTransaction(input.prisma, async (tx) => {
    await lockHostedMemberRow(tx, input.memberId);

    const currentBillingRef = await tx.hostedMemberBillingRef.findUnique({
      where: {
        memberId: input.memberId,
      },
    });

    if (currentBillingRef?.stripeCustomerId) {
      return false;
    }

    await tx.hostedMemberBillingRef.upsert({
      where: {
        memberId: input.memberId,
      },
      create: {
        memberId: input.memberId,
        stripeCustomerId: input.stripeCustomerId,
        stripeLatestBillingEventCreatedAt: null,
        stripeLatestBillingEventId: null,
        stripeLatestCheckoutSessionId: null,
        stripeSubscriptionId: null,
      },
      update: {
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
    normalizedPhoneNumber: input.normalizedPhoneNumber,
    phoneNumberVerifiedAt: input.phoneNumberVerifiedAt,
    privyUserId: input.privyUserId,
    walletAddress: input.walletAddress,
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
    normalizedPhoneNumber: input.normalizedPhoneNumber,
    phoneNumberVerifiedAt: input.phoneNumberVerifiedAt,
    privyUserId: input.privyUserId,
    walletAddress: input.walletAddress,
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
    stripeCustomerId: input.stripeCustomerId ?? null,
    stripeLatestBillingEventCreatedAt: input.stripeLatestBillingEventCreatedAt ?? null,
    stripeLatestBillingEventId: input.stripeLatestBillingEventId ?? null,
    stripeLatestCheckoutSessionId: input.stripeLatestCheckoutSessionId ?? null,
    stripeSubscriptionId: input.stripeSubscriptionId ?? null,
  };
}

function buildHostedMemberBillingRefUpdateData(
  input: HostedMemberStripeBillingRefWriteInput,
): Prisma.HostedMemberBillingRefUncheckedUpdateInput {
  const data: Prisma.HostedMemberBillingRefUncheckedUpdateInput = {};

  if (input.stripeCustomerId !== undefined) {
    data.stripeCustomerId = input.stripeCustomerId;
  }
  if (input.stripeLatestBillingEventCreatedAt !== undefined) {
    data.stripeLatestBillingEventCreatedAt = input.stripeLatestBillingEventCreatedAt;
  }
  if (input.stripeLatestBillingEventId !== undefined) {
    data.stripeLatestBillingEventId = input.stripeLatestBillingEventId;
  }
  if (input.stripeLatestCheckoutSessionId !== undefined) {
    data.stripeLatestCheckoutSessionId = input.stripeLatestCheckoutSessionId;
  }
  if (input.stripeSubscriptionId !== undefined) {
    data.stripeSubscriptionId = input.stripeSubscriptionId;
  }

  return data;
}

function mapHostedMemberBillingRefSnapshot(
  billingRef: HostedMemberBillingRef,
): HostedMemberStripeBillingRefSnapshot {
  return {
    memberId: billingRef.memberId,
    stripeCustomerId: billingRef.stripeCustomerId,
    stripeLatestBillingEventCreatedAt: billingRef.stripeLatestBillingEventCreatedAt,
    stripeLatestBillingEventId: billingRef.stripeLatestBillingEventId,
    stripeLatestCheckoutSessionId: billingRef.stripeLatestCheckoutSessionId,
    stripeSubscriptionId: billingRef.stripeSubscriptionId,
  };
}

function mapHostedMemberIdentityState(
  identity: HostedMemberIdentity,
): HostedMemberIdentityState {
  return {
    maskedPhoneNumberHint: identity.maskedPhoneNumberHint,
    memberId: identity.memberId,
    normalizedPhoneNumber: identity.normalizedPhoneNumber,
    phoneNumberVerifiedAt: identity.phoneNumberVerifiedAt,
    privyUserId: identity.privyUserId,
    walletAddress: identity.walletAddress,
    walletChainType: identity.walletChainType,
    walletCreatedAt: identity.walletCreatedAt,
    walletProvider: identity.walletProvider,
  };
}

function mapHostedMemberRoutingState(
  routing: Pick<Prisma.HostedMemberRoutingUncheckedCreateInput, "linqChatId" | "memberId" | "telegramUserId">,
): HostedMemberRoutingStateSnapshot {
  return {
    linqChatId: routing.linqChatId ?? null,
    memberId: routing.memberId,
    telegramUserId: routing.telegramUserId ?? null,
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
    normalizedPhoneNumber: input.identity?.normalizedPhoneNumber ?? null,
    phoneNumberVerifiedAt: input.identity?.phoneNumberVerifiedAt ?? null,
    privyUserId: input.identity?.privyUserId ?? null,
    routing: input.routing,
    stripeCustomerId: input.billingRef?.stripeCustomerId ?? null,
    stripeLatestBillingEventCreatedAt: input.billingRef?.stripeLatestBillingEventCreatedAt ?? null,
    stripeLatestBillingEventId: input.billingRef?.stripeLatestBillingEventId ?? null,
    stripeLatestCheckoutSessionId: input.billingRef?.stripeLatestCheckoutSessionId ?? null,
    stripeSubscriptionId: input.billingRef?.stripeSubscriptionId ?? null,
    telegramUserId: input.routing?.telegramUserId ?? null,
    walletAddress: input.identity?.walletAddress ?? null,
    walletChainType: input.identity?.walletChainType ?? null,
    walletCreatedAt: input.identity?.walletCreatedAt ?? null,
    walletProvider: input.identity?.walletProvider ?? null,
  };
}
