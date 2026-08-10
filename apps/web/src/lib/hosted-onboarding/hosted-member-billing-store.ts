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
  createHostedStripeCheckoutSessionLookupKeyReadCandidates,
  createHostedStripeCustomerLookupKey,
  createHostedStripeCustomerLookupKeyReadCandidates,
  createHostedStripeSubscriptionLookupKey,
  createHostedStripeSubscriptionLookupKeyReadCandidates,
  createHostedStripeSubscriptionScheduleLookupKey,
  createHostedStripeSubscriptionScheduleLookupKeyReadCandidates,
} from "./contact-privacy";
import { hostedOnboardingError } from "./errors";
import {
  buildHostedMemberBillingCheckoutSessionPrivateColumn,
  buildHostedMemberBillingPrivateColumns,
  readHostedMemberBillingPrivateState,
} from "./member-private-codecs";
import { assertHostedMemberNotSuspended } from "./entitlement";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  lockHostedMemberRow,
  type HostedOnboardingReadClient,
} from "./shared";
import {
  parseHostedPulseTrialStartSource,
  type HostedPulseTrialStartSource,
} from "./pulse-trial-start-source";

export interface HostedMemberStripeBillingRefSnapshot {
  checkoutAttemptId?: string | null;
  checkoutCreatedAt?: Date | null;
  checkoutIntentHash?: string | null;
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
  pulseTrialPaidClaimPriceId?: string | null;
  pulseTrialRedeemedAt?: Date | null;
  pulseTrialStartSource?: HostedPulseTrialStartSource | null;
  scheduledBillingEffectiveAt?: Date | null;
  scheduledBillingPlanCode?: string | null;
  stripeCheckoutSessionId?: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripeSubscriptionScheduleId?: string | null;
  usagePlanTransitionAt?: Date | null;
  usagePlanTransitionFromCode?: string | null;
  usagePlanTransitionKind?: string | null;
  usagePlanTransitionToCode?: string | null;
}

export interface HostedMemberBillingEligibilityState {
  currentBillingPhase: string | null;
  currentBillingPlanCode: string | null;
  currentCheckoutOffer: string | null;
  currentPeriodEnd: Date | null;
  hasStripeCustomerId: boolean;
  hasStripeSubscriptionId: boolean;
  scheduledBillingEffectiveAt: Date | null;
  scheduledBillingPlanCode: string | null;
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
  pulseTrialPaidClaimPriceId?: string | null;
  pulseTrialRedeemedAt?: Date | null;
  pulseTrialStartSource?: HostedPulseTrialStartSource | null;
  scheduledBillingEffectiveAt?: Date | null;
  scheduledBillingPlanCode?: string | null;
  stripeEventCreatedAt?: Date | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  stripeSubscriptionScheduleId?: string | null;
  tx: Prisma.TransactionClient;
  usagePlanTransitionAt?: Date | null;
  usagePlanTransitionFromCode?: string | null;
  usagePlanTransitionKind?: string | null;
  usagePlanTransitionToCode?: string | null;
}

export interface HostedMemberStripeCheckoutAttempt {
  attemptId: string;
  createdAt: Date;
  intentHash: string;
  stripeCheckoutSessionId: string | null;
}

export interface PreparedHostedMemberStripeCheckoutSession {
  stripeCheckoutSessionIdEncrypted: string;
  stripeCheckoutSessionLookupKey: string;
}

export interface PreparedHostedMemberStripeCheckoutCompletion {
  memberId: string;
  stripeCustomerId: string;
  stripeCustomerIdEncrypted: string;
  stripeCustomerLookupKey: string;
  stripeSubscriptionId: string;
  stripeSubscriptionIdEncrypted: string;
  stripeSubscriptionLookupKey: string;
}

export interface HostedMemberStripeBillingLookupState {
  stripeCustomerLookupKey: string | null;
  stripeSubscriptionLookupKey: string | null;
}

export type HostedMemberStripeCheckoutAcceptance =
  | {
      kind: "accepted" | "already_accepted";
    }
  | {
      kind: "cleanup_superseded" | "cleanup_terminal";
    };

export type HostedMemberStripeCheckoutAttemptRevalidation =
  | "current"
  | "session_advanced"
  | "stale";

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

export async function readHostedMemberStripeBillingLookupState(input: {
  memberId: string;
  prisma: HostedOnboardingReadClient;
}): Promise<HostedMemberStripeBillingLookupState | null> {
  return input.prisma.hostedMemberBillingRef.findUnique({
    select: {
      stripeCustomerLookupKey: true,
      stripeSubscriptionLookupKey: true,
    },
    where: { memberId: input.memberId },
  });
}

export async function listHostedMemberStripeBillingLookupMemberIds(input: {
  prisma: HostedOnboardingReadClient;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
}): Promise<string[]> {
  const stripeCustomerLookupKeys =
    createHostedStripeCustomerLookupKeyReadCandidates(
      input.stripeCustomerId,
    );
  const stripeSubscriptionLookupKeys =
    createHostedStripeSubscriptionLookupKeyReadCandidates(
      input.stripeSubscriptionId,
    );
  const selectors: Prisma.HostedMemberBillingRefWhereInput[] = [];
  if (stripeCustomerLookupKeys.length > 0) {
    selectors.push({
      stripeCustomerLookupKey: { in: stripeCustomerLookupKeys },
    });
  }
  if (stripeSubscriptionLookupKeys.length > 0) {
    selectors.push({
      stripeSubscriptionLookupKey: { in: stripeSubscriptionLookupKeys },
    });
  }
  if (selectors.length === 0) {
    return [];
  }
  const billingRefs = await input.prisma.hostedMemberBillingRef.findMany({
    select: { memberId: true },
    where: { OR: selectors },
  });
  return [...new Set(billingRefs.map((billingRef) => billingRef.memberId))];
}

/**
 * Persists one direct Checkout intent before Stripe is called. A retry reuses
 * this exact attempt, including after an ambiguous provider or commit result.
 */
export async function reserveHostedMemberStripeCheckoutAttemptUnderLockTx(input: {
  attemptId: string;
  createdAt: Date;
  expectedBillingRef: HostedMemberStripeBillingRefSnapshot | null;
  intentHash: string;
  memberId: string;
  tx: Prisma.TransactionClient;
}): Promise<HostedMemberStripeCheckoutAttempt> {
  const current = await input.tx.hostedMemberBillingRef.findUnique({
    select: {
      checkoutAttemptId: true,
      checkoutCreatedAt: true,
      checkoutIntentHash: true,
      pulseTrialRedeemedAt: true,
      stripeCheckoutSessionLookupKey: true,
      stripeCustomerLookupKey: true,
      stripeSubscriptionLookupKey: true,
    },
    where: { memberId: input.memberId },
  });
  if (current?.stripeSubscriptionLookupKey) {
    throw hostedOnboardingError({
      code: "HOSTED_BILLING_SUBSCRIPTION_ALREADY_EXISTS",
      httpStatus: 409,
      message:
        "This hosted account already has a subscription. Manage it from Settings instead of starting a new one.",
    });
  }

  const expected = input.expectedBillingRef;
  const expectedAttempt = readHostedMemberStripeCheckoutAttempt(expected);
  const currentAttemptId = current?.checkoutAttemptId ?? null;
  const currentCreatedAt = current?.checkoutCreatedAt ?? null;
  const currentIntentHash = current?.checkoutIntentHash ?? null;
  const currentSessionLookupKey =
    current?.stripeCheckoutSessionLookupKey ?? null;
  if (currentAttemptId) {
    if (
      !expectedAttempt
      || expectedAttempt.attemptId !== currentAttemptId
      || expectedAttempt.createdAt.getTime() !== currentCreatedAt?.getTime()
      || expectedAttempt.intentHash !== currentIntentHash
      || (
        expectedAttempt.stripeCheckoutSessionId !== null
        && !hostedStripeLookupKeyMatchesValue(
          currentSessionLookupKey,
          expectedAttempt.stripeCheckoutSessionId,
          createHostedStripeCheckoutSessionLookupKeyReadCandidates,
        )
      )
    ) {
      throw buildHostedMemberStripeCheckoutAttemptStaleError();
    }
    return expectedAttempt;
  }
  if (
    expectedAttempt
    || currentCreatedAt
    || currentIntentHash
    || currentSessionLookupKey
  ) {
    throw buildHostedMemberStripeCheckoutAttemptStaleError();
  }
  if (
    !hostedStripeLookupKeyMatchesValue(
      current?.stripeCustomerLookupKey ?? null,
      expected?.stripeCustomerId ?? null,
      createHostedStripeCustomerLookupKeyReadCandidates,
    )
    || (current?.pulseTrialRedeemedAt?.getTime() ?? null) !==
      (expected?.pulseTrialRedeemedAt?.getTime() ?? null)
  ) {
    throw buildHostedMemberStripeCheckoutAttemptStaleError();
  }

  await input.tx.hostedMemberBillingRef.upsert({
    create: {
      checkoutAttemptId: input.attemptId,
      checkoutCreatedAt: input.createdAt,
      checkoutIntentHash: input.intentHash,
      memberId: input.memberId,
    },
    update: {
      checkoutAttemptId: input.attemptId,
      checkoutCreatedAt: input.createdAt,
      checkoutIntentHash: input.intentHash,
      stripeCheckoutSessionIdEncrypted: null,
      stripeCheckoutSessionLookupKey: null,
    },
    where: {
      memberId: input.memberId,
    },
  });

  return {
    attemptId: input.attemptId,
    createdAt: input.createdAt,
    intentHash: input.intentHash,
    stripeCheckoutSessionId: null,
  };
}

export async function prepareHostedMemberStripeCheckoutSession(input: {
  memberId: string;
  prisma: PrismaClient;
  sessionId: string;
}): Promise<PreparedHostedMemberStripeCheckoutSession> {
  const stripeCheckoutSessionLookupKey =
    createHostedStripeCheckoutSessionLookupKey(input.sessionId);
  if (!stripeCheckoutSessionLookupKey) {
    throw new TypeError("Stripe Checkout Session ID is invalid.");
  }
  const { stripeCheckoutSessionIdEncrypted } =
    await buildHostedMemberBillingCheckoutSessionPrivateColumn({
      memberId: input.memberId,
      prisma: input.prisma,
      stripeCheckoutSessionId: input.sessionId,
    });
  if (!stripeCheckoutSessionIdEncrypted) {
    throw new TypeError("Stripe Checkout Session ID encryption failed.");
  }
  return {
    stripeCheckoutSessionIdEncrypted,
    stripeCheckoutSessionLookupKey,
  };
}

export async function bindHostedMemberStripeCheckoutSessionTx(input: {
  attemptId: string;
  intentHash: string;
  memberId: string;
  preparedSession: PreparedHostedMemberStripeCheckoutSession;
  tx: Prisma.TransactionClient;
}): Promise<boolean> {
  const updated = await input.tx.hostedMemberBillingRef.updateMany({
    data: {
      stripeCheckoutSessionIdEncrypted:
        input.preparedSession.stripeCheckoutSessionIdEncrypted,
      stripeCheckoutSessionLookupKey:
        input.preparedSession.stripeCheckoutSessionLookupKey,
    },
    where: {
      checkoutAttemptId: input.attemptId,
      checkoutIntentHash: input.intentHash,
      memberId: input.memberId,
      stripeSubscriptionLookupKey: null,
    },
  });
  return updated.count === 1;
}

export async function revalidateHostedMemberStripeCheckoutAttemptUnderLockTx(input: {
  attempt: HostedMemberStripeCheckoutAttempt;
  memberId: string;
  tx: Prisma.TransactionClient;
}): Promise<HostedMemberStripeCheckoutAttemptRevalidation> {
  const sessionLookupKeys =
    createHostedStripeCheckoutSessionLookupKeyReadCandidates(
      input.attempt.stripeCheckoutSessionId,
    );
  const current = await input.tx.hostedMemberBillingRef.findUnique({
    select: {
      checkoutAttemptId: true,
      checkoutCreatedAt: true,
      checkoutIntentHash: true,
      stripeCheckoutSessionLookupKey: true,
      stripeSubscriptionLookupKey: true,
    },
    where: { memberId: input.memberId },
  });
  if (
    !current
    || current.checkoutAttemptId !== input.attempt.attemptId
    || current.checkoutCreatedAt?.getTime() !==
      input.attempt.createdAt.getTime()
    || current.checkoutIntentHash !== input.attempt.intentHash
    || current.stripeSubscriptionLookupKey
  ) {
    return "stale";
  }
  if (!input.attempt.stripeCheckoutSessionId) {
    return current.stripeCheckoutSessionLookupKey
      ? "session_advanced"
      : "current";
  }
  return current.stripeCheckoutSessionLookupKey
      && sessionLookupKeys.includes(current.stripeCheckoutSessionLookupKey)
    ? "current"
    : "stale";
}

export async function clearHostedMemberStripeCheckoutAttemptTx(input: {
  attemptId: string;
  expectedSessionId: string | null;
  intentHash: string;
  memberId: string;
  tx: Prisma.TransactionClient;
}): Promise<boolean> {
  const sessionLookupKeys =
    createHostedStripeCheckoutSessionLookupKeyReadCandidates(
      input.expectedSessionId,
    );
  const updated = await input.tx.hostedMemberBillingRef.updateMany({
    data: {
      checkoutAttemptId: null,
      checkoutCreatedAt: null,
      checkoutIntentHash: null,
      stripeCheckoutSessionIdEncrypted: null,
      stripeCheckoutSessionLookupKey: null,
    },
    where: {
      checkoutAttemptId: input.attemptId,
      checkoutIntentHash: input.intentHash,
      memberId: input.memberId,
      stripeCheckoutSessionLookupKey: input.expectedSessionId
        ? { in: sessionLookupKeys }
        : null,
    },
  });
  return updated.count === 1;
}

export async function clearHostedMemberStripeCheckoutAttemptForSessionTx(input: {
  memberId: string;
  sessionId: string;
  tx: Prisma.TransactionClient;
}): Promise<boolean> {
  const sessionLookupKeys =
    createHostedStripeCheckoutSessionLookupKeyReadCandidates(input.sessionId);
  if (sessionLookupKeys.length === 0) {
    return false;
  }
  const updated = await input.tx.hostedMemberBillingRef.updateMany({
    data: {
      checkoutAttemptId: null,
      checkoutCreatedAt: null,
      checkoutIntentHash: null,
      stripeCheckoutSessionIdEncrypted: null,
      stripeCheckoutSessionLookupKey: null,
    },
    where: {
      memberId: input.memberId,
      stripeCheckoutSessionLookupKey: {
        in: sessionLookupKeys,
      },
    },
  });
  return updated.count === 1;
}

/**
 * Owns exactly one completed direct Checkout. Standard Checkout preserves an
 * existing billing identity. Pulse Trial may replace an identity only after
 * its caller classifies that identity as stale while holding the same member
 * lock. A terminal provider candidate is never bound, but the same owner must
 * distinguish an already-accepted replay from an unaccepted cleanup target.
 */
export async function acceptHostedMemberStripeCheckoutCompletionTx(input: {
  allowBillingIdentityReplacement?: boolean;
  billingIdentityDisposition: "bind" | "terminal";
  checkoutAttemptId: string | null;
  checkoutIntentHash: string | null;
  checkoutSessionId: string;
  currentCheckoutOffer: string;
  eventCreatedAt: Date;
  memberId: string;
  preparedCompletion: PreparedHostedMemberStripeCheckoutCompletion;
  tx: Prisma.TransactionClient;
}): Promise<HostedMemberStripeCheckoutAcceptance> {
  await lockHostedMemberRow(input.tx, input.memberId);
  const sessionLookupKeys =
    createHostedStripeCheckoutSessionLookupKeyReadCandidates(
      input.checkoutSessionId,
    );
  const customerLookupKeys =
    createHostedStripeCustomerLookupKeyReadCandidates(
      input.preparedCompletion.stripeCustomerId,
    );
  const subscriptionLookupKeys =
    createHostedStripeSubscriptionLookupKeyReadCandidates(
      input.preparedCompletion.stripeSubscriptionId,
    );
  if (
    input.preparedCompletion.memberId !== input.memberId
    || sessionLookupKeys.length === 0
    || customerLookupKeys.length === 0
    || subscriptionLookupKeys.length === 0
  ) {
    throw new TypeError("Completed Stripe Checkout identifiers are invalid.");
  }

  const currentRecord = await input.tx.hostedMemberBillingRef.findUnique({
    select: {
      checkoutAttemptId: true,
      checkoutIntentHash: true,
      lastStripeEventCreatedAt: true,
      stripeCheckoutSessionLookupKey: true,
      stripeCustomerLookupKey: true,
      stripeSubscriptionLookupKey: true,
    },
    where: { memberId: input.memberId },
  });
  if (
    !input.allowBillingIdentityReplacement
    && currentRecord?.stripeSubscriptionLookupKey
    && !subscriptionLookupKeys.includes(
      currentRecord.stripeSubscriptionLookupKey,
    )
  ) {
    return { kind: "cleanup_superseded" };
  }
  if (
    !input.allowBillingIdentityReplacement
    && currentRecord?.stripeCustomerLookupKey
    && !customerLookupKeys.includes(currentRecord.stripeCustomerLookupKey)
  ) {
    return { kind: "cleanup_superseded" };
  }

  const completionHasAttempt = Boolean(
    input.checkoutAttemptId && input.checkoutIntentHash,
  );
  const completionMatchesAttempt = Boolean(
    completionHasAttempt
    && currentRecord?.checkoutAttemptId === input.checkoutAttemptId
    && currentRecord.checkoutIntentHash === input.checkoutIntentHash
    && (
      currentRecord.stripeCheckoutSessionLookupKey === null
      || sessionLookupKeys.includes(
        currentRecord.stripeCheckoutSessionLookupKey,
      )
    ),
  );
  const acceptsLegacyCompletion = Boolean(
    !input.checkoutAttemptId
    && !input.checkoutIntentHash
    && !currentRecord?.checkoutAttemptId
    && !currentRecord?.checkoutIntentHash
    && !currentRecord?.stripeCheckoutSessionLookupKey,
  );
  const alreadyAccepted =
    Boolean(
      currentRecord?.stripeSubscriptionLookupKey
      && subscriptionLookupKeys.includes(
        currentRecord.stripeSubscriptionLookupKey,
      ),
    );
  if (alreadyAccepted && input.billingIdentityDisposition === "terminal") {
    return { kind: "already_accepted" };
  }
  if (!alreadyAccepted && !completionMatchesAttempt && !acceptsLegacyCompletion) {
    return { kind: "cleanup_superseded" };
  }

  await assertHostedMemberStripeBillingIdentifiersAvailableTx({
    memberId: input.memberId,
    stripeCustomerId: input.preparedCompletion.stripeCustomerId,
    stripeSubscriptionId: input.preparedCompletion.stripeSubscriptionId,
    tx: input.tx,
  });
  if (input.billingIdentityDisposition === "terminal") {
    return { kind: "cleanup_terminal" };
  }
  const lastStripeEventCreatedAt =
    currentRecord?.lastStripeEventCreatedAt
    && currentRecord.lastStripeEventCreatedAt > input.eventCreatedAt
      ? currentRecord.lastStripeEventCreatedAt
      : input.eventCreatedAt;
  const data = {
    checkoutAttemptId: null,
    checkoutCreatedAt: null,
    checkoutIntentHash: null,
    currentCheckoutOffer: input.currentCheckoutOffer,
    lastStripeEventCreatedAt,
    stripeCheckoutSessionIdEncrypted: null,
    stripeCheckoutSessionLookupKey: null,
    stripeCustomerIdEncrypted:
      input.preparedCompletion.stripeCustomerIdEncrypted,
    stripeCustomerLookupKey:
      input.preparedCompletion.stripeCustomerLookupKey,
    stripeSubscriptionIdEncrypted:
      input.preparedCompletion.stripeSubscriptionIdEncrypted,
    stripeSubscriptionLookupKey:
      input.preparedCompletion.stripeSubscriptionLookupKey,
  };
  if (currentRecord) {
    await input.tx.hostedMemberBillingRef.update({
      data,
      where: { memberId: input.memberId },
    });
  } else {
    await input.tx.hostedMemberBillingRef.create({
      data: {
        ...data,
        memberId: input.memberId,
      },
    });
  }

  return {
    kind: alreadyAccepted ? "already_accepted" : "accepted",
  };
}

export async function writeAcceptedHostedMemberPulseTrialBillingTx(input: {
  currentCheckoutOffer: string;
  currentPeriodEnd: Date | null;
  currentPeriodStart: Date | null;
  currentTrialEndsAt: Date;
  currentTrialStartedAt: Date;
  memberId: string;
  preparedCompletion: PreparedHostedMemberStripeCheckoutCompletion;
  pulseTrialPolicyVersion: string;
  pulseTrialStartSource: HostedPulseTrialStartSource | null;
  tx: Prisma.TransactionClient;
}): Promise<boolean> {
  if (input.preparedCompletion.memberId !== input.memberId) {
    throw new TypeError("Prepared Stripe Checkout completion has a different owner.");
  }

  const updated = await input.tx.hostedMemberBillingRef.updateMany({
    data: {
      currentBillingPhase: "trial",
      currentBillingPlanCode: "launch_monthly",
      currentCheckoutOffer: input.currentCheckoutOffer,
      currentPeriodEnd: input.currentPeriodEnd,
      currentPeriodStart: input.currentPeriodStart,
      currentTrialEndsAt: input.currentTrialEndsAt,
      currentTrialStartedAt: input.currentTrialStartedAt,
      pulseTrialPolicyVersion: input.pulseTrialPolicyVersion,
      pulseTrialRedeemedAt: input.currentTrialStartedAt,
      pulseTrialStartSource: input.pulseTrialStartSource,
    },
    where: {
      memberId: input.memberId,
      pulseTrialRedeemedAt: null,
      stripeCustomerLookupKey:
        input.preparedCompletion.stripeCustomerLookupKey,
      stripeSubscriptionLookupKey:
        input.preparedCompletion.stripeSubscriptionLookupKey,
    },
  });

  return updated.count === 1;
}

export async function prepareHostedMemberStripeCheckoutCompletion(input: {
  memberId: string;
  prisma: PrismaClient;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
}): Promise<PreparedHostedMemberStripeCheckoutCompletion> {
  const stripeCustomerLookupKey =
    createHostedStripeCustomerLookupKey(input.stripeCustomerId);
  const stripeSubscriptionLookupKey =
    createHostedStripeSubscriptionLookupKey(input.stripeSubscriptionId);
  if (!stripeCustomerLookupKey || !stripeSubscriptionLookupKey) {
    throw new TypeError("Completed Stripe Checkout identifiers are invalid.");
  }
  const {
    stripeCustomerIdEncrypted,
    stripeSubscriptionIdEncrypted,
  } = await buildHostedMemberBillingPrivateColumns({
    memberId: input.memberId,
    prisma: input.prisma,
    stripeCustomerId: input.stripeCustomerId,
    stripeSubscriptionId: input.stripeSubscriptionId,
  });
  if (!stripeCustomerIdEncrypted || !stripeSubscriptionIdEncrypted) {
    throw new TypeError("Completed Stripe Checkout identifier encryption failed.");
  }
  return {
    memberId: input.memberId,
    stripeCustomerId: input.stripeCustomerId,
    stripeCustomerIdEncrypted,
    stripeCustomerLookupKey,
    stripeSubscriptionId: input.stripeSubscriptionId,
    stripeSubscriptionIdEncrypted,
    stripeSubscriptionLookupKey,
  };
}

function hostedStripeLookupKeyMatchesValue(
  lookupKey: string | null,
  value: string | null,
  createReadCandidates: (value: string | null) => string[],
): boolean {
  if (!value) {
    return lookupKey === null;
  }
  return Boolean(
    lookupKey
    && createReadCandidates(value).includes(lookupKey),
  );
}

function buildHostedMemberStripeCheckoutAttemptStaleError() {
  return hostedOnboardingError({
    code: "HOSTED_BILLING_CHECKOUT_ATTEMPT_STALE",
    httpStatus: 409,
    message: "Billing checkout changed while it was being prepared. Try again.",
    retryable: true,
  });
}

function readHostedMemberStripeCheckoutAttempt(
  billingRef: HostedMemberStripeBillingRefSnapshot | null,
): HostedMemberStripeCheckoutAttempt | null {
  const attemptId = billingRef?.checkoutAttemptId ?? null;
  const createdAt = billingRef?.checkoutCreatedAt ?? null;
  const intentHash = billingRef?.checkoutIntentHash ?? null;
  const stripeCheckoutSessionId =
    billingRef?.stripeCheckoutSessionId ?? null;
  if (!attemptId) {
    if (createdAt || intentHash || stripeCheckoutSessionId) {
      throw buildHostedMemberStripeCheckoutAttemptInvariantError();
    }
    return null;
  }
  if (!createdAt || !intentHash) {
    throw buildHostedMemberStripeCheckoutAttemptInvariantError();
  }
  return {
    attemptId,
    createdAt,
    intentHash,
    stripeCheckoutSessionId,
  };
}

function buildHostedMemberStripeCheckoutAttemptInvariantError() {
  return hostedOnboardingError({
    code: "HOSTED_BILLING_CHECKOUT_ATTEMPT_INCONSISTENT",
    httpStatus: 500,
    message:
      "Stored billing checkout state is incomplete. Contact support before starting another checkout.",
  });
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
      currentPeriodEnd: true,
      scheduledBillingEffectiveAt: true,
      scheduledBillingPlanCode: true,
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
    currentPeriodEnd: billingRef.currentPeriodEnd,
    hasStripeCustomerId: Boolean(billingRef.stripeCustomerLookupKey),
    hasStripeSubscriptionId: Boolean(billingRef.stripeSubscriptionLookupKey),
    scheduledBillingEffectiveAt:
      billingRef.scheduledBillingEffectiveAt,
    scheduledBillingPlanCode: billingRef.scheduledBillingPlanCode,
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

export async function projectHostedMemberStripeBillingRefSnapshot(
  billingRef: HostedMemberBillingRef,
  prisma?: HostedOnboardingReadClient,
): Promise<HostedMemberStripeBillingRefSnapshot> {
  const privateState = await readHostedMemberBillingPrivateState(billingRef, prisma);

  return {
    ...(billingRef.checkoutAttemptId !== undefined
      ? { checkoutAttemptId: billingRef.checkoutAttemptId }
      : {}),
    ...(billingRef.checkoutCreatedAt !== undefined
      ? { checkoutCreatedAt: billingRef.checkoutCreatedAt }
      : {}),
    ...(billingRef.checkoutIntentHash !== undefined
      ? { checkoutIntentHash: billingRef.checkoutIntentHash }
      : {}),
    ...(billingRef.lastStripeEventCreatedAt !== undefined
      ? {
          lastStripeEventCreatedAt: billingRef.lastStripeEventCreatedAt,
        }
      : {}),
    ...(billingRef.usagePlanTransitionAt !== undefined
      ? { usagePlanTransitionAt: billingRef.usagePlanTransitionAt }
      : {}),
    ...(billingRef.usagePlanTransitionFromCode !== undefined
      ? { usagePlanTransitionFromCode: billingRef.usagePlanTransitionFromCode }
      : {}),
    ...(billingRef.usagePlanTransitionKind !== undefined
      ? { usagePlanTransitionKind: billingRef.usagePlanTransitionKind }
      : {}),
    ...(billingRef.usagePlanTransitionToCode !== undefined
      ? { usagePlanTransitionToCode: billingRef.usagePlanTransitionToCode }
      : {}),
    ...(billingRef.currentBillingPlanCode !== undefined
      ? { currentBillingPlanCode: billingRef.currentBillingPlanCode }
      : {}),
    ...(billingRef.currentBillingPhase !== undefined
      ? { currentBillingPhase: billingRef.currentBillingPhase }
      : {}),
    ...(billingRef.currentCheckoutOffer !== undefined
      ? { currentCheckoutOffer: billingRef.currentCheckoutOffer }
      : {}),
    ...(billingRef.currentPeriodEnd !== undefined
      ? { currentPeriodEnd: billingRef.currentPeriodEnd }
      : {}),
    ...(billingRef.currentPeriodStart !== undefined
      ? { currentPeriodStart: billingRef.currentPeriodStart }
      : {}),
    ...(billingRef.currentTrialEndsAt !== undefined
      ? { currentTrialEndsAt: billingRef.currentTrialEndsAt }
      : {}),
    ...(billingRef.currentTrialStartedAt !== undefined
      ? { currentTrialStartedAt: billingRef.currentTrialStartedAt }
      : {}),
    memberId: billingRef.memberId,
    ...(billingRef.pulseTrialPolicyVersion !== undefined
      ? { pulseTrialPolicyVersion: billingRef.pulseTrialPolicyVersion }
      : {}),
    ...(billingRef.pulseTrialPaidClaimPriceId !== undefined
      ? { pulseTrialPaidClaimPriceId: billingRef.pulseTrialPaidClaimPriceId }
      : {}),
    ...(billingRef.pulseTrialRedeemedAt !== undefined
      ? { pulseTrialRedeemedAt: billingRef.pulseTrialRedeemedAt }
      : {}),
    ...(billingRef.pulseTrialStartSource !== undefined
      ? {
          pulseTrialStartSource: parseHostedPulseTrialStartSource(
            billingRef.pulseTrialStartSource,
          ),
        }
      : {}),
    ...(billingRef.scheduledBillingEffectiveAt
      ? { scheduledBillingEffectiveAt: billingRef.scheduledBillingEffectiveAt }
      : {}),
    ...(billingRef.scheduledBillingPlanCode
      ? { scheduledBillingPlanCode: billingRef.scheduledBillingPlanCode }
      : {}),
    ...(billingRef.stripeCheckoutSessionIdEncrypted !== undefined
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
    pulseTrialPaidClaimPriceId: input.pulseTrialPaidClaimPriceId ?? null,
    pulseTrialRedeemedAt: input.pulseTrialRedeemedAt ?? null,
    pulseTrialStartSource: input.pulseTrialStartSource ?? null,
    scheduledBillingEffectiveAt: input.scheduledBillingEffectiveAt ?? null,
    scheduledBillingPlanCode: input.scheduledBillingPlanCode ?? null,
    stripeCustomerLookupKey: createHostedStripeCustomerLookupKey(input.stripeCustomerId ?? null),
    stripeSubscriptionLookupKey: createHostedStripeSubscriptionLookupKey(
      input.stripeSubscriptionId ?? null,
    ),
    stripeSubscriptionScheduleLookupKey: createHostedStripeSubscriptionScheduleLookupKey(
      input.stripeSubscriptionScheduleId ?? null,
    ),
    usagePlanTransitionAt: input.usagePlanTransitionAt ?? null,
    usagePlanTransitionFromCode: input.usagePlanTransitionFromCode ?? null,
    usagePlanTransitionKind: input.usagePlanTransitionKind ?? null,
    usagePlanTransitionToCode: input.usagePlanTransitionToCode ?? null,
  };
}

async function buildHostedMemberBillingRefUpdateData(
  input: HostedMemberStripeBillingRefWriteInput,
): Promise<Prisma.HostedMemberBillingRefUncheckedUpdateInput> {
  const data: Prisma.HostedMemberBillingRefUncheckedUpdateInput = {};

  if (input.stripeEventCreatedAt !== undefined) {
    data.lastStripeEventCreatedAt = input.stripeEventCreatedAt;
  }
  if (input.usagePlanTransitionAt !== undefined) {
    data.usagePlanTransitionAt = input.usagePlanTransitionAt;
  }
  if (input.usagePlanTransitionFromCode !== undefined) {
    data.usagePlanTransitionFromCode = input.usagePlanTransitionFromCode;
  }
  if (input.usagePlanTransitionKind !== undefined) {
    data.usagePlanTransitionKind = input.usagePlanTransitionKind;
  }
  if (input.usagePlanTransitionToCode !== undefined) {
    data.usagePlanTransitionToCode = input.usagePlanTransitionToCode;
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
  if (input.pulseTrialPaidClaimPriceId !== undefined) {
    data.pulseTrialPaidClaimPriceId = input.pulseTrialPaidClaimPriceId;
  }
  if (input.pulseTrialStartSource !== undefined) {
    data.pulseTrialStartSource = input.pulseTrialStartSource;
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
