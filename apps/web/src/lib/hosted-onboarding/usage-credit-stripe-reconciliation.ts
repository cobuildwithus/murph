import type { PrismaClient } from "@prisma/client";
import type Stripe from "stripe";

import { coerceStripeObjectId } from "./billing";
import { withHostedMemberStripeMutationLock } from "./hosted-member-billing-store";
import { requireHostedStripeApiMode } from "./runtime";
import { normalizeNullableString } from "./shared";
import {
  HOSTED_USAGE_CREDIT_CHECKOUT_PURPOSE,
  HOSTED_USAGE_CREDIT_CHECKOUT_REQUEST_POLICY_VERSION,
} from "./usage-credit-offers";
import {
  isHostedUsageCreditCheckoutEvent,
  prepareHostedUsageCreditCheckoutEvent,
  reconcileHostedUsageCreditCheckoutEventTx,
  type HostedUsageCreditPreparedCheckoutEvent,
} from "./usage-credit-stripe-checkout-reconciliation";
import {
  isHostedUsageCreditFinancialReversalEvent,
  prepareHostedUsageCreditFinancialEvent,
  readHostedUsageCreditFinancialEventPaymentReferences,
  reconcileHostedUsageCreditFinancialEventTx,
  resolveHostedUsageCreditFinancialEventKind,
  type HostedUsageCreditPreparedFinancialEvent,
} from "./usage-credit-stripe-financial-reconciliation";
import { readStringRecord } from "./usage-credit-stripe-payment-proof";
import {
  buildHostedUsageCreditStripeRetryableError,
  findHostedUsageCreditPurchaseById,
  findHostedUsageCreditPurchaseByPaymentReference,
  HOSTED_USAGE_CREDIT_PURCHASE_SELECT,
  HOSTED_USAGE_CREDIT_STRIPE_PREPARATION_BUDGET,
  HostedUsageCreditStripeRetryableError,
  isHostedUsageCreditStripeRetryableError,
  isRetryableHostedUsageCreditDependencyError,
  readHostedUsageCreditStripe,
  runHostedUsageCreditDatabaseOperation,
  throwIfHostedUsageCreditPreparationAborted,
  type HostedUsageCreditPurchaseForReconciliation,
  type HostedUsageCreditPurchaseReadClient,
  type HostedUsageCreditStripePreparationContext,
  withHostedUsageCreditStripePreparationBudget,
} from "./usage-credit-stripe-reconciliation-context";

export {
  HOSTED_USAGE_CREDIT_STRIPE_PREPARATION_BUDGET,
  HostedUsageCreditStripeRetryableError,
  isHostedUsageCreditStripeRetryableError,
};

type HostedUsageCreditStripeEventCandidate = {
  beneficiaryMemberId: string;
  eventKind: "checkout" | "dispute" | "refund";
  purchaseId: string;
};

export type HostedUsageCreditStripeReconcileResult =
  | {
      handled: false;
    }
  | {
      beneficiaryMemberId: string;
      granted: boolean;
      handled: true;
      purchaseId: string;
      wakeRequired: boolean;
    }
  | {
      beneficiaryMemberId: null;
      granted: false;
      handled: true;
      purchaseId: string;
      wakeRequired: false;
    };

type HostedUsageCreditPreparedStripeEvent =
  | {
      eventKind: "checkout";
      reconciliationVersion: bigint;
      value: HostedUsageCreditPreparedCheckoutEvent;
    }
  | {
      eventKind: "dispute" | "refund";
      reconciliationVersion: bigint;
      value: HostedUsageCreditPreparedFinancialEvent;
    };

type HostedUsageCreditPreparedReconciliation =
  | {
      kind: "handled";
      result: Extract<
        HostedUsageCreditStripeReconcileResult,
        { beneficiaryMemberId: null }
      >;
    }
  | {
      kind: "unhandled";
    }
  | {
      candidate: HostedUsageCreditStripeEventCandidate;
      kind: "prepared";
      prepared: HostedUsageCreditPreparedStripeEvent;
    };

export async function reconcileHostedUsageCreditStripeEvent(input: {
  event: Stripe.Event;
  prisma: PrismaClient;
}): Promise<HostedUsageCreditStripeReconcileResult> {
  const stripeMode = shouldGuardHostedUsageCreditStripeEvent(input.event)
    ? requireHostedStripeApiMode()
    : null;
  if (!stripeMode) {
    return { handled: false };
  }
  if (stripeMode.stripeLiveMode !== input.event.livemode) {
    throw new Error("Usage-credit Stripe event environment did not match.");
  }
  const preparation = await withHostedUsageCreditStripePreparationBudget({
    run: (context) => prepareHostedUsageCreditStripeReconciliation({
      context,
      event: input.event,
      prisma: input.prisma,
    }),
    stripe: stripeMode.stripe,
  });
  if (preparation.kind === "handled") {
    return preparation.result;
  }
  if (preparation.kind === "unhandled") {
    return { handled: false };
  }
  const { candidate, prepared } = preparation;

  let reconciliation: Awaited<
    ReturnType<typeof reconcileHostedUsageCreditCheckoutEventTx>
  >;
  try {
    reconciliation = await withHostedMemberStripeMutationLock({
      memberId: candidate.beneficiaryMemberId,
      prisma: input.prisma,
      run: async (tx) => {
        const purchase = await runHostedUsageCreditDatabaseOperation({
          read: () => tx.hostedUsageCreditPurchase.findUnique({
            select: HOSTED_USAGE_CREDIT_PURCHASE_SELECT,
            where: {
              id: candidate.purchaseId,
            },
          }),
        });
        if (
          !purchase ||
          purchase.beneficiaryMemberId !== candidate.beneficiaryMemberId
        ) {
          throw new Error(
            "Usage-credit purchase ownership changed before Stripe reconciliation.",
          );
        }
        if (
          purchase.reconciliationVersion !== prepared.reconciliationVersion
        ) {
          throw buildHostedUsageCreditStripeRetryableError(
            new Error(
              "Usage-credit Stripe preparation became stale before reconciliation.",
            ),
          );
        }

        return prepared.eventKind === "checkout"
          ? reconcileHostedUsageCreditCheckoutEventTx({
              event: input.event,
              expectedReconciliationVersion: prepared.reconciliationVersion,
              prepared: prepared.value,
              purchase,
              tx,
            })
          : reconcileHostedUsageCreditFinancialEventTx({
              event: input.event,
              eventKind: prepared.eventKind,
              expectedReconciliationVersion: prepared.reconciliationVersion,
              prepared: prepared.value,
              purchase,
              tx,
            });
      },
    });
  } catch (error) {
    if (isRetryableHostedUsageCreditDependencyError(error)) {
      throw buildHostedUsageCreditStripeRetryableError(error);
    }
    throw error;
  }

  return {
    beneficiaryMemberId: candidate.beneficiaryMemberId,
    granted: reconciliation.granted,
    handled: true,
    purchaseId: candidate.purchaseId,
    wakeRequired: reconciliation.wakeRequired,
  };
}

async function prepareHostedUsageCreditStripeReconciliation(input: {
  context: HostedUsageCreditStripePreparationContext;
  event: Stripe.Event;
  prisma: PrismaClient;
}): Promise<HostedUsageCreditPreparedReconciliation> {
  const deletedExpiredCheckout =
    await reconcileDeletedExpiredUsageCreditCheckout({
      context: input.context,
      event: input.event,
      prisma: input.prisma,
    });
  if (deletedExpiredCheckout) {
    return { kind: "handled", result: deletedExpiredCheckout };
  }
  const candidate = await resolveHostedUsageCreditStripeEventCandidate({
    context: input.context,
    event: input.event,
    prisma: input.prisma,
  });
  if (!candidate) {
    return { kind: "unhandled" };
  }
  const purchase = await findHostedUsageCreditPurchaseById({
    prisma: input.prisma,
    purchaseId: candidate.purchaseId,
  });
  throwIfHostedUsageCreditPreparationAborted(input.context.signal);
  if (purchase.beneficiaryMemberId !== candidate.beneficiaryMemberId) {
    throw new Error(
      "Usage-credit purchase ownership changed before Stripe preparation.",
    );
  }
  return {
    candidate,
    kind: "prepared",
    prepared: await prepareHostedUsageCreditStripeEvent({
      candidate,
      context: input.context,
      event: input.event,
      prisma: input.prisma,
      purchase,
    }),
  };
}

async function reconcileDeletedExpiredUsageCreditCheckout(input: {
  context: HostedUsageCreditStripePreparationContext;
  event: Stripe.Event;
  prisma: HostedUsageCreditPurchaseReadClient;
}): Promise<Extract<
  HostedUsageCreditStripeReconcileResult,
  { beneficiaryMemberId: null }
> | null> {
  if (input.event.type !== "checkout.session.expired") {
    return null;
  }
  const eventSession = input.event.data.object as Stripe.Checkout.Session;
  if (
    normalizeNullableString(eventSession.metadata?.purpose) !==
      HOSTED_USAGE_CREDIT_CHECKOUT_PURPOSE
  ) {
    return null;
  }
  const purchaseId = readHostedUsageCreditPurchaseIdFromMetadata(
    eventSession.metadata,
  );
  const purchase = await runHostedUsageCreditDatabaseOperation({
    read: () => input.prisma.hostedUsageCreditPurchase.findUnique({
      select: { id: true },
      where: { id: purchaseId },
    }),
  });
  if (purchase) {
    return null;
  }

  const sessionId = normalizeNullableString(eventSession.id);
  if (!sessionId) {
    throw new Error("Deleted usage-credit expiry did not include a Session.");
  }
  const session = await readHostedUsageCreditStripe({
    context: input.context,
    read: (options) =>
      input.context.stripe.checkout.sessions.retrieve(
        sessionId,
        undefined,
        options,
      ),
  });
  const expectedMetadata = {
    policyVersion: HOSTED_USAGE_CREDIT_CHECKOUT_REQUEST_POLICY_VERSION,
    purchaseId,
    purpose: HOSTED_USAGE_CREDIT_CHECKOUT_PURPOSE,
  };
  const eventMetadata = readStringRecord(eventSession.metadata);
  const liveMetadata = readStringRecord(session.metadata);
  const metadataMatches = (metadata: Record<string, string> | null) =>
    metadata !== null &&
    Object.keys(metadata).length === Object.keys(expectedMetadata).length &&
    Object.entries(expectedMetadata).every(
      ([key, value]) => metadata[key] === value,
    );
  if (
    normalizeNullableString(session.id) !== sessionId ||
    eventSession.livemode !== input.event.livemode ||
    session.livemode !== input.event.livemode ||
    session.mode !== "payment" ||
    session.status !== "expired" ||
    session.payment_status !== "unpaid" ||
    normalizeNullableString(eventSession.client_reference_id) !== purchaseId ||
    normalizeNullableString(session.client_reference_id) !== purchaseId ||
    !metadataMatches(eventMetadata) ||
    !metadataMatches(liveMetadata)
  ) {
    throw new Error(
      "Deleted usage-credit Checkout did not have safe expired state.",
    );
  }
  return {
    beneficiaryMemberId: null,
    granted: false,
    handled: true,
    purchaseId,
    wakeRequired: false,
  };
}

async function resolveHostedUsageCreditStripeEventCandidate(input: {
  context: HostedUsageCreditStripePreparationContext;
  event: Stripe.Event;
  prisma: HostedUsageCreditPurchaseReadClient;
}): Promise<HostedUsageCreditStripeEventCandidate | null> {
  if (isHostedUsageCreditCheckoutEvent(input.event.type)) {
    const session = input.event.data.object as Stripe.Checkout.Session;
    if (
      normalizeNullableString(session.metadata?.purpose) !==
      HOSTED_USAGE_CREDIT_CHECKOUT_PURPOSE
    ) {
      return null;
    }

    const purchaseId = readHostedUsageCreditPurchaseIdFromMetadata(
      session.metadata,
    );
    const purchase = await findHostedUsageCreditPurchaseById({
      prisma: input.prisma,
      purchaseId,
    });
    return {
      beneficiaryMemberId: purchase.beneficiaryMemberId,
      eventKind: "checkout",
      purchaseId: purchase.id,
    };
  }

  if (!isHostedUsageCreditFinancialReversalEvent(input.event.type)) {
    return null;
  }

  const {
    chargeId,
    paymentIntentId: eventPaymentIntentId,
  } = readHostedUsageCreditFinancialEventPaymentReferences(input.event);
  const indexedPurchase = await findHostedUsageCreditPurchaseByPaymentReference({
    chargeId,
    paymentIntentId: eventPaymentIntentId,
    prisma: input.prisma,
  });
  if (indexedPurchase) {
    return {
      beneficiaryMemberId: indexedPurchase.beneficiaryMemberId,
      eventKind: resolveHostedUsageCreditFinancialEventKind(input.event.type),
      purchaseId: indexedPurchase.id,
    };
  }

  const charge = chargeId
    ? await readHostedUsageCreditStripe({
        context: input.context,
        read: (options) =>
          input.context.stripe.charges.retrieve(chargeId, undefined, options),
      })
    : null;
  const paymentIntentId = eventPaymentIntentId ?? coerceStripeObjectId(
    charge?.payment_intent,
  );
  const paymentIntent = paymentIntentId
    ? await readHostedUsageCreditStripe({
        context: input.context,
        read: (options) =>
          input.context.stripe.paymentIntents.retrieve(
            paymentIntentId,
            undefined,
            options,
          ),
      })
    : null;
  const metadata = paymentIntent?.metadata ?? charge?.metadata;
  if (
    normalizeNullableString(metadata?.purpose) !==
    HOSTED_USAGE_CREDIT_CHECKOUT_PURPOSE
  ) {
    return null;
  }

  const purchaseId = readHostedUsageCreditPurchaseIdFromMetadata(metadata);
  const purchase = await findHostedUsageCreditPurchaseById({
    prisma: input.prisma,
    purchaseId,
  });
  return {
    beneficiaryMemberId: purchase.beneficiaryMemberId,
    eventKind: resolveHostedUsageCreditFinancialEventKind(input.event.type),
    purchaseId: purchase.id,
  };
}

async function prepareHostedUsageCreditStripeEvent(input: {
  candidate: HostedUsageCreditStripeEventCandidate;
  context: HostedUsageCreditStripePreparationContext;
  event: Stripe.Event;
  prisma: PrismaClient;
  purchase: HostedUsageCreditPurchaseForReconciliation;
}): Promise<HostedUsageCreditPreparedStripeEvent> {
  if (input.candidate.eventKind === "checkout") {
    return {
      eventKind: "checkout",
      reconciliationVersion: input.purchase.reconciliationVersion,
      value: await prepareHostedUsageCreditCheckoutEvent({
        context: input.context,
        event: input.event,
        prisma: input.prisma,
        purchase: input.purchase,
      }),
    };
  }
  return {
    eventKind: input.candidate.eventKind,
    reconciliationVersion: input.purchase.reconciliationVersion,
    value: await prepareHostedUsageCreditFinancialEvent({
      context: input.context,
      event: input.event,
      eventKind: input.candidate.eventKind,
      prisma: input.prisma,
      purchase: input.purchase,
    }),
  };
}

function readHostedUsageCreditPurchaseIdFromMetadata(
  metadata: Stripe.Metadata | null | undefined,
): string {
  const purchaseId = normalizeNullableString(metadata?.purchaseId);
  if (!purchaseId) {
    throw new Error("Stripe usage-credit metadata did not include a purchase.");
  }
  return purchaseId;
}

function shouldGuardHostedUsageCreditStripeEvent(event: Stripe.Event): boolean {
  if (isHostedUsageCreditFinancialReversalEvent(event.type)) {
    return true;
  }
  if (!isHostedUsageCreditCheckoutEvent(event.type)) {
    return false;
  }
  const session = event.data.object as Stripe.Checkout.Session;
  return normalizeNullableString(session.metadata?.purpose) ===
    HOSTED_USAGE_CREDIT_CHECKOUT_PURPOSE;
}
