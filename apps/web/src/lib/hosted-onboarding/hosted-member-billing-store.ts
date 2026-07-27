/**
 * Owns hosted member Stripe billing-reference lookup and write surfaces.
 */
import {
  type HostedMember,
  type HostedMemberBillingRef,
  HostedBillingStatus,
  Prisma,
  type PrismaClient,
} from "@prisma/client";

import { getPrisma } from "../prisma";
import {
  createHostedStripeCheckoutSessionLookupKey,
  createHostedStripeCustomerLookupKey,
  createHostedStripeCustomerLookupKeyReadCandidates,
  createHostedStripeSubscriptionLookupKey,
  createHostedStripeSubscriptionLookupKeyReadCandidates,
  createHostedStripeSubscriptionScheduleLookupKey,
  createHostedStripeSubscriptionScheduleLookupKeyReadCandidates,
} from "./contact-privacy";
import { hostedOnboardingError } from "./errors";
import {
  buildHostedMemberBillingPrivateColumns,
  readHostedMemberBillingPrivateState,
} from "./member-private-codecs";
import { assertHostedMemberNotSuspended } from "./entitlement";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  lockHostedMemberRow,
  type HostedOnboardingReadClient,
} from "./shared";

export interface HostedMemberStripeBillingRefSnapshot {
  currentBillingPhase?: string | null;
  currentBillingPlanCode?: string | null;
  currentCheckoutOffer?: string | null;
  currentPeriodEnd?: Date | null;
  currentPeriodStart?: Date | null;
  currentTrialEndsAt?: Date | null;
  currentTrialStartedAt?: Date | null;
  lastStripeEventCreatedAt?: Date | null;
  memberId: string;
  pulseTrialPolicyVersion?: string | null;
  pulseTrialRedeemedAt?: Date | null;
  scheduledBillingEffectiveAt?: Date | null;
  scheduledBillingPlanCode?: string | null;
  stripeCheckoutSessionId?: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripeSubscriptionScheduleId?: string | null;
}

export interface HostedMemberBillingEligibilityState {
  currentBillingPhase: string | null;
  currentBillingPlanCode: string | null;
  currentCheckoutOffer: string | null;
  hasStripeCustomerId: boolean;
  hasStripeSubscriptionId: boolean;
}

export type HostedMemberStripeBillingLookupMatch =
  | "stripeCustomerId"
  | "stripeSubscriptionId"
  | "stripeSubscriptionScheduleId";

export interface HostedMemberStripeBillingLookup {
  billingRef: HostedMemberStripeBillingRefSnapshot;
  core: HostedMember;
  matchedBy: HostedMemberStripeBillingLookupMatch;
}

export interface HostedMemberStripeBillingRefWriteInput {
  currentBillingPhase?: string | null;
  currentBillingPlanCode?: string | null;
  currentCheckoutOffer?: string | null;
  currentPeriodEnd?: Date | null;
  currentPeriodStart?: Date | null;
  currentTrialEndsAt?: Date | null;
  currentTrialStartedAt?: Date | null;
  memberId: string;
  pulseTrialPolicyVersion?: string | null;
  pulseTrialRedeemedAt?: Date | null;
  scheduledBillingEffectiveAt?: Date | null;
  scheduledBillingPlanCode?: string | null;
  stripeEventCreatedAt?: Date | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  stripeSubscriptionScheduleId?: string | null;
  tx: Prisma.TransactionClient;
}

// Stripe's pinned SDK permits three 80-second attempts plus two Retry-After
// waits of up to 60 seconds per call. A serialized billing transition can
// perform one retrieve and one update under this lock, so 13 minutes covers
// both 6-minute provider budgets plus one minute for lock acquisition and local
// database reconciliation.
export const HOSTED_MEMBER_STRIPE_MUTATION_TRANSACTION_TIMEOUT_MS = 780_000;

const HOSTED_MEMBER_STRIPE_MUTATION_TRANSACTION_OPTIONS = {
  ...HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  timeout: HOSTED_MEMBER_STRIPE_MUTATION_TRANSACTION_TIMEOUT_MS,
} as const;

export class HostedMemberStripeMutationLockBusyError extends Error {
  constructor() {
    super("Hosted member Stripe mutation lock is busy.");
    this.name = "HostedMemberStripeMutationLockBusyError";
  }
}

export async function withHostedMemberStripeMutationLock<TResult>(input: {
  memberId: string;
  prisma: PrismaClient;
  run: (tx: Prisma.TransactionClient) => Promise<TResult>;
}): Promise<TResult> {
  return input.prisma.$transaction(async (tx) => {
    await lockHostedMemberRow(tx, input.memberId);
    return input.run(tx);
  }, HOSTED_MEMBER_STRIPE_MUTATION_TRANSACTION_OPTIONS);
}

export async function withHostedMemberStripeMutationLockForOps<TResult>(input: {
  acquisitionTimeoutMs: number;
  memberId: string;
  prisma: PrismaClient;
  run: (tx: Prisma.TransactionClient) => Promise<TResult>;
  transactionTimeoutMs: number;
}): Promise<TResult> {
  return input.prisma.$transaction(async (tx) => {
    try {
      await lockHostedMemberRow(tx, input.memberId, {
        timeoutMs: input.acquisitionTimeoutMs,
      });
    } catch (error) {
      if (isHostedMemberStripeMutationLockTimeout(error)) {
        throw new HostedMemberStripeMutationLockBusyError();
      }
      throw error;
    }

    await tx.$queryRaw`select set_config('lock_timeout', '0', true)`;
    return input.run(tx);
  }, {
    ...HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
    timeout: input.transactionTimeoutMs,
  });
}

function isHostedMemberStripeMutationLockTimeout(error: unknown): boolean {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== "P2010"
  ) {
    return false;
  }

  const driverAdapterError = error.meta?.driverAdapterError;
  if (!isUnknownRecord(driverAdapterError)) {
    return false;
  }
  const cause = driverAdapterError.cause;
  return isUnknownRecord(cause) &&
    (cause.originalCode === "55P03" || cause.code === "55P03");
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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

  return resolveHostedMemberStripeBillingLookup(
    billingRefRecords,
    "stripeCustomerId",
    input.prisma,
  );
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

  return resolveHostedMemberStripeBillingLookup(
    billingRefRecords,
    "stripeSubscriptionId",
    input.prisma,
  );
}

export async function lookupHostedMemberStripeBillingRefByStripeSubscriptionScheduleId(input: {
  prisma: HostedOnboardingReadClient;
  stripeSubscriptionScheduleId: string;
}): Promise<HostedMemberStripeBillingLookup | null> {
  const stripeSubscriptionScheduleLookupKeys =
    createHostedStripeSubscriptionScheduleLookupKeyReadCandidates(
      input.stripeSubscriptionScheduleId,
    );

  if (stripeSubscriptionScheduleLookupKeys.length === 0) {
    return null;
  }

  const billingRefRecords = await input.prisma.hostedMemberBillingRef.findMany({
    where: {
      stripeSubscriptionScheduleLookupKey: {
        in: stripeSubscriptionScheduleLookupKeys,
      },
    },
    include: {
      member: true,
    },
  });

  return resolveHostedMemberStripeBillingLookup(
    billingRefRecords,
    "stripeSubscriptionScheduleId",
    input.prisma,
  );
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

  return billingRef ? await projectHostedMemberStripeBillingRefSnapshot(billingRef, input.prisma) : null;
}

export async function readHostedMemberBillingEligibilityState(input: {
  memberId: string;
  prisma: HostedOnboardingReadClient;
}): Promise<HostedMemberBillingEligibilityState | null> {
  const billingRef = await input.prisma.hostedMemberBillingRef.findUnique({
    where: {
      memberId: input.memberId,
    },
    select: {
      currentBillingPhase: true,
      currentBillingPlanCode: true,
      currentCheckoutOffer: true,
      stripeCustomerLookupKey: true,
      stripeSubscriptionLookupKey: true,
    },
  });

  if (!billingRef) {
    return null;
  }

  return {
    currentBillingPhase: billingRef.currentBillingPhase,
    currentBillingPlanCode: billingRef.currentBillingPlanCode,
    currentCheckoutOffer: billingRef.currentCheckoutOffer,
    hasStripeCustomerId: Boolean(billingRef.stripeCustomerLookupKey),
    hasStripeSubscriptionId: Boolean(billingRef.stripeSubscriptionLookupKey),
  };
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
  await lockHostedMemberRow(input.tx, input.memberId);
  const member = await input.tx.hostedMember.findUnique({
    select: { suspendedAt: true },
    where: { id: input.memberId },
  });
  if (!member) {
    throw hostedOnboardingError({
      code: "HOSTED_MEMBER_NOT_FOUND",
      httpStatus: 404,
      message: "Hosted member record was not found.",
    });
  }
  assertHostedMemberNotSuspended(member);
  await assertHostedMemberStripeBillingIdentifiersAvailableTx(input);

  let billingRef;

  try {
    billingRef = await input.tx.hostedMemberBillingRef.upsert({
      where: {
        memberId: input.memberId,
      },
      create: await buildHostedMemberBillingRefCreateData(input),
      update: await buildHostedMemberBillingRefUpdateData(input),
    });
  } catch (error) {
    if (isPrismaUniqueConstraintError(error)) {
      throw buildHostedStripeBillingIdentityConflictError(
        deriveHostedStripeBillingUniqueViolationField(input),
      );
    }

    throw error;
  }

  return projectHostedMemberStripeBillingRefSnapshot(billingRef, input.tx);
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

  await lockHostedMemberRow(input.tx, input.memberId);
  const member = await input.tx.hostedMember.findUnique({
    select: { suspendedAt: true },
    where: { id: input.memberId },
  });
  if (!member) {
    return null;
  }
  assertHostedMemberNotSuspended(member);
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
    return projectHostedMemberStripeBillingRefSnapshot(currentBillingRef, input.tx);
  }

  const billingPrivateColumns = await buildHostedMemberBillingPrivateColumns({
    memberId: input.memberId,
    prisma: input.tx,
    stripeCustomerId: input.stripeCustomerId,
    stripeSubscriptionId: null,
  });
  let billingRef;

  try {
    billingRef = await input.tx.hostedMemberBillingRef.upsert({
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
  } catch (error) {
    if (isPrismaUniqueConstraintError(error)) {
      throw buildHostedStripeBillingIdentityConflictError("stripeCustomerId");
    }

    throw error;
  }

  return projectHostedMemberStripeBillingRefSnapshot(billingRef, input.tx);
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

export async function bindHostedMemberStripeCheckoutSessionTx(input: {
  memberId: string;
  stripeCheckoutSessionId: string;
  tx: Prisma.TransactionClient;
}): Promise<HostedMemberStripeBillingRefSnapshot> {
  const stripeCheckoutSessionLookupKey = createHostedStripeCheckoutSessionLookupKey(
    input.stripeCheckoutSessionId,
  );
  if (!stripeCheckoutSessionLookupKey) {
    throw hostedOnboardingError({
      code: "HOSTED_BILLING_CHECKOUT_SESSION_INVALID",
      httpStatus: 502,
      message: "Stripe Checkout returned an invalid session identifier.",
      retryable: true,
    });
  }

  await lockHostedMemberRow(input.tx, input.memberId);
  const member = await input.tx.hostedMember.findUnique({
    select: { suspendedAt: true },
    where: { id: input.memberId },
  });
  if (!member) {
    throw hostedOnboardingError({
      code: "HOSTED_MEMBER_NOT_FOUND",
      httpStatus: 404,
      message: "Hosted member record was not found.",
    });
  }
  assertHostedMemberNotSuspended(member);

  const currentBillingRef = await input.tx.hostedMemberBillingRef.findUnique({
    where: { memberId: input.memberId },
  });
  if (
    currentBillingRef?.stripeCheckoutSessionLookupKey
    && currentBillingRef.stripeCheckoutSessionLookupKey !== stripeCheckoutSessionLookupKey
  ) {
    throw hostedOnboardingError({
      code: "HOSTED_BILLING_CHECKOUT_IN_PROGRESS",
      httpStatus: 409,
      message: "Billing checkout is already in progress. Finish the existing checkout before starting another.",
      retryable: true,
    });
  }

  const privateColumns = await buildHostedMemberBillingPrivateColumns({
    memberId: input.memberId,
    prisma: input.tx,
    stripeCheckoutSessionId: input.stripeCheckoutSessionId,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
  });

  try {
    const billingRef = await input.tx.hostedMemberBillingRef.upsert({
      create: {
        ...privateColumns,
        memberId: input.memberId,
        stripeCheckoutSessionLookupKey,
        stripeCustomerLookupKey: null,
        stripeSubscriptionLookupKey: null,
      },
      update: {
        stripeCheckoutSessionIdEncrypted:
          privateColumns.stripeCheckoutSessionIdEncrypted,
        stripeCheckoutSessionLookupKey,
      },
      where: { memberId: input.memberId },
    });
    return projectHostedMemberStripeBillingRefSnapshot(billingRef, input.tx);
  } catch (error) {
    if (isPrismaUniqueConstraintError(error)) {
      throw hostedOnboardingError({
        code: "STRIPE_CHECKOUT_SESSION_IDENTITY_CONFLICT",
        httpStatus: 500,
        message: "Stripe Checkout matched a different Murph account.",
        retryable: true,
      });
    }
    throw error;
  }
}

export async function projectHostedMemberStripeBillingRefSnapshot(
  billingRef: HostedMemberBillingRef,
  prisma?: HostedOnboardingReadClient,
): Promise<HostedMemberStripeBillingRefSnapshot> {
  const privateState = await readHostedMemberBillingPrivateState(billingRef, prisma);

  return {
    ...(billingRef.lastStripeEventCreatedAt !== undefined
      ? {
          lastStripeEventCreatedAt: billingRef.lastStripeEventCreatedAt,
        }
      : {}),
    currentBillingPlanCode: billingRef.currentBillingPlanCode,
    currentBillingPhase: billingRef.currentBillingPhase,
    currentCheckoutOffer: billingRef.currentCheckoutOffer,
    currentPeriodEnd: billingRef.currentPeriodEnd,
    currentPeriodStart: billingRef.currentPeriodStart,
    currentTrialEndsAt: billingRef.currentTrialEndsAt,
    currentTrialStartedAt: billingRef.currentTrialStartedAt,
    memberId: billingRef.memberId,
    pulseTrialPolicyVersion: billingRef.pulseTrialPolicyVersion,
    pulseTrialRedeemedAt: billingRef.pulseTrialRedeemedAt,
    ...(billingRef.scheduledBillingEffectiveAt
      ? { scheduledBillingEffectiveAt: billingRef.scheduledBillingEffectiveAt }
      : {}),
    ...(billingRef.scheduledBillingPlanCode
      ? { scheduledBillingPlanCode: billingRef.scheduledBillingPlanCode }
      : {}),
    ...(privateState.stripeCheckoutSessionId
      ? { stripeCheckoutSessionId: privateState.stripeCheckoutSessionId }
      : {}),
    stripeCustomerId: privateState.stripeCustomerId,
    stripeSubscriptionId: privateState.stripeSubscriptionId,
    ...(privateState.stripeSubscriptionScheduleId
      ? { stripeSubscriptionScheduleId: privateState.stripeSubscriptionScheduleId }
      : {}),
  };
}

async function projectHostedMemberStripeBillingLookup(
  billingRef: HostedMemberBillingRef & {
    member: HostedMember;
  },
  matchedBy: HostedMemberStripeBillingLookupMatch,
  prisma?: HostedOnboardingReadClient,
): Promise<HostedMemberStripeBillingLookup> {
  return {
    billingRef: await projectHostedMemberStripeBillingRefSnapshot(billingRef, prisma),
    core: billingRef.member,
    matchedBy,
  };
}

async function resolveHostedMemberStripeBillingLookup(
  billingRefRecords: Array<HostedMemberBillingRef & { member: HostedMember }>,
  matchedBy: HostedMemberStripeBillingLookupMatch,
  prisma?: HostedOnboardingReadClient,
): Promise<HostedMemberStripeBillingLookup | null> {
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
  return projectHostedMemberStripeBillingLookup(billingRefRecord, matchedBy, prisma);
}

async function buildHostedMemberBillingRefCreateData(
  input: HostedMemberStripeBillingRefWriteInput,
): Promise<Prisma.HostedMemberBillingRefUncheckedCreateInput> {
  return {
    ...(input.stripeEventCreatedAt !== undefined
      ? {
          lastStripeEventCreatedAt: input.stripeEventCreatedAt,
        }
      : {}),
    memberId: input.memberId,
    ...(await buildHostedMemberBillingPrivateColumns({
      memberId: input.memberId,
      prisma: input.tx,
      stripeCustomerId: input.stripeCustomerId ?? null,
      stripeSubscriptionId: input.stripeSubscriptionId ?? null,
      stripeSubscriptionScheduleId: input.stripeSubscriptionScheduleId ?? null,
    })),
    currentBillingPhase: input.currentBillingPhase ?? null,
    currentBillingPlanCode: input.currentBillingPlanCode ?? null,
    currentCheckoutOffer: input.currentCheckoutOffer ?? null,
    currentPeriodEnd: input.currentPeriodEnd ?? null,
    currentPeriodStart: input.currentPeriodStart ?? null,
    currentTrialEndsAt: input.currentTrialEndsAt ?? null,
    currentTrialStartedAt: input.currentTrialStartedAt ?? null,
    pulseTrialPolicyVersion: input.pulseTrialPolicyVersion ?? null,
    pulseTrialRedeemedAt: input.pulseTrialRedeemedAt ?? null,
    scheduledBillingEffectiveAt: input.scheduledBillingEffectiveAt ?? null,
    scheduledBillingPlanCode: input.scheduledBillingPlanCode ?? null,
    stripeCustomerLookupKey: createHostedStripeCustomerLookupKey(input.stripeCustomerId ?? null),
    stripeSubscriptionLookupKey: createHostedStripeSubscriptionLookupKey(
      input.stripeSubscriptionId ?? null,
    ),
    stripeSubscriptionScheduleLookupKey: createHostedStripeSubscriptionScheduleLookupKey(
      input.stripeSubscriptionScheduleId ?? null,
    ),
  };
}

async function buildHostedMemberBillingRefUpdateData(
  input: HostedMemberStripeBillingRefWriteInput,
): Promise<Prisma.HostedMemberBillingRefUncheckedUpdateInput> {
  const data: Prisma.HostedMemberBillingRefUncheckedUpdateInput = {};

  if (input.stripeEventCreatedAt !== undefined) {
    data.lastStripeEventCreatedAt = input.stripeEventCreatedAt;
  }
  if (input.currentBillingPlanCode !== undefined) {
    data.currentBillingPlanCode = input.currentBillingPlanCode;
  }
  if (input.currentBillingPhase !== undefined) {
    data.currentBillingPhase = input.currentBillingPhase;
  }
  if (input.currentCheckoutOffer !== undefined) {
    data.currentCheckoutOffer = input.currentCheckoutOffer;
  }
  if (input.currentPeriodStart !== undefined) {
    data.currentPeriodStart = input.currentPeriodStart;
  }
  if (input.currentPeriodEnd !== undefined) {
    data.currentPeriodEnd = input.currentPeriodEnd;
  }
  if (input.currentTrialStartedAt !== undefined) {
    data.currentTrialStartedAt = input.currentTrialStartedAt;
  }
  if (input.currentTrialEndsAt !== undefined) {
    data.currentTrialEndsAt = input.currentTrialEndsAt;
  }
  if (input.pulseTrialRedeemedAt !== undefined) {
    data.pulseTrialRedeemedAt = input.pulseTrialRedeemedAt;
  }
  if (input.pulseTrialPolicyVersion !== undefined) {
    data.pulseTrialPolicyVersion = input.pulseTrialPolicyVersion;
  }
  if (input.scheduledBillingPlanCode !== undefined) {
    data.scheduledBillingPlanCode = input.scheduledBillingPlanCode;
  }
  if (input.scheduledBillingEffectiveAt !== undefined) {
    data.scheduledBillingEffectiveAt = input.scheduledBillingEffectiveAt;
  }
  if (input.stripeCustomerId !== undefined) {
    data.stripeCustomerLookupKey = createHostedStripeCustomerLookupKey(input.stripeCustomerId);
    data.stripeCustomerIdEncrypted = (await buildHostedMemberBillingPrivateColumns({
      memberId: input.memberId,
      prisma: input.tx,
      stripeCustomerId: input.stripeCustomerId,
      stripeSubscriptionId: null,
      stripeSubscriptionScheduleId: undefined,
    })).stripeCustomerIdEncrypted;
  }
  if (input.stripeSubscriptionId !== undefined) {
    data.stripeSubscriptionLookupKey = createHostedStripeSubscriptionLookupKey(
      input.stripeSubscriptionId,
    );
    data.stripeSubscriptionIdEncrypted = (await buildHostedMemberBillingPrivateColumns({
      memberId: input.memberId,
      prisma: input.tx,
      stripeCustomerId: null,
      stripeSubscriptionId: input.stripeSubscriptionId,
      stripeSubscriptionScheduleId: undefined,
    })).stripeSubscriptionIdEncrypted;
    if (input.stripeSubscriptionId) {
      data.stripeCheckoutSessionIdEncrypted = null;
      data.stripeCheckoutSessionLookupKey = null;
    }
  }
  if (input.stripeSubscriptionScheduleId !== undefined) {
    data.stripeSubscriptionScheduleLookupKey = createHostedStripeSubscriptionScheduleLookupKey(
      input.stripeSubscriptionScheduleId,
    );
    data.stripeSubscriptionScheduleIdEncrypted = (await buildHostedMemberBillingPrivateColumns({
      memberId: input.memberId,
      prisma: input.tx,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      stripeSubscriptionScheduleId: input.stripeSubscriptionScheduleId,
    })).stripeSubscriptionScheduleIdEncrypted;
  }

  if (input.currentBillingPlanCode === "launch_monthly") {
    data.scheduledBillingEffectiveAt = null;
    data.scheduledBillingPlanCode = null;
    data.stripeSubscriptionScheduleIdEncrypted = null;
    data.stripeSubscriptionScheduleLookupKey = null;
  }

  return data;
}

async function assertHostedMemberStripeBillingIdentifiersAvailableTx(input: {
  memberId: string;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  stripeSubscriptionScheduleId?: string | null;
  tx: Prisma.TransactionClient;
}): Promise<void> {
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

  if (input.stripeSubscriptionScheduleId !== undefined) {
    await assertHostedStripeBillingLookupCandidatesAvailableTx({
      lookupKeys: createHostedStripeSubscriptionScheduleLookupKeyReadCandidates(
        input.stripeSubscriptionScheduleId,
      ),
      memberId: input.memberId,
      tx: input.tx,
      violatedField: "stripeSubscriptionScheduleId",
    });
  }
}

function isPrismaUniqueConstraintError(
  error: unknown,
): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function deriveHostedStripeBillingUniqueViolationField(
  input: Pick<
    HostedMemberStripeBillingRefWriteInput,
    "stripeCustomerId" | "stripeSubscriptionId" | "stripeSubscriptionScheduleId"
  >,
): HostedMemberStripeBillingLookupMatch {
  if (input.stripeCustomerId === undefined && input.stripeSubscriptionId !== undefined) {
    return "stripeSubscriptionId";
  }

  if (
    input.stripeCustomerId === undefined &&
    input.stripeSubscriptionId === undefined &&
    input.stripeSubscriptionScheduleId !== undefined
  ) {
    return "stripeSubscriptionScheduleId";
  }

  return "stripeCustomerId";
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
    where: buildHostedStripeBillingLookupWhere(input),
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

function buildHostedStripeBillingLookupWhere(input: {
  lookupKeys: string[];
  violatedField: HostedMemberStripeBillingLookupMatch;
}): Prisma.HostedMemberBillingRefWhereInput {
  if (input.violatedField === "stripeCustomerId") {
    return {
      stripeCustomerLookupKey: {
        in: input.lookupKeys,
      },
    };
  }

  if (input.violatedField === "stripeSubscriptionId") {
    return {
      stripeSubscriptionLookupKey: {
        in: input.lookupKeys,
      },
    };
  }

  return {
    stripeSubscriptionScheduleLookupKey: {
      in: input.lookupKeys,
    },
  };
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

/**
 * Presence-only check on the subscription blind index. `incomplete` cannot be
 * read from billing status alone, so surfaces that must tell recovery apart from
 * first-time checkout ask this instead of re-deriving it.
 */
export async function readHostedMemberOwnsSubscription(input: {
  billingStatus?: HostedBillingStatus;
  memberId: string;
  prisma?: PrismaClient;
}): Promise<boolean> {
  // Only `incomplete` is ambiguous between recovery and first-time checkout, so
  // callers that pass a status skip the read for every other state.
  if (
    input.billingStatus !== undefined
    && input.billingStatus !== HostedBillingStatus.incomplete
  ) {
    return false;
  }
  const prisma = input.prisma ?? getPrisma();
  const billingRef = await prisma.hostedMemberBillingRef.findUnique({
    select: {
      stripeSubscriptionLookupKey: true,
    },
    where: {
      memberId: input.memberId,
    },
  });
  return Boolean(billingRef?.stripeSubscriptionLookupKey);
}
