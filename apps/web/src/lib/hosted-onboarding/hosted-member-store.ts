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

type HostedMemberIdentitySnapshot = Pick<
  HostedMember,
  | "id"
  | "maskedPhoneNumberHint"
  | "normalizedPhoneNumber"
  | "phoneNumberVerifiedAt"
  | "privyUserId"
  | "walletAddress"
  | "walletChainType"
  | "walletProvider"
  | "walletCreatedAt"
>;

type HostedMemberBillingRefSnapshotSource = Pick<
  HostedMember,
  | "id"
  | "stripeCustomerId"
  | "stripeSubscriptionId"
  | "stripeLatestCheckoutSessionId"
  | "stripeLatestBillingEventCreatedAt"
  | "stripeLatestBillingEventId"
>;

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

export type HostedMemberTelegramLookupSnapshot = Pick<
  HostedMember,
  "billingStatus" | "id" | "status"
>;

export async function findHostedMemberByPrivyUserId(input: {
  prisma: HostedMemberStoreClient;
  privyUserId: string;
}): Promise<HostedMember | null> {
  const identityRecord = typeof input.prisma.hostedMemberIdentity?.findUnique === "function"
    ? await input.prisma.hostedMemberIdentity.findUnique({
        where: {
          privyUserId: input.privyUserId,
        },
        include: {
          member: true,
        },
      })
    : null;

  if (identityRecord?.member) {
    return identityRecord.member;
  }

  return input.prisma.hostedMember.findUnique({
    where: {
      privyUserId: input.privyUserId,
    },
  });
}

export async function findHostedMemberByPhoneLookupKey(input: {
  phoneLookupKey: string;
  prisma: HostedMemberStoreClient;
}): Promise<HostedMember | null> {
  const identityRecord = typeof input.prisma.hostedMemberIdentity?.findUnique === "function"
    ? await input.prisma.hostedMemberIdentity.findUnique({
        where: {
          normalizedPhoneNumber: input.phoneLookupKey,
        },
        include: {
          member: true,
        },
      })
    : null;

  if (identityRecord?.member) {
    return identityRecord.member;
  }

  return input.prisma.hostedMember.findUnique({
    where: {
      normalizedPhoneNumber: input.phoneLookupKey,
    },
  });
}

export async function findHostedMemberByWalletAddress(input: {
  prisma: HostedMemberStoreClient;
  walletAddress: string;
}): Promise<HostedMember | null> {
  const identityRecord = typeof input.prisma.hostedMemberIdentity?.findUnique === "function"
    ? await input.prisma.hostedMemberIdentity.findUnique({
        where: {
          walletAddress: input.walletAddress,
        },
        include: {
          member: true,
        },
      })
    : null;

  if (identityRecord?.member) {
    return identityRecord.member;
  }

  return input.prisma.hostedMember.findUnique({
    where: {
      walletAddress: input.walletAddress,
    },
  });
}

export async function findHostedMemberByTelegramUserLookupKey(input: {
  prisma: HostedMemberStoreClient;
  telegramUserId: string;
}): Promise<HostedMemberTelegramLookupSnapshot | null> {
  if (typeof input.prisma.hostedMemberRouting?.findUnique !== "function") {
    return null;
  }

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
  const billingRefRecord = typeof input.prisma.hostedMemberBillingRef?.findUnique === "function"
    ? await input.prisma.hostedMemberBillingRef.findUnique({
        where: {
          stripeCustomerId: input.stripeCustomerId,
        },
        include: {
          member: true,
        },
      })
    : null;

  if (billingRefRecord?.member) {
    return billingRefRecord.member;
  }

  return input.prisma.hostedMember.findUnique({
    where: {
      stripeCustomerId: input.stripeCustomerId,
    },
  });
}

export async function findHostedMemberByStripeSubscriptionId(input: {
  prisma: HostedMemberStoreClient;
  stripeSubscriptionId: string;
}): Promise<HostedMember | null> {
  const billingRefRecord = typeof input.prisma.hostedMemberBillingRef?.findUnique === "function"
    ? await input.prisma.hostedMemberBillingRef.findUnique({
        where: {
          stripeSubscriptionId: input.stripeSubscriptionId,
        },
        include: {
          member: true,
        },
      })
    : null;

  if (billingRefRecord?.member) {
    return billingRefRecord.member;
  }

  return input.prisma.hostedMember.findUnique({
    where: {
      stripeSubscriptionId: input.stripeSubscriptionId,
    },
  });
}

export async function readHostedMemberIdentity(input: {
  memberId: string;
  prisma: HostedMemberStoreClient;
}): Promise<HostedMemberIdentityState | null> {
  const identityRecord = typeof input.prisma.hostedMemberIdentity?.findUnique === "function"
    ? await input.prisma.hostedMemberIdentity.findUnique({
        where: {
          memberId: input.memberId,
        },
      })
    : null;

  if (identityRecord) {
    return mapHostedMemberIdentityState(identityRecord);
  }

  if (typeof input.prisma.hostedMember.findUnique !== "function") {
    return null;
  }

  const member = await input.prisma.hostedMember.findUnique({
    where: {
      id: input.memberId,
    },
    select: {
      id: true,
      maskedPhoneNumberHint: true,
      normalizedPhoneNumber: true,
      phoneNumberVerifiedAt: true,
      privyUserId: true,
      walletAddress: true,
      walletChainType: true,
      walletCreatedAt: true,
      walletProvider: true,
    },
  });

  return member ? mapLegacyHostedMemberIdentityState(member) : null;
}

export async function readHostedMemberRoutingState(input: {
  memberId: string;
  prisma: HostedMemberStoreClient;
}): Promise<HostedMemberRoutingStateSnapshot | null> {
  if (typeof input.prisma.hostedMemberRouting?.findUnique !== "function") {
    return null;
  }

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

export async function upsertHostedMemberLinqChatBinding(input: {
  linqChatId: string | null;
  memberId: string;
  prisma: HostedMemberStoreClient;
}): Promise<void> {
  if (!input.linqChatId) {
    return;
  }

  await withHostedOnboardingTransaction(input.prisma, async (tx) => {
    if (typeof tx.hostedMemberRouting?.upsert !== "function") {
      return;
    }

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
    if (typeof tx.hostedMemberRouting?.upsert !== "function") {
      return;
    }

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

export async function readHostedMemberStripeBillingRef(input: {
  memberId: string;
  prisma: HostedMemberStoreClient;
}): Promise<HostedMemberStripeBillingRefSnapshot | null> {
  if (typeof input.prisma.hostedMemberBillingRef?.findUnique === "function") {
    const billingRef = await input.prisma.hostedMemberBillingRef.findUnique({
      where: {
        memberId: input.memberId,
      },
    });

    return billingRef ? mapHostedMemberBillingRefSnapshot(billingRef) : null;
  }

  const member = await input.prisma.hostedMember.findUnique({
    where: {
      id: input.memberId,
    },
    select: {
      id: true,
      stripeCustomerId: true,
      stripeLatestBillingEventCreatedAt: true,
      stripeLatestBillingEventId: true,
      stripeLatestCheckoutSessionId: true,
      stripeSubscriptionId: true,
    },
  });

  return member ? mapLegacyHostedMemberBillingRefSnapshot(member) : null;
}

export async function writeHostedMemberStripeBillingRef(
  input: HostedMemberStripeBillingRefWriteInput,
): Promise<HostedMemberStripeBillingRefSnapshot | null> {
  return withHostedOnboardingTransaction(input.prisma, async (tx) => {
    if (typeof tx.hostedMemberBillingRef?.upsert !== "function") {
      const legacyUpdate = buildHostedMemberStripeBillingRefLegacyWriteData(input);

      if (Object.keys(legacyUpdate).length > 0) {
        await tx.hostedMember.update({
          where: {
            id: input.memberId,
          },
          data: legacyUpdate,
        });
      }

      return readHostedMemberStripeBillingRef({
        memberId: input.memberId,
        prisma: tx,
      });
    }

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
    if (typeof tx.hostedMemberBillingRef?.upsert === "function") {
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
    }

    const legacyBindResult = await tx.hostedMember.updateMany({
      where: {
        id: input.memberId,
        stripeCustomerId: null,
      },
      data: {
        stripeCustomerId: input.stripeCustomerId,
      },
    });

    return legacyBindResult.count === 1;
  });
}

export async function syncHostedMemberPrivacyFoundationFromMember(input: {
  member: HostedMemberIdentitySnapshot & HostedMemberBillingRefSnapshotSource;
  prisma: HostedMemberStoreClient;
}): Promise<void> {
  if (typeof input.prisma.hostedMemberIdentity?.upsert === "function") {
    await input.prisma.hostedMemberIdentity.upsert({
      where: {
        memberId: input.member.id,
      },
      create: buildHostedMemberIdentityCreateData(input.member),
      update: buildHostedMemberIdentityUpdateData(input.member),
    });
  }

  if (
    typeof input.prisma.hostedMemberBillingRef?.findUnique === "function" &&
    typeof input.prisma.hostedMemberBillingRef.create === "function"
  ) {
    const existingBillingRef = await input.prisma.hostedMemberBillingRef.findUnique({
      where: {
        memberId: input.member.id,
      },
    });

    if (!existingBillingRef) {
      await input.prisma.hostedMemberBillingRef.create({
        data: buildHostedMemberBillingRefCreateData({
          memberId: input.member.id,
          prisma: input.prisma,
          stripeCustomerId: input.member.stripeCustomerId,
          stripeLatestBillingEventCreatedAt: input.member.stripeLatestBillingEventCreatedAt,
          stripeLatestBillingEventId: input.member.stripeLatestBillingEventId,
          stripeLatestCheckoutSessionId: input.member.stripeLatestCheckoutSessionId,
          stripeSubscriptionId: input.member.stripeSubscriptionId,
        }),
      });
    }
  }
}

function buildHostedMemberIdentityCreateData(
  member: HostedMemberIdentitySnapshot,
): Prisma.HostedMemberIdentityUncheckedCreateInput {
  return {
    memberId: member.id,
    maskedPhoneNumberHint: member.maskedPhoneNumberHint,
    normalizedPhoneNumber: member.normalizedPhoneNumber,
    phoneNumberVerifiedAt: member.phoneNumberVerifiedAt,
    privyUserId: member.privyUserId,
    walletAddress: member.walletAddress,
    walletChainType: member.walletChainType,
    walletProvider: member.walletProvider,
    walletCreatedAt: member.walletCreatedAt,
  };
}

function buildHostedMemberIdentityUpdateData(
  member: HostedMemberIdentitySnapshot,
): Prisma.HostedMemberIdentityUncheckedUpdateInput {
  return {
    maskedPhoneNumberHint: member.maskedPhoneNumberHint,
    normalizedPhoneNumber: member.normalizedPhoneNumber,
    phoneNumberVerifiedAt: member.phoneNumberVerifiedAt,
    privyUserId: member.privyUserId,
    walletAddress: member.walletAddress,
    walletChainType: member.walletChainType,
    walletProvider: member.walletProvider,
    walletCreatedAt: member.walletCreatedAt,
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

function buildHostedMemberStripeBillingRefLegacyWriteData(
  input: HostedMemberStripeBillingRefWriteInput,
): Prisma.HostedMemberUncheckedUpdateInput {
  const data: Prisma.HostedMemberUncheckedUpdateInput = {};

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

function mapLegacyHostedMemberIdentityState(
  member: Pick<
    HostedMember,
    | "id"
    | "maskedPhoneNumberHint"
    | "normalizedPhoneNumber"
    | "phoneNumberVerifiedAt"
    | "privyUserId"
    | "walletAddress"
    | "walletChainType"
    | "walletCreatedAt"
    | "walletProvider"
  >,
): HostedMemberIdentityState {
  return {
    maskedPhoneNumberHint: member.maskedPhoneNumberHint,
    memberId: member.id,
    normalizedPhoneNumber: member.normalizedPhoneNumber,
    phoneNumberVerifiedAt: member.phoneNumberVerifiedAt,
    privyUserId: member.privyUserId,
    walletAddress: member.walletAddress,
    walletChainType: member.walletChainType,
    walletCreatedAt: member.walletCreatedAt,
    walletProvider: member.walletProvider,
  };
}

function mapLegacyHostedMemberBillingRefSnapshot(
  member: HostedMemberBillingRefSnapshotSource,
): HostedMemberStripeBillingRefSnapshot {
  return {
    memberId: member.id,
    stripeCustomerId: member.stripeCustomerId,
    stripeLatestBillingEventCreatedAt: member.stripeLatestBillingEventCreatedAt,
    stripeLatestBillingEventId: member.stripeLatestBillingEventId,
    stripeLatestCheckoutSessionId: member.stripeLatestCheckoutSessionId,
    stripeSubscriptionId: member.stripeSubscriptionId,
  };
}
