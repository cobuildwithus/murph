/**
 * Owns hosted member Stripe billing-reference lookup and write surfaces.
 */
import {
  type HostedMember,
  type HostedMemberBillingRef,
  Prisma,
} from "@prisma/client";

import {
  createHostedStripeCustomerLookupKey,
  createHostedStripeCustomerLookupKeyReadCandidates,
  createHostedStripeSubscriptionLookupKey,
  createHostedStripeSubscriptionLookupKeyReadCandidates,
} from "./contact-privacy";
import {
  buildHostedMemberBillingPrivateColumns,
  readHostedMemberBillingPrivateState,
} from "./member-private-codecs";
import {
  lockHostedMemberRow,
  type HostedOnboardingPrismaClient,
  withHostedOnboardingTransaction,
} from "./shared";

export interface HostedMemberStripeBillingRefSnapshot {
  memberId: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
}

export interface HostedMemberStripeBillingRefWriteInput {
  memberId: string;
  prisma: HostedOnboardingPrismaClient;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
}

export async function findHostedMemberByStripeCustomerId(input: {
  prisma: HostedOnboardingPrismaClient;
  stripeCustomerId: string;
}): Promise<HostedMember | null> {
  const stripeCustomerLookupKeys = createHostedStripeCustomerLookupKeyReadCandidates(
    input.stripeCustomerId,
  );

  if (stripeCustomerLookupKeys.length === 0) {
    return null;
  }

  const billingRefRecord = await input.prisma.hostedMemberBillingRef.findFirst({
    where: {
      stripeCustomerLookupKey: {
        in: stripeCustomerLookupKeys,
      },
    },
    include: {
      member: true,
    },
  });

  return billingRefRecord?.member ?? null;
}

export async function findHostedMemberByStripeSubscriptionId(input: {
  prisma: HostedOnboardingPrismaClient;
  stripeSubscriptionId: string;
}): Promise<HostedMember | null> {
  const stripeSubscriptionLookupKeys = createHostedStripeSubscriptionLookupKeyReadCandidates(
    input.stripeSubscriptionId,
  );

  if (stripeSubscriptionLookupKeys.length === 0) {
    return null;
  }

  const billingRefRecord = await input.prisma.hostedMemberBillingRef.findFirst({
    where: {
      stripeSubscriptionLookupKey: {
        in: stripeSubscriptionLookupKeys,
      },
    },
    include: {
      member: true,
    },
  });

  return billingRefRecord?.member ?? null;
}

export async function readHostedMemberStripeBillingRef(input: {
  memberId: string;
  prisma: HostedOnboardingPrismaClient;
}): Promise<HostedMemberStripeBillingRefSnapshot | null> {
  const billingRef = await input.prisma.hostedMemberBillingRef.findUnique({
    where: {
      memberId: input.memberId,
    },
  });

  return billingRef ? projectHostedMemberStripeBillingRefSnapshot(billingRef) : null;
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

    return projectHostedMemberStripeBillingRefSnapshot(billingRef);
  });
}

export async function bindHostedMemberStripeCustomerIdIfMissing(input: {
  memberId: string;
  prisma: HostedOnboardingPrismaClient;
  stripeCustomerId: string;
}): Promise<boolean> {
  const stripeCustomerLookupKey = createHostedStripeCustomerLookupKey(input.stripeCustomerId);

  if (!stripeCustomerLookupKey) {
    return false;
  }

  const billingPrivateColumns = buildHostedMemberBillingPrivateColumns({
    memberId: input.memberId,
    stripeCustomerId: input.stripeCustomerId,
    stripeSubscriptionId: null,
  });

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
        ...billingPrivateColumns,
        memberId: input.memberId,
        stripeCustomerLookupKey,
        stripeSubscriptionLookupKey: null,
      },
      update: {
        stripeCustomerIdEncrypted: billingPrivateColumns.stripeCustomerIdEncrypted,
        stripeCustomerLookupKey,
      },
    });

    return true;
  });
}

export function projectHostedMemberStripeBillingRefSnapshot(
  billingRef: HostedMemberBillingRef,
): HostedMemberStripeBillingRefSnapshot {
  const privateState = readHostedMemberBillingPrivateState(billingRef);

  return {
    memberId: billingRef.memberId,
    stripeCustomerId: privateState.stripeCustomerId,
    stripeSubscriptionId: privateState.stripeSubscriptionId,
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
      stripeSubscriptionId: input.stripeSubscriptionId ?? null,
    }),
    stripeCustomerLookupKey: createHostedStripeCustomerLookupKey(input.stripeCustomerId ?? null),
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
      stripeSubscriptionId: null,
    }).stripeCustomerIdEncrypted;
  }
  if (input.stripeSubscriptionId !== undefined) {
    data.stripeSubscriptionLookupKey = createHostedStripeSubscriptionLookupKey(
      input.stripeSubscriptionId,
    );
    data.stripeSubscriptionIdEncrypted = buildHostedMemberBillingPrivateColumns({
      memberId: input.memberId,
      stripeCustomerId: null,
      stripeSubscriptionId: input.stripeSubscriptionId,
    }).stripeSubscriptionIdEncrypted;
  }

  return data;
}
