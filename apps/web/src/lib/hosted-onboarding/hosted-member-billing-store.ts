/**
 * Owns hosted member Stripe billing-reference lookup and write surfaces.
 */
import {
  type HostedMember,
  type HostedMemberBillingRef,
  Prisma,
  type PrismaClient,
} from "@prisma/client";

import { getPrisma } from "../prisma";
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
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  lockHostedMemberRow,
  type HostedOnboardingReadClient,
} from "./shared";

export interface HostedMemberStripeBillingRefSnapshot {
  memberId: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
}

export type HostedMemberStripeBillingLookupMatch =
  | "stripeCustomerId"
  | "stripeSubscriptionId";

export interface HostedMemberStripeBillingLookup {
  billingRef: HostedMemberStripeBillingRefSnapshot;
  core: HostedMember;
  matchedBy: HostedMemberStripeBillingLookupMatch;
}

export interface HostedMemberStripeBillingRefWriteInput {
  memberId: string;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  tx: Prisma.TransactionClient;
}

export async function lookupHostedMemberStripeBillingRefByStripeCustomerId(input: {
  prisma: HostedOnboardingReadClient;
  stripeCustomerId: string;
}): Promise<HostedMemberStripeBillingLookup | null> {
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

  return billingRefRecord
    ? projectHostedMemberStripeBillingLookup(billingRefRecord, "stripeCustomerId")
    : null;
}

export async function lookupHostedMemberStripeBillingRefByStripeSubscriptionId(input: {
  prisma: HostedOnboardingReadClient;
  stripeSubscriptionId: string;
}): Promise<HostedMemberStripeBillingLookup | null> {
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

  return billingRefRecord
    ? projectHostedMemberStripeBillingLookup(billingRefRecord, "stripeSubscriptionId")
    : null;
}

export async function readHostedMemberStripeBillingRef(input: {
  memberId: string;
  prisma: HostedOnboardingReadClient;
}): Promise<HostedMemberStripeBillingRefSnapshot | null> {
  const billingRef = await input.prisma.hostedMemberBillingRef.findUnique({
    where: {
      memberId: input.memberId,
    },
  });

  return billingRef ? projectHostedMemberStripeBillingRefSnapshot(billingRef) : null;
}

export async function readHostedMemberStripeCustomerId(input: {
  memberId: string;
  prisma: HostedOnboardingReadClient;
}): Promise<string | null> {
  const billingRef = await readHostedMemberStripeBillingRef(input);
  return billingRef?.stripeCustomerId ?? null;
}

export async function writeHostedMemberStripeBillingRefTx(
  input: HostedMemberStripeBillingRefWriteInput,
): Promise<HostedMemberStripeBillingRefSnapshot> {
  const billingRef = await input.tx.hostedMemberBillingRef.upsert({
    where: {
      memberId: input.memberId,
    },
    create: buildHostedMemberBillingRefCreateData(input),
    update: buildHostedMemberBillingRefUpdateData(input),
  });

  return projectHostedMemberStripeBillingRefSnapshot(billingRef);
}

export async function bindHostedMemberStripeCustomerIdIfMissingTx(input: {
  memberId: string;
  stripeCustomerId: string;
  tx: Prisma.TransactionClient;
}): Promise<HostedMemberStripeBillingRefSnapshot | null> {
  const stripeCustomerLookupKey = createHostedStripeCustomerLookupKey(input.stripeCustomerId);

  if (!stripeCustomerLookupKey) {
    return null;
  }

  const billingPrivateColumns = buildHostedMemberBillingPrivateColumns({
    memberId: input.memberId,
    stripeCustomerId: input.stripeCustomerId,
    stripeSubscriptionId: null,
  });

  await lockHostedMemberRow(input.tx, input.memberId);

  const currentBillingRef = await input.tx.hostedMemberBillingRef.findUnique({
    where: {
      memberId: input.memberId,
    },
  });

  if (currentBillingRef?.stripeCustomerLookupKey) {
    return projectHostedMemberStripeBillingRefSnapshot(currentBillingRef);
  }

  const billingRef = await input.tx.hostedMemberBillingRef.upsert({
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

  return projectHostedMemberStripeBillingRefSnapshot(billingRef);
}

export async function bindHostedMemberStripeCustomerIdIfMissing(input: {
  memberId: string;
  prisma?: PrismaClient;
  stripeCustomerId: string;
}): Promise<HostedMemberStripeBillingRefSnapshot | null> {
  const prisma = input.prisma ?? getPrisma();

  return prisma.$transaction((tx) => bindHostedMemberStripeCustomerIdIfMissingTx({
    memberId: input.memberId,
    stripeCustomerId: input.stripeCustomerId,
    tx,
  }), HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
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

function projectHostedMemberStripeBillingLookup(
  billingRef: HostedMemberBillingRef & {
    member: HostedMember;
  },
  matchedBy: HostedMemberStripeBillingLookupMatch,
): HostedMemberStripeBillingLookup {
  return {
    billingRef: projectHostedMemberStripeBillingRefSnapshot(billingRef),
    core: billingRef.member,
    matchedBy,
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
