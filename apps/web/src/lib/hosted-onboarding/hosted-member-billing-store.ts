/**
 * Owns hosted member Stripe billing-reference lookup and write surfaces.
 */
import { randomUUID } from "node:crypto";

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
  buildHostedMemberBillingPrivateColumns,
  readHostedMemberBillingPrivateState,
} from "./member-private-codecs";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  lockHostedMemberRow,
  type HostedOnboardingReadClient,
} from "./shared";
import {
  HOSTED_STRIPE_IDEMPOTENCY_SAFE_REPLAY_WINDOW_MS,
} from "./stripe-billing-state";

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
  pulseTrialRedeemedAt?: Date | null;
  scheduledBillingEffectiveAt?: Date | null;
  scheduledBillingPlanCode?: string | null;
  stripeCustomerReservationCreatedAt?: Date | null;
  stripeCustomerReservationId?: string | null;
  stripeCustomerId: string | null;
  stripeCheckoutSessionId?: string | null;
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

type HostedMemberStripeCheckoutAcceptanceOutcome =
  | {
      billingRef: HostedMemberStripeBillingRefSnapshot;
      kind: "accepted" | "already_accepted";
    }
  | {
      kind: "cleanup_superseded";
    };

export interface HostedMemberStripeCheckoutAttemptReservation {
  attemptId: string;
  createdAt: Date;
  intentHash: string;
  stripeCheckoutSessionId: string | null;
}

export type HostedMemberStripeCustomerReservationOutcome =
  | {
      kind: "bound";
      stripeCustomerId: string;
    }
  | {
      createdAt: Date;
      kind: "reserved";
      reservationId: string;
    };

export type HostedMemberStripeCustomerReservationFinalizationOutcome =
  | {
      kind: "bound";
      stripeCustomerId: string;
    }
  | {
      kind: "ineligible";
    };

export interface HostedMemberStripeCustomerReservation {
  createdAt: Date;
  reservationId: string;
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
  return withHostedMemberStripeMutationLocksForOps({
    acquisitionTimeoutMs: input.acquisitionTimeoutMs,
    memberIds: [input.memberId],
    prisma: input.prisma,
    run: input.run,
    transactionTimeoutMs: input.transactionTimeoutMs,
  });
}

export async function withHostedMemberStripeMutationLocksForOps<TResult>(input: {
  acquisitionTimeoutMs: number;
  memberIds: readonly string[];
  prisma: PrismaClient;
  run: (tx: Prisma.TransactionClient) => Promise<TResult>;
  transactionTimeoutMs: number;
}): Promise<TResult> {
  return input.prisma.$transaction(async (tx) => {
    for (const memberId of [...new Set(input.memberIds)]) {
      try {
        await lockHostedMemberRow(tx, memberId, {
          timeoutMs: input.acquisitionTimeoutMs,
        });
      } catch (error) {
        if (isHostedMemberStripeMutationLockTimeout(error)) {
          throw new HostedMemberStripeMutationLockBusyError();
        }
        throw error;
      }
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

/**
 * Reserves the single standard Checkout attempt owned by a hosted member.
 *
 * Callers first commit this reservation, then reacquire the member row lock
 * across the bounded Stripe create/retrieve and exact Session bind. The
 * committed attempt survives an ambiguous provider response; the second lock
 * prevents a conflicting Checkout, deletion, or subscription acceptance from
 * replacing its owner while Stripe is deciding the mutation.
 */
export async function reserveHostedMemberStripeCheckoutAttemptTx(input: {
  attemptId: string;
  createdAt: Date;
  intentHash: string;
  memberId: string;
  tx: Prisma.TransactionClient;
}): Promise<HostedMemberStripeCheckoutAttemptReservation> {
  await lockHostedMemberRow(input.tx, input.memberId);

  const member = await input.tx.hostedMember.findUnique({
    select: {
      suspendedAt: true,
    },
    where: {
      id: input.memberId,
    },
  });
  if (!member) {
    throw hostedOnboardingError({
      code: "HOSTED_MEMBER_NOT_FOUND",
      httpStatus: 404,
      message: "Your hosted member record was not found.",
    });
  }
  if (member.suspendedAt instanceof Date) {
    throw hostedOnboardingError({
      code: "HOSTED_MEMBER_SUSPENDED",
      httpStatus: 403,
      message: "This hosted account is suspended. Contact support to restore access.",
    });
  }

  const currentBillingRef = await readHostedMemberStripeBillingRef({
    memberId: input.memberId,
    prisma: input.tx,
  });
  if (currentBillingRef?.stripeSubscriptionId) {
    throw hostedOnboardingError({
      code: "HOSTED_BILLING_SUBSCRIPTION_ALREADY_EXISTS",
      httpStatus: 409,
      message:
        "This hosted account already has a subscription. Manage it from Settings instead of starting a new one.",
    });
  }

  const currentAttempt = readHostedMemberStripeCheckoutAttempt(currentBillingRef);
  if (currentAttempt) {
    return currentAttempt;
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

export async function bindHostedMemberStripeCheckoutSessionTx(input: {
  attemptId: string;
  intentHash: string;
  memberId: string;
  sessionId: string;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  const stripeCheckoutSessionLookupKey = createHostedStripeCheckoutSessionLookupKey(
    input.sessionId,
  );
  if (!stripeCheckoutSessionLookupKey) {
    throw new TypeError("Stripe Checkout Session ID is invalid.");
  }
  const stripeCheckoutSessionIdEncrypted = (
    await buildHostedMemberBillingPrivateColumns({
      memberId: input.memberId,
      prisma: input.tx,
      stripeCheckoutSessionId: input.sessionId,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
    })
  ).stripeCheckoutSessionIdEncrypted;

  const updated = await input.tx.hostedMemberBillingRef.updateMany({
    data: {
      stripeCheckoutSessionIdEncrypted,
      stripeCheckoutSessionLookupKey,
    },
    where: {
      checkoutAttemptId: input.attemptId,
      checkoutIntentHash: input.intentHash,
      memberId: input.memberId,
      stripeSubscriptionLookupKey: null,
    },
  });
  if (updated.count !== 1) {
    throw hostedOnboardingError({
      code: "HOSTED_BILLING_CHECKOUT_ATTEMPT_STALE",
      httpStatus: 409,
      message:
        "Billing changed before Stripe returned a checkout session. Start checkout again.",
      retryable: true,
    });
  }
}

export async function clearHostedMemberStripeCheckoutAttemptTx(input: {
  attemptId: string;
  expectedSessionId: string | null;
  intentHash: string;
  memberId: string;
  tx: Prisma.TransactionClient;
}): Promise<boolean> {
  const stripeCheckoutSessionLookupKeys =
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
        ? { in: stripeCheckoutSessionLookupKeys }
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
  const stripeCheckoutSessionLookupKeys =
    createHostedStripeCheckoutSessionLookupKeyReadCandidates(input.sessionId);
  if (stripeCheckoutSessionLookupKeys.length === 0) {
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
        in: stripeCheckoutSessionLookupKeys,
      },
    },
  });
  return updated.count === 1;
}

/**
 * Atomically accepts one standard Checkout winner. Ownership, provider refs,
 * the event watermark, and attempt cleanup move in the same locked write, so
 * an older authoritative completion cannot be rejected by event freshness or
 * leave a cleared attempt without its subscription binding.
 */
export async function acceptHostedMemberStripeCheckoutCompletionTx(input: {
  allowLegacyCompletion: boolean;
  checkoutAttemptId: string | null;
  checkoutIntentHash: string | null;
  checkoutSessionId: string;
  currentCheckoutOffer: string;
  eventCreatedAt: Date;
  memberId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  tx: Prisma.TransactionClient;
}): Promise<HostedMemberStripeCheckoutAcceptanceOutcome> {
  const stripeCheckoutSessionLookupKey =
    createHostedStripeCheckoutSessionLookupKey(input.checkoutSessionId);
  const stripeCheckoutSessionLookupCandidates =
    createHostedStripeCheckoutSessionLookupKeyReadCandidates(
      input.checkoutSessionId,
    );
  const stripeCustomerLookupKey =
    createHostedStripeCustomerLookupKey(input.stripeCustomerId);
  const stripeSubscriptionLookupKey =
    createHostedStripeSubscriptionLookupKey(input.stripeSubscriptionId);
  if (
    !stripeCheckoutSessionLookupKey
    || !stripeCustomerLookupKey
    || !stripeSubscriptionLookupKey
  ) {
    throw new TypeError("Completed Stripe Checkout identifiers are invalid.");
  }

  const stripeCustomerLookupCandidates =
    createHostedStripeCustomerLookupKeyReadCandidates(input.stripeCustomerId);
  const stripeSubscriptionLookupCandidates =
    createHostedStripeSubscriptionLookupKeyReadCandidates(
      input.stripeSubscriptionId,
    );
  const current = await input.tx.hostedMemberBillingRef.findUnique({
    where: {
      memberId: input.memberId,
    },
  });
  const completionMatchesCurrentAttempt = Boolean(
    current
    && input.checkoutAttemptId
    && input.checkoutIntentHash
    && current.checkoutAttemptId === input.checkoutAttemptId
    && current.checkoutIntentHash === input.checkoutIntentHash
    && (
      current.stripeCheckoutSessionLookupKey === null
      || stripeCheckoutSessionLookupCandidates.includes(
        current.stripeCheckoutSessionLookupKey,
      )
    ),
  );
  const completionMatchesUntrackedCheckout = Boolean(
    current
    && current.checkoutAttemptId === null
    && current.checkoutCreatedAt === null
    && current.checkoutIntentHash === null
    && (
      current.stripeCheckoutSessionLookupKey === null
      || stripeCheckoutSessionLookupCandidates.includes(
        current.stripeCheckoutSessionLookupKey,
      )
    ),
  );
  const clearAcceptedCheckoutState =
    completionMatchesCurrentAttempt || completionMatchesUntrackedCheckout;
  const nextEventCreatedAt = maxHostedStripeEventCreatedAt(
    current?.lastStripeEventCreatedAt ?? null,
    input.eventCreatedAt,
  );
  const privateColumns = await buildHostedMemberBillingPrivateColumns({
    memberId: input.memberId,
    prisma: input.tx,
    stripeCheckoutSessionId: null,
    stripeCustomerId: input.stripeCustomerId,
    stripeSubscriptionId: input.stripeSubscriptionId,
  });

  if (current?.stripeSubscriptionLookupKey) {
    if (
      !stripeSubscriptionLookupCandidates.includes(
        current.stripeSubscriptionLookupKey,
      )
    ) {
      return { kind: "cleanup_superseded" };
    }
    const updated = await input.tx.hostedMemberBillingRef.updateMany({
      data: {
        ...(clearAcceptedCheckoutState
          ? {
              checkoutAttemptId: null,
              checkoutCreatedAt: null,
              checkoutIntentHash: null,
              stripeCheckoutSessionIdEncrypted: null,
              stripeCheckoutSessionLookupKey: null,
            }
          : {}),
        currentCheckoutOffer: input.currentCheckoutOffer,
        lastStripeEventCreatedAt: nextEventCreatedAt,
        stripeCustomerIdEncrypted: privateColumns.stripeCustomerIdEncrypted,
        stripeCustomerLookupKey,
      },
      where: {
        checkoutAttemptId: current.checkoutAttemptId,
        checkoutCreatedAt: current.checkoutCreatedAt,
        checkoutIntentHash: current.checkoutIntentHash,
        memberId: input.memberId,
        stripeCheckoutSessionLookupKey:
          current.stripeCheckoutSessionLookupKey,
        stripeSubscriptionLookupKey: {
          in: stripeSubscriptionLookupCandidates,
        },
      },
    });
    if (updated.count !== 1) {
      return { kind: "cleanup_superseded" };
    }
    const accepted = await input.tx.hostedMemberBillingRef.findUniqueOrThrow({
      where: {
        memberId: input.memberId,
      },
    });
    return {
      billingRef: await projectHostedMemberStripeBillingRefSnapshot(
        accepted,
        input.tx,
      ),
      kind: "already_accepted",
    };
  }

  if (
    current?.stripeCustomerLookupKey
    && !stripeCustomerLookupCandidates.includes(current.stripeCustomerLookupKey)
  ) {
    return { kind: "cleanup_superseded" };
  }

  const acceptsCurrentAttempt = completionMatchesCurrentAttempt;
  const acceptsLegacy = Boolean(
    input.allowLegacyCompletion
    && !input.checkoutAttemptId
    && !input.checkoutIntentHash
    && (
      !current
      || (
        current.checkoutAttemptId === null
        && current.checkoutCreatedAt === null
        && current.checkoutIntentHash === null
        && current.stripeCheckoutSessionLookupKey === null
      )
    ),
  );
  if (!acceptsCurrentAttempt && !acceptsLegacy) {
    return { kind: "cleanup_superseded" };
  }

  await assertHostedMemberStripeBillingIdentifiersAvailableTx({
    memberId: input.memberId,
    stripeCustomerId: input.stripeCustomerId,
    stripeSubscriptionId: input.stripeSubscriptionId,
    tx: input.tx,
  });

  if (!current) {
    const accepted = await input.tx.hostedMemberBillingRef.create({
      data: {
        ...privateColumns,
        currentCheckoutOffer: input.currentCheckoutOffer,
        lastStripeEventCreatedAt: nextEventCreatedAt,
        memberId: input.memberId,
        stripeCustomerLookupKey,
        stripeSubscriptionLookupKey,
      },
    });
    return {
      billingRef: await projectHostedMemberStripeBillingRefSnapshot(
        accepted,
        input.tx,
      ),
      kind: "accepted",
    };
  }

  const updated = await input.tx.hostedMemberBillingRef.updateMany({
    data: {
      checkoutAttemptId: null,
      checkoutCreatedAt: null,
      checkoutIntentHash: null,
      currentCheckoutOffer: input.currentCheckoutOffer,
      lastStripeEventCreatedAt: nextEventCreatedAt,
      stripeCheckoutSessionIdEncrypted: null,
      stripeCheckoutSessionLookupKey: null,
      stripeCustomerIdEncrypted: privateColumns.stripeCustomerIdEncrypted,
      stripeCustomerLookupKey,
      stripeSubscriptionIdEncrypted:
        privateColumns.stripeSubscriptionIdEncrypted,
      stripeSubscriptionLookupKey,
    },
    where: {
      checkoutAttemptId: acceptsCurrentAttempt
        ? input.checkoutAttemptId
        : null,
      checkoutIntentHash: acceptsCurrentAttempt
        ? input.checkoutIntentHash
        : null,
      memberId: input.memberId,
      ...(acceptsCurrentAttempt
        ? {
            OR: [
              { stripeCheckoutSessionLookupKey: null },
              {
                stripeCheckoutSessionLookupKey: {
                  in: stripeCheckoutSessionLookupCandidates,
                },
              },
            ],
          }
        : { stripeCheckoutSessionLookupKey: null }),
      stripeSubscriptionLookupKey: null,
    },
  });
  if (updated.count !== 1) {
    return { kind: "cleanup_superseded" };
  }
  const accepted = await input.tx.hostedMemberBillingRef.findUniqueOrThrow({
    where: {
      memberId: input.memberId,
    },
  });
  return {
    billingRef: await projectHostedMemberStripeBillingRefSnapshot(
      accepted,
      input.tx,
    ),
    kind: "accepted",
  };
}

function maxHostedStripeEventCreatedAt(
  current: Date | null,
  candidate: Date,
): Date {
  return current && current.getTime() > candidate.getTime()
    ? current
    : candidate;
}

function readHostedMemberStripeCheckoutAttempt(
  billingRef: HostedMemberStripeBillingRefSnapshot | null,
): HostedMemberStripeCheckoutAttemptReservation | null {
  const attemptId = billingRef?.checkoutAttemptId ?? null;
  const intentHash = billingRef?.checkoutIntentHash ?? null;
  const createdAt = billingRef?.checkoutCreatedAt ?? null;
  const stripeCheckoutSessionId = billingRef?.stripeCheckoutSessionId ?? null;

  if (!attemptId) {
    if (intentHash || createdAt || stripeCheckoutSessionId) {
      throw buildHostedMemberStripeCheckoutAttemptInvariantError();
    }
    return null;
  }
  if (!intentHash || !createdAt) {
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

/**
 * Irreversible cleanup checks only the subscription blind index. It must not
 * decrypt customer/subscription IDs or widen the KMS scope while holding a
 * provider-mutation lock.
 */
export async function readHostedMemberOwnsExactStripeSubscriptionTx(input: {
  memberId: string;
  stripeSubscriptionId: string;
  tx: Prisma.TransactionClient;
}): Promise<boolean> {
  const lookupCandidates = createHostedStripeSubscriptionLookupKeyReadCandidates(
    input.stripeSubscriptionId,
  );
  if (lookupCandidates.length === 0) {
    return false;
  }
  const billingRef = await input.tx.hostedMemberBillingRef.findUnique({
    select: {
      stripeSubscriptionLookupKey: true,
    },
    where: {
      memberId: input.memberId,
    },
  });
  return Boolean(
    billingRef?.stripeSubscriptionLookupKey
    && lookupCandidates.includes(billingRef.stripeSubscriptionLookupKey),
  );
}

export async function writeHostedMemberStripeBillingRefTx(
  input: HostedMemberStripeBillingRefWriteInput,
): Promise<HostedMemberStripeBillingRefSnapshot> {
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

  const billingPrivateColumns = await buildHostedMemberBillingPrivateColumns({
    memberId: input.memberId,
    prisma: input.tx,
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
    return projectHostedMemberStripeBillingRefSnapshot(currentBillingRef, input.tx);
  }

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

export async function reserveHostedMemberStripeCustomerReservationTx(input: {
  memberId: string;
  now: Date;
  tx: Prisma.TransactionClient;
}): Promise<HostedMemberStripeCustomerReservationOutcome> {
  await lockHostedMemberRow(input.tx, input.memberId);
  const current = await input.tx.hostedMemberBillingRef.findUnique({
    where: { memberId: input.memberId },
  });

  assertHostedMemberStripeCustomerReservationShape(current);
  if (current?.stripeCustomerLookupKey) {
    const billingRef = await projectHostedMemberStripeBillingRefSnapshot(
      current,
      input.tx,
    );
    if (!billingRef.stripeCustomerId) {
      throw buildHostedMemberStripeCustomerReservationInvariantError();
    }
    return {
      kind: "bound",
      stripeCustomerId: billingRef.stripeCustomerId,
    };
  }

  const currentReservation =
    readHostedMemberStripeCustomerReservation(current);
  if (currentReservation) {
    assertHostedMemberStripeCustomerReservationFresh({
      createdAt: currentReservation.createdAt,
      now: input.now,
    });
    return {
      ...currentReservation,
      kind: "reserved",
    };
  }

  const reservationId = `hbscr_${randomUUID()}`;
  const reserved = await input.tx.hostedMemberBillingRef.upsert({
    where: { memberId: input.memberId },
    create: {
      memberId: input.memberId,
      stripeCustomerReservationCreatedAt: input.now,
      stripeCustomerReservationId: reservationId,
    },
    update: {
      stripeCustomerReservationCreatedAt: input.now,
      stripeCustomerReservationId: reservationId,
    },
  });
  assertHostedMemberStripeCustomerReservationShape(reserved);
  return {
    createdAt: input.now,
    kind: "reserved",
    reservationId,
  };
}

export async function finalizeHostedMemberStripeCustomerReservationTx(input: {
  bindAllowed: boolean;
  candidateStripeCustomerId: string;
  memberId: string;
  now: Date;
  reservationId: string;
  tx: Prisma.TransactionClient;
}): Promise<HostedMemberStripeCustomerReservationFinalizationOutcome> {
  await lockHostedMemberRow(input.tx, input.memberId);
  const current = await input.tx.hostedMemberBillingRef.findUnique({
    where: { memberId: input.memberId },
  });

  if (!current) {
    if (!input.bindAllowed) {
      return { kind: "ineligible" };
    }
    throw buildHostedMemberStripeCustomerReservationInvariantError();
  }
  assertHostedMemberStripeCustomerReservationShape(current);

  if (current.stripeCustomerLookupKey) {
    const billingRef = await projectHostedMemberStripeBillingRefSnapshot(
      current,
      input.tx,
    );
    if (billingRef.stripeCustomerId !== input.candidateStripeCustomerId) {
      throw buildHostedMemberStripeCustomerReservationInvariantError();
    }
    if (!input.bindAllowed) {
      return { kind: "ineligible" };
    }
    return {
      kind: "bound",
      stripeCustomerId: input.candidateStripeCustomerId,
    };
  }

  const reservation = readHostedMemberStripeCustomerReservation(current);
  if (!reservation || reservation.reservationId !== input.reservationId) {
    throw buildHostedMemberStripeCustomerReservationInvariantError();
  }
  assertHostedMemberStripeCustomerReservationFresh({
    createdAt: reservation.createdAt,
    now: input.now,
  });
  if (!input.bindAllowed) {
    return { kind: "ineligible" };
  }

  const stripeCustomerLookupKey = createHostedStripeCustomerLookupKey(
    input.candidateStripeCustomerId,
  );
  if (!stripeCustomerLookupKey) {
    throw buildHostedMemberStripeCustomerReservationInvariantError();
  }
  await assertHostedMemberStripeBillingIdentifiersAvailableTx({
    memberId: input.memberId,
    stripeCustomerId: input.candidateStripeCustomerId,
    tx: input.tx,
  });
  const privateColumns = await buildHostedMemberBillingPrivateColumns({
    memberId: input.memberId,
    prisma: input.tx,
    stripeCustomerId: input.candidateStripeCustomerId,
    stripeSubscriptionId: null,
  });
  const bound = await input.tx.hostedMemberBillingRef.updateMany({
    data: {
      stripeCustomerIdEncrypted: privateColumns.stripeCustomerIdEncrypted,
      stripeCustomerLookupKey,
      stripeCustomerReservationCreatedAt: null,
      stripeCustomerReservationId: null,
    },
    where: {
      memberId: input.memberId,
      stripeCustomerLookupKey: null,
      stripeCustomerReservationCreatedAt: reservation.createdAt,
      stripeCustomerReservationId: reservation.reservationId,
    },
  });
  if (bound.count !== 1) {
    throw buildHostedMemberStripeCustomerReservationInvariantError();
  }

  return {
    kind: "bound",
    stripeCustomerId: input.candidateStripeCustomerId,
  };
}

export async function clearHostedMemberStripeCustomerReservationAfterDefinitiveFailureTx(
  input: {
    memberId: string;
    reservationId: string;
    tx: Prisma.TransactionClient;
  },
): Promise<boolean> {
  await lockHostedMemberRow(input.tx, input.memberId);
  const current = await input.tx.hostedMemberBillingRef.findUnique({
    where: { memberId: input.memberId },
  });
  if (!current) {
    return false;
  }
  assertHostedMemberStripeCustomerReservationShape(current);
  if (current.stripeCustomerLookupKey) {
    return false;
  }
  const reservation = readHostedMemberStripeCustomerReservation(current);
  if (!reservation) {
    return false;
  }
  if (reservation.reservationId !== input.reservationId) {
    throw buildHostedMemberStripeCustomerReservationInvariantError();
  }

  const cleared = await input.tx.hostedMemberBillingRef.updateMany({
    data: {
      stripeCustomerReservationCreatedAt: null,
      stripeCustomerReservationId: null,
    },
    where: {
      memberId: input.memberId,
      stripeCustomerLookupKey: null,
      stripeCustomerReservationCreatedAt: reservation.createdAt,
      stripeCustomerReservationId: reservation.reservationId,
    },
  });
  if (cleared.count !== 1) {
    throw buildHostedMemberStripeCustomerReservationInvariantError();
  }
  return true;
}

export function readFreshHostedMemberStripeCustomerReservation(input: {
  billingRef: HostedMemberStripeBillingRefSnapshot | null;
  now: Date;
}): HostedMemberStripeCustomerReservation | null {
  const billingRef = input.billingRef;
  assertHostedMemberStripeCustomerReservationPairShape({
    hasBoundCustomer: Boolean(billingRef?.stripeCustomerId),
    reservationCreatedAt: billingRef?.stripeCustomerReservationCreatedAt,
    reservationId: billingRef?.stripeCustomerReservationId,
  });
  const reservation = readHostedMemberStripeCustomerReservation(billingRef);
  if (reservation) {
    assertHostedMemberStripeCustomerReservationFresh({
      createdAt: reservation.createdAt,
      now: input.now,
    });
  }
  return reservation;
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
    stripeCustomerReservationCreatedAt:
      billingRef.stripeCustomerReservationCreatedAt,
    stripeCustomerReservationId: billingRef.stripeCustomerReservationId,
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

function assertHostedMemberStripeCustomerReservationShape(
  billingRef: HostedMemberBillingRef | null,
): void {
  if (!billingRef) {
    return;
  }
  assertHostedMemberStripeCustomerReservationPairShape({
    hasBoundCustomer: Boolean(billingRef.stripeCustomerLookupKey),
    reservationCreatedAt: billingRef.stripeCustomerReservationCreatedAt,
    reservationId: billingRef.stripeCustomerReservationId,
  });
}

function assertHostedMemberStripeCustomerReservationPairShape(input: {
  hasBoundCustomer: boolean;
  reservationCreatedAt?: Date | null;
  reservationId?: string | null;
}): void {
  const hasReservationId = Boolean(input.reservationId);
  const hasReservationCreatedAt = input.reservationCreatedAt instanceof Date;
  if (
    hasReservationId !== hasReservationCreatedAt ||
    (
      input.hasBoundCustomer &&
      (hasReservationId || hasReservationCreatedAt)
    )
  ) {
    throw buildHostedMemberStripeCustomerReservationInvariantError();
  }
}

function readHostedMemberStripeCustomerReservation(
  billingRef:
    | HostedMemberBillingRef
    | HostedMemberStripeBillingRefSnapshot
    | null,
): HostedMemberStripeCustomerReservation | null {
  if (
    !billingRef?.stripeCustomerReservationId ||
    !(billingRef.stripeCustomerReservationCreatedAt instanceof Date)
  ) {
    return null;
  }
  return {
    createdAt: billingRef.stripeCustomerReservationCreatedAt,
    reservationId: billingRef.stripeCustomerReservationId,
  };
}

function assertHostedMemberStripeCustomerReservationFresh(input: {
  createdAt: Date;
  now: Date;
}): void {
  const ageMs = input.now.getTime() - input.createdAt.getTime();
  if (
    Number.isFinite(ageMs) &&
    ageMs >= 0 &&
    ageMs < HOSTED_STRIPE_IDEMPOTENCY_SAFE_REPLAY_WINDOW_MS
  ) {
    return;
  }
  throw hostedOnboardingError({
    code: "HOSTED_STRIPE_CUSTOMER_RESERVATION_RECOVERY_REQUIRED",
    httpStatus: 409,
    message:
      "Stripe Customer creation could not be reconciled safely. Contact support before retrying billing.",
    retryable: false,
  });
}

function buildHostedMemberStripeCustomerReservationInvariantError(): Error {
  return hostedOnboardingError({
    code: "HOSTED_STRIPE_CUSTOMER_RESERVATION_INCONSISTENT",
    httpStatus: 500,
    message:
      "Stored Stripe Customer reservation state is inconsistent. Contact support before retrying billing.",
    retryable: false,
  });
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
