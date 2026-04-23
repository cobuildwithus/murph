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
  createHostedStripeCustomerLookupConflictLockToken,
  createHostedStripeCustomerLookupKey,
  createHostedStripeCustomerLookupKeyReadCandidates,
  createHostedStripeSubscriptionLookupConflictLockToken,
  createHostedStripeSubscriptionLookupKey,
  createHostedStripeSubscriptionLookupKeyReadCandidates,
} from "./contact-privacy";
import { hostedOnboardingError } from "./errors";
import {
  buildHostedMemberBillingPrivateColumns,
  readHostedMemberBillingPrivateState,
} from "./member-private-codecs";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  lockHostedAdvisoryKey,
  lockHostedMemberRow,
  type HostedOnboardingReadClient,
} from "./shared";

export interface HostedMemberStripeBillingRefSnapshot {
  lastStripeEventCreatedAt?: Date | null;
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
  stripeEventCreatedAt?: Date | null;
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

  const billingRefRecords = await input.prisma.hostedMemberBillingRef.findMany({
    where: {
      stripeCustomerLookupKey: {
        in: stripeCustomerLookupKeys,
      },
    },
    include: {
      member: true,
    },
  });

  return resolveHostedMemberStripeBillingLookup(billingRefRecords, "stripeCustomerId");
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

  const billingRefRecords = await input.prisma.hostedMemberBillingRef.findMany({
    where: {
      stripeSubscriptionLookupKey: {
        in: stripeSubscriptionLookupKeys,
      },
    },
    include: {
      member: true,
    },
  });

  return resolveHostedMemberStripeBillingLookup(billingRefRecords, "stripeSubscriptionId");
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
  await assertHostedMemberStripeBillingIdentifiersAvailableTx(input);

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
  await assertHostedMemberStripeBillingIdentifiersAvailableTx({
    memberId: input.memberId,
    stripeCustomerId: input.stripeCustomerId,
    tx: input.tx,
  });

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
    ...(billingRef.lastStripeEventCreatedAt !== undefined
      ? {
          lastStripeEventCreatedAt: billingRef.lastStripeEventCreatedAt,
        }
      : {}),
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

function resolveHostedMemberStripeBillingLookup(
  billingRefRecords: Array<HostedMemberBillingRef & { member: HostedMember }>,
  matchedBy: HostedMemberStripeBillingLookupMatch,
): HostedMemberStripeBillingLookup | null {
  if (billingRefRecords.length === 0) {
    return null;
  }

  const billingRefRecordByMemberId = new Map<string, HostedMemberBillingRef & { member: HostedMember }>();

  for (const billingRefRecord of billingRefRecords) {
    if (!billingRefRecordByMemberId.has(billingRefRecord.memberId)) {
      billingRefRecordByMemberId.set(billingRefRecord.memberId, billingRefRecord);
    }
  }

  if (billingRefRecordByMemberId.size !== 1) {
    throw buildHostedStripeBillingLookupAmbiguousError(
      matchedBy,
      billingRefRecordByMemberId.size,
    );
  }

  const [billingRefRecord] = [...billingRefRecordByMemberId.values()];
  return projectHostedMemberStripeBillingLookup(billingRefRecord, matchedBy);
}

function buildHostedMemberBillingRefCreateData(
  input: HostedMemberStripeBillingRefWriteInput,
): Prisma.HostedMemberBillingRefUncheckedCreateInput {
  return {
    ...(input.stripeEventCreatedAt !== undefined
      ? {
          lastStripeEventCreatedAt: input.stripeEventCreatedAt,
        }
      : {}),
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

  if (input.stripeEventCreatedAt !== undefined) {
    data.lastStripeEventCreatedAt = input.stripeEventCreatedAt;
  }
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

async function assertHostedMemberStripeBillingIdentifiersAvailableTx(input: {
  memberId: string;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  const lockTokens = [
    input.stripeCustomerId === undefined
      ? null
      : createHostedStripeCustomerLookupConflictLockToken(input.stripeCustomerId),
    input.stripeSubscriptionId === undefined
      ? null
      : createHostedStripeSubscriptionLookupConflictLockToken(input.stripeSubscriptionId),
  ].filter((token): token is string => Boolean(token));

  for (const lockToken of [...new Set(lockTokens)].sort()) {
    await lockHostedAdvisoryKey(input.tx, lockToken);
  }

  if (input.stripeCustomerId !== undefined) {
    await assertHostedStripeBillingLookupCandidatesAvailableTx({
      lookupKeys: createHostedStripeCustomerLookupKeyReadCandidates(input.stripeCustomerId),
      memberId: input.memberId,
      tx: input.tx,
      violatedField: "stripeCustomerId",
    });
  }

  if (input.stripeSubscriptionId !== undefined) {
    await assertHostedStripeBillingLookupCandidatesAvailableTx({
      lookupKeys: createHostedStripeSubscriptionLookupKeyReadCandidates(input.stripeSubscriptionId),
      memberId: input.memberId,
      tx: input.tx,
      violatedField: "stripeSubscriptionId",
    });
  }
}

async function assertHostedStripeBillingLookupCandidatesAvailableTx(input: {
  lookupKeys: string[];
  memberId: string;
  tx: Prisma.TransactionClient;
  violatedField: HostedMemberStripeBillingLookupMatch;
}): Promise<void> {
  if (input.lookupKeys.length === 0) {
    return;
  }

  const existingBindings = await input.tx.hostedMemberBillingRef.findMany({
    where: input.violatedField === "stripeCustomerId"
      ? {
          stripeCustomerLookupKey: {
            in: input.lookupKeys,
          },
        }
      : {
          stripeSubscriptionLookupKey: {
            in: input.lookupKeys,
          },
        },
    select: {
      memberId: true,
    },
  });

  const conflictingMemberIds = new Set(
    existingBindings
      .map((binding) => binding.memberId)
      .filter((memberId) => memberId !== input.memberId),
  );

  if (conflictingMemberIds.size > 0) {
    throw buildHostedStripeBillingIdentityConflictError(input.violatedField);
  }
}

function buildHostedStripeBillingIdentityConflictError(
  violatedField: HostedMemberStripeBillingLookupMatch,
) {
  return hostedOnboardingError({
    code: "STRIPE_BILLING_IDENTITY_CONFLICT",
    details: {
      violatedField,
    },
    httpStatus: 500,
    message:
      "Stripe billing references matched a different Murph account during blind-index rotation. Repair the duplicate binding before retrying.",
    retryable: true,
  });
}

function buildHostedStripeBillingLookupAmbiguousError(
  violatedField: HostedMemberStripeBillingLookupMatch,
  matchCount: number,
) {
  return hostedOnboardingError({
    code: "STRIPE_BILLING_LOOKUP_AMBIGUOUS",
    details: {
      matchCount,
      violatedField,
    },
    httpStatus: 500,
    message:
      "Stripe billing lookup matched multiple Murph accounts during blind-index rotation. Repair the duplicate binding before retrying.",
    retryable: true,
  });
}
