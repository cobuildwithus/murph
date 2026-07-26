import { createHash } from "node:crypto";

import { type Prisma, type PrismaClient } from "@prisma/client";
import type Stripe from "stripe";

import { coerceStripeInvoiceSubscriptionId, coerceStripeObjectId } from "./billing";
import {
  createHostedStripeCustomerLookupKeyReadCandidates,
  createHostedStripeSubscriptionLookupKeyReadCandidates,
} from "./contact-privacy";
import { hostedOnboardingError, isHostedOnboardingError } from "./errors";
import {
  readHostedAccountGroupStripeBillingRef,
  readHostedMemberFamilyBillingClaim,
  type HostedMemberFamilyBillingClaim,
} from "./family-plan";
import {
  HostedMemberStripeMutationLockBusyError,
  readHostedMemberOwnsExactStripeSubscriptionTx,
  withHostedMemberStripeMutationLockForOps,
  withHostedMemberStripeMutationLocksForOps,
} from "./hosted-member-billing-store";
import { requireHostedStripeApi } from "./runtime";
import { withHostedStripeFailureLog } from "./stripe-error-log";
import { isHostedStripeRetryableFailure } from "./stripe-billing-state";

const HOSTED_CHECKOUT_CLEANUP_MEMBER_LOCK_ACQUISITION_TIMEOUT_MS = 2_000;
const HOSTED_CHECKOUT_CLEANUP_TRANSACTION_TIMEOUT_MS = 120_000;
const HOSTED_CHECKOUT_CLEANUP_MAX_PAID_ALLOCATIONS = 4;
const HOSTED_CHECKOUT_CLEANUP_STRIPE_REQUEST_OPTIONS = {
  maxNetworkRetries: 0,
  timeout: 5_000,
} as const satisfies Stripe.RequestOptions;

type HostedCheckoutSubscriptionCleanupReason =
  | "family_sponsored"
  | "family_account_deletion"
  | "superseded";

export interface HostedCheckoutSubscriptionCleanupCandidate {
  checkoutAttemptId: string | null;
  checkoutIntentHash: string | null;
  checkoutSessionId: string;
  familyBillingClaim?: HostedMemberFamilyBillingClaim | null;
  familyGroupId?: string | null;
  memberId: string;
  reason: HostedCheckoutSubscriptionCleanupReason;
  stripeSubscriptionId: string;
}

export function buildHostedFamilyCheckoutSubscriptionCleanupCandidate(input: {
  groupId: string;
  ownerMemberId: string;
  session: Stripe.Checkout.Session;
  stripeSubscriptionId: string;
}): HostedCheckoutSubscriptionCleanupCandidate {
  if (
    input.session.client_reference_id !== input.groupId
    || input.session.metadata?.accountGroupId !== input.groupId
    || input.session.metadata?.ownerMemberId !== input.ownerMemberId
    || coerceStripeObjectId(input.session.subscription) !==
      input.stripeSubscriptionId
  ) {
    throw buildHostedCheckoutCleanupInvariantError(
      "The completed Family Checkout Session does not match the cleanup candidate.",
    );
  }
  return {
    checkoutAttemptId: normalizeNullableStripeMetadata(
      input.session.metadata?.checkoutAttemptId,
    ),
    checkoutIntentHash: null,
    checkoutSessionId: input.session.id,
    familyBillingClaim: null,
    familyGroupId: input.groupId,
    memberId: input.ownerMemberId,
    reason: "family_account_deletion",
    stripeSubscriptionId: input.stripeSubscriptionId,
  };
}

export function buildHostedCheckoutSubscriptionCleanupCandidate(input: {
  familyBillingClaim?: HostedMemberFamilyBillingClaim | null;
  memberId: string;
  reason: HostedCheckoutSubscriptionCleanupReason;
  session: Stripe.Checkout.Session;
  stripeSubscriptionId: string;
}): HostedCheckoutSubscriptionCleanupCandidate {
  if (
    input.session.client_reference_id !== input.memberId
    || input.session.metadata?.memberId !== input.memberId
    || coerceStripeObjectId(input.session.subscription) !== input.stripeSubscriptionId
  ) {
    throw buildHostedCheckoutCleanupInvariantError(
      "The completed Checkout Session does not match the cleanup candidate.",
    );
  }

  return {
    checkoutAttemptId: normalizeNullableStripeMetadata(
      input.session.metadata?.checkoutAttemptId,
    ),
    checkoutIntentHash: normalizeNullableStripeMetadata(
      input.session.metadata?.checkoutIntentHash,
    ),
    checkoutSessionId: input.session.id,
    familyBillingClaim: input.familyBillingClaim ?? null,
    memberId: input.memberId,
    reason: input.reason,
    stripeSubscriptionId: input.stripeSubscriptionId,
  };
}

/**
 * Cancels and refunds a paid standard Checkout loser under the member's billing
 * owner lock. Every financial decision is derived from the exact Checkout
 * Session invoice; `latest_invoice` is never used.
 */
export async function executeHostedCheckoutSubscriptionCleanup(input: {
  candidate: HostedCheckoutSubscriptionCleanupCandidate;
  prisma: PrismaClient;
  stripe?: Stripe;
}): Promise<void> {
  const stripe = input.stripe ?? requireHostedStripeApi();
  try {
    if (input.candidate.reason === "family_account_deletion") {
      await withHostedMemberStripeMutationLockForOps({
        acquisitionTimeoutMs: HOSTED_CHECKOUT_CLEANUP_MEMBER_LOCK_ACQUISITION_TIMEOUT_MS,
        memberId: input.candidate.memberId,
        prisma: input.prisma,
        run: async (tx) => {
          const familyGroupId = input.candidate.familyGroupId;
          if (!familyGroupId) {
            throw buildHostedCheckoutCleanupInvariantError(
              "Family Checkout cleanup did not identify its billing group.",
            );
          }
          const billingRef = await readHostedAccountGroupStripeBillingRef({
            groupId: familyGroupId,
            prisma: tx,
          });
          if (
            billingRef?.group.ownerMemberId !== input.candidate.memberId
            || billingRef.stripeSubscriptionId !==
              input.candidate.stripeSubscriptionId
          ) {
            throw buildHostedCheckoutCleanupOwnershipChangedError();
          }
          await cancelAndRefundHostedCheckoutSubscription({
            candidate: input.candidate,
            stripe,
            tx,
          });
        },
        transactionTimeoutMs: HOSTED_CHECKOUT_CLEANUP_TRANSACTION_TIMEOUT_MS,
      });
      return;
    }

    if (input.candidate.reason === "family_sponsored") {
      const familyBillingClaim =
        input.candidate.familyBillingClaim
        ?? await readHostedMemberFamilyBillingClaim({
        memberId: input.candidate.memberId,
        prisma: input.prisma,
      });
      if (!familyBillingClaim) {
        throw buildHostedCheckoutCleanupOwnershipChangedError();
      }
      // Family membership mutations lock the group owner first; accepting a
      // membership then locks the beneficiary. Use that same order so removal,
      // acceptance, and loser cleanup cannot cross while Stripe is mutated.
      await withHostedMemberStripeMutationLocksForOps({
        acquisitionTimeoutMs: HOSTED_CHECKOUT_CLEANUP_MEMBER_LOCK_ACQUISITION_TIMEOUT_MS,
        memberIds: [
          familyBillingClaim.ownerMemberId,
          input.candidate.memberId,
        ],
        prisma: input.prisma,
        run: async (tx) => {
          const currentFamilyBillingClaim =
            await readHostedMemberFamilyBillingClaim({
            memberId: input.candidate.memberId,
            prisma: tx,
          });
          if (
            !currentFamilyBillingClaim
            || !hostedMemberFamilyBillingClaimsEqual(
              currentFamilyBillingClaim,
              familyBillingClaim,
            )
          ) {
            throw buildHostedCheckoutCleanupOwnershipChangedError();
          }
          await cancelAndRefundHostedCheckoutSubscription({
            candidate: input.candidate,
            stripe,
            tx,
          });
        },
        transactionTimeoutMs: HOSTED_CHECKOUT_CLEANUP_TRANSACTION_TIMEOUT_MS,
      });
      return;
    }

    await withHostedMemberStripeMutationLockForOps({
      acquisitionTimeoutMs: HOSTED_CHECKOUT_CLEANUP_MEMBER_LOCK_ACQUISITION_TIMEOUT_MS,
      memberId: input.candidate.memberId,
      prisma: input.prisma,
      run: async (tx) => {
        await assertHostedCheckoutCleanupOwnerStillAllowsCleanup({
          candidate: input.candidate,
          tx,
        });
        await cancelAndRefundHostedCheckoutSubscription({
          candidate: input.candidate,
          stripe,
          tx,
        });
      },
      transactionTimeoutMs: HOSTED_CHECKOUT_CLEANUP_TRANSACTION_TIMEOUT_MS,
    });
  } catch (error) {
    if (isHostedOnboardingError(error)) {
      throw error;
    }
    if (error instanceof HostedMemberStripeMutationLockBusyError) {
      throw hostedOnboardingError({
        cause: error,
        code: "HOSTED_CHECKOUT_CLEANUP_OWNER_BUSY",
        httpStatus: 409,
        message: "Billing ownership changed while cleanup was starting. Retry cleanup.",
        retryable: true,
      });
    }
    throw buildHostedCheckoutCleanupProviderError(error);
  }
}

async function assertHostedCheckoutCleanupOwnerStillAllowsCleanup(input: {
  candidate: HostedCheckoutSubscriptionCleanupCandidate;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  const candidateBecameAuthoritative =
    await readHostedMemberOwnsExactStripeSubscriptionTx({
    memberId: input.candidate.memberId,
    stripeSubscriptionId: input.candidate.stripeSubscriptionId,
    tx: input.tx,
  });
  if (!candidateBecameAuthoritative) {
    return;
  }
  throw buildHostedCheckoutCleanupOwnershipChangedError();
}

function hostedMemberFamilyBillingClaimsEqual(
  current: HostedMemberFamilyBillingClaim,
  expected: HostedMemberFamilyBillingClaim,
): boolean {
  if (
    current.kind !== expected.kind
    || current.groupId !== expected.groupId
    || current.ownerMemberId !== expected.ownerMemberId
  ) {
    return false;
  }
  if (
    current.kind === "checkout_attempt"
    && expected.kind === "checkout_attempt"
  ) {
    return current.checkoutAttemptId === expected.checkoutAttemptId;
  }
  if (
    current.kind === "bound_subscription"
    && expected.kind === "bound_subscription"
  ) {
    return current.stripeSubscriptionId === expected.stripeSubscriptionId;
  }
  return current.kind === "active_sponsorship";
}

function buildHostedCheckoutCleanupOwnershipChangedError() {
  return hostedOnboardingError({
    code: "HOSTED_CHECKOUT_CLEANUP_OWNERSHIP_CHANGED",
    httpStatus: 409,
    message:
      "Billing ownership changed before Checkout cleanup. Reconcile billing again before canceling.",
    retryable: true,
  });
}

async function cancelAndRefundHostedCheckoutSubscription(input: {
  candidate: HostedCheckoutSubscriptionCleanupCandidate;
  stripe: Stripe;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  const lockRows = await input.tx.$queryRaw<Array<{ acquired: boolean }>>`
    select pg_try_advisory_xact_lock(
      hashtext('hosted-checkout-subscription-cleanup'),
      hashtext(${input.candidate.memberId})
    ) as "acquired"
  `;
  if (!lockRows.some((row) => row.acquired === true)) {
    throw new HostedMemberStripeMutationLockBusyError();
  }
  await assertHostedCheckoutCleanupGlobalOwnership({
    candidate: input.candidate,
    tx: input.tx,
  });
  const session = await withHostedStripeFailureLog(
    "checkout.sessions.retrieve.subscription-cleanup",
    () => input.stripe.checkout.sessions.retrieve(
      input.candidate.checkoutSessionId,
      {},
      HOSTED_CHECKOUT_CLEANUP_STRIPE_REQUEST_OPTIONS,
    ),
  );
  assertHostedCheckoutCleanupSession({
    candidate: input.candidate,
    session,
  });

  const subscription = await withHostedStripeFailureLog(
    "subscriptions.retrieve.checkout-cleanup",
    () => input.stripe.subscriptions.retrieve(
      input.candidate.stripeSubscriptionId,
      {},
      HOSTED_CHECKOUT_CLEANUP_STRIPE_REQUEST_OPTIONS,
    ),
  );
  assertHostedCheckoutCleanupSubscription({
    candidate: input.candidate,
    subscription,
  });
  const refundPreparation = await prepareHostedCheckoutRefunds({
    session,
    stripe: input.stripe,
    subscription,
  });
  await cancelHostedCheckoutLoserSubscription({
    stripe: input.stripe,
    subscription,
  });
  if (refundPreparation.hasPendingRefund) {
    throw buildHostedCheckoutRefundPendingError();
  }
  for (const refundPlan of refundPreparation.plans) {
    await executeHostedCheckoutRefundPlan({
      candidate: input.candidate,
      invoiceId: refundPreparation.invoiceId,
      plan: refundPlan,
      sessionId: session.id,
      stripe: input.stripe,
    });
  }
  await deleteUnownedHostedCheckoutCustomer({
    session,
    stripe: input.stripe,
    tx: input.tx,
  });
}

async function assertHostedCheckoutCleanupGlobalOwnership(input: {
  candidate: HostedCheckoutSubscriptionCleanupCandidate;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  const lookupKeys = createHostedStripeSubscriptionLookupKeyReadCandidates(
    input.candidate.stripeSubscriptionId,
  );
  if (lookupKeys.length === 0) {
    throw buildHostedCheckoutCleanupInvariantError(
      "The Checkout cleanup subscription identifier is invalid.",
    );
  }
  const [memberOwners, familyOwners] = await Promise.all([
    input.tx.hostedMemberBillingRef.findMany({
      select: {
        memberId: true,
      },
      where: {
        stripeSubscriptionLookupKey: {
          in: lookupKeys,
        },
      },
    }),
    input.tx.hostedAccountGroupBillingRef.findMany({
      select: {
        groupId: true,
      },
      where: {
        stripeSubscriptionLookupKey: {
          in: lookupKeys,
        },
      },
    }),
  ]);
  if (input.candidate.reason === "family_account_deletion") {
    if (
      memberOwners.length === 0
      && familyOwners.length === 1
      && familyOwners[0]?.groupId === input.candidate.familyGroupId
    ) {
      return;
    }
    throw buildHostedCheckoutCleanupOwnershipChangedError();
  }
  if (memberOwners.length === 0 && familyOwners.length === 0) {
    return;
  }
  throw buildHostedCheckoutCleanupOwnershipChangedError();
}

interface HostedCheckoutRefundPlan {
  payment: HostedCheckoutRefundPayment;
  remainingAmount: number;
  terminalFailureScope: Array<{
    amount: number;
    id: string;
    status: string;
  }>;
}

interface HostedCheckoutRefundPreparation {
  hasPendingRefund: boolean;
  invoiceId: string;
  plans: HostedCheckoutRefundPlan[];
}

async function prepareHostedCheckoutRefunds(input: {
  session: Stripe.Checkout.Session;
  stripe: Stripe;
  subscription: Stripe.Subscription;
}): Promise<HostedCheckoutRefundPreparation> {
  const invoiceId = coerceStripeObjectId(input.session.invoice);
  if (!invoiceId) {
    if (input.session.payment_status === "paid") {
      throw buildHostedCheckoutCleanupInvariantError(
        "A paid Checkout Session did not include its exact invoice.",
      );
    }
    return {
      hasPendingRefund: false,
      invoiceId: "no_invoice",
      plans: [],
    };
  }

  const [invoice, invoicePayments] = await Promise.all([
    withHostedStripeFailureLog(
      "invoices.retrieve.checkout-cleanup",
      () => input.stripe.invoices.retrieve(
        invoiceId,
        {},
        HOSTED_CHECKOUT_CLEANUP_STRIPE_REQUEST_OPTIONS,
      ),
    ),
    withHostedStripeFailureLog(
      "invoicePayments.list.checkout-cleanup",
      () => input.stripe.invoicePayments.list({
        invoice: invoiceId,
        limit: 100,
      }, HOSTED_CHECKOUT_CLEANUP_STRIPE_REQUEST_OPTIONS),
    ),
  ]);
  if (
    invoice.id !== invoiceId
    || coerceStripeInvoiceSubscriptionId(invoice) !== input.subscription.id
  ) {
    throw buildHostedCheckoutCleanupInvariantError(
      "The Checkout invoice does not belong to the loser subscription.",
    );
  }
  if (invoicePayments.has_more) {
    throw buildHostedCheckoutCleanupInvariantError(
      "The Checkout invoice has too many payments to refund safely.",
    );
  }
  if (!Number.isSafeInteger(invoice.amount_paid) || invoice.amount_paid < 0) {
    throw buildHostedCheckoutCleanupInvariantError(
      "The Checkout invoice paid amount is invalid.",
    );
  }
  if (invoice.amount_paid === 0) {
    return {
      hasPendingRefund: false,
      invoiceId,
      plans: [],
    };
  }
  if (invoice.status !== "paid" || input.session.payment_status !== "paid") {
    throw buildHostedCheckoutCleanupInvariantError(
      "The Checkout invoice has paid funds but is not canonically paid.",
    );
  }

  const paidPayments = invoicePayments.data.filter((payment) =>
    payment.status === "paid"
  );
  if (paidPayments.length > HOSTED_CHECKOUT_CLEANUP_MAX_PAID_ALLOCATIONS) {
    throw buildHostedCheckoutCleanupInvariantError(
      "The Checkout invoice has too many paid allocations to clean up inside the owner lock.",
    );
  }
  let allocatedAmount = 0;
  const paymentIds = new Set<string>();
  const plans: HostedCheckoutRefundPlan[] = [];
  let hasPendingRefund = false;
  for (const invoicePayment of invoicePayments.data) {
    if (coerceStripeObjectId(invoicePayment.invoice) !== invoice.id) {
      throw buildHostedCheckoutCleanupInvariantError(
        "Stripe returned a payment for a different Checkout invoice.",
      );
    }
  }
  for (const invoicePayment of paidPayments) {
    const paidAmount = invoicePayment.amount_paid;
    if (
      typeof paidAmount !== "number"
      || !Number.isSafeInteger(paidAmount)
      || paidAmount <= 0
    ) {
      throw buildHostedCheckoutCleanupInvariantError(
        "Stripe returned an invalid paid Checkout allocation.",
      );
    }
    allocatedAmount += paidAmount;
    const payment = requireHostedCheckoutRefundPayment(invoicePayment);
    const paymentKey = `${payment.kind}:${payment.id}`;
    if (paymentIds.has(paymentKey)) {
      throw buildHostedCheckoutCleanupInvariantError(
        "The Checkout invoice repeats the same payment allocation.",
      );
    }
    paymentIds.add(paymentKey);
    const refunds = await withHostedStripeFailureLog(
      "refunds.list.checkout-cleanup",
      () => input.stripe.refunds.list({
        ...payment.filter,
        limit: 100,
      }, HOSTED_CHECKOUT_CLEANUP_STRIPE_REQUEST_OPTIONS),
    );
    if (refunds.has_more) {
      throw buildHostedCheckoutCleanupInvariantError(
        "A Checkout payment has too many refunds to reconcile safely.",
      );
    }
    let succeededAmount = 0;
    const terminalFailureScope: HostedCheckoutRefundPlan["terminalFailureScope"] = [];
    for (const refund of refunds.data) {
      assertHostedCheckoutRefundMatchesPayment({
        payment,
        refund,
      });
      if (!Number.isSafeInteger(refund.amount) || refund.amount <= 0) {
        throw buildHostedCheckoutCleanupInvariantError(
          "Stripe returned an invalid Checkout refund amount.",
        );
      }
      if (refund.status === "succeeded") {
        succeededAmount += refund.amount;
      } else if (
        refund.status === "failed"
        || refund.status === "canceled"
      ) {
        terminalFailureScope.push({
          amount: refund.amount,
          id: refund.id,
          status: refund.status,
        });
      } else if (
        refund.status === "pending"
        || refund.status === "requires_action"
      ) {
        hasPendingRefund = true;
      } else {
        throw buildHostedCheckoutCleanupInvariantError(
          "Stripe returned an unknown Checkout refund state.",
        );
      }
    }
    if (succeededAmount > paidAmount) {
      throw buildHostedCheckoutCleanupInvariantError(
        "Checkout refunds exceed a paid invoice allocation.",
      );
    }
    if (!hasPendingRefund && succeededAmount < paidAmount) {
      plans.push({
        payment,
        remainingAmount: paidAmount - succeededAmount,
        terminalFailureScope: terminalFailureScope.sort((left, right) =>
          left.id.localeCompare(right.id)
        ),
      });
    }
  }
  if (allocatedAmount !== invoice.amount_paid) {
    throw buildHostedCheckoutCleanupInvariantError(
      "Checkout paid allocations do not equal the exact invoice paid amount.",
    );
  }
  return {
    hasPendingRefund,
    invoiceId,
    plans,
  };
}

async function cancelHostedCheckoutLoserSubscription(input: {
  stripe: Stripe;
  subscription: Stripe.Subscription;
}): Promise<void> {
  if (
    input.subscription.status === "canceled"
    || input.subscription.status === "incomplete_expired"
  ) {
    return;
  }
  try {
    const canceled = await withHostedStripeFailureLog(
      "subscriptions.cancel.checkout-cleanup",
      () => input.stripe.subscriptions.cancel(
        input.subscription.id,
        {},
        HOSTED_CHECKOUT_CLEANUP_STRIPE_REQUEST_OPTIONS,
      ),
    );
    if (
      canceled.id !== input.subscription.id
      || (
        canceled.status !== "canceled"
        && canceled.status !== "incomplete_expired"
      )
    ) {
      throw buildHostedCheckoutCleanupInvariantError(
        "Stripe did not confirm the exact loser subscription as canceled.",
      );
    }
  } catch (error) {
    if (!isStripeResourceMissingError(error)) {
      throw error;
    }
  }
}

async function executeHostedCheckoutRefundPlan(input: {
  candidate: HostedCheckoutSubscriptionCleanupCandidate;
  invoiceId: string;
  plan: HostedCheckoutRefundPlan;
  sessionId: string;
  stripe: Stripe;
}): Promise<void> {
  const refund = await withHostedStripeFailureLog(
    "refunds.create.checkout-cleanup",
    () => input.stripe.refunds.create({
      amount: input.plan.remainingAmount,
      ...input.plan.payment.filter,
      metadata: {
        checkoutSessionId: input.sessionId,
        cleanupReason: input.candidate.reason,
      },
      reason: "duplicate",
    }, {
      ...HOSTED_CHECKOUT_CLEANUP_STRIPE_REQUEST_OPTIONS,
      idempotencyKey: buildHostedCheckoutCleanupRefundIdempotencyKey({
        invoiceId: input.invoiceId,
        paymentId: input.plan.payment.id,
        sessionId: input.sessionId,
        terminalFailureScope: input.plan.terminalFailureScope,
      }),
    }),
  );
  assertHostedCheckoutRefundMatchesPayment({
    payment: input.plan.payment,
    refund,
  });
  if (refund.amount !== input.plan.remainingAmount) {
    throw buildHostedCheckoutCleanupInvariantError(
      "Stripe created a refund for the wrong Checkout amount.",
    );
  }
  if (refund.status === "succeeded") {
    return;
  }
  if (refund.status === "pending" || refund.status === "requires_action") {
    throw buildHostedCheckoutRefundPendingError();
  }
  throw hostedOnboardingError({
    code: "HOSTED_CHECKOUT_CLEANUP_REFUND_FAILED",
    httpStatus: 502,
    message: "Stripe did not complete the Checkout refund. Retry reconciliation.",
    retryable: true,
  });
}

function buildHostedCheckoutRefundPendingError() {
  return hostedOnboardingError({
    code: "HOSTED_CHECKOUT_CLEANUP_REFUND_PENDING",
    httpStatus: 409,
    message: "The Checkout refund is still processing. Retry reconciliation later.",
    retryable: true,
  });
}

async function deleteUnownedHostedCheckoutCustomer(input: {
  session: Stripe.Checkout.Session;
  stripe: Stripe;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  const stripeCustomerId = coerceStripeObjectId(input.session.customer);
  if (!stripeCustomerId) {
    throw buildHostedCheckoutCleanupInvariantError(
      "The subscription Checkout Session did not include its Stripe Customer.",
    );
  }
  const lookupKeys =
    createHostedStripeCustomerLookupKeyReadCandidates(stripeCustomerId);
  if (lookupKeys.length === 0) {
    throw buildHostedCheckoutCleanupInvariantError(
      "The Checkout Customer identifier is invalid.",
    );
  }
  const [memberOwner, familyOwner] = await Promise.all([
    input.tx.hostedMemberBillingRef.findFirst({
      select: {
        memberId: true,
      },
      where: {
        stripeCustomerLookupKey: {
          in: lookupKeys,
        },
      },
    }),
    input.tx.hostedAccountGroupBillingRef.findFirst({
      select: {
        groupId: true,
      },
      where: {
        stripeCustomerLookupKey: {
          in: lookupKeys,
        },
      },
    }),
  ]);
  if (memberOwner || familyOwner) {
    return;
  }

  const subscriptions = await withHostedStripeFailureLog(
    "subscriptions.list.checkout-customer-cleanup",
    () => input.stripe.subscriptions.list({
      customer: stripeCustomerId,
      limit: 100,
      status: "all",
    }, HOSTED_CHECKOUT_CLEANUP_STRIPE_REQUEST_OPTIONS),
  );
  if (subscriptions.has_more) {
    throw buildHostedCheckoutCleanupInvariantError(
      "The orphan Checkout Customer has too many subscriptions to delete safely.",
    );
  }
  const liveSubscription = subscriptions.data.find((subscription) =>
    subscription.status !== "canceled"
    && subscription.status !== "incomplete_expired"
  );
  if (liveSubscription) {
    throw hostedOnboardingError({
      code: "HOSTED_CHECKOUT_CLEANUP_CUSTOMER_HAS_LIVE_BILLING",
      httpStatus: 409,
      message:
        "The orphan Checkout Customer still has live billing. Reconcile it before deleting customer data.",
    });
  }

  try {
    const deleted = await withHostedStripeFailureLog(
      "customers.delete.checkout-cleanup",
      () => input.stripe.customers.del(
        stripeCustomerId,
        {},
        HOSTED_CHECKOUT_CLEANUP_STRIPE_REQUEST_OPTIONS,
      ),
    );
    if (deleted.id !== stripeCustomerId || !deleted.deleted) {
      throw buildHostedCheckoutCleanupInvariantError(
        "Stripe did not confirm deletion of the orphan Checkout Customer.",
      );
    }
  } catch (error) {
    if (!isStripeResourceMissingError(error)) {
      throw error;
    }
  }
}

type HostedCheckoutRefundPayment =
  | {
      filter: {
        charge: string;
      };
      id: string;
      kind: "charge";
    }
  | {
      filter: {
        payment_intent: string;
      };
      id: string;
      kind: "payment_intent";
    };

function requireHostedCheckoutRefundPayment(
  invoicePayment: Stripe.InvoicePayment,
): HostedCheckoutRefundPayment {
  if (invoicePayment.payment.type === "payment_intent") {
    const paymentIntentId = coerceStripeObjectId(
      invoicePayment.payment.payment_intent,
    );
    if (paymentIntentId) {
      return {
        filter: {
          payment_intent: paymentIntentId,
        },
        id: paymentIntentId,
        kind: "payment_intent",
      };
    }
  }
  if (invoicePayment.payment.type === "charge") {
    const chargeId = coerceStripeObjectId(invoicePayment.payment.charge);
    if (chargeId) {
      return {
        filter: {
          charge: chargeId,
        },
        id: chargeId,
        kind: "charge",
      };
    }
  }
  throw buildHostedCheckoutCleanupInvariantError(
    "The paid Checkout invoice payment cannot be refunded safely.",
  );
}

function assertHostedCheckoutRefundMatchesPayment(input: {
  payment: HostedCheckoutRefundPayment;
  refund: Stripe.Refund;
}): void {
  const actualId = input.payment.kind === "payment_intent"
    ? coerceStripeObjectId(input.refund.payment_intent)
    : coerceStripeObjectId(input.refund.charge);
  if (actualId !== input.payment.id) {
    throw buildHostedCheckoutCleanupInvariantError(
      "Stripe returned a refund for a different Checkout payment.",
    );
  }
}

function assertHostedCheckoutCleanupSession(input: {
  candidate: HostedCheckoutSubscriptionCleanupCandidate;
  session: Stripe.Checkout.Session;
}): void {
  const familyGroupId = input.candidate.familyGroupId ?? null;
  const ownerMatches = familyGroupId
    ? (
        input.session.client_reference_id === familyGroupId
        && input.session.metadata?.accountGroupId === familyGroupId
        && input.session.metadata?.ownerMemberId ===
          input.candidate.memberId
      )
    : (
        input.session.client_reference_id === input.candidate.memberId
        && input.session.metadata?.memberId === input.candidate.memberId
      );
  if (
    input.session.id !== input.candidate.checkoutSessionId
    || input.session.status !== "complete"
    || input.session.mode !== "subscription"
    || !ownerMatches
    || (
      input.candidate.checkoutAttemptId !== null
      && input.session.metadata?.checkoutAttemptId !==
        input.candidate.checkoutAttemptId
    )
    || (
      input.candidate.checkoutIntentHash !== null
      && input.session.metadata?.checkoutIntentHash !==
        input.candidate.checkoutIntentHash
    )
    || coerceStripeObjectId(input.session.subscription) !==
      input.candidate.stripeSubscriptionId
  ) {
    throw buildHostedCheckoutCleanupInvariantError(
      "The canonical Checkout Session no longer matches the cleanup candidate.",
    );
  }
}

function assertHostedCheckoutCleanupSubscription(input: {
  candidate: HostedCheckoutSubscriptionCleanupCandidate;
  subscription: Stripe.Subscription;
}): void {
  const familyGroupId = input.candidate.familyGroupId ?? null;
  const ownerMatches = familyGroupId
    ? (
        input.subscription.metadata?.accountGroupId === familyGroupId
        && input.subscription.metadata?.ownerMemberId ===
          input.candidate.memberId
      )
    : input.subscription.metadata?.memberId === input.candidate.memberId;
  if (
    input.subscription.id !== input.candidate.stripeSubscriptionId
    || !ownerMatches
    || (
      input.candidate.checkoutAttemptId !== null
      && input.subscription.metadata?.checkoutAttemptId !==
        input.candidate.checkoutAttemptId
    )
    || (
      input.candidate.checkoutIntentHash !== null
      && input.subscription.metadata?.checkoutIntentHash !==
        input.candidate.checkoutIntentHash
    )
  ) {
    throw buildHostedCheckoutCleanupInvariantError(
      "The canonical Stripe subscription no longer matches the Checkout attempt.",
    );
  }
}

function buildHostedCheckoutCleanupRefundIdempotencyKey(input: {
  invoiceId: string;
  paymentId: string;
  sessionId: string;
  terminalFailureScope: readonly {
    amount: number;
    id: string;
    status: string;
  }[];
}): string {
  const terminalFailureFingerprint = createHash("sha256")
    .update(JSON.stringify(input.terminalFailureScope))
    .digest("hex")
    .slice(0, 20);
  return [
    "hosted-checkout-cleanup-refund",
    input.sessionId,
    input.invoiceId,
    input.paymentId,
    terminalFailureFingerprint,
  ].join(":");
}

function buildHostedCheckoutCleanupProviderError(error: unknown) {
  const retryable = isHostedStripeRetryableFailure(error);
  return hostedOnboardingError({
    cause: error,
    code: retryable
      ? "HOSTED_CHECKOUT_CLEANUP_PROVIDER_UNAVAILABLE"
      : "HOSTED_CHECKOUT_CLEANUP_PROVIDER_REJECTED",
    httpStatus: retryable ? 502 : 500,
    message: retryable
      ? "Stripe could not confirm subscription cleanup. Retry reconciliation."
      : "Stripe rejected subscription cleanup. Billing support must reconcile it.",
    retryable,
  });
}

function buildHostedCheckoutCleanupInvariantError(message: string) {
  return hostedOnboardingError({
    code: "HOSTED_CHECKOUT_CLEANUP_INVARIANT_FAILED",
    httpStatus: 500,
    message,
  });
}

function isStripeResourceMissingError(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === "object"
    && Reflect.get(error, "code") === "resource_missing",
  );
}

function normalizeNullableStripeMetadata(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}
