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
const HOSTED_CHECKOUT_CLEANUP_MAX_BALANCE_TRANSACTION_PAGES = 4;
const HOSTED_CHECKOUT_CLEANUP_BALANCE_TRANSACTION_PAGE_SIZE = 100;
const HOSTED_CHECKOUT_CREDIT_NOTE_OPERATION =
  "checkout_loser_credit_restore_v1";
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
  if (refundPreparation.balanceRestoration) {
    await executeHostedCheckoutBalanceRestoration({
      candidate: input.candidate,
      invoiceId: refundPreparation.invoiceId,
      plan: refundPreparation.balanceRestoration,
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
  succeededRefundScope: Array<{
    amount: number;
    id: string;
    status: string;
  }>;
  terminalFailureScope: Array<{
    amount: number;
    id: string;
    status: string;
  }>;
}

interface HostedCheckoutRefundPreparation {
  balanceRestoration: HostedCheckoutBalanceRestorationPlan | null;
  hasPendingRefund: boolean;
  invoiceId: string;
  plans: HostedCheckoutRefundPlan[];
}

interface HostedCheckoutBalanceRestorationPlan {
  invoice: Stripe.Invoice;
  sessionCreated: number;
  value: HostedCheckoutBalanceRestorationValue;
}

interface HostedCheckoutBalanceRestorationValue {
  amount: number;
  consumedAmount: number;
  currency: string;
  customerId: string;
  issuedCreditNoteScope: HostedCheckoutIssuedCreditNoteScope[];
  sourceFingerprint: string;
}

interface HostedCheckoutIssuedCreditNoteScope {
  amount: number;
  customerBalanceTransaction: {
    amount: number;
    id: string;
    type: "credit_note";
  };
  id: string;
  status: "issued";
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
      balanceRestoration: null,
      hasPendingRefund: false,
      invoiceId: "no_invoice",
      plans: [],
    };
  }
  const customerId = coerceStripeObjectId(input.session.customer);
  if (!customerId) {
    throw buildHostedCheckoutCleanupInvariantError(
      "A subscription Checkout Session did not include its exact Customer.",
    );
  }
  if (
    !Number.isSafeInteger(input.session.created)
    || input.session.created < 0
  ) {
    throw buildHostedCheckoutCleanupInvariantError(
      "The Checkout Session creation time is invalid.",
    );
  }

  const [
    invoice,
    invoicePayments,
    invoiceBalanceTransactions,
    recentBalanceTransactions,
    creditNotes,
  ] = await Promise.all([
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
    listHostedCheckoutCustomerBalanceTransactions({
      customerId,
      operation: "customers.listBalanceTransactions.checkout-cleanup-invoice",
      requestPage: (startingAfter) =>
        input.stripe.customers.listBalanceTransactions(customerId, {
          invoice: invoiceId,
          limit: HOSTED_CHECKOUT_CLEANUP_BALANCE_TRANSACTION_PAGE_SIZE,
          ...(startingAfter ? { starting_after: startingAfter } : {}),
        }, HOSTED_CHECKOUT_CLEANUP_STRIPE_REQUEST_OPTIONS),
    }),
    listHostedCheckoutCustomerBalanceTransactions({
      customerId,
      operation: "customers.listBalanceTransactions.checkout-cleanup-session",
      // Current Stripe Checkout can reserve credit before the invoice exists.
      // Those immutable entries are Session-linked and cannot be filtered by
      // Session ID, so scan the complete bounded interval and match exactly.
      requestPage: (startingAfter) =>
        input.stripe.customers.listBalanceTransactions(customerId, {
          created: {
            gte: input.session.created,
          },
          limit: HOSTED_CHECKOUT_CLEANUP_BALANCE_TRANSACTION_PAGE_SIZE,
          ...(startingAfter ? { starting_after: startingAfter } : {}),
        }, HOSTED_CHECKOUT_CLEANUP_STRIPE_REQUEST_OPTIONS),
    }),
    withHostedStripeFailureLog(
      "creditNotes.list.checkout-cleanup",
      () => input.stripe.creditNotes.list({
        expand: ["data.customer_balance_transaction"],
        invoice: invoiceId,
        limit: 100,
      }, HOSTED_CHECKOUT_CLEANUP_STRIPE_REQUEST_OPTIONS),
    ),
  ]);
  if (
    invoice.id !== invoiceId
    || coerceStripeInvoiceSubscriptionId(invoice) !== input.subscription.id
    || coerceStripeObjectId(invoice.customer) !== customerId
  ) {
    throw buildHostedCheckoutCleanupInvariantError(
      "The Checkout invoice does not belong to the loser subscription and Customer.",
    );
  }
  if (invoicePayments.has_more) {
    throw buildHostedCheckoutCleanupInvariantError(
      "The Checkout invoice has too many payments to refund safely.",
    );
  }
  if (creditNotes.has_more) {
    throw buildHostedCheckoutCleanupInvariantError(
      "The Checkout invoice has too many credit notes to reconcile safely.",
    );
  }
  if (
    !Number.isSafeInteger(invoice.amount_due)
    || invoice.amount_due < 0
    || !Number.isSafeInteger(invoice.amount_paid)
    || invoice.amount_paid < 0
    || !Number.isSafeInteger(invoice.amount_remaining)
    || invoice.amount_remaining !== 0
    || !Number.isSafeInteger(invoice.amount_overpaid)
    || invoice.amount_overpaid !== 0
    || !Number.isSafeInteger(invoice.pre_payment_credit_notes_amount)
    || invoice.pre_payment_credit_notes_amount !== 0
    || !Number.isSafeInteger(invoice.post_payment_credit_notes_amount)
    || invoice.post_payment_credit_notes_amount < 0
    || !Number.isSafeInteger(invoice.total)
    || invoice.total < 0
    || !Number.isSafeInteger(invoice.starting_balance)
    || !Number.isSafeInteger(invoice.ending_balance)
    || invoice.amount_due !== invoice.amount_paid
  ) {
    throw buildHostedCheckoutCleanupInvariantError(
      "The Checkout invoice financial totals are not safe to compensate.",
    );
  }
  if (invoice.status !== "paid" || input.session.payment_status !== "paid") {
    throw buildHostedCheckoutCleanupInvariantError(
      "The Checkout invoice has paid funds but is not canonically paid.",
    );
  }
  const balanceFacts = readHostedCheckoutBalanceFacts({
    customerId,
    creditNoteBalanceTransactionIds: new Set(
      creditNotes.data.flatMap((creditNote) => {
        const transactionId = coerceStripeObjectId(
          creditNote.customer_balance_transaction,
        );
        return transactionId ? [transactionId] : [];
      }),
    ),
    invoice,
    invoiceBalanceTransactions,
    recentBalanceTransactions,
    sessionId: input.session.id,
  });
  const creditNoteFacts = readHostedCheckoutCreditNoteFacts({
    creditNotes: creditNotes.data,
    customerId,
    invoice,
  });
  if (
    creditNoteFacts.postPaymentAmount
      !== invoice.post_payment_credit_notes_amount
  ) {
    throw buildHostedCheckoutCleanupInvariantError(
      "The Checkout invoice credit-note total does not match its canonical notes.",
    );
  }
  if (
    creditNoteFacts.customerCreditAmount > balanceFacts.consumedCreditAmount
  ) {
    throw buildHostedCheckoutCleanupInvariantError(
      "Checkout invoice credit notes exceed the customer credit consumed by the loser.",
    );
  }
  const totalAfterInvoiceBalance = addSafeCheckoutAmounts(
    invoice.amount_paid,
    balanceFacts.netAppliedAmount,
  );
  if (totalAfterInvoiceBalance !== invoice.total) {
    throw buildHostedCheckoutCleanupInvariantError(
      "The Checkout invoice payment and balance allocations do not equal its total.",
    );
  }
  // A positive starting Customer balance is prior debt collected alongside
  // this invoice. Refund only the loser invoice's cash, not that older debt.
  const cashRefundTarget = invoice.total - balanceFacts.consumedCreditAmount;
  if (
    !Number.isSafeInteger(cashRefundTarget)
    || cashRefundTarget < 0
    || cashRefundTarget > invoice.amount_paid
  ) {
    throw buildHostedCheckoutCleanupInvariantError(
      "The Checkout invoice cash refund target is invalid.",
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
  const refundFacts: Array<{
    paidAmount: number;
    payment: HostedCheckoutRefundPayment;
    succeededAmount: number;
    succeededRefundScope:
      HostedCheckoutRefundPlan["succeededRefundScope"];
    terminalFailureScope: HostedCheckoutRefundPlan["terminalFailureScope"];
  }> = [];
  let hasPendingRefund = false;
  let pendingRefundAmount = 0;
  let succeededRefundAmount = 0;
  for (const invoicePayment of invoicePayments.data) {
    if (coerceStripeObjectId(invoicePayment.invoice) !== invoice.id) {
      throw buildHostedCheckoutCleanupInvariantError(
        "Stripe returned a payment for a different Checkout invoice.",
      );
    }
  }
  const paidAllocations = paidPayments.map((invoicePayment) => ({
    invoicePayment,
    payment: requireHostedCheckoutRefundPayment(invoicePayment),
  })).sort((left, right) => {
    const leftKey = `${left.payment.kind}:${left.payment.id}`;
    const rightKey = `${right.payment.kind}:${right.payment.id}`;
    return leftKey.localeCompare(rightKey);
  });
  for (const { invoicePayment, payment } of paidAllocations) {
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
    allocatedAmount = addSafeCheckoutAmounts(allocatedAmount, paidAmount);
    const paymentKey = `${payment.kind}:${payment.id}`;
    if (paymentIds.has(paymentKey)) {
      throw buildHostedCheckoutCleanupInvariantError(
        "The Checkout invoice repeats the same payment allocation.",
      );
    }
    paymentIds.add(paymentKey);
    await assertHostedCheckoutPaymentIntentHasExactInvoiceAllocation({
      invoice,
      invoicePayment,
      paymentIntentId: payment.id,
      stripe: input.stripe,
    });
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
    let pendingAmount = 0;
    const succeededRefundScope:
      HostedCheckoutRefundPlan["succeededRefundScope"] = [];
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
        succeededAmount = addSafeCheckoutAmounts(
          succeededAmount,
          refund.amount,
        );
        succeededRefundScope.push({
          amount: refund.amount,
          id: refund.id,
          status: refund.status,
        });
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
        pendingAmount = addSafeCheckoutAmounts(
          pendingAmount,
          refund.amount,
        );
      } else {
        throw buildHostedCheckoutCleanupInvariantError(
          "Stripe returned an unknown Checkout refund state.",
        );
      }
    }
    if (
      addSafeCheckoutAmounts(succeededAmount, pendingAmount) > paidAmount
    ) {
      throw buildHostedCheckoutCleanupInvariantError(
        "Checkout refunds exceed a paid invoice allocation.",
      );
    }
    succeededRefundAmount = addSafeCheckoutAmounts(
      succeededRefundAmount,
      succeededAmount,
    );
    pendingRefundAmount = addSafeCheckoutAmounts(
      pendingRefundAmount,
      pendingAmount,
    );
    refundFacts.push({
      paidAmount,
      payment,
      succeededAmount,
      succeededRefundScope: succeededRefundScope.sort((left, right) =>
        left.id.localeCompare(right.id)
      ),
      terminalFailureScope: terminalFailureScope.sort((left, right) =>
        left.id.localeCompare(right.id)
      ),
    });
  }
  if (allocatedAmount !== invoice.amount_paid) {
    throw buildHostedCheckoutCleanupInvariantError(
      "Checkout paid allocations do not equal the exact invoice paid amount.",
    );
  }
  if (
    succeededRefundAmount > cashRefundTarget
    || addSafeCheckoutAmounts(
      succeededRefundAmount,
      pendingRefundAmount,
    ) > cashRefundTarget
  ) {
    throw buildHostedCheckoutCleanupInvariantError(
      "Checkout refunds exceed the loser invoice cash allocation.",
    );
  }
  const plans: HostedCheckoutRefundPlan[] = [];
  if (!hasPendingRefund) {
    let remainingRefundAmount = cashRefundTarget - succeededRefundAmount;
    for (const refundFact of refundFacts) {
      const availableAmount =
        refundFact.paidAmount - refundFact.succeededAmount;
      const remainingAmount = Math.min(
        availableAmount,
        remainingRefundAmount,
      );
      if (remainingAmount > 0) {
        plans.push({
          payment: refundFact.payment,
          remainingAmount,
          succeededRefundScope: refundFact.succeededRefundScope,
          terminalFailureScope: refundFact.terminalFailureScope,
        });
        remainingRefundAmount -= remainingAmount;
      }
    }
    if (remainingRefundAmount !== 0) {
      throw buildHostedCheckoutCleanupInvariantError(
        "The Checkout invoice does not have enough refundable cash allocation.",
      );
    }
  }
  return {
    balanceRestoration:
      creditNoteFacts.customerCreditAmount < balanceFacts.consumedCreditAmount
        ? {
          invoice,
          sessionCreated: input.session.created,
          value: {
            amount:
              balanceFacts.consumedCreditAmount
              - creditNoteFacts.customerCreditAmount,
            consumedAmount: balanceFacts.consumedCreditAmount,
            currency: invoice.currency,
            customerId,
            issuedCreditNoteScope:
              creditNoteFacts.issuedCreditNoteScope,
            sourceFingerprint: balanceFacts.sourceFingerprint,
          },
        }
      : null,
    hasPendingRefund,
    invoiceId,
    plans,
  };
}

interface HostedCheckoutBalanceFacts {
  consumedCreditAmount: number;
  netAppliedAmount: number;
  sourceFingerprint: string;
}

function readHostedCheckoutBalanceFacts(input: {
  customerId: string;
  creditNoteBalanceTransactionIds: ReadonlySet<string>;
  invoice: Stripe.Invoice;
  invoiceBalanceTransactions: readonly Stripe.CustomerBalanceTransaction[];
  recentBalanceTransactions: readonly Stripe.CustomerBalanceTransaction[];
  sessionId: string;
}): HostedCheckoutBalanceFacts {
  const sourceTransactions = new Map<
    string,
    Stripe.CustomerBalanceTransaction
  >();
  for (const transaction of input.invoiceBalanceTransactions) {
    assertHostedCheckoutBalanceTransactionCustomer({
      currency: input.invoice.currency,
      customerId: input.customerId,
      transaction,
    });
    if (
      transaction.type === "credit_note"
      && input.creditNoteBalanceTransactionIds.has(transaction.id)
    ) {
      continue;
    }
    if (coerceStripeObjectId(transaction.invoice) !== input.invoice.id) {
      throw buildHostedCheckoutCleanupInvariantError(
        "Stripe returned a balance transaction for a different Checkout invoice.",
      );
    }
    if (
      transaction.type !== "applied_to_invoice"
      && transaction.type !== "unapplied_from_invoice"
      && transaction.type !== "checkout_session_subscription_payment"
      && transaction.type !==
        "checkout_session_subscription_payment_canceled"
    ) {
      throw buildHostedCheckoutCleanupInvariantError(
        "The Checkout invoice has an unsupported customer balance transaction.",
      );
    }
    const transactionSessionId = coerceStripeObjectId(
      transaction.checkout_session,
    );
    if (
      (
        transaction.type === "checkout_session_subscription_payment"
        || transaction.type ===
          "checkout_session_subscription_payment_canceled"
      )
      && transactionSessionId !== input.sessionId
    ) {
      throw buildHostedCheckoutCleanupInvariantError(
        "The Checkout invoice balance transaction belongs to another Session.",
      );
    }
    addHostedCheckoutBalanceSourceTransaction({
      sourceTransactions,
      transaction,
    });
  }

  for (const transaction of input.recentBalanceTransactions) {
    assertHostedCheckoutBalanceTransactionCustomer({
      customerId: input.customerId,
      transaction,
    });
    const transactionSessionId = coerceStripeObjectId(
      transaction.checkout_session,
    );
    if (transactionSessionId !== input.sessionId) {
      continue;
    }
    if (
      transaction.type !== "checkout_session_subscription_payment"
      && transaction.type !==
        "checkout_session_subscription_payment_canceled"
    ) {
      throw buildHostedCheckoutCleanupInvariantError(
        "The Checkout Session has an unsupported customer balance transaction.",
      );
    }
    assertHostedCheckoutBalanceTransactionCustomer({
      currency: input.invoice.currency,
      customerId: input.customerId,
      transaction,
    });
    const transactionInvoiceId = coerceStripeObjectId(transaction.invoice);
    if (
      transactionInvoiceId !== null
      && transactionInvoiceId !== input.invoice.id
    ) {
      throw buildHostedCheckoutCleanupInvariantError(
        "The Checkout Session balance transaction belongs to another invoice.",
      );
    }
    addHostedCheckoutBalanceSourceTransaction({
      sourceTransactions,
      transaction,
    });
  }

  let creditAppliedAmount = 0;
  let creditReturnedAmount = 0;
  let debitAppliedAmount = 0;
  let debitReturnedAmount = 0;
  const sourceScope: Array<{
    amount: number;
    id: string;
    type: Stripe.CustomerBalanceTransaction.Type;
  }> = [];
  for (const transaction of sourceTransactions.values()) {
    if (
      !Number.isSafeInteger(transaction.amount)
      || transaction.amount === 0
      || !Number.isSafeInteger(transaction.ending_balance)
    ) {
      throw buildHostedCheckoutCleanupInvariantError(
        "Stripe returned an invalid Checkout customer balance amount.",
      );
    }
    const isApplication =
      transaction.type === "applied_to_invoice"
      || transaction.type === "checkout_session_subscription_payment";
    if (isApplication && transaction.amount > 0) {
      creditAppliedAmount = addSafeCheckoutAmounts(
        creditAppliedAmount,
        transaction.amount,
      );
    } else if (isApplication) {
      debitAppliedAmount = addSafeCheckoutAmounts(
        debitAppliedAmount,
        -transaction.amount,
      );
    } else if (transaction.amount < 0) {
      creditReturnedAmount = addSafeCheckoutAmounts(
        creditReturnedAmount,
        -transaction.amount,
      );
    } else {
      debitReturnedAmount = addSafeCheckoutAmounts(
        debitReturnedAmount,
        transaction.amount,
      );
    }
    sourceScope.push({
      amount: transaction.amount,
      id: transaction.id,
      type: transaction.type,
    });
  }
  if (
    creditReturnedAmount > creditAppliedAmount
    || debitReturnedAmount > debitAppliedAmount
  ) {
    throw buildHostedCheckoutCleanupInvariantError(
      "The Checkout customer balance reversals do not match their applications.",
    );
  }
  const consumedCreditAmount =
    creditAppliedAmount - creditReturnedAmount;
  const appliedDebitAmount = debitAppliedAmount - debitReturnedAmount;
  if (consumedCreditAmount > 0 && appliedDebitAmount > 0) {
    throw buildHostedCheckoutCleanupInvariantError(
      "The Checkout invoice mixes customer credit and debit applications.",
    );
  }
  const netAppliedAmount = consumedCreditAmount - appliedDebitAmount;
  const endingBalance = input.invoice.ending_balance;
  if (
    typeof endingBalance !== "number"
    || !Number.isSafeInteger(endingBalance)
  ) {
    throw buildHostedCheckoutCleanupInvariantError(
      "The Checkout invoice ending balance is invalid.",
    );
  }
  const invoiceBalanceDelta = endingBalance
    - input.invoice.starting_balance;
  if (
    !Number.isSafeInteger(invoiceBalanceDelta)
    || netAppliedAmount !== invoiceBalanceDelta
  ) {
    throw buildHostedCheckoutCleanupInvariantError(
      "The Checkout customer balance ledger does not match the invoice snapshot.",
    );
  }
  const sourceFingerprint = createHash("sha256")
    .update(JSON.stringify(sourceScope.sort((left, right) =>
      left.id.localeCompare(right.id)
    )))
    .digest("hex")
    .slice(0, 24);
  return {
    consumedCreditAmount,
    netAppliedAmount,
    sourceFingerprint,
  };
}

interface HostedCheckoutCreditNoteFacts {
  customerCreditAmount: number;
  issuedCreditNoteScope: HostedCheckoutIssuedCreditNoteScope[];
  postPaymentAmount: number;
}

function readHostedCheckoutCreditNoteFacts(input: {
  creditNotes: readonly Stripe.CreditNote[];
  customerId: string;
  invoice: Stripe.Invoice;
}): HostedCheckoutCreditNoteFacts {
  let customerCreditAmount = 0;
  let postPaymentAmount = 0;
  const issuedCreditNoteScope: HostedCheckoutIssuedCreditNoteScope[] = [];
  const customerBalanceTransactionIds = new Set<string>();
  for (const creditNote of input.creditNotes) {
    if (
      coerceStripeObjectId(creditNote.invoice) !== input.invoice.id
      || coerceStripeObjectId(creditNote.customer) !== input.customerId
      || creditNote.currency !== input.invoice.currency
    ) {
      throw buildHostedCheckoutCleanupInvariantError(
        "Stripe returned a credit note for another Checkout invoice or Customer.",
      );
    }
    if (creditNote.status === "void") {
      continue;
    }
    const credit = readHostedCheckoutCreditNoteCustomerCreditAmount({
      creditNote,
      customerId: input.customerId,
      invoice: input.invoice,
    });
    if (
      credit.customerBalanceTransactionId
      && customerBalanceTransactionIds.has(
        credit.customerBalanceTransactionId,
      )
    ) {
      throw buildHostedCheckoutCleanupInvariantError(
        "Stripe returned the same Customer balance credit on multiple credit notes.",
      );
    }
    if (credit.customerBalanceTransactionId) {
      customerBalanceTransactionIds.add(
        credit.customerBalanceTransactionId,
      );
    }
    if (!credit.customerBalanceTransactionId) {
      throw buildHostedCheckoutCleanupInvariantError(
        "The issued Checkout credit note did not include its Customer balance transaction.",
      );
    }
    issuedCreditNoteScope.push({
      amount: creditNote.amount,
      customerBalanceTransaction: {
        amount: -credit.amount,
        id: credit.customerBalanceTransactionId,
        type: "credit_note",
      },
      id: creditNote.id,
      status: creditNote.status,
    });
    customerCreditAmount = addSafeCheckoutAmounts(
      customerCreditAmount,
      credit.amount,
    );
    postPaymentAmount = addSafeCheckoutAmounts(
      postPaymentAmount,
      creditNote.post_payment_amount,
    );
  }
  return {
    customerCreditAmount,
    issuedCreditNoteScope: issuedCreditNoteScope.sort((left, right) =>
      left.id.localeCompare(right.id)
    ),
    postPaymentAmount,
  };
}

function readHostedCheckoutCreditNoteCustomerCreditAmount(input: {
  creditNote: Stripe.CreditNote;
  customerId: string;
  invoice: Stripe.Invoice;
}): {
  amount: number;
  customerBalanceTransactionId: string | null;
} {
  const { creditNote } = input;
  // Cash refunds have their own exact-payment reconciliation above. Only pure
  // Customer-balance Credit Notes compose here; mixed or out-of-band notes
  // would make total compensation ambiguous and therefore fail closed.
  if (
    creditNote.status !== "issued"
    || creditNote.type !== "post_payment"
    || coerceStripeObjectId(creditNote.invoice) !== input.invoice.id
    || coerceStripeObjectId(creditNote.customer) !== input.customerId
    || creditNote.currency !== input.invoice.currency
    || !Number.isSafeInteger(creditNote.amount)
    || creditNote.amount <= 0
    || !Number.isSafeInteger(creditNote.pre_payment_amount)
    || creditNote.pre_payment_amount !== 0
    || !Number.isSafeInteger(creditNote.post_payment_amount)
    || creditNote.post_payment_amount !== creditNote.amount
    || creditNote.out_of_band_amount !== null
    || creditNote.refunds.length !== 0
  ) {
    throw buildHostedCheckoutCleanupInvariantError(
      "The Checkout invoice has an unsupported issued credit note.",
    );
  }
  const customerBalanceTransaction =
    creditNote.customer_balance_transaction;
  let customerCreditAmount = 0;
  let customerBalanceTransactionId: string | null = null;
  if (customerBalanceTransaction !== null) {
    if (typeof customerBalanceTransaction === "string") {
      throw buildHostedCheckoutCleanupInvariantError(
        "Stripe did not expand the Checkout credit note Customer balance transaction.",
      );
    }
    assertHostedCheckoutBalanceTransactionCustomer({
      currency: input.invoice.currency,
      customerId: input.customerId,
      transaction: customerBalanceTransaction,
    });
    if (
      customerBalanceTransaction.type !== "credit_note"
      || !Number.isSafeInteger(customerBalanceTransaction.amount)
      || customerBalanceTransaction.amount >= 0
      || !Number.isSafeInteger(customerBalanceTransaction.ending_balance)
      || coerceStripeObjectId(customerBalanceTransaction.credit_note)
        !== creditNote.id
      || coerceStripeObjectId(customerBalanceTransaction.invoice)
        !== input.invoice.id
      || coerceStripeObjectId(customerBalanceTransaction.checkout_session)
        !== null
    ) {
      throw buildHostedCheckoutCleanupInvariantError(
        "The Checkout credit note does not contain an exact Customer balance credit.",
      );
    }
    customerCreditAmount = -customerBalanceTransaction.amount;
    customerBalanceTransactionId = customerBalanceTransaction.id;
  }
  if (
    customerCreditAmount !== creditNote.post_payment_amount
  ) {
    throw buildHostedCheckoutCleanupInvariantError(
      "The Checkout credit note allocations do not equal its post-payment amount.",
    );
  }
  return {
    amount: customerCreditAmount,
    customerBalanceTransactionId,
  };
}

function addHostedCheckoutBalanceSourceTransaction(input: {
  sourceTransactions: Map<string, Stripe.CustomerBalanceTransaction>;
  transaction: Stripe.CustomerBalanceTransaction;
}): void {
  const existing = input.sourceTransactions.get(input.transaction.id);
  if (!existing) {
    input.sourceTransactions.set(input.transaction.id, input.transaction);
    return;
  }
  if (
    existing.amount !== input.transaction.amount
    || existing.type !== input.transaction.type
    || existing.currency !== input.transaction.currency
    || coerceStripeObjectId(existing.customer) !==
      coerceStripeObjectId(input.transaction.customer)
    || coerceStripeObjectId(existing.invoice) !==
      coerceStripeObjectId(input.transaction.invoice)
    || coerceStripeObjectId(existing.checkout_session) !==
      coerceStripeObjectId(input.transaction.checkout_session)
    || existing.ending_balance !== input.transaction.ending_balance
  ) {
    throw buildHostedCheckoutCleanupInvariantError(
      "Stripe returned inconsistent copies of a Checkout balance transaction.",
    );
  }
}

async function listHostedCheckoutCustomerBalanceTransactions(input: {
  customerId: string;
  operation: string;
  requestPage: (
    startingAfter: string | undefined,
  ) => Promise<{
    data: Stripe.CustomerBalanceTransaction[];
    has_more: boolean;
  }>;
}): Promise<Stripe.CustomerBalanceTransaction[]> {
  const transactions: Stripe.CustomerBalanceTransaction[] = [];
  const seenIds = new Set<string>();
  let startingAfter: string | undefined;
  for (
    let pageIndex = 0;
    pageIndex < HOSTED_CHECKOUT_CLEANUP_MAX_BALANCE_TRANSACTION_PAGES;
    pageIndex += 1
  ) {
    const page = await withHostedStripeFailureLog(
      input.operation,
      () => input.requestPage(startingAfter),
    );
    for (const transaction of page.data) {
      if (seenIds.has(transaction.id)) {
        throw buildHostedCheckoutCleanupInvariantError(
          "Stripe repeated a Checkout customer balance transaction page.",
        );
      }
      seenIds.add(transaction.id);
      transactions.push(transaction);
    }
    if (!page.has_more) {
      return transactions;
    }
    const lastTransaction = page.data.at(-1);
    if (!lastTransaction) {
      throw buildHostedCheckoutCleanupInvariantError(
        "Stripe returned an empty paginated customer balance response.",
      );
    }
    startingAfter = lastTransaction.id;
  }
  throw buildHostedCheckoutCleanupInvariantError(
    "The Checkout Customer has too many balance transactions to reconcile safely.",
  );
}

function assertHostedCheckoutBalanceTransactionCustomer(input: {
  currency?: string;
  customerId: string;
  transaction: Stripe.CustomerBalanceTransaction;
}): void {
  if (
    coerceStripeObjectId(input.transaction.customer) !== input.customerId
    || (
      input.currency !== undefined
      && input.transaction.currency !== input.currency
    )
  ) {
    throw buildHostedCheckoutCleanupInvariantError(
      "Stripe returned a balance transaction for another Checkout Customer or currency.",
    );
  }
}

function addSafeCheckoutAmounts(left: number, right: number): number {
  const total = left + right;
  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right)
    || !Number.isSafeInteger(total)) {
    throw buildHostedCheckoutCleanupInvariantError(
      "Stripe returned Checkout financial amounts outside the safe integer range.",
    );
  }
  return total;
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

async function assertHostedCheckoutPaymentIntentHasExactInvoiceAllocation(
  input: {
    invoice: Stripe.Invoice;
    invoicePayment: Stripe.InvoicePayment;
    paymentIntentId: string;
    stripe: Stripe;
  },
): Promise<void> {
  const allocations = await withHostedStripeFailureLog(
    "invoicePayments.list.checkout-cleanup-payment-intent",
    () => input.stripe.invoicePayments.list({
      limit: 100,
      payment: {
        payment_intent: input.paymentIntentId,
        type: "payment_intent",
      },
    }, HOSTED_CHECKOUT_CLEANUP_STRIPE_REQUEST_OPTIONS),
  );
  if (allocations.has_more || allocations.data.length !== 1) {
    throw buildHostedCheckoutCleanupInvariantError(
      "The Checkout PaymentIntent is attached to another invoice allocation.",
    );
  }
  const [allocation] = allocations.data;
  if (
    !allocation
    || allocation.id !== input.invoicePayment.id
    || allocation.status !== "paid"
    || allocation.amount_paid !== input.invoicePayment.amount_paid
    || coerceStripeObjectId(allocation.invoice) !== input.invoice.id
    || allocation.payment.type !== "payment_intent"
    || coerceStripeObjectId(allocation.payment.payment_intent)
      !== input.paymentIntentId
  ) {
    throw buildHostedCheckoutCleanupInvariantError(
      "Stripe did not confirm the exact Checkout PaymentIntent invoice allocation.",
    );
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
        remainingAmount: input.plan.remainingAmount,
        sessionId: input.sessionId,
        succeededRefundScope: input.plan.succeededRefundScope,
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

async function executeHostedCheckoutBalanceRestoration(input: {
  candidate: HostedCheckoutSubscriptionCleanupCandidate;
  invoiceId: string;
  plan: HostedCheckoutBalanceRestorationPlan;
  sessionId: string;
  stripe: Stripe;
}): Promise<void> {
  const [
    invoice,
    invoiceBalanceTransactions,
    recentBalanceTransactions,
    creditNotes,
  ] =
    await Promise.all([
      withHostedStripeFailureLog(
        "invoices.retrieve.checkout-credit-restore",
        () => input.stripe.invoices.retrieve(
          input.invoiceId,
          {},
          HOSTED_CHECKOUT_CLEANUP_STRIPE_REQUEST_OPTIONS,
        ),
      ),
      listHostedCheckoutCustomerBalanceTransactions({
        customerId: input.plan.value.customerId,
        operation:
          "customers.listBalanceTransactions.checkout-credit-restore-invoice",
        requestPage: (startingAfter) =>
          input.stripe.customers.listBalanceTransactions(
            input.plan.value.customerId,
            {
              invoice: input.invoiceId,
              limit: HOSTED_CHECKOUT_CLEANUP_BALANCE_TRANSACTION_PAGE_SIZE,
              ...(startingAfter ? { starting_after: startingAfter } : {}),
            },
            HOSTED_CHECKOUT_CLEANUP_STRIPE_REQUEST_OPTIONS,
          ),
      }),
      listHostedCheckoutCustomerBalanceTransactions({
        customerId: input.plan.value.customerId,
        operation:
          "customers.listBalanceTransactions.checkout-credit-restore-session",
        requestPage: (startingAfter) =>
          input.stripe.customers.listBalanceTransactions(
            input.plan.value.customerId,
            {
              created: {
                gte: input.plan.sessionCreated,
              },
              limit: HOSTED_CHECKOUT_CLEANUP_BALANCE_TRANSACTION_PAGE_SIZE,
              ...(startingAfter ? { starting_after: startingAfter } : {}),
            },
            HOSTED_CHECKOUT_CLEANUP_STRIPE_REQUEST_OPTIONS,
          ),
      }),
      withHostedStripeFailureLog(
        "creditNotes.list.checkout-credit-restore",
        () => input.stripe.creditNotes.list({
          expand: ["data.customer_balance_transaction"],
          invoice: input.invoiceId,
          limit: 100,
        }, HOSTED_CHECKOUT_CLEANUP_STRIPE_REQUEST_OPTIONS),
      ),
    ]);
  if (creditNotes.has_more) {
    throw buildHostedCheckoutCleanupInvariantError(
      "The Checkout invoice has too many credit notes to restore customer credit safely.",
    );
  }
  if (!hostedCheckoutInvoicesHaveSameCompensationState(
    invoice,
    input.plan.invoice,
  )) {
    throw buildHostedCheckoutCleanupInvariantError(
      "The Checkout invoice changed before customer credit restoration.",
    );
  }
  const balanceFacts = readHostedCheckoutBalanceFacts({
    customerId: input.plan.value.customerId,
    creditNoteBalanceTransactionIds: new Set(
      creditNotes.data.flatMap((creditNote) => {
        const transactionId = coerceStripeObjectId(
          creditNote.customer_balance_transaction,
        );
        return transactionId ? [transactionId] : [];
      }),
    ),
    invoice,
    invoiceBalanceTransactions,
    recentBalanceTransactions,
    sessionId: input.sessionId,
  });
  const creditNoteFacts = readHostedCheckoutCreditNoteFacts({
    creditNotes: creditNotes.data,
    customerId: input.plan.value.customerId,
    invoice,
  });
  if (
    creditNoteFacts.postPaymentAmount
      !== invoice.post_payment_credit_notes_amount
  ) {
    throw buildHostedCheckoutCleanupInvariantError(
      "The Checkout invoice credit-note total changed before customer credit restoration.",
    );
  }
  if (
    balanceFacts.consumedCreditAmount !== input.plan.value.consumedAmount
    || balanceFacts.sourceFingerprint !== input.plan.value.sourceFingerprint
    || JSON.stringify(creditNoteFacts.issuedCreditNoteScope)
      !== JSON.stringify(input.plan.value.issuedCreditNoteScope)
  ) {
    throw buildHostedCheckoutCleanupInvariantError(
      "The Checkout customer credit allocation changed before restoration.",
    );
  }
  if (
    creditNoteFacts.customerCreditAmount > balanceFacts.consumedCreditAmount
  ) {
    throw buildHostedCheckoutCleanupInvariantError(
      "Checkout invoice credit notes exceed the customer credit consumed by the loser.",
    );
  }
  const remainingCreditAmount =
    balanceFacts.consumedCreditAmount
    - creditNoteFacts.customerCreditAmount;
  if (remainingCreditAmount === 0) {
    return;
  }
  if (
    remainingCreditAmount !== input.plan.value.amount
    || invoice.currency !== input.plan.value.currency
    || coerceStripeObjectId(invoice.customer) !==
      input.plan.value.customerId
  ) {
    throw buildHostedCheckoutCleanupInvariantError(
      "The Checkout customer credit proof changed before restoration.",
    );
  }

  const restoration = await withHostedStripeFailureLog(
    "creditNotes.create.checkout-cleanup",
    () => input.stripe.creditNotes.create({
      amount: input.plan.value.amount,
      credit_amount: input.plan.value.amount,
      email_type: "none",
      expand: ["customer_balance_transaction"],
      invoice: input.invoiceId,
      metadata: {
        checkoutSessionId: input.sessionId,
        cleanupReason: input.candidate.reason,
        operation: HOSTED_CHECKOUT_CREDIT_NOTE_OPERATION,
        sourceFingerprint: input.plan.value.sourceFingerprint,
      },
      reason: "duplicate",
    }, {
      ...HOSTED_CHECKOUT_CLEANUP_STRIPE_REQUEST_OPTIONS,
      idempotencyKey: [
        "hosted-checkout-credit-restore",
        input.sessionId,
        input.invoiceId,
        String(input.plan.value.amount),
        input.plan.value.sourceFingerprint,
        createHash("sha256")
          .update(JSON.stringify(input.plan.value.issuedCreditNoteScope))
          .digest("hex")
          .slice(0, 20),
      ].join(":"),
    }),
  );
  const restoredCredit = readHostedCheckoutCreditNoteCustomerCreditAmount({
    creditNote: restoration,
    customerId: input.plan.value.customerId,
    invoice,
  });
  if (
    restoredCredit.amount !== input.plan.value.amount
  ) {
    throw buildHostedCheckoutCleanupInvariantError(
      "Stripe did not confirm the exact Checkout customer credit restoration.",
    );
  }
}

function hostedCheckoutInvoicesHaveSameCompensationState(
  current: Stripe.Invoice,
  expected: Stripe.Invoice,
): boolean {
  return current.id === expected.id
    && coerceStripeInvoiceSubscriptionId(current) ===
      coerceStripeInvoiceSubscriptionId(expected)
    && coerceStripeObjectId(current.customer) ===
      coerceStripeObjectId(expected.customer)
    && current.currency === expected.currency
    && current.status === expected.status
    && current.amount_due === expected.amount_due
    && current.amount_paid === expected.amount_paid
    && current.amount_remaining === expected.amount_remaining
    && current.amount_overpaid === expected.amount_overpaid
    && current.total === expected.total
    && current.starting_balance === expected.starting_balance
    && current.ending_balance === expected.ending_balance
    && current.pre_payment_credit_notes_amount ===
      expected.pre_payment_credit_notes_amount
    && current.post_payment_credit_notes_amount ===
      expected.post_payment_credit_notes_amount;
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
  if (await hasHostedCheckoutCustomerLocalOwner({
    lookupKeys,
    tx: input.tx,
  })) {
    return;
  }

  const initialBalanceState =
    await readHostedCheckoutCustomerDeletionBalanceState({
      customerId: stripeCustomerId,
      stripe: input.stripe,
    });
  if (initialBalanceState !== "zero") {
    // Deleting this Customer would discard restored credit or unresolved debt.
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
  const finalBalanceState =
    await readHostedCheckoutCustomerDeletionBalanceState({
      customerId: stripeCustomerId,
      stripe: input.stripe,
    });
  if (finalBalanceState !== "zero") {
    return;
  }
  if (await hasHostedCheckoutCustomerLocalOwner({
    lookupKeys,
    tx: input.tx,
  })) {
    return;
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

async function hasHostedCheckoutCustomerLocalOwner(input: {
  lookupKeys: readonly string[];
  tx: Prisma.TransactionClient;
}): Promise<boolean> {
  const [memberOwner, familyOwner] = await Promise.all([
    input.tx.hostedMemberBillingRef.findFirst({
      select: {
        memberId: true,
      },
      where: {
        stripeCustomerLookupKey: {
          in: [...input.lookupKeys],
        },
      },
    }),
    input.tx.hostedAccountGroupBillingRef.findFirst({
      select: {
        groupId: true,
      },
      where: {
        stripeCustomerLookupKey: {
          in: [...input.lookupKeys],
        },
      },
    }),
  ]);
  return Boolean(memberOwner || familyOwner);
}

async function readHostedCheckoutCustomerDeletionBalanceState(input: {
  customerId: string;
  stripe: Stripe;
}): Promise<"cash_balance" | "deleted" | "nonzero" | "zero"> {
  const customer = await withHostedStripeFailureLog(
    "customers.retrieve.checkout-customer-cleanup",
    () => input.stripe.customers.retrieve(
      input.customerId,
      {
        expand: ["cash_balance", "invoice_credit_balance"],
      },
      HOSTED_CHECKOUT_CLEANUP_STRIPE_REQUEST_OPTIONS,
    ),
  );
  if (customer.id !== input.customerId) {
    throw buildHostedCheckoutCleanupInvariantError(
      "Stripe returned a different orphan Checkout Customer.",
    );
  }
  if (customer.deleted) {
    return "deleted";
  }
  const deletionBalanceState =
    classifyHostedStripeCustomerDeletionBalance(customer);
  if (deletionBalanceState === "invalid") {
    throw buildHostedCheckoutCleanupInvariantError(
      "The orphan Checkout Customer has an invalid deletion balance.",
    );
  }
  return deletionBalanceState;
}

export function classifyHostedStripeCustomerDeletionBalance(
  customer: Pick<
    Stripe.Customer,
    "balance" | "cash_balance" | "invoice_credit_balance"
  >,
): "cash_balance" | "invalid" | "nonzero" | "zero" {
  if (
    customer.cash_balance === undefined
    || customer.invoice_credit_balance === undefined
  ) {
    return "invalid";
  }
  if (customer.cash_balance !== null) {
    // Stripe refuses Customer deletion whenever a Cash Balance object exists,
    // including objects whose available currency amounts are currently zero.
    return "cash_balance";
  }
  const currencyBalances = Object.values(customer.invoice_credit_balance);
  if (
    !Number.isSafeInteger(customer.balance)
    || currencyBalances.some((amount) => !Number.isSafeInteger(amount))
  ) {
    return "invalid";
  }
  return customer.balance !== 0
      || currencyBalances.some((amount) => amount !== 0)
    ? "nonzero"
    : "zero";
}

interface HostedCheckoutRefundPayment {
  filter: {
    payment_intent: string;
  };
  id: string;
  kind: "payment_intent";
}

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
  throw buildHostedCheckoutCleanupInvariantError(
    "The paid Checkout invoice does not use a supported PaymentIntent allocation.",
  );
}

function assertHostedCheckoutRefundMatchesPayment(input: {
  payment: HostedCheckoutRefundPayment;
  refund: Stripe.Refund;
}): void {
  const actualId = coerceStripeObjectId(input.refund.payment_intent);
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
  remainingAmount: number;
  sessionId: string;
  succeededRefundScope: readonly {
    amount: number;
    id: string;
    status: string;
  }[];
  terminalFailureScope: readonly {
    amount: number;
    id: string;
    status: string;
  }[];
}): string {
  const compensationFingerprint = createHash("sha256")
    .update(JSON.stringify({
      succeeded: input.succeededRefundScope,
      terminal: input.terminalFailureScope,
    }))
    .digest("hex")
    .slice(0, 20);
  return [
    "hosted-checkout-cleanup-refund",
    input.sessionId,
    input.invoiceId,
    input.paymentId,
    String(input.remainingAmount),
    compensationFingerprint,
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
