import { Prisma, type PrismaClient } from "@prisma/client";
import type Stripe from "stripe";

import { readStripeShouldRetryDirective } from "./billing";
import {
  createHostedStripeBillingEventLookupKey,
  createHostedStripeBillingEventLookupKeyReadCandidates,
  createHostedStripeCheckoutSessionLookupKey,
} from "./contact-privacy";
import { isHostedOnboardingError } from "./errors";
import { logHostedStripeFailure } from "./stripe-error-log";
import {
  encryptHostedUsageCreditPurchaseStripeField,
  HOSTED_USAGE_CREDIT_PURCHASE_STRIPE_PRIVATE_FIELDS,
  type HostedUsageCreditPurchaseStripePrivateField,
} from "./usage-credit-purchase-stripe";

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
const HOSTED_USAGE_CREDIT_RETRYABLE_GCP_KMS_PROVIDER_REASONS = new Set([
  "ABORTED",
  "ALREADY_EXISTS",
  "CANCELLED",
  "DEADLINE_EXCEEDED",
  "INTERNAL",
  "RESOURCE_EXHAUSTED",
  "UNAVAILABLE",
  "UNKNOWN",
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

export const HOSTED_USAGE_CREDIT_PURCHASE_SELECT = {
  beneficiaryMemberId: true,
  cashAmountMinor: true,
  cashCurrency: true,
  checkoutCancelUrl: true,
  checkoutExpiresAt: true,
  checkoutRequestPolicyVersion: true,
  checkoutSuccessUrl: true,
  createdAt: true,
  grantSlotReleasedAt: true,
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

export type HostedUsageCreditPurchaseForReconciliation =
  Prisma.HostedUsageCreditPurchaseGetPayload<{
    select: typeof HOSTED_USAGE_CREDIT_PURCHASE_SELECT;
  }>;

export type HostedUsageCreditPurchaseReadClient =
  | PrismaClient
  | Prisma.TransactionClient;

export type HostedUsageCreditStripePreparationContext = {
  kmsOperationCount: number;
  signal: AbortSignal;
  stripe: Stripe;
  stripeReadCount: number;
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

export async function withHostedUsageCreditStripePreparationBudget<TResult>(input: {
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

export async function readHostedUsageCreditStripe<TResult>(input: {
  context: HostedUsageCreditStripePreparationContext;
  operationName: string;
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
    logHostedStripeFailure({ error, operationName: input.operationName });
    if (isDefinitiveHostedUsageCreditStripeRequestRejection(error)) {
      throw error;
    }
    throw buildHostedUsageCreditStripeRetryableError(error);
  }
  throwIfHostedUsageCreditPreparationAborted(input.context.signal);
  return result;
}

export function takeHostedUsageCreditKmsSignal(
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

export function throwIfHostedUsageCreditPreparationAborted(signal: AbortSignal): void {
  if (!signal.aborted) {
    return;
  }
  if (signal.reason instanceof Error) {
    throw signal.reason;
  }
  throw new Error("Usage-credit Stripe preparation was aborted.");
}

export async function findHostedUsageCreditPurchaseById(input: {
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

export async function findHostedUsageCreditPurchaseByPaymentReference(input: {
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

export type HostedUsageCreditStripePrivateReferences = {
  stripeChargeIdEncrypted: string | null;
  stripeChargeLookupKey: string | null;
  stripeCheckoutSessionIdEncrypted: string | null;
  stripeCheckoutSessionLookupKey: string | null;
  stripePaymentIntentIdEncrypted: string | null;
  stripePaymentIntentLookupKey: string | null;
};

export async function buildHostedUsageCreditStripePrivateReferences(input: {
  chargeId: string | null;
  context: HostedUsageCreditStripePreparationContext;
  paymentIntentId: string | null;
  prisma: HostedUsageCreditPurchaseReadClient;
  purchase: HostedUsageCreditPurchaseForReconciliation;
  sessionId: string | null;
}): Promise<HostedUsageCreditStripePrivateReferences> {
  const payerMemberId = input.purchase.payerMemberId;
  const encryptPrivateReference = (
    field: HostedUsageCreditPurchaseStripePrivateField,
    value: string | null,
  ) =>
    payerMemberId === null
      ? Promise.resolve(null)
      : runHostedUsageCreditKmsOperation({
          run: () => encryptHostedUsageCreditPurchaseStripeField({
            field,
            payerMemberId,
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

export async function bindHostedUsageCreditStripeReferencesTx(input: {
  expectedReconciliationVersion: bigint;
  lastReconciledAt: Date;
  privateReferences: HostedUsageCreditStripePrivateReferences;
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

export function buildHostedUsageCreditStripeRetryableError(
  error: unknown,
): HostedUsageCreditStripeRetryableError {
  return isHostedUsageCreditStripeRetryableError(error)
    ? error
    : new HostedUsageCreditStripeRetryableError(error);
}

export async function runHostedUsageCreditDatabaseOperation<TResult>(input: {
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

export async function runHostedUsageCreditKmsOperation<TResult>(input: {
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

export function isRetryableHostedUsageCreditDependencyError(error: unknown): boolean {
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
  if (!("code" in error) || typeof error.code !== "string") {
    return error instanceof TypeError && error.message === "fetch failed";
  }
  if (error.code === "GOOGLE_CLOUD_API_ERROR") {
    const status = "status" in error && typeof error.status === "number"
      ? error.status
      : null;
    return status === null || status === 409 || status === 429 || status >= 500;
  }
  if (error.code === "HOSTED_GCP_KMS_PROVIDER_ERROR") {
    const status = "status" in error && typeof error.status === "number"
      ? error.status
      : null;
    if (status !== null) {
      return status === 408 || status === 409 || status === 429 || status >= 500;
    }
    const providerReason = "providerReason" in error &&
        typeof error.providerReason === "string"
      ? error.providerReason
      : null;
    // The KMS client performs no immediate provider retry. Its `retryable`
    // field describes that local policy; durable reconciliation still retries
    // transient provider outcomes on a later attempt.
    return providerReason !== null &&
      HOSTED_USAGE_CREDIT_RETRYABLE_GCP_KMS_PROVIDER_REASONS.has(providerReason);
  }
  if (
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
  return false;
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
