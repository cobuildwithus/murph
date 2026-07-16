import {
  HostedUsageCreditPurchaseStatus,
  Prisma,
  type PrismaClient,
} from "@prisma/client";
import type Stripe from "stripe";

import {
  grantHostedUsageCreditForPurchaseTx,
  reconcileHostedUsageCreditDisputeNetReversalTx,
  reconcileHostedUsageCreditRefundNetReversalTx,
} from "../hosted-execution/usage-credits";
import {
  coerceStripeObjectId,
  readStripeShouldRetryDirective,
} from "./billing";
import {
  createHostedStripeBillingEventLookupKey,
  createHostedStripeBillingEventLookupKeyReadCandidates,
  createHostedStripeCheckoutSessionLookupKey,
  hostedLookupKeyMatchesValue,
} from "./contact-privacy";
import { withHostedMemberStripeMutationLock } from "./hosted-member-billing-store";
import { isHostedOnboardingError } from "./errors";
import { normalizeNullableString } from "./shared";
import { requireHostedStripeApiMode } from "./runtime";
import {
  decryptHostedUsageCreditPurchaseStripeField,
  encryptHostedUsageCreditPurchaseStripeField,
  HOSTED_USAGE_CREDIT_PURCHASE_STRIPE_PRIVATE_FIELDS,
  type HostedUsageCreditPurchaseStripePrivateField,
} from "./usage-credit-purchase-service";
import {
  HOSTED_USAGE_CREDIT_CHECKOUT_PURPOSE,
  HOSTED_USAGE_CREDIT_CHECKOUT_REQUEST_POLICY_VERSION,
} from "./usage-credit-offers";

const HOSTED_USAGE_CREDIT_STRIPE_READ_TIMEOUT_MS = 15_000;
const HOSTED_USAGE_CREDIT_STRIPE_MAX_READS = 10;
const HOSTED_USAGE_CREDIT_KMS_OPERATION_TIMEOUT_MS = 30_000;
const HOSTED_USAGE_CREDIT_KMS_MAX_OPERATIONS = 4;
const HOSTED_USAGE_CREDIT_PREPARATION_LOCAL_MARGIN_MS = 30_000;
const HOSTED_USAGE_CREDIT_STRIPE_RETRYABLE_ERROR_CODE =
  "HOSTED_USAGE_CREDIT_STRIPE_RECONCILIATION_RETRYABLE";
const HOSTED_USAGE_CREDIT_RETRYABLE_PRISMA_CODES = new Set([
  "P1001",
  "P1002",
  "P1008",
  "P1017",
  "P2024",
  "P2028",
  "P2034",
  "P2037",
]);
const HOSTED_USAGE_CREDIT_RETRYABLE_POSTGRES_CODES = new Set([
  "08006",
  "40001",
  "40P01",
  "55P03",
  "57014",
  "57P01",
]);

export const HOSTED_USAGE_CREDIT_STRIPE_PREPARATION_BUDGET = {
  kmsMaxOperations: HOSTED_USAGE_CREDIT_KMS_MAX_OPERATIONS,
  kmsOperationTimeoutMs: HOSTED_USAGE_CREDIT_KMS_OPERATION_TIMEOUT_MS,
  localMarginMs: HOSTED_USAGE_CREDIT_PREPARATION_LOCAL_MARGIN_MS,
  stripeMaxReads: HOSTED_USAGE_CREDIT_STRIPE_MAX_READS,
  stripeReadTimeoutMs: HOSTED_USAGE_CREDIT_STRIPE_READ_TIMEOUT_MS,
  timeoutMs:
    HOSTED_USAGE_CREDIT_STRIPE_MAX_READS *
      HOSTED_USAGE_CREDIT_STRIPE_READ_TIMEOUT_MS +
    HOSTED_USAGE_CREDIT_KMS_MAX_OPERATIONS *
      HOSTED_USAGE_CREDIT_KMS_OPERATION_TIMEOUT_MS +
    HOSTED_USAGE_CREDIT_PREPARATION_LOCAL_MARGIN_MS,
} as const;

const HOSTED_USAGE_CREDIT_STRIPE_READ_OPTIONS = {
  maxNetworkRetries: 0,
  timeout: HOSTED_USAGE_CREDIT_STRIPE_READ_TIMEOUT_MS,
} as const satisfies Stripe.RequestOptions;

const HOSTED_USAGE_CREDIT_PURCHASE_SELECT = {
  beneficiaryMemberId: true,
  cashAmountMinor: true,
  cashCurrency: true,
  checkoutCancelUrl: true,
  checkoutExpiresAt: true,
  checkoutRequestPolicyVersion: true,
  checkoutSuccessUrl: true,
  createdAt: true,
  grantUsdMicros: true,
  id: true,
  payerMemberId: true,
  reconciliationVersion: true,
  status: true,
  stripeChargeLookupKey: true,
  stripeCheckoutSessionIdEncrypted: true,
  stripeCheckoutSessionLookupKey: true,
  stripeCustomerLookupKey: true,
  stripeLiveMode: true,
  stripePaymentIntentLookupKey: true,
  stripePriceLookupKey: true,
} as const satisfies Prisma.HostedUsageCreditPurchaseSelect;

type HostedUsageCreditPurchaseForReconciliation =
  Prisma.HostedUsageCreditPurchaseGetPayload<{
    select: typeof HOSTED_USAGE_CREDIT_PURCHASE_SELECT;
  }>;

type HostedUsageCreditPurchaseReadClient =
  | PrismaClient
  | Prisma.TransactionClient;

type HostedUsageCreditStripeEventCandidate = {
  beneficiaryMemberId: string;
  eventKind: "checkout" | "dispute" | "refund";
  purchaseId: string;
};

type HostedUsageCreditStripePreparationContext = {
  kmsOperationCount: number;
  signal: AbortSignal;
  stripe: Stripe;
  stripeReadCount: number;
};

type HostedUsageCreditChargeContext = {
  charge: Stripe.Charge;
  paymentIntent: Stripe.PaymentIntent;
};

type HostedUsageCreditRefundExposure = {
  refundIds: string[];
  sourceReferenceId: string;
  targetCashAmountMinor: number;
};

type HostedUsageCreditDisputeExposure = {
  disputeId: string;
  targetCashAmountMinor: number;
};

type HostedUsageCreditFinancialSnapshot = {
  context: HostedUsageCreditChargeContext;
  disputes: HostedUsageCreditDisputeExposure[];
  refund: HostedUsageCreditRefundExposure | null;
};

type HostedUsageCreditPaidCheckoutAuthorization = {
  paymentIntentId: string;
  purchaseId: string;
  sessionId: string;
};

type HostedUsageCreditPreparedPaidCheckout = {
  lineItems: Stripe.ApiList<Stripe.LineItem>;
  paymentIntent: Stripe.PaymentIntent;
  session: Stripe.Checkout.Session;
};

type HostedUsageCreditPreparedCheckoutEvent = {
  chargeId: string | null;
  lineItems: Stripe.ApiList<Stripe.LineItem>;
  paymentIntent: Stripe.PaymentIntent | null;
  paymentIntentId: string | null;
  privateReferences: Awaited<
    ReturnType<typeof buildHostedUsageCreditStripePrivateReferences>
  >;
  session: Stripe.Checkout.Session;
  sessionId: string;
  snapshot: HostedUsageCreditFinancialSnapshot | null;
};

type HostedUsageCreditPreparedFinancialEvent = {
  paidCheckout: HostedUsageCreditPreparedPaidCheckout;
  privateReferences: Awaited<
    ReturnType<typeof buildHostedUsageCreditStripePrivateReferences>
  >;
  snapshot: HostedUsageCreditFinancialSnapshot;
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

export class HostedUsageCreditStripeRetryableError extends Error {
  readonly code = HOSTED_USAGE_CREDIT_STRIPE_RETRYABLE_ERROR_CODE;

  constructor(cause: unknown) {
    super(
      cause instanceof Error
        ? cause.message
        : "Usage-credit Stripe reconciliation must be retried.",
      { cause },
    );
    this.name = "HostedUsageCreditStripeRetryableError";
  }
}

export function isHostedUsageCreditStripeRetryableError(
  error: unknown,
): error is HostedUsageCreditStripeRetryableError {
  return error instanceof HostedUsageCreditStripeRetryableError;
}

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

async function withHostedUsageCreditStripePreparationBudget<TResult>(input: {
  run: (
    context: HostedUsageCreditStripePreparationContext,
  ) => Promise<TResult>;
  stripe: Stripe;
}): Promise<TResult> {
  const controller = new AbortController();
  const timeoutError = buildHostedUsageCreditStripeRetryableError(
    new Error(
      "Usage-credit Stripe preparation exceeded its bounded read budget.",
    ),
  );
  timeoutError.name = "HostedUsageCreditStripePreparationTimeoutError";
  const timeout = setTimeout(() => {
    controller.abort(timeoutError);
  }, HOSTED_USAGE_CREDIT_STRIPE_PREPARATION_BUDGET.timeoutMs);
  const rejectOnAbort = new Promise<never>((_resolve, reject) => {
    controller.signal.addEventListener("abort", () => {
      reject(controller.signal.reason ?? timeoutError);
    }, { once: true });
  });
  const context: HostedUsageCreditStripePreparationContext = {
    kmsOperationCount: 0,
    signal: controller.signal,
    stripe: input.stripe,
    stripeReadCount: 0,
  };

  try {
    return await Promise.race([
      input.run(context),
      rejectOnAbort,
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function readHostedUsageCreditStripe<TResult>(input: {
  context: HostedUsageCreditStripePreparationContext;
  read: (options: Stripe.RequestOptions) => Promise<TResult>;
}): Promise<TResult> {
  throwIfHostedUsageCreditPreparationAborted(input.context.signal);
  input.context.stripeReadCount += 1;
  if (
    input.context.stripeReadCount >
      HOSTED_USAGE_CREDIT_STRIPE_PREPARATION_BUDGET.stripeMaxReads
  ) {
    throw buildHostedUsageCreditStripeRetryableError(
      new Error(
        "Usage-credit Stripe preparation exceeded its maximum read count.",
      ),
    );
  }
  let result: TResult;
  try {
    result = await input.read(HOSTED_USAGE_CREDIT_STRIPE_READ_OPTIONS);
  } catch (error) {
    if (isDefinitiveHostedUsageCreditStripeRequestRejection(error)) {
      throw error;
    }
    throw buildHostedUsageCreditStripeRetryableError(error);
  }
  throwIfHostedUsageCreditPreparationAborted(input.context.signal);
  return result;
}

function takeHostedUsageCreditKmsSignal(
  context: HostedUsageCreditStripePreparationContext,
): AbortSignal {
  throwIfHostedUsageCreditPreparationAborted(context.signal);
  context.kmsOperationCount += 1;
  if (
    context.kmsOperationCount >
      HOSTED_USAGE_CREDIT_STRIPE_PREPARATION_BUDGET.kmsMaxOperations
  ) {
    throw buildHostedUsageCreditStripeRetryableError(
      new Error(
        "Usage-credit Stripe preparation exceeded its maximum KMS operation count.",
      ),
    );
  }
  return AbortSignal.any([
    context.signal,
    AbortSignal.timeout(
      HOSTED_USAGE_CREDIT_STRIPE_PREPARATION_BUDGET.kmsOperationTimeoutMs,
    ),
  ]);
}

function throwIfHostedUsageCreditPreparationAborted(signal: AbortSignal): void {
  if (!signal.aborted) {
    return;
  }
  if (signal.reason instanceof Error) {
    throw signal.reason;
  }
  throw new Error("Usage-credit Stripe preparation was aborted.");
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

async function findHostedUsageCreditPurchaseById(input: {
  prisma: HostedUsageCreditPurchaseReadClient;
  purchaseId: string;
}): Promise<HostedUsageCreditPurchaseForReconciliation> {
  const purchase = await runHostedUsageCreditDatabaseOperation({
    read: () => input.prisma.hostedUsageCreditPurchase.findUnique({
      select: HOSTED_USAGE_CREDIT_PURCHASE_SELECT,
      where: {
        id: input.purchaseId,
      },
    }),
  });
  if (!purchase) {
    throw new Error("Stripe referenced an unknown usage-credit purchase.");
  }
  return purchase;
}

async function findHostedUsageCreditPurchaseByPaymentReference(input: {
  chargeId: string | null;
  paymentIntentId: string | null;
  prisma: HostedUsageCreditPurchaseReadClient;
}): Promise<HostedUsageCreditPurchaseForReconciliation | null> {
  const chargeLookupKeys =
    createHostedStripeBillingEventLookupKeyReadCandidates(input.chargeId);
  const paymentIntentLookupKeys =
    createHostedStripeBillingEventLookupKeyReadCandidates(
      input.paymentIntentId,
    );
  const conditions: Prisma.HostedUsageCreditPurchaseWhereInput[] = [];
  if (chargeLookupKeys.length > 0) {
    conditions.push({
      stripeChargeLookupKey: {
        in: chargeLookupKeys,
      },
    });
  }
  if (paymentIntentLookupKeys.length > 0) {
    conditions.push({
      stripePaymentIntentLookupKey: {
        in: paymentIntentLookupKeys,
      },
    });
  }
  if (conditions.length === 0) {
    return null;
  }

  const purchases = await runHostedUsageCreditDatabaseOperation({
    read: () => input.prisma.hostedUsageCreditPurchase.findMany({
      select: HOSTED_USAGE_CREDIT_PURCHASE_SELECT,
      take: 2,
      where: {
        OR: conditions,
      },
    }),
  });
  if (purchases.length > 1) {
    throw new Error(
      "Stripe payment identity matched multiple usage-credit purchases.",
    );
  }
  return purchases[0] ?? null;
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

async function prepareHostedUsageCreditCheckoutEvent(input: {
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
      read: (options) => input.context.stripe.checkout.sessions.retrieve(
        sessionId,
        undefined,
        options,
      ),
    }),
    readHostedUsageCreditStripe({
      context: input.context,
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

async function reconcileHostedUsageCreditCheckoutEventTx(input: {
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
      checkoutAuthorization,
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
  if (
    input.purchase.status === HostedUsageCreditPurchaseStatus.payment_failed ||
    input.purchase.status === HostedUsageCreditPurchaseStatus.expired
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
  if (input.purchase.status === HostedUsageCreditPurchaseStatus.fulfilled) {
    throw new Error(
      "A fulfilled usage-credit purchase no longer has paid Checkout state.",
    );
  }

  if (input.event.type === "checkout.session.expired") {
    if (session.status !== "expired") {
      throw new Error(
        "Stripe reported Checkout expiry before the live Session expired.",
      );
    }
    await transitionHostedUsageCreditCheckoutTx({
      expectedReconciliationVersion: input.expectedReconciliationVersion,
      lastReconciledAt: reconciledAt,
      privateReferences,
      purchaseId: input.purchase.id,
      status: HostedUsageCreditPurchaseStatus.expired,
      terminalAt: deriveStripeEventAt(input.event),
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

async function prepareHostedUsageCreditFinancialEvent(input: {
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

  const paidCheckout = await prepareHostedUsageCreditFinancialSnapshotCheckout({
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
    sessionId: paidCheckout.session.id,
  });
  return { paidCheckout, privateReferences, snapshot };
}

async function reconcileHostedUsageCreditFinancialEventTx(input: {
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
  return reconcileAndBindHostedUsageCreditFinancialSnapshotTx({
    checkoutAuthorization: validateHostedUsageCreditPreparedPaidCheckout({
      eventLiveMode: input.event.livemode,
      paidCheckout: input.prepared.paidCheckout,
      purchase: input.purchase,
    }),
    event: input.event,
    expectedReconciliationVersion: input.expectedReconciliationVersion,
    privateReferences: input.prepared.privateReferences,
    purchase: input.purchase,
    snapshot: input.prepared.snapshot,
    tx: input.tx,
  });
}

async function retrieveHostedUsageCreditFinancialSnapshot(input: {
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
      read: (options) => input.context.stripe.refunds.list({
        charge: charge.id,
        limit: 100,
      }, options),
    }),
    readHostedUsageCreditStripe({
      context: input.context,
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

async function prepareHostedUsageCreditFinancialSnapshotCheckout(input: {
  context: HostedUsageCreditStripePreparationContext;
  eventLiveMode: boolean;
  paymentIntent: Stripe.PaymentIntent;
  prisma: HostedUsageCreditPurchaseReadClient;
  purchase: HostedUsageCreditPurchaseForReconciliation;
}): Promise<HostedUsageCreditPreparedPaidCheckout> {
  let sessionId: string | null = null;
  if (input.purchase.stripeCheckoutSessionIdEncrypted) {
    sessionId = await runHostedUsageCreditKmsOperation({
      run: () => decryptHostedUsageCreditPurchaseStripeField({
        field:
          HOSTED_USAGE_CREDIT_PURCHASE_STRIPE_PRIVATE_FIELDS.checkoutSessionId,
        payerMemberId: input.purchase.payerMemberId,
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
      read: (options) => input.context.stripe.checkout.sessions.retrieve(
        sessionId,
        undefined,
        options,
      ),
    }),
    readHostedUsageCreditStripe({
      context: input.context,
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
  return paidCheckout;
}

function validateHostedUsageCreditPreparedPaidCheckout(input: {
  eventLiveMode: boolean;
  paidCheckout: HostedUsageCreditPreparedPaidCheckout;
  purchase: HostedUsageCreditPurchaseForReconciliation;
}): HostedUsageCreditPaidCheckoutAuthorization {
  const { lineItems, paymentIntent, session } = input.paidCheckout;
  if (input.purchase.stripeCheckoutSessionLookupKey) {
    assertHostedStripeLookupMatches({
      expectedLookupKey: input.purchase.stripeCheckoutSessionLookupKey,
      kind: "stripe-checkout-session",
      value: normalizeNullableString(session.id),
    });
  }
  assertHostedUsageCreditSession({
    allowExpiredSession: false,
    eventLiveMode: input.eventLiveMode,
    lineItems,
    purchase: input.purchase,
    session,
  });
  const paymentIntentId = coerceStripeObjectId(session.payment_intent);
  assertHostedUsageCreditPaymentIdentity({
    paymentIntent,
    paymentIntentId,
    purchase: input.purchase,
    session,
  });
  return buildHostedUsageCreditPaidCheckoutAuthorization({
    paymentIntent,
    purchase: input.purchase,
    session,
  });
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

function buildHostedUsageCreditPaidCheckoutAuthorization(input: {
  paymentIntent: Stripe.PaymentIntent;
  purchase: HostedUsageCreditPurchaseForReconciliation;
  session: Stripe.Checkout.Session;
}): HostedUsageCreditPaidCheckoutAuthorization {
  if (
    input.session.payment_status !== "paid" ||
    input.session.status !== "complete" ||
    input.paymentIntent.status !== "succeeded" ||
    coerceStripeObjectId(input.session.payment_intent) !== input.paymentIntent.id
  ) {
    throw new Error(
      "Usage-credit financial payment lacked a completed paid Checkout Session.",
    );
  }
  return {
    paymentIntentId: input.paymentIntent.id,
    purchaseId: input.purchase.id,
    sessionId: input.session.id,
  };
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
  checkoutAuthorization: HostedUsageCreditPaidCheckoutAuthorization;
  event: Stripe.Event;
  expectedReconciliationVersion: bigint;
  privateReferences: Awaited<
    ReturnType<typeof buildHostedUsageCreditStripePrivateReferences>
  >;
  purchase: HostedUsageCreditPurchaseForReconciliation;
  snapshot: HostedUsageCreditFinancialSnapshot;
  tx: Prisma.TransactionClient;
}): Promise<{ granted: boolean; wakeRequired: boolean }> {
  const reconciliation = await reconcileHostedUsageCreditFinancialSnapshotTx({
    checkoutAuthorization: input.checkoutAuthorization,
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

async function reconcileHostedUsageCreditFinancialSnapshotTx(input: {
  checkoutAuthorization: HostedUsageCreditPaidCheckoutAuthorization;
  effectiveAt: Date;
  purchase: HostedUsageCreditPurchaseForReconciliation;
  snapshot: HostedUsageCreditFinancialSnapshot;
  tx: Prisma.TransactionClient;
}): Promise<{ granted: boolean; wakeRequired: boolean }> {
  if (
    input.checkoutAuthorization.purchaseId !== input.purchase.id ||
    input.checkoutAuthorization.paymentIntentId !==
      input.snapshot.context.paymentIntent.id
  ) {
    throw new Error(
      "Usage-credit financial snapshot lacked Checkout authorization.",
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
  let balanceUsdMicros = grant.balanceUsdMicros;

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
    }
  }

  return {
    granted: grant.granted,
    wakeRequired: balanceUsdMicros > 0n,
  };
}

function assertHostedUsageCreditChargeContext(input: {
  charge: Stripe.Charge;
  paymentIntent: Stripe.PaymentIntent;
  purchase: HostedUsageCreditPurchaseForReconciliation;
}): void {
  if (
    input.charge.livemode !== input.purchase.stripeLiveMode ||
    input.paymentIntent.livemode !== input.purchase.stripeLiveMode ||
    !input.charge.paid ||
    input.paymentIntent.status !== "succeeded"
  ) {
    throw new Error("Usage-credit Charge payment state did not match.");
  }
  if (
    !Number.isSafeInteger(input.charge.amount) ||
    !Number.isSafeInteger(input.charge.amount_refunded) ||
    !Number.isSafeInteger(input.paymentIntent.amount) ||
    !Number.isSafeInteger(input.paymentIntent.amount_received) ||
    input.charge.amount !== input.purchase.cashAmountMinor ||
    input.charge.amount_refunded < 0 ||
    input.charge.amount_refunded > input.charge.amount ||
    input.paymentIntent.amount !== input.charge.amount ||
    input.paymentIntent.amount_received !== input.charge.amount ||
    normalizeNullableString(input.charge.currency)?.toLowerCase() !==
      input.purchase.cashCurrency.toLowerCase() ||
    normalizeNullableString(input.paymentIntent.currency)?.toLowerCase() !==
      input.purchase.cashCurrency.toLowerCase()
  ) {
    throw new Error("Usage-credit Charge amount or currency did not match.");
  }
  assertHostedUsageCreditMetadata({
    metadata: input.paymentIntent.metadata,
    purchase: input.purchase,
  });
  assertHostedStripeLookupMatches({
    expectedLookupKey: input.purchase.stripeCustomerLookupKey,
    kind: "stripe-customer",
    value: coerceStripeObjectId(input.charge.customer),
  });
  assertHostedStripeLookupMatches({
    expectedLookupKey: input.purchase.stripeCustomerLookupKey,
    kind: "stripe-customer",
    value: coerceStripeObjectId(input.paymentIntent.customer),
  });
  assertHostedStripeBillingEventLookupMatches({
    expectedLookupKey: input.purchase.stripePaymentIntentLookupKey,
    value: input.paymentIntent.id,
  });
  assertHostedStripeBillingEventLookupMatches({
    expectedLookupKey: input.purchase.stripeChargeLookupKey,
    value: input.charge.id,
  });
  if (coerceStripeObjectId(input.charge.payment_intent) !== input.paymentIntent.id) {
    throw new Error("Usage-credit Charge PaymentIntent did not match.");
  }
}

function assertHostedUsageCreditFinancialEventLinks(input: {
  eventChargeId: string | null;
  eventPaymentIntentId: string | null;
  financialChargeId: string | null;
  financialPaymentIntentId: string | null;
  paymentIntentId: string;
}): void {
  if (
    input.eventChargeId !== input.financialChargeId ||
    (
      input.eventPaymentIntentId !== null &&
      input.eventPaymentIntentId !== input.paymentIntentId
    ) ||
    (
      input.financialPaymentIntentId !== null &&
      input.financialPaymentIntentId !== input.paymentIntentId
    )
  ) {
    throw new Error("Usage-credit financial event payment identity did not match.");
  }
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

function assertHostedUsageCreditSession(input: {
  allowExpiredSession: boolean;
  eventLiveMode: boolean;
  lineItems: Stripe.ApiList<Stripe.LineItem>;
  purchase: HostedUsageCreditPurchaseForReconciliation;
  session: Stripe.Checkout.Session;
}): void {
  if (
    input.eventLiveMode !== input.purchase.stripeLiveMode ||
    input.session.livemode !== input.purchase.stripeLiveMode
  ) {
    throw new Error("Usage-credit Checkout environment did not match its purchase.");
  }
  if (input.session.mode !== "payment") {
    throw new Error("Usage-credit Checkout Session was not a one-time payment.");
  }
  if (
    input.session.payment_status !== "paid" &&
    input.session.payment_status !== "unpaid"
  ) {
    throw new Error("Usage-credit Checkout payment state was invalid.");
  }
  if (
    !input.allowExpiredSession &&
    input.session.status !== "complete"
  ) {
    throw new Error("Usage-credit Checkout Session was not complete.");
  }
  if (
    normalizeNullableString(input.session.client_reference_id) !==
      input.purchase.id
  ) {
    throw new Error("Usage-credit Checkout client reference did not match.");
  }
  assertHostedUsageCreditMetadata({
    metadata: input.session.metadata,
    purchase: input.purchase,
  });
  if (
    normalizeNullableString(input.session.success_url) !==
      input.purchase.checkoutSuccessUrl ||
    normalizeNullableString(input.session.cancel_url) !==
      input.purchase.checkoutCancelUrl
  ) {
    throw new Error("Usage-credit Checkout return policy did not match.");
  }
  if (
    !Number.isFinite(input.session.expires_at) ||
    input.session.expires_at !== Math.floor(
      input.purchase.checkoutExpiresAt.getTime() / 1000,
    )
  ) {
    throw new Error("Usage-credit Checkout expiry did not match.");
  }
  if (
    input.session.amount_subtotal !== input.purchase.cashAmountMinor ||
    input.session.amount_total !== input.purchase.cashAmountMinor ||
    normalizeNullableString(input.session.currency)?.toLowerCase() !==
      input.purchase.cashCurrency.toLowerCase()
  ) {
    throw new Error("Usage-credit Checkout amount or currency did not match.");
  }

  const customerId = coerceStripeObjectId(input.session.customer);
  assertHostedStripeLookupMatches({
    expectedLookupKey: input.purchase.stripeCustomerLookupKey,
    kind: "stripe-customer",
    value: customerId,
  });
  if (input.lineItems.has_more || input.lineItems.data.length !== 1) {
    throw new Error("Usage-credit Checkout must contain exactly one line item.");
  }
  const [lineItem] = input.lineItems.data;
  if (!lineItem || lineItem.quantity !== 1) {
    throw new Error("Usage-credit Checkout line-item quantity did not match.");
  }
  assertHostedStripeLookupMatches({
    expectedLookupKey: input.purchase.stripePriceLookupKey,
    kind: "stripe-price",
    value: normalizeNullableString(lineItem.price?.id),
  });
}

function assertHostedUsageCreditPaymentIdentity(input: {
  paymentIntent: Stripe.PaymentIntent | null;
  paymentIntentId: string | null;
  purchase: HostedUsageCreditPurchaseForReconciliation;
  session: Stripe.Checkout.Session;
}): void {
  if (!input.paymentIntent || !input.paymentIntentId) {
    if (input.session.payment_status === "paid") {
      throw new Error(
        "Paid usage-credit Checkout Session did not include a PaymentIntent.",
      );
    }
    return;
  }

  if (input.paymentIntent.livemode !== input.purchase.stripeLiveMode) {
    throw new Error("Usage-credit PaymentIntent environment did not match.");
  }
  assertHostedUsageCreditMetadata({
    metadata: input.paymentIntent.metadata,
    purchase: input.purchase,
  });
  assertHostedStripeLookupMatches({
    expectedLookupKey: input.purchase.stripeCustomerLookupKey,
    kind: "stripe-customer",
    value: coerceStripeObjectId(input.paymentIntent.customer),
  });
  if (
    input.paymentIntent.id !== input.paymentIntentId ||
    !Number.isSafeInteger(input.paymentIntent.amount) ||
    !Number.isSafeInteger(input.paymentIntent.amount_received) ||
    normalizeNullableString(input.paymentIntent.currency)?.toLowerCase() !==
      input.purchase.cashCurrency.toLowerCase() ||
    input.paymentIntent.amount !== input.purchase.cashAmountMinor ||
    input.paymentIntent.amount_received < 0 ||
    input.paymentIntent.amount_received > input.purchase.cashAmountMinor ||
    (
      input.session.payment_status === "paid" &&
      input.paymentIntent.amount_received !== input.purchase.cashAmountMinor
    )
  ) {
    throw new Error("Usage-credit PaymentIntent amount or currency did not match.");
  }
  if (
    input.purchase.stripePaymentIntentLookupKey &&
    !hostedLookupKeyMatchesValue({
      expectedLookupKey: input.purchase.stripePaymentIntentLookupKey,
      kind: "stripe-billing-event",
      normalizedValue: input.paymentIntentId,
    })
  ) {
    throw new Error("Usage-credit PaymentIntent identity did not match.");
  }

  const chargeId = coerceStripeObjectId(input.paymentIntent.latest_charge);
  if (
    input.purchase.stripeChargeLookupKey &&
    !hostedLookupKeyMatchesValue({
      expectedLookupKey: input.purchase.stripeChargeLookupKey,
      kind: "stripe-billing-event",
      normalizedValue: chargeId,
    })
  ) {
    throw new Error("Usage-credit Charge identity did not match.");
  }
}

function assertHostedUsageCreditMetadata(input: {
  metadata: Prisma.JsonValue | Stripe.Metadata | null;
  purchase: HostedUsageCreditPurchaseForReconciliation;
}): void {
  const metadata = readStringRecord(input.metadata);
  const expected = {
    policyVersion: HOSTED_USAGE_CREDIT_CHECKOUT_REQUEST_POLICY_VERSION,
    purchaseId: input.purchase.id,
    purpose: HOSTED_USAGE_CREDIT_CHECKOUT_PURPOSE,
  };
  if (
    input.purchase.checkoutRequestPolicyVersion !==
      HOSTED_USAGE_CREDIT_CHECKOUT_REQUEST_POLICY_VERSION ||
    !metadata ||
    Object.keys(metadata).length !== Object.keys(expected).length ||
    Object.entries(expected).some(([key, value]) => metadata[key] !== value)
  ) {
    throw new Error("Usage-credit Checkout metadata did not match.");
  }
}

async function buildHostedUsageCreditStripePrivateReferences(input: {
  chargeId: string | null;
  context: HostedUsageCreditStripePreparationContext;
  paymentIntentId: string | null;
  prisma: HostedUsageCreditPurchaseReadClient;
  purchase: HostedUsageCreditPurchaseForReconciliation;
  sessionId: string;
}) {
  const encryptPrivateReference = (
    field: HostedUsageCreditPurchaseStripePrivateField,
    value: string | null,
  ) =>
    runHostedUsageCreditKmsOperation({
      run: () => encryptHostedUsageCreditPurchaseStripeField({
        field,
        payerMemberId: input.purchase.payerMemberId,
        prisma: input.prisma,
        signal: takeHostedUsageCreditKmsSignal(input.context),
        value,
      }),
    });
  const [
    stripeCheckoutSessionIdEncrypted,
    stripePaymentIntentIdEncrypted,
    stripeChargeIdEncrypted,
  ] = await Promise.all([
    encryptPrivateReference(
      HOSTED_USAGE_CREDIT_PURCHASE_STRIPE_PRIVATE_FIELDS.checkoutSessionId,
      input.sessionId,
    ),
    encryptPrivateReference(
      HOSTED_USAGE_CREDIT_PURCHASE_STRIPE_PRIVATE_FIELDS.paymentIntentId,
      input.paymentIntentId,
    ),
    encryptPrivateReference(
      HOSTED_USAGE_CREDIT_PURCHASE_STRIPE_PRIVATE_FIELDS.chargeId,
      input.chargeId,
    ),
  ]);

  return {
    stripeChargeIdEncrypted,
    stripeChargeLookupKey: createHostedStripeBillingEventLookupKey(
      input.chargeId,
    ),
    stripeCheckoutSessionIdEncrypted,
    stripeCheckoutSessionLookupKey: createHostedStripeCheckoutSessionLookupKey(
      input.sessionId,
    ),
    stripePaymentIntentIdEncrypted,
    stripePaymentIntentLookupKey: createHostedStripeBillingEventLookupKey(
      input.paymentIntentId,
    ),
  };
}

async function bindHostedUsageCreditStripeReferencesTx(input: {
  expectedReconciliationVersion: bigint;
  lastReconciledAt: Date;
  privateReferences: Awaited<
    ReturnType<typeof buildHostedUsageCreditStripePrivateReferences>
  >;
  purchaseId: string;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  const updated = await runHostedUsageCreditDatabaseOperation({
    read: () => input.tx.hostedUsageCreditPurchase.updateMany({
      data: {
        lastReconciledAt: input.lastReconciledAt,
        reconciliationVersion: {
          increment: 1n,
        },
        ...input.privateReferences,
      },
      where: {
        id: input.purchaseId,
        reconciliationVersion: input.expectedReconciliationVersion,
      },
    }),
  });
  if (updated.count !== 1) {
    throw buildHostedUsageCreditStripeRetryableError(
      new Error(
        "Usage-credit purchase changed before Stripe references were bound.",
      ),
    );
  }
}

async function transitionHostedUsageCreditCheckoutTx(input: {
  expectedReconciliationVersion: bigint;
  lastReconciledAt: Date;
  privateReferences: Awaited<
    ReturnType<typeof buildHostedUsageCreditStripePrivateReferences>
  >;
  purchaseId: string;
  status: HostedUsageCreditPurchaseStatus;
  terminalAt: Date | null;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  const updated = await runHostedUsageCreditDatabaseOperation({
    read: () => input.tx.hostedUsageCreditPurchase.updateMany({
      data: {
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

function assertHostedStripeLookupMatches(input: {
  expectedLookupKey: string;
  kind: "stripe-checkout-session" | "stripe-customer" | "stripe-price";
  value: string | null;
}): void {
  if (
    !hostedLookupKeyMatchesValue({
      expectedLookupKey: input.expectedLookupKey,
      kind: input.kind,
      normalizedValue: input.value,
    })
  ) {
    throw new Error("Usage-credit Stripe identity did not match its purchase.");
  }
}

function assertHostedStripeBillingEventLookupMatches(input: {
  expectedLookupKey: string | null;
  value: string;
}): void {
  if (
    input.expectedLookupKey &&
    !hostedLookupKeyMatchesValue({
      expectedLookupKey: input.expectedLookupKey,
      kind: "stripe-billing-event",
      normalizedValue: input.value,
    })
  ) {
    throw new Error("Usage-credit Stripe payment identity did not match.");
  }
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

function buildHostedUsageCreditStripeRetryableError(
  error: unknown,
): HostedUsageCreditStripeRetryableError {
  return isHostedUsageCreditStripeRetryableError(error)
    ? error
    : new HostedUsageCreditStripeRetryableError(error);
}

async function runHostedUsageCreditDatabaseOperation<TResult>(input: {
  read: () => Promise<TResult>;
}): Promise<TResult> {
  try {
    return await input.read();
  } catch (error) {
    if (isRetryableHostedUsageCreditDependencyError(error)) {
      throw buildHostedUsageCreditStripeRetryableError(error);
    }
    throw error;
  }
}

async function runHostedUsageCreditKmsOperation<TResult>(input: {
  run: () => Promise<TResult>;
}): Promise<TResult> {
  try {
    return await input.run();
  } catch (error) {
    if (isRetryableHostedUsageCreditDependencyError(error)) {
      throw buildHostedUsageCreditStripeRetryableError(error);
    }
    throw error;
  }
}

function isRetryableHostedUsageCreditDependencyError(error: unknown): boolean {
  if (isHostedUsageCreditStripeRetryableError(error)) {
    return true;
  }
  if (isHostedOnboardingError(error)) {
    return error.retryable;
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return HOSTED_USAGE_CREDIT_RETRYABLE_PRISMA_CODES.has(error.code) ||
      (
        error.code === "P2010" &&
        typeof error.meta?.code === "string" &&
        HOSTED_USAGE_CREDIT_RETRYABLE_POSTGRES_CODES.has(error.meta.code)
      );
  }
  if (error instanceof Prisma.PrismaClientInitializationError) {
    return error.errorCode === undefined ||
      HOSTED_USAGE_CREDIT_RETRYABLE_PRISMA_CODES.has(error.errorCode);
  }
  if (
    error instanceof Prisma.PrismaClientUnknownRequestError ||
    error instanceof Prisma.PrismaClientRustPanicError
  ) {
    return true;
  }
  if (
    error instanceof DOMException &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  ) {
    return true;
  }
  if (!error || typeof error !== "object") {
    return false;
  }
  if (
    "code" in error &&
    typeof error.code === "string" &&
    error.code === "GOOGLE_CLOUD_API_ERROR"
  ) {
    const status = "status" in error && typeof error.status === "number"
      ? error.status
      : null;
    return status === null || status === 409 || status === 429 || status >= 500;
  }
  if (
    "code" in error &&
    typeof error.code === "string" &&
    (
      error.code === "ECONNABORTED" ||
      error.code === "ECONNREFUSED" ||
      error.code === "ECONNRESET" ||
      error.code === "ENETUNREACH" ||
      error.code === "ETIMEDOUT"
    )
  ) {
    return true;
  }
  return error instanceof TypeError && error.message === "fetch failed";
}

function isDefinitiveHostedUsageCreditStripeRequestRejection(
  error: unknown,
): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const shouldRetry = readStripeShouldRetryDirective(error);
  if (shouldRetry !== null) {
    return !shouldRetry;
  }
  const type = "type" in error && typeof error.type === "string"
    ? error.type
    : null;
  const rawType = "rawType" in error && typeof error.rawType === "string"
    ? error.rawType
    : null;
  const statusCode = "statusCode" in error &&
      typeof error.statusCode === "number"
    ? error.statusCode
    : null;
  return (
    type === "StripeInvalidRequestError" || rawType === "invalid_request_error"
  ) &&
    statusCode !== null &&
    statusCode >= 400 &&
    statusCode < 500 &&
    statusCode !== 409 &&
    statusCode !== 429;
}

function readStringRecord(
  value: Prisma.JsonValue | Stripe.Metadata | null,
): Record<string, string> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const entries = Object.entries(value);
  if (entries.some(([, entry]) => typeof entry !== "string")) {
    return null;
  }
  return Object.fromEntries(
    entries.map(([key, entry]) => [key, String(entry)]),
  );
}

function readStripeObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(Object.entries(value));
}

function readHostedUsageCreditFinancialEventPaymentReferences(
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

function deriveHostedUsageCreditFinancialEffectiveAt(input: {
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

function deriveStripeEventAt(event: Stripe.Event): Date {
  return Number.isFinite(event.created)
    ? new Date(event.created * 1000)
    : new Date();
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

function isHostedUsageCreditCheckoutEvent(type: string): boolean {
  return type === "checkout.session.completed" ||
    type === "checkout.session.async_payment_succeeded" ||
    type === "checkout.session.async_payment_failed" ||
    type === "checkout.session.expired";
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

function isHostedUsageCreditFinancialReversalEvent(type: string): boolean {
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

function resolveHostedUsageCreditFinancialEventKind(
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
