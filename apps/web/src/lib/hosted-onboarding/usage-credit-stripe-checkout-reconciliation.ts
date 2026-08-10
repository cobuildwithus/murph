import {
  HostedUsageCreditPurchaseStatus,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";
import type Stripe from "stripe";

import { coerceStripeObjectId } from "./billing";
import { normalizeNullableString } from "./shared";
import {
  deriveHostedUsageCreditFinancialEffectiveAt,
  type HostedUsageCreditFinancialSnapshot,
  reconcileHostedUsageCreditFinancialSnapshotTx,
  retrieveHostedUsageCreditFinancialSnapshot,
} from "./usage-credit-stripe-financial-reconciliation";
import {
  assertHostedStripeLookupMatches,
  assertHostedUsageCreditPaymentIdentity,
  assertHostedUsageCreditSession,
  buildHostedUsageCreditPaidCheckoutAuthorization,
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

export type HostedUsageCreditPreparedCheckoutEvent = {
  chargeId: string | null;
  lineItems: Stripe.ApiList<Stripe.LineItem>;
  paymentIntent: Stripe.PaymentIntent | null;
  paymentIntentId: string | null;
  privateReferences: HostedUsageCreditStripePrivateReferences;
  session: Stripe.Checkout.Session;
  sessionId: string;
  snapshot: HostedUsageCreditFinancialSnapshot | null;
};

export async function prepareHostedUsageCreditCheckoutEvent(input: {
  context: HostedUsageCreditStripePreparationContext;
  event: Stripe.Event;
  prisma: PrismaClient;
  purchase: HostedUsageCreditPurchaseForReconciliation;
}): Promise<HostedUsageCreditPreparedCheckoutEvent> {
  if (!isHostedUsageCreditCheckoutEvent(input.event.type)) {
    throw new Error("Expected a usage-credit Checkout event.");
  }

  const eventSession = input.event.data.object as Stripe.Checkout.Session;
  const sessionId = normalizeNullableString(eventSession.id);
  if (!sessionId) {
    throw new Error("Usage-credit Checkout event did not include a Session.");
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
  assertHostedUsageCreditSession({
    allowExpiredSession: input.event.type === "checkout.session.expired",
    eventLiveMode: input.event.livemode,
    lineItems,
    purchase: input.purchase,
    session,
  });

  const paymentIntentId = coerceStripeObjectId(session.payment_intent);
  const paymentIntent = paymentIntentId
    ? await readHostedUsageCreditStripe({
        context: input.context,
        operationName: "paymentIntents.retrieve.usage-credit-reconciliation",
        read: (options) => input.context.stripe.paymentIntents.retrieve(
          paymentIntentId,
          { expand: ["latest_charge"] },
          options,
        ),
      })
    : null;
  const chargeId = paymentIntent
    ? coerceStripeObjectId(paymentIntent.latest_charge)
    : null;
  assertHostedUsageCreditPaymentIdentity({
    paymentIntent,
    paymentIntentId,
    purchase: input.purchase,
    session,
  });

  let snapshot: HostedUsageCreditFinancialSnapshot | null = null;
  if (session.payment_status === "paid") {
    if (!paymentIntent || paymentIntent.status !== "succeeded" || !chargeId) {
      throw new Error(
        "Paid usage-credit Checkout Session did not have a succeeded payment Charge.",
      );
    }
    buildHostedUsageCreditPaidCheckoutAuthorization({
      paymentIntent,
      purchase: input.purchase,
      session,
    });
    snapshot = await retrieveHostedUsageCreditFinancialSnapshot({
      chargeId,
      context: input.context,
      paymentIntent,
      purchase: input.purchase,
    });
  }
  const privateReferences = await buildHostedUsageCreditStripePrivateReferences({
    chargeId,
    context: input.context,
    paymentIntentId,
    prisma: input.prisma,
    purchase: input.purchase,
    sessionId,
  });

  return {
    chargeId,
    lineItems,
    paymentIntent,
    paymentIntentId,
    privateReferences,
    session,
    sessionId,
    snapshot,
  };
}

export async function reconcileHostedUsageCreditCheckoutEventTx(input: {
  event: Stripe.Event;
  expectedReconciliationVersion: bigint;
  prepared: HostedUsageCreditPreparedCheckoutEvent;
  purchase: HostedUsageCreditPurchaseForReconciliation;
  tx: Prisma.TransactionClient;
}): Promise<{ granted: boolean; wakeRequired: boolean }> {
  if (!isHostedUsageCreditCheckoutEvent(input.event.type)) {
    throw new Error("Expected a usage-credit Checkout event.");
  }

  const eventSession = input.event.data.object as Stripe.Checkout.Session;
  const sessionId = normalizeNullableString(eventSession.id);
  if (!sessionId || sessionId !== input.prepared.sessionId) {
    throw new Error("Usage-credit Checkout event did not include a Session.");
  }
  if (input.purchase.stripeCheckoutSessionLookupKey) {
    assertHostedStripeLookupMatches({
      expectedLookupKey: input.purchase.stripeCheckoutSessionLookupKey,
      kind: "stripe-checkout-session",
      value: sessionId,
    });
  }

  const {
    chargeId,
    lineItems,
    paymentIntent,
    paymentIntentId,
    privateReferences,
    session,
    snapshot,
  } = input.prepared;
  assertHostedUsageCreditSession({
    allowExpiredSession: input.event.type === "checkout.session.expired",
    eventLiveMode: input.event.livemode,
    lineItems,
    purchase: input.purchase,
    session,
  });
  assertHostedUsageCreditPaymentIdentity({
    paymentIntent,
    paymentIntentId,
    purchase: input.purchase,
    session,
  });

  const reconciledAt = new Date();
  if (input.purchase.grantSlotReleasedAt !== null) {
    if (
      input.purchase.status !== HostedUsageCreditPurchaseStatus.expired ||
      session.status !== "expired" ||
      session.payment_status !== "unpaid"
    ) {
      throw new Error(
        "Provider-final usage-credit Checkout release contradicted live Stripe state.",
      );
    }
    await bindHostedUsageCreditStripeReferencesTx({
      expectedReconciliationVersion: input.expectedReconciliationVersion,
      lastReconciledAt: reconciledAt,
      privateReferences,
      purchaseId: input.purchase.id,
      tx: input.tx,
    });
    return { granted: false, wakeRequired: false };
  }

  if (session.payment_status === "paid") {
    if (!paymentIntent || paymentIntent.status !== "succeeded" || !chargeId) {
      throw new Error(
        "Paid usage-credit Checkout Session did not have a succeeded payment Charge.",
      );
    }
    const checkoutAuthorization = buildHostedUsageCreditPaidCheckoutAuthorization({
      paymentIntent,
      purchase: input.purchase,
      session,
    });
    if (!snapshot) {
      throw new Error("Paid usage-credit Checkout lacked a financial snapshot.");
    }
    const convergence = await reconcileHostedUsageCreditFinancialSnapshotTx({
      paymentAuthorization: checkoutAuthorization,
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

  if (input.event.type === "checkout.session.async_payment_succeeded") {
    throw new Error(
      "Stripe reported asynchronous payment success before live Checkout became paid.",
    );
  }
  if (input.purchase.status === HostedUsageCreditPurchaseStatus.fulfilled) {
    throw new Error(
      "A fulfilled usage-credit purchase no longer has paid Checkout state.",
    );
  }

  if (input.event.type === "checkout.session.expired") {
    // Stripe's live `expired` Session state is terminal for this exact Checkout
    // authority. Payment failure alone is recoverable and never writes release.
    if (
      session.status !== "expired" ||
      session.payment_status !== "unpaid"
    ) {
      throw new Error(
        "Stripe reported Checkout expiry without provider-final unpaid state.",
      );
    }
    await transitionHostedUsageCreditCheckoutTx({
      expectedReconciliationVersion: input.expectedReconciliationVersion,
      grantSlotReleasedAt: reconciledAt,
      lastReconciledAt: reconciledAt,
      privateReferences,
      purchaseId: input.purchase.id,
      status: HostedUsageCreditPurchaseStatus.expired,
      terminalAt: deriveStripeEventAt(input.event),
      tx: input.tx,
    });
    return { granted: false, wakeRequired: false };
  }
  if (
    input.purchase.status === HostedUsageCreditPurchaseStatus.payment_failed
  ) {
    await bindHostedUsageCreditStripeReferencesTx({
      expectedReconciliationVersion: input.expectedReconciliationVersion,
      lastReconciledAt: reconciledAt,
      privateReferences,
      purchaseId: input.purchase.id,
      tx: input.tx,
    });
    return { granted: false, wakeRequired: false };
  }

  if (input.event.type === "checkout.session.async_payment_failed") {
    if (paymentIntent?.status === "succeeded") {
      throw new Error(
        "Stripe reported asynchronous payment failure for a succeeded PaymentIntent.",
      );
    }
    await transitionHostedUsageCreditCheckoutTx({
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

  await transitionHostedUsageCreditCheckoutTx({
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

async function transitionHostedUsageCreditCheckoutTx(input: {
  expectedReconciliationVersion: bigint;
  grantSlotReleasedAt?: Date;
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
        ...(input.grantSlotReleasedAt
          ? { grantSlotReleasedAt: input.grantSlotReleasedAt }
          : {}),
        lastReconciledAt: input.lastReconciledAt,
        reconciliationVersion: {
          increment: 1n,
        },
        status: input.status,
        terminalAt: input.terminalAt,
        ...input.privateReferences,
      },
      where: {
        id: input.purchaseId,
        ...(input.grantSlotReleasedAt
          ? { grantSlotReleasedAt: null }
          : {}),
        reconciliationVersion: input.expectedReconciliationVersion,
        status: {
          in: [
            HostedUsageCreditPurchaseStatus.created,
            HostedUsageCreditPurchaseStatus.checkout_open,
            HostedUsageCreditPurchaseStatus.payment_pending,
            HostedUsageCreditPurchaseStatus.expired,
            HostedUsageCreditPurchaseStatus.payment_failed,
          ],
        },
      },
    }),
  });
  if (updated.count !== 1) {
    throw buildHostedUsageCreditStripeRetryableError(
      new Error(
        "Usage-credit purchase changed before Checkout reconciliation.",
      ),
    );
  }
}

function deriveStripeEventAt(event: Stripe.Event): Date {
  return Number.isFinite(event.created)
    ? new Date(event.created * 1000)
    : new Date();
}

export function isHostedUsageCreditCheckoutEvent(type: string): boolean {
  return type === "checkout.session.completed" ||
    type === "checkout.session.async_payment_succeeded" ||
    type === "checkout.session.async_payment_failed" ||
    type === "checkout.session.expired";
}
