import type { Prisma, PrismaClient } from "@prisma/client";
import type Stripe from "stripe";

import {
  grantHostedUsageCreditForPurchaseTx,
  reconcileHostedUsageCreditDisputeNetReversalTx,
  reconcileHostedUsageCreditRefundNetReversalTx,
} from "../hosted-execution/usage-credits";
import {
  readHostedUsageCreditGrantCapacityTx,
} from "../hosted-execution/usage-credit-grant-capacity";
import {
  activateHostedGroupSponsorshipAuthorizationForPurchaseTx,
  pauseHostedGroupSponsorshipForFinancialReversalTx,
} from "../hosted-groups/group-sponsorship-authorization";
import { coerceStripeObjectId } from "./billing";
import {
  createHostedStripeBillingEventLookupKey,
  createHostedStripeBillingEventLookupKeyReadCandidates,
} from "./contact-privacy";
import { normalizeNullableString } from "./shared";
import {
  decryptHostedUsageCreditPurchaseStripeField,
  HOSTED_USAGE_CREDIT_PURCHASE_STRIPE_PRIVATE_FIELDS,
  requireHostedUsageCreditPurchasePayerMemberId,
} from "./usage-credit-purchase-stripe";
import {
  assertHostedStripeLookupMatches,
  assertHostedUsageCreditChargeContext,
  assertHostedUsageCreditFinancialEventLinks,
  buildHostedUsageCreditDirectPaymentAuthorization,
  readHostedUsageCreditSavedCardPurchaseId,
  type HostedUsageCreditChargeContext,
  type HostedUsageCreditPaymentAuthorization,
  type HostedUsageCreditPreparedPaidCheckout,
  validateHostedUsageCreditPreparedPaidCheckout,
} from "./usage-credit-stripe-payment-proof";
import {
  bindHostedUsageCreditStripeReferencesTx,
  buildHostedUsageCreditStripeRetryableError,
  buildHostedUsageCreditStripePrivateReferences,
  type HostedUsageCreditPurchaseForReconciliation,
  type HostedUsageCreditPurchaseReadClient,
  readHostedUsageCreditStripe,
  runHostedUsageCreditDatabaseOperation,
  runHostedUsageCreditKmsOperation,
  takeHostedUsageCreditKmsSignal,
  type HostedUsageCreditStripePreparationContext,
  type HostedUsageCreditStripePrivateReferences,
} from "./usage-credit-stripe-reconciliation-context";

type HostedUsageCreditRefundExposure = {
  refundIds: string[];
  sourceReferenceId: string;
  targetCashAmountMinor: number;
};

type HostedUsageCreditDisputeExposure = {
  disputeId: string;
  targetCashAmountMinor: number;
};

export type HostedUsageCreditFinancialSnapshot = {
  context: HostedUsageCreditChargeContext;
  disputes: HostedUsageCreditDisputeExposure[];
  refund: HostedUsageCreditRefundExposure | null;
};

type HostedUsageCreditPreparedFinancialPayment =
  | {
      kind: "checkout";
      paidCheckout: HostedUsageCreditPreparedPaidCheckout;
    }
  | {
      kind: "saved_card";
      paymentIntent: Stripe.PaymentIntent;
    };

export type HostedUsageCreditPreparedFinancialEvent = {
  payment: HostedUsageCreditPreparedFinancialPayment;
  privateReferences: HostedUsageCreditStripePrivateReferences;
  snapshot: HostedUsageCreditFinancialSnapshot;
};

export async function prepareHostedUsageCreditFinancialEvent(input: {
  context: HostedUsageCreditStripePreparationContext;
  event: Stripe.Event;
  eventKind: "dispute" | "refund";
  prisma: PrismaClient;
  purchase: HostedUsageCreditPurchaseForReconciliation;
}): Promise<HostedUsageCreditPreparedFinancialEvent> {
  let snapshot: HostedUsageCreditFinancialSnapshot;
  if (input.eventKind === "refund" && input.event.type === "charge.refunded") {
    const eventCharge = input.event.data.object as Stripe.Charge;
    const chargeId = normalizeNullableString(eventCharge.id);
    if (!chargeId) {
      throw new Error(
        "Usage-credit charge.refunded event did not include a Charge.",
      );
    }
    snapshot = await retrieveHostedUsageCreditFinancialSnapshot({
      chargeId,
      context: input.context,
      purchase: input.purchase,
    });
    if (
      input.event.livemode !== input.purchase.stripeLiveMode ||
      eventCharge.livemode !== input.purchase.stripeLiveMode
    ) {
      throw new Error("Usage-credit refunded Charge environment did not match.");
    }
    assertHostedUsageCreditFinancialEventLinks({
      eventChargeId: normalizeNullableString(eventCharge.id),
      eventPaymentIntentId: coerceStripeObjectId(eventCharge.payment_intent),
      financialChargeId: snapshot.context.charge.id,
      financialPaymentIntentId: coerceStripeObjectId(
        snapshot.context.charge.payment_intent,
      ),
      paymentIntentId: snapshot.context.paymentIntent.id,
    });
    if (!snapshot.refund) {
      throw new Error(
        "Usage-credit refunded Charge did not include Refund provenance.",
      );
    }
  } else if (input.eventKind === "refund") {
    const eventRefund = input.event.data.object as Stripe.Refund;
    const refundId = normalizeNullableString(eventRefund.id);
    if (!refundId) {
      throw new Error("Usage-credit refund event did not include a Refund.");
    }
    const refund = await readHostedUsageCreditStripe({
      context: input.context,
      operationName: "refunds.retrieve.usage-credit-reconciliation",
      read: (options) => input.context.stripe.refunds.retrieve(
        refundId,
        undefined,
        options,
      ),
    });
    if (
      refund.id !== refundId ||
      input.event.livemode !== input.purchase.stripeLiveMode
    ) {
      throw new Error("Usage-credit Refund environment or identity did not match.");
    }
    const chargeId = coerceStripeObjectId(refund.charge);
    snapshot = await retrieveHostedUsageCreditFinancialSnapshot({
      chargeId,
      context: input.context,
      purchase: input.purchase,
    });
    assertHostedUsageCreditFinancialEventLinks({
      eventChargeId: coerceStripeObjectId(eventRefund.charge),
      eventPaymentIntentId: coerceStripeObjectId(eventRefund.payment_intent),
      financialChargeId: chargeId,
      financialPaymentIntentId: coerceStripeObjectId(refund.payment_intent),
      paymentIntentId: snapshot.context.paymentIntent.id,
    });
    if (!snapshot.refund?.refundIds.includes(refund.id)) {
      throw new Error("Usage-credit Refund was absent from its live Charge.");
    }
  } else {
    const eventDispute = input.event.data.object as Stripe.Dispute;
    const disputeId = normalizeNullableString(eventDispute.id);
    if (!disputeId) {
      throw new Error("Usage-credit dispute event did not include a Dispute.");
    }
    const dispute = await readHostedUsageCreditStripe({
      context: input.context,
      operationName: "disputes.retrieve.usage-credit-reconciliation",
      read: (options) => input.context.stripe.disputes.retrieve(
        disputeId,
        undefined,
        options,
      ),
    });
    if (
      dispute.id !== disputeId ||
      input.event.livemode !== input.purchase.stripeLiveMode ||
      dispute.livemode !== input.purchase.stripeLiveMode
    ) {
      throw new Error("Usage-credit Dispute environment or identity did not match.");
    }
    const chargeId = coerceStripeObjectId(dispute.charge);
    snapshot = await retrieveHostedUsageCreditFinancialSnapshot({
      chargeId,
      context: input.context,
      purchase: input.purchase,
    });
    assertHostedUsageCreditFinancialEventLinks({
      eventChargeId: coerceStripeObjectId(eventDispute.charge),
      eventPaymentIntentId: coerceStripeObjectId(eventDispute.payment_intent),
      financialChargeId: chargeId,
      financialPaymentIntentId: coerceStripeObjectId(dispute.payment_intent),
      paymentIntentId: snapshot.context.paymentIntent.id,
    });
    if (!snapshot.disputes.some((entry) => entry.disputeId === dispute.id)) {
      throw new Error("Usage-credit Dispute was absent from its live Charge.");
    }
  }

  const payment = await prepareHostedUsageCreditFinancialSnapshotPayment({
    context: input.context,
    eventLiveMode: input.event.livemode,
    paymentIntent: snapshot.context.paymentIntent,
    prisma: input.prisma,
    purchase: input.purchase,
  });
  const privateReferences = await buildHostedUsageCreditStripePrivateReferences({
    chargeId: snapshot.context.charge.id,
    context: input.context,
    paymentIntentId: snapshot.context.paymentIntent.id,
    prisma: input.prisma,
    purchase: input.purchase,
    sessionId: payment.kind === "checkout"
      ? payment.paidCheckout.session.id
      : null,
  });
  return { payment, privateReferences, snapshot };
}

export async function reconcileHostedUsageCreditFinancialEventTx(input: {
  event: Stripe.Event;
  eventKind: "dispute" | "refund";
  expectedReconciliationVersion: bigint;
  prepared: HostedUsageCreditPreparedFinancialEvent;
  purchase: HostedUsageCreditPurchaseForReconciliation;
  tx: Prisma.TransactionClient;
}): Promise<{ granted: boolean; wakeRequired: boolean }> {
  assertHostedUsageCreditPreparedFinancialEvent({
    event: input.event,
    eventKind: input.eventKind,
    prepared: input.prepared,
    purchase: input.purchase,
  });
  const paymentAuthorization = input.prepared.payment.kind === "checkout"
    ? validateHostedUsageCreditPreparedPaidCheckout({
        eventLiveMode: input.event.livemode,
        paidCheckout: input.prepared.payment.paidCheckout,
        purchase: input.purchase,
      })
    : buildHostedUsageCreditDirectPaymentAuthorization({
        paymentIntent: input.prepared.payment.paymentIntent,
        purchase: input.purchase,
      });
  return reconcileAndBindHostedUsageCreditFinancialSnapshotTx({
    paymentAuthorization,
    event: input.event,
    expectedReconciliationVersion: input.expectedReconciliationVersion,
    privateReferences: input.prepared.privateReferences,
    purchase: input.purchase,
    snapshot: input.prepared.snapshot,
    tx: input.tx,
  });
}

export async function retrieveHostedUsageCreditFinancialSnapshot(input: {
  chargeId: string | null;
  context: HostedUsageCreditStripePreparationContext;
  paymentIntent?: Stripe.PaymentIntent;
  purchase: HostedUsageCreditPurchaseForReconciliation;
}): Promise<HostedUsageCreditFinancialSnapshot> {
  const { chargeId } = input;
  if (!chargeId) {
    throw new Error("Usage-credit financial event did not include a Charge.");
  }
  const charge = await readHostedUsageCreditStripe({
    context: input.context,
    operationName: "charges.retrieve.usage-credit-reconciliation",
    read: (options) => input.context.stripe.charges.retrieve(
      chargeId,
      undefined,
      options,
    ),
  });
  const paymentIntentId = coerceStripeObjectId(charge.payment_intent);
  if (!paymentIntentId) {
    throw new Error("Usage-credit Charge did not include a PaymentIntent.");
  }
  const paymentIntent = input.paymentIntent ??
    await readHostedUsageCreditStripe({
      context: input.context,
      operationName: "paymentIntents.retrieve.usage-credit-reconciliation",
      read: (options) => input.context.stripe.paymentIntents.retrieve(
        paymentIntentId,
        undefined,
        options,
      ),
    });
  assertHostedUsageCreditChargeContext({
    charge,
    paymentIntent,
    purchase: input.purchase,
  });
  const [refunds, disputes] = await Promise.all([
    readHostedUsageCreditStripe({
      context: input.context,
      operationName: "refunds.list.usage-credit-reconciliation",
      read: (options) => input.context.stripe.refunds.list({
        charge: charge.id,
        limit: 100,
      }, options),
    }),
    readHostedUsageCreditStripe({
      context: input.context,
      operationName: "disputes.list.usage-credit-reconciliation",
      read: (options) => input.context.stripe.disputes.list({
        charge: charge.id,
        limit: 100,
      }, options),
    }),
  ]);
  if (refunds.has_more || disputes.has_more) {
    throw new Error(
      "Usage-credit Charge has too many financial reversals to reconcile safely.",
    );
  }

  const context = { charge, paymentIntent };
  return {
    context,
    disputes: buildHostedUsageCreditDisputeExposures({
      context,
      disputes: disputes.data,
      purchase: input.purchase,
    }),
    refund: buildHostedUsageCreditRefundExposure({
      context,
      purchase: input.purchase,
      refunds: refunds.data,
    }),
  };
}

async function prepareHostedUsageCreditFinancialSnapshotPayment(input: {
  context: HostedUsageCreditStripePreparationContext;
  eventLiveMode: boolean;
  paymentIntent: Stripe.PaymentIntent;
  prisma: HostedUsageCreditPurchaseReadClient;
  purchase: HostedUsageCreditPurchaseForReconciliation;
}): Promise<HostedUsageCreditPreparedFinancialPayment> {
  const savedCardPurchaseId = readHostedUsageCreditSavedCardPurchaseId(
    input.paymentIntent.metadata,
  );
  if (savedCardPurchaseId) {
    if (savedCardPurchaseId !== input.purchase.id) {
      throw new Error(
        "Saved-card usage-credit payment referenced a different purchase.",
      );
    }
    buildHostedUsageCreditDirectPaymentAuthorization({
      paymentIntent: input.paymentIntent,
      purchase: input.purchase,
    });
    return {
      kind: "saved_card",
      paymentIntent: input.paymentIntent,
    };
  }

  let sessionId: string | null = null;
  if (input.purchase.stripeCheckoutSessionIdEncrypted) {
    const payerMemberId = requireHostedUsageCreditPurchasePayerMemberId(
      input.purchase,
    );
    sessionId = await runHostedUsageCreditKmsOperation({
      run: () => decryptHostedUsageCreditPurchaseStripeField({
        field:
          HOSTED_USAGE_CREDIT_PURCHASE_STRIPE_PRIVATE_FIELDS.checkoutSessionId,
        payerMemberId,
        prisma: input.prisma,
        signal: takeHostedUsageCreditKmsSignal(input.context),
        value: input.purchase.stripeCheckoutSessionIdEncrypted,
      }),
    });
    if (!sessionId) {
      throw new Error(
        "Usage-credit purchase Checkout Session could not be decrypted.",
      );
    }
  } else {
    const sessions = await readHostedUsageCreditStripe({
      context: input.context,
      operationName: "checkout.sessions.list.usage-credit-reconciliation",
      read: (options) => input.context.stripe.checkout.sessions.list({
        limit: 2,
        payment_intent: input.paymentIntent.id,
      }, options),
    });
    if (sessions.has_more || sessions.data.length !== 1) {
      throw new Error(
        "Usage-credit payment did not resolve to exactly one Checkout Session.",
      );
    }
    sessionId = normalizeNullableString(sessions.data[0]?.id);
  }
  if (!sessionId) {
    throw new Error("Usage-credit payment did not include a Checkout Session.");
  }
  if (input.purchase.stripeCheckoutSessionLookupKey) {
    assertHostedStripeLookupMatches({
      expectedLookupKey: input.purchase.stripeCheckoutSessionLookupKey,
      kind: "stripe-checkout-session",
      value: sessionId,
    });
  }

  const [session, lineItems] = await Promise.all([
    readHostedUsageCreditStripe({
      context: input.context,
      operationName: "checkout.sessions.retrieve.usage-credit-reconciliation",
      read: (options) => input.context.stripe.checkout.sessions.retrieve(
        sessionId,
        undefined,
        options,
      ),
    }),
    readHostedUsageCreditStripe({
      context: input.context,
      operationName: "checkout.sessions.listLineItems.usage-credit-reconciliation",
      read: (options) => input.context.stripe.checkout.sessions.listLineItems(
        sessionId,
        { limit: 100 },
        options,
      ),
    }),
  ]);
  if (normalizeNullableString(session.id) !== sessionId) {
    throw new Error("Usage-credit Checkout Session identity changed.");
  }
  const paidCheckout = {
    lineItems,
    paymentIntent: input.paymentIntent,
    session,
  };
  validateHostedUsageCreditPreparedPaidCheckout({
    eventLiveMode: input.eventLiveMode,
    paidCheckout,
    purchase: input.purchase,
  });
  return {
    kind: "checkout",
    paidCheckout,
  };
}

function assertHostedUsageCreditPreparedFinancialEvent(input: {
  event: Stripe.Event;
  eventKind: "dispute" | "refund";
  prepared: HostedUsageCreditPreparedFinancialEvent;
  purchase: HostedUsageCreditPurchaseForReconciliation;
}): void {
  if (
    resolveHostedUsageCreditFinancialEventKind(input.event.type) !==
      input.eventKind ||
    input.event.livemode !== input.purchase.stripeLiveMode
  ) {
    throw new Error("Usage-credit financial event type or environment changed.");
  }
  const { snapshot } = input.prepared;
  assertHostedUsageCreditChargeContext({
    charge: snapshot.context.charge,
    paymentIntent: snapshot.context.paymentIntent,
    purchase: input.purchase,
  });

  if (input.event.type === "charge.refunded") {
    const eventCharge = input.event.data.object as Stripe.Charge;
    if (eventCharge.livemode !== input.purchase.stripeLiveMode) {
      throw new Error("Usage-credit refunded Charge environment did not match.");
    }
    assertHostedUsageCreditFinancialEventLinks({
      eventChargeId: normalizeNullableString(eventCharge.id),
      eventPaymentIntentId: coerceStripeObjectId(eventCharge.payment_intent),
      financialChargeId: snapshot.context.charge.id,
      financialPaymentIntentId: coerceStripeObjectId(
        snapshot.context.charge.payment_intent,
      ),
      paymentIntentId: snapshot.context.paymentIntent.id,
    });
    if (!snapshot.refund) {
      throw new Error(
        "Usage-credit refunded Charge did not include Refund provenance.",
      );
    }
    return;
  }

  if (input.eventKind === "refund") {
    const eventRefund = input.event.data.object as Stripe.Refund;
    const refundId = normalizeNullableString(eventRefund.id);
    assertHostedUsageCreditFinancialEventLinks({
      eventChargeId: coerceStripeObjectId(eventRefund.charge),
      eventPaymentIntentId: coerceStripeObjectId(eventRefund.payment_intent),
      financialChargeId: snapshot.context.charge.id,
      financialPaymentIntentId: snapshot.context.paymentIntent.id,
      paymentIntentId: snapshot.context.paymentIntent.id,
    });
    if (!refundId || !snapshot.refund?.refundIds.includes(refundId)) {
      throw new Error("Usage-credit Refund was absent from its live Charge.");
    }
    return;
  }

  const eventDispute = input.event.data.object as Stripe.Dispute;
  const disputeId = normalizeNullableString(eventDispute.id);
  assertHostedUsageCreditFinancialEventLinks({
    eventChargeId: coerceStripeObjectId(eventDispute.charge),
    eventPaymentIntentId: coerceStripeObjectId(eventDispute.payment_intent),
    financialChargeId: snapshot.context.charge.id,
    financialPaymentIntentId: snapshot.context.paymentIntent.id,
    paymentIntentId: snapshot.context.paymentIntent.id,
  });
  if (
    !disputeId ||
    !snapshot.disputes.some((entry) => entry.disputeId === disputeId)
  ) {
    throw new Error("Usage-credit Dispute was absent from its live Charge.");
  }
}

function buildHostedUsageCreditRefundExposure(input: {
  context: HostedUsageCreditChargeContext;
  purchase: HostedUsageCreditPurchaseForReconciliation;
  refunds: Stripe.Refund[];
}): HostedUsageCreditRefundExposure | null {
  if (input.refunds.length === 0) {
    if (input.context.charge.amount_refunded !== 0) {
      throw new Error("Usage-credit Charge refund total lacked Refund provenance.");
    }
    return null;
  }

  const refundIds = new Set<string>();
  let activeAmountMinor = 0;
  let succeededAmountMinor = 0;
  for (const refund of input.refunds) {
    const refundId = normalizeNullableString(refund.id);
    const refundPaymentIntentId = coerceStripeObjectId(refund.payment_intent);
    if (
      !refundId ||
      refundIds.has(refundId) ||
      !isHostedUsageCreditRefundStatus(refund.status) ||
      !Number.isSafeInteger(refund.created) ||
      !Number.isSafeInteger(refund.amount) ||
      refund.amount <= 0 ||
      refund.amount > input.context.charge.amount ||
      coerceStripeObjectId(refund.charge) !== input.context.charge.id ||
      (
        refundPaymentIntentId !== null &&
        refundPaymentIntentId !== input.context.paymentIntent.id
      ) ||
      normalizeNullableString(refund.currency)?.toLowerCase() !==
        input.purchase.cashCurrency.toLowerCase()
    ) {
      throw new Error("Usage-credit Charge included an invalid Refund.");
    }
    refundIds.add(refundId);
    if (isHostedUsageCreditActiveRefundStatus(refund.status)) {
      activeAmountMinor += refund.amount;
      if (
        !Number.isSafeInteger(activeAmountMinor) ||
        activeAmountMinor > input.context.charge.amount
      ) {
        throw new Error("Usage-credit Charge active Refund total was invalid.");
      }
    }
    if (refund.status === "succeeded") {
      succeededAmountMinor += refund.amount;
      if (!Number.isSafeInteger(succeededAmountMinor)) {
        throw new Error("Usage-credit Charge Refund total was invalid.");
      }
    }
  }
  // Depending on the payment rail, Charge.amount_refunded can lag an active
  // pending refund. The canonical Refund objects are the conservative source
  // of exposure: reserve pending/requires_action funds now, and restore only
  // after Stripe proves the refund failed or was canceled.
  if (
    input.context.charge.amount_refunded < succeededAmountMinor ||
    input.context.charge.amount_refunded > activeAmountMinor
  ) {
    throw new Error("Usage-credit Charge Refund total did not converge.");
  }

  const sourceRefunds = activeAmountMinor > 0
    ? input.refunds.filter((refund) =>
        isHostedUsageCreditActiveRefundStatus(refund.status)
      )
    : input.refunds;
  const [sourceRefund] = [...sourceRefunds].sort((left, right) =>
    right.created - left.created || right.id.localeCompare(left.id)
  );
  if (!sourceRefund) {
    throw new Error("Usage-credit Charge did not include Refund provenance.");
  }
  return {
    refundIds: [...refundIds].sort(),
    sourceReferenceId: sourceRefund.id,
    targetCashAmountMinor: activeAmountMinor,
  };
}

function buildHostedUsageCreditDisputeExposures(input: {
  context: HostedUsageCreditChargeContext;
  disputes: Stripe.Dispute[];
  purchase: HostedUsageCreditPurchaseForReconciliation;
}): HostedUsageCreditDisputeExposure[] {
  const disputeIds = new Set<string>();
  return input.disputes.map((dispute) => {
    const disputeId = normalizeNullableString(dispute.id);
    if (
      !disputeId ||
      disputeIds.has(disputeId) ||
      dispute.livemode !== input.purchase.stripeLiveMode ||
      !Number.isSafeInteger(dispute.created) ||
      !Number.isSafeInteger(dispute.amount) ||
      dispute.amount <= 0 ||
      coerceStripeObjectId(dispute.charge) !== input.context.charge.id ||
      (
        coerceStripeObjectId(dispute.payment_intent) !== null &&
        coerceStripeObjectId(dispute.payment_intent) !==
          input.context.paymentIntent.id
      ) ||
      normalizeNullableString(dispute.currency)?.toLowerCase() !==
        input.purchase.cashCurrency.toLowerCase() ||
      !Array.isArray(dispute.balance_transactions) ||
      dispute.balance_transactions.length > 2
    ) {
      throw new Error("Usage-credit Charge included an invalid Dispute.");
    }
    disputeIds.add(disputeId);

    const transactionIds = new Set<string>();
    const balanceByCurrency = new Map<
      string,
      { reinstatedAmountMinor: number; withdrawnAmountMinor: number }
    >();
    for (const transaction of dispute.balance_transactions) {
      const transactionId = normalizeNullableString(transaction.id);
      const sourceId = coerceStripeObjectId(transaction.source);
      const transactionCurrency = normalizeNullableString(
        transaction.currency,
      )?.toLowerCase();
      if (
        !transactionId ||
        transactionIds.has(transactionId) ||
        !Number.isSafeInteger(transaction.amount) ||
        transaction.amount === 0 ||
        !transactionCurrency ||
        (sourceId !== null && sourceId !== disputeId)
      ) {
        throw new Error(
          "Usage-credit Dispute included an invalid balance transaction.",
        );
      }
      transactionIds.add(transactionId);
      const balance = balanceByCurrency.get(transactionCurrency) ?? {
        reinstatedAmountMinor: 0,
        withdrawnAmountMinor: 0,
      };
      if (transaction.amount < 0) {
        balance.withdrawnAmountMinor += -transaction.amount;
      } else {
        balance.reinstatedAmountMinor += transaction.amount;
      }
      if (
        !Number.isSafeInteger(balance.withdrawnAmountMinor) ||
        !Number.isSafeInteger(balance.reinstatedAmountMinor)
      ) {
        throw new Error("Usage-credit Dispute balance total was invalid.");
      }
      balanceByCurrency.set(transactionCurrency, balance);
    }

    const purchaseCurrency = input.purchase.cashCurrency.toLowerCase();
    let targetCashAmountMinor = 0;
    for (const [currency, balance] of balanceByCurrency) {
      const netWithdrawnAmountMinor = Math.max(
        0,
        balance.withdrawnAmountMinor - balance.reinstatedAmountMinor,
      );
      if (netWithdrawnAmountMinor === 0) {
        continue;
      }
      if (currency !== purchaseCurrency) {
        // Stripe balance transactions use the account's settlement currency,
        // which can differ from the Charge currency. Without a durable FX rate,
        // conservatively reserve the entire top-up while any such exposure is
        // outstanding; a later reinstatement restores it through the same key.
        targetCashAmountMinor = input.purchase.cashAmountMinor;
        break;
      }
      const remainingCashExposureMinor =
        input.purchase.cashAmountMinor - targetCashAmountMinor;
      targetCashAmountMinor = netWithdrawnAmountMinor >= remainingCashExposureMinor
        ? input.purchase.cashAmountMinor
        : targetCashAmountMinor + netWithdrawnAmountMinor;
    }
    return {
      disputeId,
      targetCashAmountMinor,
    };
  }).sort((left, right) => left.disputeId.localeCompare(right.disputeId));
}

async function reconcileAndBindHostedUsageCreditFinancialSnapshotTx(input: {
  paymentAuthorization: HostedUsageCreditPaymentAuthorization;
  event: Stripe.Event;
  expectedReconciliationVersion: bigint;
  privateReferences: HostedUsageCreditStripePrivateReferences;
  purchase: HostedUsageCreditPurchaseForReconciliation;
  snapshot: HostedUsageCreditFinancialSnapshot;
  tx: Prisma.TransactionClient;
}): Promise<{ granted: boolean; wakeRequired: boolean }> {
  const reconciliation = await reconcileHostedUsageCreditFinancialSnapshotTx({
    paymentAuthorization: input.paymentAuthorization,
    effectiveAt: deriveHostedUsageCreditFinancialEffectiveAt({
      event: input.event,
      snapshot: input.snapshot,
    }),
    purchase: input.purchase,
    snapshot: input.snapshot,
    tx: input.tx,
  });
  await bindHostedUsageCreditStripeReferencesTx({
    expectedReconciliationVersion: input.expectedReconciliationVersion,
    lastReconciledAt: new Date(),
    privateReferences: input.privateReferences,
    purchaseId: input.purchase.id,
    tx: input.tx,
  });
  return reconciliation;
}

export async function reconcileHostedUsageCreditFinancialSnapshotTx(input: {
  paymentAuthorization: HostedUsageCreditPaymentAuthorization;
  effectiveAt: Date;
  purchase: HostedUsageCreditPurchaseForReconciliation;
  snapshot: HostedUsageCreditFinancialSnapshot;
  tx: Prisma.TransactionClient;
}): Promise<{ granted: boolean; wakeRequired: boolean }> {
  if (
    input.paymentAuthorization.purchaseId !== input.purchase.id ||
    input.paymentAuthorization.paymentIntentId !==
      input.snapshot.context.paymentIntent.id
  ) {
    throw new Error(
      "Usage-credit financial snapshot lacked payment authorization.",
    );
  }
  const paidAt = deriveHostedUsageCreditChargePaidAt(
    input.snapshot.context.charge,
  );
  const grant = await runHostedUsageCreditDatabaseOperation({
    read: () => grantHostedUsageCreditForPurchaseTx({
      paidAt,
      purchaseId: input.purchase.id,
      tx: input.tx,
    }),
  });
  await activateHostedGroupSponsorshipAuthorizationForPurchaseTx({
    paidAt,
    purchaseId: input.purchase.id,
    tx: input.tx,
  });
  let balanceUsdMicros = grant.balanceUsdMicros;
  let ledgerVersion = grant.ledgerVersion;

  // Pass one applies every target, including all decreases. Pass two consumes
  // capacity that a later source in pass one may have restored, so overlapping
  // refunds and disputes converge without depending on webhook order.
  for (let pass = 0; pass < 2; pass += 1) {
    const refundSnapshot = input.snapshot.refund;
    if (refundSnapshot) {
      const refund = await runHostedUsageCreditDatabaseOperation({
        read: () => reconcileHostedUsageCreditRefundNetReversalTx({
          effectiveAt: input.effectiveAt,
          purchaseId: input.purchase.id,
          sourceReferenceLookupKey: requireHostedUsageCreditFinancialLookupKey(
            refundSnapshot.sourceReferenceId,
          ),
          targetNetReversalUsdMicros:
            computeHostedUsageCreditProportionalReversalTarget({
              cashAmountMinor: input.purchase.cashAmountMinor,
              grantUsdMicros: input.purchase.grantUsdMicros,
              reversedCashAmountMinor: refundSnapshot.targetCashAmountMinor,
            }),
          tx: input.tx,
        }),
      });
      balanceUsdMicros = refund.balanceUsdMicros;
      ledgerVersion = refund.ledgerVersion;
    }
    for (const dispute of input.snapshot.disputes) {
      const disputeReconciliation = await runHostedUsageCreditDatabaseOperation({
        read: () => reconcileHostedUsageCreditDisputeNetReversalTx({
          effectiveAt: input.effectiveAt,
          purchaseId: input.purchase.id,
          sourceReferenceLookupKey:
            requireHostedUsageCreditFinancialLookupKey(dispute.disputeId),
          sourceReferenceLookupKeyCandidates:
            createHostedStripeBillingEventLookupKeyReadCandidates(
              dispute.disputeId,
            ),
          targetNetReversalUsdMicros:
            computeHostedUsageCreditProportionalReversalTarget({
              cashAmountMinor: input.purchase.cashAmountMinor,
              grantUsdMicros: input.purchase.grantUsdMicros,
              reversedCashAmountMinor: dispute.targetCashAmountMinor,
            }),
          tx: input.tx,
        }),
      });
      balanceUsdMicros = disputeReconciliation.balanceUsdMicros;
      ledgerVersion = disputeReconciliation.ledgerVersion;
    }
  }

  // Capacity is a final-state invariant: pass two may reverse a temporary
  // restoration from pass one, so do not reject an intermediate projection.
  const finalCapacity = await runHostedUsageCreditDatabaseOperation({
    read: () => readHostedUsageCreditGrantCapacityTx({
      lockedBeneficiary: {
        balanceUsdMicros,
        beneficiaryMemberId: input.purchase.beneficiaryMemberId,
        ledgerVersion,
      },
      tx: input.tx,
    }),
  });
  if (finalCapacity.state === "overflow") {
    throw buildHostedUsageCreditStripeRetryableError(
      new Error(
        "Usage-credit financial restoration exceeds occupied grant capacity.",
      ),
    );
  }

  if (
    (input.snapshot.refund?.targetCashAmountMinor ?? 0) > 0 ||
    input.snapshot.disputes.some((dispute) =>
      dispute.targetCashAmountMinor > 0
    )
  ) {
    await pauseHostedGroupSponsorshipForFinancialReversalTx({
      effectiveAt: input.effectiveAt,
      purchaseId: input.purchase.id,
      tx: input.tx,
    });
  }

  return {
    granted: grant.granted,
    wakeRequired: balanceUsdMicros > 0n,
  };
}

function computeHostedUsageCreditProportionalReversalTarget(input: {
  cashAmountMinor: number;
  grantUsdMicros: bigint;
  reversedCashAmountMinor: number;
}): bigint {
  if (
    !Number.isSafeInteger(input.cashAmountMinor) ||
    input.cashAmountMinor <= 0 ||
    !Number.isSafeInteger(input.reversedCashAmountMinor) ||
    input.reversedCashAmountMinor < 0 ||
    input.grantUsdMicros <= 0n
  ) {
    throw new Error("Usage-credit reversal amount was invalid.");
  }
  if (input.reversedCashAmountMinor === 0) {
    return 0n;
  }
  if (input.reversedCashAmountMinor >= input.cashAmountMinor) {
    return input.grantUsdMicros;
  }
  return input.grantUsdMicros * BigInt(input.reversedCashAmountMinor) /
    BigInt(input.cashAmountMinor);
}

function requireHostedUsageCreditFinancialLookupKey(value: string): string {
  const lookupKey = createHostedStripeBillingEventLookupKey(value);
  if (!lookupKey) {
    throw new Error("Usage-credit financial identity was invalid.");
  }
  return lookupKey;
}

function readStripeObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(Object.entries(value));
}

export function readHostedUsageCreditFinancialEventPaymentReferences(
  event: Stripe.Event,
): { chargeId: string | null; paymentIntentId: string | null } {
  const object = readStripeObject(event.data.object);
  return {
    chargeId: coerceStripeObjectId(
      (event.type === "charge.refunded" ? object.id : object.charge) as never,
    ),
    paymentIntentId: coerceStripeObjectId(object.payment_intent as never),
  };
}

function deriveHostedUsageCreditChargePaidAt(charge: Stripe.Charge): Date {
  if (!Number.isSafeInteger(charge.created) || charge.created <= 0) {
    throw new Error("Usage-credit Charge paid timestamp was invalid.");
  }
  return new Date(charge.created * 1000);
}

export function deriveHostedUsageCreditFinancialEffectiveAt(input: {
  event: Stripe.Event;
  snapshot: HostedUsageCreditFinancialSnapshot;
}): Date {
  const seconds = Math.max(
    input.event.created,
    input.snapshot.context.charge.created,
  );
  return Number.isSafeInteger(seconds) && seconds > 0
    ? new Date(seconds * 1000)
    : new Date();
}

function isHostedUsageCreditRefundStatus(
  status: string | null,
): status is "canceled" | "failed" | "pending" | "requires_action" | "succeeded" {
  return status === "canceled" ||
    status === "failed" ||
    status === "pending" ||
    status === "requires_action" ||
    status === "succeeded";
}

function isHostedUsageCreditActiveRefundStatus(
  status: string | null,
): status is "pending" | "requires_action" | "succeeded" {
  return status === "pending" ||
    status === "requires_action" ||
    status === "succeeded";
}

export function isHostedUsageCreditFinancialReversalEvent(type: string): boolean {
  return type === "charge.refunded" ||
    type === "refund.created" ||
    type === "refund.updated" ||
    type === "refund.failed" ||
    type === "charge.dispute.created" ||
    type === "charge.dispute.updated" ||
    type === "charge.dispute.funds_withdrawn" ||
    type === "charge.dispute.funds_reinstated" ||
    type === "charge.dispute.closed";
}

export function resolveHostedUsageCreditFinancialEventKind(
  type: string,
): "dispute" | "refund" {
  if (
    type === "charge.refunded" ||
    type === "refund.created" ||
    type === "refund.updated" ||
    type === "refund.failed"
  ) {
    return "refund";
  }
  if (type.startsWith("charge.dispute.")) {
    return "dispute";
  }
  throw new Error("Expected a usage-credit refund or dispute event.");
}
