import {
  HostedUsageCreditPurchaseStatus,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";
import type Stripe from "stripe";

import { coerceStripeObjectId } from "./billing";
import { hostedLookupKeyMatchesValue } from "./contact-privacy";
import { normalizeNullableString } from "./shared";
import {
  deriveHostedUsageCreditFinancialEffectiveAt,
  type HostedUsageCreditFinancialSnapshot,
  reconcileHostedUsageCreditFinancialSnapshotTx,
  retrieveHostedUsageCreditFinancialSnapshot,
} from "./usage-credit-stripe-financial-reconciliation";
import {
  assertHostedUsageCreditPaymentIntentMatchesPurchase,
  buildHostedUsageCreditDirectPaymentAuthorization,
  readHostedUsageCreditSavedCardPurchaseId,
} from "./usage-credit-stripe-payment-proof";
import {
  bindHostedUsageCreditStripeReferencesTx,
  buildHostedUsageCreditStripePrivateReferences,
  buildHostedUsageCreditStripeRetryableError,
  type HostedUsageCreditPurchaseForReconciliation,
  readHostedUsageCreditStripe,
  runHostedUsageCreditDatabaseOperation,
  type HostedUsageCreditStripePreparationContext,
  type HostedUsageCreditStripePrivateReferences,
} from "./usage-credit-stripe-reconciliation-context";

export type HostedUsageCreditPreparedDirectPaymentEvent = {
  paymentIntent: Stripe.PaymentIntent;
  privateReferences: HostedUsageCreditStripePrivateReferences;
  snapshot: HostedUsageCreditFinancialSnapshot | null;
};

export async function prepareHostedUsageCreditDirectPaymentEvent(input: {
  context: HostedUsageCreditStripePreparationContext;
  event: Stripe.Event;
  prisma: PrismaClient;
  purchase: HostedUsageCreditPurchaseForReconciliation;
}): Promise<HostedUsageCreditPreparedDirectPaymentEvent> {
  if (!isHostedUsageCreditDirectPaymentEvent(input.event.type)) {
    throw new Error("Expected a direct usage-credit payment event.");
  }

  const eventPaymentIntent = input.event.data.object as Stripe.PaymentIntent;
  const paymentIntentId = normalizeNullableString(eventPaymentIntent.id);
  if (!paymentIntentId) {
    throw new Error(
      "Direct usage-credit payment event did not include a PaymentIntent.",
    );
  }
  if (
    readHostedUsageCreditSavedCardPurchaseId(eventPaymentIntent.metadata) !==
      input.purchase.id
  ) {
    throw new Error(
      "Direct usage-credit payment event referenced a different purchase.",
    );
  }

  const paymentIntent = await readHostedUsageCreditStripe({
    context: input.context,
    operationName: "paymentIntents.retrieve.usage-credit-direct-reconciliation",
    read: (options) => input.context.stripe.paymentIntents.retrieve(
      paymentIntentId,
      { expand: ["latest_charge"] },
      options,
    ),
  });
  if (
    paymentIntent.id !== paymentIntentId ||
    input.event.livemode !== input.purchase.stripeLiveMode ||
    eventPaymentIntent.livemode !== input.purchase.stripeLiveMode
  ) {
    throw new Error(
      "Direct usage-credit PaymentIntent environment or identity did not match.",
    );
  }
  assertHostedUsageCreditPaymentIntentMatchesPurchase({
    paymentIntent,
    purchase: input.purchase,
  });

  const chargeId = coerceStripeObjectId(paymentIntent.latest_charge);
  const snapshot = paymentIntent.status === "succeeded"
    ? await retrieveHostedUsageCreditFinancialSnapshot({
        chargeId,
        context: input.context,
        paymentIntent,
        purchase: input.purchase,
      })
    : null;
  const privateReferences = await buildHostedUsageCreditStripePrivateReferences({
    chargeId,
    context: input.context,
    paymentIntentId: paymentIntent.id,
    prisma: input.prisma,
    purchase: input.purchase,
    sessionId: null,
  });

  return {
    paymentIntent,
    privateReferences,
    snapshot,
  };
}

export async function reconcileHostedUsageCreditDirectPaymentEventTx(input: {
  event: Stripe.Event;
  expectedReconciliationVersion: bigint;
  prepared: HostedUsageCreditPreparedDirectPaymentEvent;
  purchase: HostedUsageCreditPurchaseForReconciliation;
  tx: Prisma.TransactionClient;
}): Promise<{ granted: boolean; wakeRequired: boolean }> {
  if (!isHostedUsageCreditDirectPaymentEvent(input.event.type)) {
    throw new Error("Expected a direct usage-credit payment event.");
  }

  const eventPaymentIntent = input.event.data.object as Stripe.PaymentIntent;
  if (
    normalizeNullableString(eventPaymentIntent.id) !==
      input.prepared.paymentIntent.id ||
    input.event.livemode !== input.purchase.stripeLiveMode ||
    eventPaymentIntent.livemode !== input.purchase.stripeLiveMode ||
    readHostedUsageCreditSavedCardPurchaseId(eventPaymentIntent.metadata) !==
      input.purchase.id
  ) {
    throw new Error(
      "Direct usage-credit payment event changed before reconciliation.",
    );
  }

  const { paymentIntent, privateReferences, snapshot } = input.prepared;
  assertHostedUsageCreditPaymentIntentMatchesPurchase({
    paymentIntent,
    purchase: input.purchase,
  });
  const reconciledAt = new Date();

  if (paymentIntent.status === "succeeded") {
    if (!snapshot) {
      throw new Error(
        "Succeeded direct usage-credit payment lacked a financial snapshot.",
      );
    }
    const convergence = await reconcileHostedUsageCreditFinancialSnapshotTx({
      paymentAuthorization: buildHostedUsageCreditDirectPaymentAuthorization({
        paymentIntent,
        purchase: input.purchase,
      }),
      effectiveAt: deriveHostedUsageCreditFinancialEffectiveAt({
        event: input.event,
        snapshot,
      }),
      purchase: input.purchase,
      snapshot,
      tx: input.tx,
    });
    await bindHostedUsageCreditStripeReferencesTx({
      expectedReconciliationVersion: input.expectedReconciliationVersion,
      lastReconciledAt: reconciledAt,
      privateReferences,
      purchaseId: input.purchase.id,
      tx: input.tx,
    });
    return convergence;
  }

  if (input.purchase.status === HostedUsageCreditPurchaseStatus.fulfilled) {
    throw new Error(
      "A fulfilled usage-credit purchase no longer has a succeeded PaymentIntent.",
    );
  }

  if (paymentIntent.status === "processing") {
    await transitionHostedUsageCreditDirectPaymentTx({
      expectedReconciliationVersion: input.expectedReconciliationVersion,
      lastReconciledAt: reconciledAt,
      privateReferences,
      purchaseId: input.purchase.id,
      status: HostedUsageCreditPurchaseStatus.payment_pending,
      terminalAt: null,
      tx: input.tx,
    });
    return { granted: false, wakeRequired: false };
  }

  if (
    paymentIntent.status === "canceled" ||
    paymentIntent.status === "requires_payment_method"
  ) {
    // A failed saved-card attempt is intentionally left unattached when the
    // request can safely fall back to Checkout. Only a PaymentIntent that was
    // previously bound as processing owns the purchase state and may close it.
    if (!hostedUsageCreditPurchaseOwnsPaymentIntent({
      paymentIntentId: paymentIntent.id,
      purchase: input.purchase,
    })) {
      return { granted: false, wakeRequired: false };
    }
    await transitionHostedUsageCreditDirectPaymentTx({
      expectedReconciliationVersion: input.expectedReconciliationVersion,
      lastReconciledAt: reconciledAt,
      privateReferences,
      purchaseId: input.purchase.id,
      status: HostedUsageCreditPurchaseStatus.payment_failed,
      terminalAt: deriveStripeEventAt(input.event),
      tx: input.tx,
    });
    return { granted: false, wakeRequired: false };
  }

  throw new Error(
    `Direct usage-credit PaymentIntent had unsupported status ${paymentIntent.status}.`,
  );
}

async function transitionHostedUsageCreditDirectPaymentTx(input: {
  expectedReconciliationVersion: bigint;
  lastReconciledAt: Date;
  privateReferences: HostedUsageCreditStripePrivateReferences;
  purchaseId: string;
  status: HostedUsageCreditPurchaseStatus;
  terminalAt: Date | null;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  const updated = await runHostedUsageCreditDatabaseOperation({
    read: () => input.tx.hostedUsageCreditPurchase.updateMany({
      data: {
        lastReconciledAt: input.lastReconciledAt,
        reconciliationVersion: { increment: 1n },
        status: input.status,
        terminalAt: input.terminalAt,
        ...input.privateReferences,
      },
      where: {
        id: input.purchaseId,
        reconciliationVersion: input.expectedReconciliationVersion,
        status: {
          in: [
            HostedUsageCreditPurchaseStatus.created,
            HostedUsageCreditPurchaseStatus.payment_pending,
            HostedUsageCreditPurchaseStatus.payment_failed,
          ],
        },
      },
    }),
  });
  if (updated.count !== 1) {
    throw buildHostedUsageCreditStripeRetryableError(
      new Error(
        "Usage-credit purchase changed before direct payment reconciliation.",
      ),
    );
  }
}

function hostedUsageCreditPurchaseOwnsPaymentIntent(input: {
  paymentIntentId: string;
  purchase: HostedUsageCreditPurchaseForReconciliation;
}): boolean {
  return Boolean(
    input.purchase.stripePaymentIntentLookupKey &&
      hostedLookupKeyMatchesValue({
        expectedLookupKey: input.purchase.stripePaymentIntentLookupKey,
        kind: "stripe-billing-event",
        normalizedValue: input.paymentIntentId,
      }),
  );
}

function deriveStripeEventAt(event: Stripe.Event): Date {
  return Number.isSafeInteger(event.created) && event.created > 0
    ? new Date(event.created * 1000)
    : new Date();
}

export function isHostedUsageCreditDirectPaymentEvent(type: string): boolean {
  return type === "payment_intent.succeeded" ||
    type === "payment_intent.processing" ||
    type === "payment_intent.payment_failed" ||
    type === "payment_intent.canceled";
}
