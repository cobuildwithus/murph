import type Stripe from "stripe";

import {
  HostedUsageCreditCheckoutCreateState,
  HostedUsageCreditPurchaseStatus,
  type HostedUsageCreditPurchase,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";

import {
  createHostedStripeCheckoutSessionLookupKey,
  createHostedStripeCustomerLookupKey,
  createHostedStripeCustomerLookupKeyReadCandidates,
  createHostedStripePriceLookupKey,
  hostedLookupKeyMatchesValue,
} from "./contact-privacy";
import {
  isHostedPulseTrialBillingState,
  parseHostedBillingPhase,
  parseHostedBillingPlanCode,
} from "./billing-plans";
import { coerceStripeObjectId } from "./billing";
import { hostedOnboardingError } from "./errors";
import { readHostedMemberStripeBillingRef } from "./hosted-member-billing-store";
import {
  requireHostedOnboardingPublicBaseUrl,
  requireHostedStripeApiMode,
  requireHostedStripeUsageCreditCheckoutConfig,
} from "./runtime";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  lockHostedMemberRow,
  type HostedOnboardingReadClient,
} from "./shared";
import {
  getHostedUsageCreditOfferDefinition,
  HOSTED_USAGE_CREDIT_CHECKOUT_PURPOSE,
  HOSTED_USAGE_CREDIT_CHECKOUT_REQUEST_POLICY_VERSION,
  parseHostedUsageCreditOfferCode,
  type HostedUsageCreditOfferCode,
} from "./usage-credit-offers";
import {
  decryptHostedWebNullableString,
  encryptHostedWebNullableString,
} from "../hosted-web/encryption";
import {
  generateHostedRandomPrefixedId,
  isRecord,
  sha256Hex,
} from "../primitives";
import { getPrisma } from "../prisma";

const HOSTED_USAGE_CREDIT_AUTHORIZATION_CONTEXT = "personal_self_v1";
const HOSTED_USAGE_CREDIT_CHECKOUT_RETRY_DURATION_MS = 30 * 60 * 1_000;
const HOSTED_USAGE_CREDIT_CHECKOUT_EXPIRY_DURATION_MS = 90 * 60 * 1_000;
const HOSTED_USAGE_CREDIT_CLIENT_REQUEST_KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/u;
const HOSTED_USAGE_CREDIT_PURCHASE_ID_PATTERN = /^hucp_[A-Za-z0-9_-]{16}$/u;

const HOSTED_USAGE_CREDIT_NONTERMINAL_PURCHASE_STATUSES = [
  HostedUsageCreditPurchaseStatus.created,
  HostedUsageCreditPurchaseStatus.checkout_open,
  HostedUsageCreditPurchaseStatus.payment_pending,
] as const;

export const HOSTED_USAGE_CREDIT_PURCHASE_STRIPE_PRIVATE_FIELDS = {
  chargeId: "hosted_usage_credit_purchase.stripe_charge_id",
  checkoutSessionId: "hosted_usage_credit_purchase.stripe_checkout_session_id",
  checkoutUrl: "hosted_usage_credit_purchase.stripe_checkout_url",
  customerId: "hosted_usage_credit_purchase.stripe_customer_id",
  paymentIntentId: "hosted_usage_credit_purchase.stripe_payment_intent_id",
  priceId: "hosted_usage_credit_purchase.stripe_price_id",
} as const;

export type HostedUsageCreditPurchaseStripePrivateField =
  (typeof HOSTED_USAGE_CREDIT_PURCHASE_STRIPE_PRIVATE_FIELDS)[
    keyof typeof HOSTED_USAGE_CREDIT_PURCHASE_STRIPE_PRIVATE_FIELDS
  ];

export const HOSTED_USAGE_CREDIT_PUBLIC_PURCHASE_STATUSES = [
  "checkout_open",
  "payment_pending",
  "fulfilled",
  "expired",
  "payment_failed",
  "reconciling",
] as const;

export type HostedUsageCreditPublicPurchaseStatus =
  (typeof HOSTED_USAGE_CREDIT_PUBLIC_PURCHASE_STATUSES)[number];

export interface HostedUsageCreditCheckoutRequest {
  clientRequestKey: string;
  offerCode: HostedUsageCreditOfferCode;
}

export interface HostedUsageCreditCheckoutResult {
  purchaseId: string;
  status: HostedUsageCreditPublicPurchaseStatus;
  url?: string;
}

export interface HostedUsageCreditPurchaseStatusResult {
  checkoutExpiresAt: string;
  fulfilledAt: string | null;
  purchaseId: string;
  status: HostedUsageCreditPublicPurchaseStatus;
  updatedAt: string;
}

export function parseHostedUsageCreditCheckoutRequest(
  value: Record<string, unknown>,
): HostedUsageCreditCheckoutRequest {
  const keys = Object.keys(value).sort();
  if (
    keys.length !== 2 ||
    keys[0] !== "clientRequestKey" ||
    keys[1] !== "offerCode"
  ) {
    throw hostedOnboardingError({
      code: "HOSTED_USAGE_CREDIT_CHECKOUT_INVALID_REQUEST",
      httpStatus: 400,
      message: "Usage-credit checkout requires an offer and request key.",
    });
  }

  const offerCode = parseHostedUsageCreditOfferCode(value.offerCode);
  if (!offerCode) {
    throw hostedOnboardingError({
      code: "HOSTED_USAGE_CREDIT_OFFER_INVALID",
      httpStatus: 400,
      message: "Choose an available usage-credit offer.",
    });
  }

  const clientRequestKey = value.clientRequestKey;
  if (
    typeof clientRequestKey !== "string" ||
    !HOSTED_USAGE_CREDIT_CLIENT_REQUEST_KEY_PATTERN.test(clientRequestKey)
  ) {
    throw hostedOnboardingError({
      code: "HOSTED_USAGE_CREDIT_CLIENT_REQUEST_KEY_INVALID",
      httpStatus: 400,
      message: "Start a fresh usage-credit checkout request.",
    });
  }

  return {
    clientRequestKey,
    offerCode,
  };
}

export async function createHostedUsageCreditCheckout(input: {
  clientRequestKey: string;
  memberId: string;
  now?: Date;
  offerCode: HostedUsageCreditOfferCode;
  prisma?: PrismaClient;
}): Promise<HostedUsageCreditCheckoutResult> {
  const prisma = input.prisma ?? getPrisma();
  const now = input.now ?? new Date();
  const requestFingerprint = buildHostedUsageCreditRequestFingerprint({
    beneficiaryMemberId: input.memberId,
    offerCode: input.offerCode,
    payerMemberId: input.memberId,
  });
  const existing = await prisma.hostedUsageCreditPurchase.findUnique({
    where: {
      payerMemberId_clientRequestKey: {
        clientRequestKey: input.clientRequestKey,
        payerMemberId: input.memberId,
      },
    },
  });

  if (existing) {
    assertHostedUsageCreditRequestFingerprintMatches(existing, requestFingerprint);
    return continueHostedUsageCreditCheckout({
      now,
      prisma,
      purchase: existing,
    });
  }

  const checkoutConfig = requireHostedStripeUsageCreditCheckoutConfig({
    offerCode: input.offerCode,
  });
  const publicBaseUrl = requireHostedOnboardingPublicBaseUrl();
  const purchaseId = generateHostedRandomPrefixedId("hucp");
  const purchase = await prisma.$transaction(async (tx) => {
    await lockHostedMemberRow(tx, input.memberId);

    const racedExisting = await tx.hostedUsageCreditPurchase.findUnique({
      where: {
        payerMemberId_clientRequestKey: {
          clientRequestKey: input.clientRequestKey,
          payerMemberId: input.memberId,
        },
      },
    });
    if (racedExisting) {
      assertHostedUsageCreditRequestFingerprintMatches(racedExisting, requestFingerprint);
      return racedExisting;
    }

    const member = await tx.hostedMember.findUnique({
      select: {
        accountGroupMemberships: {
          select: { id: true },
          where: { status: "active" },
        },
        billingStatus: true,
        suspendedAt: true,
        threadContainer: {
          select: { memberId: true },
        },
      },
      where: { id: input.memberId },
    });
    if (!member) {
      throw buildHostedUsageCreditNotEligibleError();
    }

    const billingRef = await readHostedMemberStripeBillingRef({
      memberId: input.memberId,
      prisma: tx,
    });
    assertHostedUsageCreditPurchaseEligibility({
      billingRef,
      member,
    });

    await closeExpiredUnattachedHostedUsageCreditPurchasesTx({
      now,
      payerMemberId: input.memberId,
      tx,
    });

    const existingActive = await tx.hostedUsageCreditPurchase.findFirst({
      select: { id: true },
      where: {
        payerMemberId: input.memberId,
        status: {
          in: [...HOSTED_USAGE_CREDIT_NONTERMINAL_PURCHASE_STATUSES],
        },
      },
    });
    if (existingActive) {
      throw hostedOnboardingError({
        code: "HOSTED_USAGE_CREDIT_CHECKOUT_IN_PROGRESS",
        httpStatus: 409,
        message: "A usage-credit payment is already in progress.",
      });
    }

    const stripeCustomerId = billingRef?.stripeCustomerId;
    if (!stripeCustomerId || !billingRef?.stripeSubscriptionId) {
      throw hostedOnboardingError({
        code: "HOSTED_USAGE_CREDIT_BILLING_NOT_READY",
        httpStatus: 409,
        message: "Your subscription is not ready for usage-credit checkout yet.",
      });
    }

    const offer = getHostedUsageCreditOfferDefinition(input.offerCode);
    const checkoutExpiresAt = new Date(
      now.getTime() + HOSTED_USAGE_CREDIT_CHECKOUT_EXPIRY_DURATION_MS,
    );
    const checkoutCreateRetryCutoffAt = new Date(
      now.getTime() + HOSTED_USAGE_CREDIT_CHECKOUT_RETRY_DURATION_MS,
    );
    const checkoutMetadata = buildHostedUsageCreditCheckoutMetadata(purchaseId);
    const checkoutSuccessUrl = buildHostedUsageCreditCheckoutReturnUrl({
      outcome: "success",
      publicBaseUrl,
      purchaseId,
    });
    const checkoutCancelUrl = buildHostedUsageCreditCheckoutReturnUrl({
      outcome: "cancel",
      publicBaseUrl,
      purchaseId,
    });
    const checkoutRequest = buildHostedUsageCreditStripeCheckoutRequest({
      checkoutCancelUrl,
      checkoutExpiresAt,
      checkoutMetadata,
      checkoutSuccessUrl,
      priceId: checkoutConfig.priceId,
      purchaseId,
      stripeCustomerId,
    });
    const [stripePriceIdEncrypted, stripeCustomerIdEncrypted] = await Promise.all([
      encryptHostedUsageCreditPurchaseStripeField({
        field: HOSTED_USAGE_CREDIT_PURCHASE_STRIPE_PRIVATE_FIELDS.priceId,
        payerMemberId: input.memberId,
        prisma: tx,
        value: checkoutConfig.priceId,
      }),
      encryptHostedUsageCreditPurchaseStripeField({
        field: HOSTED_USAGE_CREDIT_PURCHASE_STRIPE_PRIVATE_FIELDS.customerId,
        payerMemberId: input.memberId,
        prisma: tx,
        value: stripeCustomerId,
      }),
    ]);
    const stripePriceLookupKey = requireHostedUsageCreditLookupKey(
      createHostedStripePriceLookupKey(checkoutConfig.priceId),
      "price",
    );
    const stripeCustomerLookupKey = requireHostedUsageCreditLookupKey(
      createHostedStripeCustomerLookupKey(stripeCustomerId),
      "customer",
    );

    const created = await tx.hostedUsageCreditPurchase.create({
      data: {
        authorizationContext: HOSTED_USAGE_CREDIT_AUTHORIZATION_CONTEXT,
        beneficiaryMemberId: input.memberId,
        cashAmountMinor: offer.cashAmountMinor,
        cashCurrency: offer.cashCurrency,
        checkoutCancelUrl,
        checkoutClientReferenceId: purchaseId,
        checkoutCreateRetryCutoffAt,
        checkoutExpiresAt,
        checkoutMetadataJson: checkoutMetadata,
        checkoutRequestDigest: buildHostedUsageCreditCheckoutRequestDigest(checkoutRequest),
        checkoutRequestPolicyVersion: HOSTED_USAGE_CREDIT_CHECKOUT_REQUEST_POLICY_VERSION,
        clientRequestKey: input.clientRequestKey,
        conversionPolicyVersion: offer.conversionPolicyVersion,
        createdAt: now,
        grantUsdMicros: offer.grantUsdMicros,
        id: purchaseId,
        offerCode: offer.code,
        payerMemberId: input.memberId,
        requestFingerprint,
        status: HostedUsageCreditPurchaseStatus.created,
        stripeCustomerIdEncrypted: requireHostedUsageCreditEncryptedValue(
          stripeCustomerIdEncrypted,
          "customer",
        ),
        stripeCustomerLookupKey,
        stripeLiveMode: checkoutConfig.stripeLiveMode,
        stripePriceIdEncrypted: requireHostedUsageCreditEncryptedValue(
          stripePriceIdEncrypted,
          "price",
        ),
        stripePriceLookupKey,
        checkoutSuccessUrl,
        updatedAt: now,
      },
    });
    const claimed = await tx.hostedUsageCreditPurchase.updateMany({
      data: {
        checkoutCreateState: HostedUsageCreditCheckoutCreateState.claimed,
        reconciliationVersion: { increment: 1n },
        updatedAt: now,
      },
      where: {
        checkoutCreateState: HostedUsageCreditCheckoutCreateState.not_started,
        id: created.id,
        reconciliationVersion: created.reconciliationVersion,
      },
    });
    if (claimed.count !== 1) {
      throw buildHostedUsageCreditInvariantError("checkout_claim_failed");
    }

    return {
      ...created,
      checkoutCreateState: HostedUsageCreditCheckoutCreateState.claimed,
      reconciliationVersion: created.reconciliationVersion + 1n,
      updatedAt: now,
    };
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);

  return continueHostedUsageCreditCheckout({
    now,
    prisma,
    purchase,
  });
}

export async function readHostedUsageCreditPurchaseStatus(input: {
  payerMemberId: string;
  prisma?: HostedOnboardingReadClient;
  purchaseId: string;
}): Promise<HostedUsageCreditPurchaseStatusResult> {
  if (!HOSTED_USAGE_CREDIT_PURCHASE_ID_PATTERN.test(input.purchaseId)) {
    throw buildHostedUsageCreditPurchaseNotFoundError();
  }

  const prisma = input.prisma ?? getPrisma();
  const purchase = await prisma.hostedUsageCreditPurchase.findFirst({
    select: {
      checkoutCreateState: true,
      checkoutExpiresAt: true,
      fulfilledAt: true,
      id: true,
      status: true,
      updatedAt: true,
    },
    where: {
      id: input.purchaseId,
      payerMemberId: input.payerMemberId,
    },
  });
  if (!purchase) {
    throw buildHostedUsageCreditPurchaseNotFoundError();
  }

  return buildHostedUsageCreditPurchaseStatusResult(purchase);
}

export async function expireHostedUsageCreditCheckout(input: {
  now?: Date;
  payerMemberId: string;
  prisma?: PrismaClient;
  purchaseId: string;
}): Promise<HostedUsageCreditPurchaseStatusResult> {
  if (!HOSTED_USAGE_CREDIT_PURCHASE_ID_PATTERN.test(input.purchaseId)) {
    throw buildHostedUsageCreditPurchaseNotFoundError();
  }

  const now = input.now ?? new Date();
  const prisma = input.prisma ?? getPrisma();
  const purchase = await prisma.$transaction(async (tx) => {
    await lockHostedMemberRow(tx, input.payerMemberId);
    await closeExpiredUnattachedHostedUsageCreditPurchasesTx({
      now,
      payerMemberId: input.payerMemberId,
      purchaseId: input.purchaseId,
      tx,
    });

    const current = await tx.hostedUsageCreditPurchase.findUnique({
      where: { id: input.purchaseId },
    });
    if (!current || current.payerMemberId !== input.payerMemberId) {
      throw buildHostedUsageCreditPurchaseNotFoundError();
    }
    return current;
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);

  if (
    purchase.status === HostedUsageCreditPurchaseStatus.fulfilled ||
    purchase.status === HostedUsageCreditPurchaseStatus.expired ||
    purchase.status === HostedUsageCreditPurchaseStatus.payment_failed ||
    purchase.checkoutCreateState !== HostedUsageCreditCheckoutCreateState.attached
  ) {
    return buildHostedUsageCreditPurchaseStatusResult(purchase);
  }

  const sessionId = await decryptHostedUsageCreditPurchaseStripeField({
    field: HOSTED_USAGE_CREDIT_PURCHASE_STRIPE_PRIVATE_FIELDS.checkoutSessionId,
    payerMemberId: purchase.payerMemberId,
    prisma,
    value: purchase.stripeCheckoutSessionIdEncrypted,
  });
  if (
    !sessionId ||
    !hostedLookupKeyMatchesValue({
      expectedLookupKey: purchase.stripeCheckoutSessionLookupKey,
      kind: "stripe-checkout-session",
      normalizedValue: sessionId,
    })
  ) {
    throw buildHostedUsageCreditInvariantError("checkout_session_identity_invalid");
  }

  const { stripe, stripeLiveMode } = requireHostedStripeApiMode();
  if (stripeLiveMode !== purchase.stripeLiveMode) {
    throw hostedOnboardingError({
      code: "HOSTED_USAGE_CREDIT_STRIPE_MODE_MISMATCH",
      httpStatus: 500,
      message: "Usage-credit checkout is temporarily unavailable.",
    });
  }

  const session = await retrieveAndExpireHostedUsageCreditStripeSession({
    purchase,
    sessionId,
    stripe,
  });

  return prisma.$transaction(async (tx) => {
    await lockHostedMemberRow(tx, input.payerMemberId);
    const current = await tx.hostedUsageCreditPurchase.findUnique({
      where: { id: input.purchaseId },
    });
    if (!current || current.payerMemberId !== input.payerMemberId) {
      throw buildHostedUsageCreditPurchaseNotFoundError();
    }
    if (
      current.status === HostedUsageCreditPurchaseStatus.fulfilled ||
      current.status === HostedUsageCreditPurchaseStatus.expired ||
      current.status === HostedUsageCreditPurchaseStatus.payment_failed
    ) {
      return buildHostedUsageCreditPurchaseStatusResult(current);
    }

    const currentSessionId = await decryptHostedUsageCreditPurchaseStripeField({
      field: HOSTED_USAGE_CREDIT_PURCHASE_STRIPE_PRIVATE_FIELDS.checkoutSessionId,
      payerMemberId: current.payerMemberId,
      prisma: tx,
      value: current.stripeCheckoutSessionIdEncrypted,
    });
    if (
      currentSessionId !== sessionId ||
      !hostedLookupKeyMatchesValue({
        expectedLookupKey: current.stripeCheckoutSessionLookupKey,
        kind: "stripe-checkout-session",
        normalizedValue: sessionId,
      })
    ) {
      throw buildHostedUsageCreditInvariantError("checkout_session_identity_changed");
    }

    const providerState = projectHostedUsageCreditStripeSessionState(session);
    if (providerState === "checkout_open") {
      throw buildHostedUsageCreditInvariantError("stripe_session_remained_open");
    }
    const expired = providerState === "expired";
    const updated = await tx.hostedUsageCreditPurchase.updateMany({
      data: {
        checkoutCreateState: expired
          ? HostedUsageCreditCheckoutCreateState.closed
          : HostedUsageCreditCheckoutCreateState.attached,
        lastReconciledAt: now,
        reconciliationVersion: { increment: 1n },
        status: expired
          ? HostedUsageCreditPurchaseStatus.expired
          : HostedUsageCreditPurchaseStatus.payment_pending,
        terminalAt: expired ? now : null,
        updatedAt: now,
      },
      where: {
        id: current.id,
        payerMemberId: input.payerMemberId,
        reconciliationVersion: current.reconciliationVersion,
      },
    });
    if (updated.count !== 1) {
      throw buildHostedUsageCreditInvariantError("checkout_expire_update_failed");
    }
    const reconciled = await tx.hostedUsageCreditPurchase.findUnique({
      where: { id: current.id },
    });
    if (!reconciled) {
      throw buildHostedUsageCreditPurchaseNotFoundError();
    }
    return buildHostedUsageCreditPurchaseStatusResult(reconciled);
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

export async function closeHostedUsageCreditPurchasesForAccountDeletion(input: {
  memberIds: readonly string[];
  now?: Date;
  prisma?: PrismaClient;
}): Promise<void> {
  const memberIds = [...new Set(input.memberIds)].sort();
  if (memberIds.length === 0) {
    return;
  }

  const now = input.now ?? new Date();
  const prisma = input.prisma ?? getPrisma();
  const purchases = await prisma.hostedUsageCreditPurchase.findMany({
    orderBy: { id: "asc" },
    where: buildHostedUsageCreditAccountDeletionScope(memberIds),
  });

  for (const listedPurchase of purchases) {
    const purchase = await prepareHostedUsageCreditPurchaseForAccountDeletion({
      prisma,
      purchase: listedPurchase,
    });
    assertHostedUsageCreditPurchaseHasCurrentAccountDeletionOwnership({
      memberIds,
      purchase,
    });
    if (isHostedUsageCreditPurchaseSafeForAccountDeletion(purchase)) {
      continue;
    }
    if (purchase.status === HostedUsageCreditPurchaseStatus.payment_pending) {
      throw buildHostedUsageCreditAccountDeletionPaymentPendingError();
    }

    const resolution = await resolveHostedUsageCreditStripeSessionForAccountDeletion({
      now,
      prisma,
      purchase,
    });
    const reconciled = resolution.kind === "session"
      ? await persistHostedUsageCreditAccountDeletionSessionState({
          now,
          prisma,
          purchase,
          session: resolution.session,
        })
      : await persistHostedUsageCreditAccountDeletionNoSessionProof({
          now,
          prisma,
          purchase,
        });
    if (isHostedUsageCreditPurchaseSafeForAccountDeletion(reconciled)) {
      continue;
    }
    if (reconciled.status === HostedUsageCreditPurchaseStatus.payment_pending) {
      throw buildHostedUsageCreditAccountDeletionPaymentPendingError();
    }
    throw buildHostedUsageCreditAccountDeletionUnresolvedError();
  }
}

export async function assertHostedUsageCreditPurchasesReadyForAccountDeletionTx(
  input: {
    memberIds: readonly string[];
    prisma?: HostedOnboardingReadClient;
  },
): Promise<void> {
  const memberIds = [...new Set(input.memberIds)].sort();
  if (memberIds.length === 0) {
    return;
  }

  const prisma = input.prisma ?? getPrisma();
  const purchases = await prisma.hostedUsageCreditPurchase.findMany({
    select: {
      authorizationContext: true,
      beneficiaryMemberId: true,
      checkoutCreateState: true,
      fulfilledAt: true,
      lastReconciledAt: true,
      paidAt: true,
      payerMemberId: true,
      status: true,
      stripeChargeIdEncrypted: true,
      stripeChargeLookupKey: true,
      stripeCheckoutSessionIdEncrypted: true,
      stripeCheckoutSessionLookupKey: true,
      stripePaymentIntentIdEncrypted: true,
      stripePaymentIntentLookupKey: true,
      terminalAt: true,
    },
    where: buildHostedUsageCreditAccountDeletionScope(memberIds),
  });
  for (const purchase of purchases) {
    assertHostedUsageCreditPurchaseHasCurrentAccountDeletionOwnership({
      memberIds,
      purchase,
    });
    if (!isHostedUsageCreditPurchaseSafeForAccountDeletion(purchase)) {
      throw buildHostedUsageCreditAccountDeletionUnresolvedError();
    }
  }
}

export function buildHostedUsageCreditCheckoutMetadata(
  purchaseId: string,
): Record<string, string> {
  return {
    policyVersion: HOSTED_USAGE_CREDIT_CHECKOUT_REQUEST_POLICY_VERSION,
    purchaseId,
    purpose: HOSTED_USAGE_CREDIT_CHECKOUT_PURPOSE,
  };
}

export async function encryptHostedUsageCreditPurchaseStripeField(input: {
  field: HostedUsageCreditPurchaseStripePrivateField;
  payerMemberId: string;
  prisma: HostedOnboardingReadClient;
  signal?: AbortSignal;
  value: string | null | undefined;
}): Promise<string | null> {
  return encryptHostedWebNullableString({
    field: input.field,
    memberId: input.payerMemberId,
    prisma: input.prisma,
    signal: input.signal,
    value: input.value,
  });
}

export async function decryptHostedUsageCreditPurchaseStripeField(input: {
  field: HostedUsageCreditPurchaseStripePrivateField;
  payerMemberId: string;
  prisma: HostedOnboardingReadClient;
  signal?: AbortSignal;
  value: string | null | undefined;
}): Promise<string | null> {
  return decryptHostedWebNullableString({
    field: input.field,
    memberId: input.payerMemberId,
    prisma: input.prisma,
    signal: input.signal,
    value: input.value,
  });
}

async function continueHostedUsageCreditCheckout(input: {
  now: Date;
  prisma: PrismaClient;
  purchase: HostedUsageCreditPurchase;
}): Promise<HostedUsageCreditCheckoutResult> {
  const purchase = await prepareHostedUsageCreditPurchaseForCheckout({
    now: input.now,
    prisma: input.prisma,
    purchase: input.purchase,
  });
  const projected = await projectHostedUsageCreditCheckoutResult({
    prisma: input.prisma,
    purchase,
  });

  if (
    purchase.checkoutCreateState !== HostedUsageCreditCheckoutCreateState.claimed ||
    purchase.status !== HostedUsageCreditPurchaseStatus.created ||
    input.now.getTime() >= purchase.checkoutCreateRetryCutoffAt.getTime()
  ) {
    return projected;
  }

  const { stripe, stripeLiveMode } = requireHostedStripeApiMode();
  if (stripeLiveMode !== purchase.stripeLiveMode) {
    throw hostedOnboardingError({
      code: "HOSTED_USAGE_CREDIT_STRIPE_MODE_MISMATCH",
      httpStatus: 500,
      message: "Usage-credit checkout is temporarily unavailable.",
    });
  }

  const checkoutRequest = await reconstructHostedUsageCreditStripeCheckoutRequest({
    prisma: input.prisma,
    purchase,
  });
  await assertHostedUsageCreditStripePriceMatchesPurchase({
    checkoutRequest,
    purchase,
    stripe,
  });
  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.create(checkoutRequest, {
      idempotencyKey: buildHostedUsageCreditCheckoutIdempotencyKey(purchase.id),
    });
  } catch (error) {
    throw hostedOnboardingError({
      code: "HOSTED_USAGE_CREDIT_STRIPE_UNAVAILABLE",
      details: describeSafeHostedUsageCreditStripeError(error),
      httpStatus: 502,
      message: "Stripe checkout is temporarily unavailable. Try again with the same request.",
      retryable: true,
    });
  }

  assertHostedUsageCreditStripeSessionMatchesPurchase({
    purchase,
    session,
  });
  const attached = await bindHostedUsageCreditCheckoutSession({
    now: input.now,
    prisma: input.prisma,
    purchase,
    session,
  });
  await assertHostedUsageCreditCheckoutCanBeReturned({
    memberId: purchase.payerMemberId,
    prisma: input.prisma,
  });

  return projectHostedUsageCreditCheckoutResult({
    prisma: input.prisma,
    purchase: attached,
  });
}

async function prepareHostedUsageCreditPurchaseForCheckout(input: {
  now: Date;
  prisma: PrismaClient;
  purchase: HostedUsageCreditPurchase;
}): Promise<HostedUsageCreditPurchase> {
  return input.prisma.$transaction(async (tx) => {
    await lockHostedMemberRow(tx, input.purchase.payerMemberId);
    const current = await tx.hostedUsageCreditPurchase.findUnique({
      where: { id: input.purchase.id },
    });
    if (!current || current.payerMemberId !== input.purchase.payerMemberId) {
      throw buildHostedUsageCreditPurchaseNotFoundError();
    }
    const member = await tx.hostedMember.findUnique({
      select: { suspendedAt: true },
      where: { id: current.payerMemberId },
    });
    if (!member || member.suspendedAt) {
      throw buildHostedUsageCreditNotEligibleError();
    }
    assertHostedUsageCreditRequestFingerprintMatches(
      current,
      input.purchase.requestFingerprint,
    );

    if (
      current.status === HostedUsageCreditPurchaseStatus.created &&
      (
        current.checkoutCreateState === HostedUsageCreditCheckoutCreateState.not_started ||
        current.checkoutCreateState === HostedUsageCreditCheckoutCreateState.claimed
      ) &&
      input.now.getTime() >= current.checkoutExpiresAt.getTime()
    ) {
      const closed = await tx.hostedUsageCreditPurchase.updateMany({
        data: {
          checkoutCreateState: HostedUsageCreditCheckoutCreateState.closed,
          reconciliationVersion: { increment: 1n },
          status: HostedUsageCreditPurchaseStatus.expired,
          terminalAt: input.now,
          updatedAt: input.now,
        },
        where: {
          checkoutCreateState: {
            in: [
              HostedUsageCreditCheckoutCreateState.not_started,
              HostedUsageCreditCheckoutCreateState.claimed,
            ],
          },
          checkoutExpiresAt: { lte: input.now },
          id: current.id,
          reconciliationVersion: current.reconciliationVersion,
          status: HostedUsageCreditPurchaseStatus.created,
        },
      });
      if (closed.count !== 1) {
        throw buildHostedUsageCreditInvariantError("checkout_expiry_close_failed");
      }
      return {
        ...current,
        checkoutCreateState: HostedUsageCreditCheckoutCreateState.closed,
        reconciliationVersion: current.reconciliationVersion + 1n,
        status: HostedUsageCreditPurchaseStatus.expired,
        terminalAt: input.now,
        updatedAt: input.now,
      };
    }

    if (
      current.checkoutCreateState !== HostedUsageCreditCheckoutCreateState.not_started ||
      current.status !== HostedUsageCreditPurchaseStatus.created
    ) {
      return current;
    }

    const claimed = await tx.hostedUsageCreditPurchase.updateMany({
      data: {
        checkoutCreateState: HostedUsageCreditCheckoutCreateState.claimed,
        reconciliationVersion: { increment: 1n },
        updatedAt: input.now,
      },
      where: {
        checkoutCreateState: HostedUsageCreditCheckoutCreateState.not_started,
        id: current.id,
        reconciliationVersion: current.reconciliationVersion,
        status: HostedUsageCreditPurchaseStatus.created,
      },
    });
    if (claimed.count !== 1) {
      throw buildHostedUsageCreditInvariantError("checkout_claim_failed");
    }

    return {
      ...current,
      checkoutCreateState: HostedUsageCreditCheckoutCreateState.claimed,
      reconciliationVersion: current.reconciliationVersion + 1n,
      updatedAt: input.now,
    };
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

async function assertHostedUsageCreditCheckoutCanBeReturned(input: {
  memberId: string;
  prisma: PrismaClient;
}): Promise<void> {
  await input.prisma.$transaction(async (tx) => {
    await lockHostedMemberRow(tx, input.memberId);
    const member = await tx.hostedMember.findUnique({
      select: { suspendedAt: true },
      where: { id: input.memberId },
    });
    if (!member || member.suspendedAt) {
      throw buildHostedUsageCreditNotEligibleError();
    }
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

async function bindHostedUsageCreditCheckoutSession(input: {
  now: Date;
  prisma: PrismaClient;
  purchase: HostedUsageCreditPurchase;
  session: Stripe.Checkout.Session;
}): Promise<HostedUsageCreditPurchase> {
  const sessionLookupKey = requireHostedUsageCreditLookupKey(
    createHostedStripeCheckoutSessionLookupKey(input.session.id),
    "checkout_session",
  );

  return input.prisma.$transaction(async (tx) => {
    await lockHostedMemberRow(tx, input.purchase.payerMemberId);
    const current = await tx.hostedUsageCreditPurchase.findUnique({
      where: { id: input.purchase.id },
    });
    if (!current || current.payerMemberId !== input.purchase.payerMemberId) {
      throw buildHostedUsageCreditPurchaseNotFoundError();
    }

    if (current.stripeCheckoutSessionLookupKey) {
      const currentSessionId = await decryptHostedUsageCreditPurchaseStripeField({
        field: HOSTED_USAGE_CREDIT_PURCHASE_STRIPE_PRIVATE_FIELDS.checkoutSessionId,
        payerMemberId: current.payerMemberId,
        prisma: tx,
        value: current.stripeCheckoutSessionIdEncrypted,
      });
      if (currentSessionId !== input.session.id) {
        throw buildHostedUsageCreditInvariantError("multiple_checkout_sessions");
      }
      return current;
    }

    if (
      current.checkoutCreateState !== HostedUsageCreditCheckoutCreateState.claimed ||
      current.status !== HostedUsageCreditPurchaseStatus.created
    ) {
      return current;
    }

    const [stripeCheckoutSessionIdEncrypted, stripeCheckoutUrlEncrypted] =
      await Promise.all([
        encryptHostedUsageCreditPurchaseStripeField({
          field: HOSTED_USAGE_CREDIT_PURCHASE_STRIPE_PRIVATE_FIELDS.checkoutSessionId,
          payerMemberId: current.payerMemberId,
          prisma: tx,
          value: input.session.id,
        }),
        encryptHostedUsageCreditPurchaseStripeField({
          field: HOSTED_USAGE_CREDIT_PURCHASE_STRIPE_PRIVATE_FIELDS.checkoutUrl,
          payerMemberId: current.payerMemberId,
          prisma: tx,
          value: input.session.url,
        }),
      ]);
    const terminal = input.session.status === "expired";
    const status = terminal
      ? HostedUsageCreditPurchaseStatus.expired
      : input.session.status === "complete" || input.session.payment_status === "paid"
        ? HostedUsageCreditPurchaseStatus.payment_pending
        : HostedUsageCreditPurchaseStatus.checkout_open;
    const updated = await tx.hostedUsageCreditPurchase.updateMany({
      data: {
        checkoutCreateState: terminal
          ? HostedUsageCreditCheckoutCreateState.closed
          : HostedUsageCreditCheckoutCreateState.attached,
        reconciliationVersion: { increment: 1n },
        status,
        stripeCheckoutSessionIdEncrypted,
        stripeCheckoutSessionLookupKey: sessionLookupKey,
        stripeCheckoutUrlEncrypted,
        terminalAt: terminal ? input.now : null,
        updatedAt: input.now,
      },
      where: {
        checkoutCreateState: HostedUsageCreditCheckoutCreateState.claimed,
        id: current.id,
        reconciliationVersion: current.reconciliationVersion,
        status: HostedUsageCreditPurchaseStatus.created,
      },
    });
    if (updated.count !== 1) {
      throw buildHostedUsageCreditInvariantError("checkout_attach_failed");
    }

    const attached = await tx.hostedUsageCreditPurchase.findUnique({
      where: { id: current.id },
    });
    if (!attached) {
      throw buildHostedUsageCreditPurchaseNotFoundError();
    }
    return attached;
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

async function projectHostedUsageCreditCheckoutResult(input: {
  prisma: HostedOnboardingReadClient;
  purchase: HostedUsageCreditPurchase;
}): Promise<HostedUsageCreditCheckoutResult> {
  const status = projectHostedUsageCreditPublicPurchaseStatus(input.purchase);
  if (
    status !== "checkout_open" ||
    !input.purchase.stripeCheckoutUrlEncrypted
  ) {
    return {
      purchaseId: input.purchase.id,
      status,
    };
  }

  const url = await decryptHostedUsageCreditPurchaseStripeField({
    field: HOSTED_USAGE_CREDIT_PURCHASE_STRIPE_PRIVATE_FIELDS.checkoutUrl,
    payerMemberId: input.purchase.payerMemberId,
    prisma: input.prisma,
    value: input.purchase.stripeCheckoutUrlEncrypted,
  });
  if (!url) {
    throw buildHostedUsageCreditInvariantError("checkout_url_missing");
  }

  return {
    purchaseId: input.purchase.id,
    status,
    url,
  };
}

function projectHostedUsageCreditPublicPurchaseStatus(input: Pick<
  HostedUsageCreditPurchase,
  "checkoutCreateState" | "status"
>): HostedUsageCreditPublicPurchaseStatus {
  switch (input.status) {
    case HostedUsageCreditPurchaseStatus.checkout_open:
    case HostedUsageCreditPurchaseStatus.payment_pending:
    case HostedUsageCreditPurchaseStatus.fulfilled:
    case HostedUsageCreditPurchaseStatus.expired:
    case HostedUsageCreditPurchaseStatus.payment_failed:
      return input.status;
    case HostedUsageCreditPurchaseStatus.created:
      return "reconciling";
  }
}

function buildHostedUsageCreditPurchaseStatusResult(input: Pick<
  HostedUsageCreditPurchase,
  | "checkoutCreateState"
  | "checkoutExpiresAt"
  | "fulfilledAt"
  | "id"
  | "status"
  | "updatedAt"
>): HostedUsageCreditPurchaseStatusResult {
  return {
    checkoutExpiresAt: input.checkoutExpiresAt.toISOString(),
    fulfilledAt: input.fulfilledAt?.toISOString() ?? null,
    purchaseId: input.id,
    status: projectHostedUsageCreditPublicPurchaseStatus(input),
    updatedAt: input.updatedAt.toISOString(),
  };
}

async function closeExpiredUnattachedHostedUsageCreditPurchasesTx(input: {
  now: Date;
  payerMemberId: string;
  purchaseId?: string;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  await input.tx.hostedUsageCreditPurchase.updateMany({
    data: {
      checkoutCreateState: HostedUsageCreditCheckoutCreateState.closed,
      reconciliationVersion: { increment: 1n },
      status: HostedUsageCreditPurchaseStatus.expired,
      terminalAt: input.now,
      updatedAt: input.now,
    },
    where: {
      checkoutCreateState: {
        in: [
          HostedUsageCreditCheckoutCreateState.not_started,
          HostedUsageCreditCheckoutCreateState.claimed,
        ],
      },
      checkoutExpiresAt: { lte: input.now },
      ...(input.purchaseId ? { id: input.purchaseId } : {}),
      payerMemberId: input.payerMemberId,
      status: HostedUsageCreditPurchaseStatus.created,
    },
  });
}

async function retrieveAndExpireHostedUsageCreditStripeSession(input: {
  purchase: HostedUsageCreditPurchase;
  sessionId: string;
  stripe: Stripe;
}): Promise<Stripe.Checkout.Session> {
  let session = await retrieveHostedUsageCreditStripeSession(input);
  const state = projectHostedUsageCreditStripeSessionState(session);
  if (state !== "checkout_open") {
    return session;
  }

  try {
    session = await input.stripe.checkout.sessions.expire(input.sessionId);
  } catch (error) {
    session = await retrieveHostedUsageCreditStripeSession(input);
    if (projectHostedUsageCreditStripeSessionState(session) === "checkout_open") {
      throw buildHostedUsageCreditStripeUnavailableError(error);
    }
    return session;
  }

  assertHostedUsageCreditStripeSessionMatchesPurchase({
    purchase: input.purchase,
    session,
  });
  return session;
}

async function resolveHostedUsageCreditStripeSessionForAccountDeletion(input: {
  now: Date;
  prisma: PrismaClient;
  purchase: HostedUsageCreditPurchase;
}): Promise<
  | { kind: "absent_after_expiry" }
  | { kind: "session"; session: Stripe.Checkout.Session }
> {
  const { stripe, stripeLiveMode } = requireHostedStripeApiMode();
  if (stripeLiveMode !== input.purchase.stripeLiveMode) {
    throw hostedOnboardingError({
      code: "HOSTED_USAGE_CREDIT_STRIPE_MODE_MISMATCH",
      httpStatus: 500,
      message: "Usage-credit checkout is temporarily unavailable.",
    });
  }

  const sessionId = await decryptHostedUsageCreditPurchaseStripeField({
    field: HOSTED_USAGE_CREDIT_PURCHASE_STRIPE_PRIVATE_FIELDS.checkoutSessionId,
    payerMemberId: input.purchase.payerMemberId,
    prisma: input.prisma,
    value: input.purchase.stripeCheckoutSessionIdEncrypted,
  });
  let resolvedSessionId = sessionId;
  if (sessionId) {
    if (
      !hostedLookupKeyMatchesValue({
        expectedLookupKey: input.purchase.stripeCheckoutSessionLookupKey,
        kind: "stripe-checkout-session",
        normalizedValue: sessionId,
      })
    ) {
      throw buildHostedUsageCreditInvariantError("checkout_session_identity_invalid");
    }
  } else {
    if (input.purchase.stripeCheckoutSessionLookupKey) {
      throw buildHostedUsageCreditInvariantError("checkout_session_identity_invalid");
    }
    const checkoutRequest = await reconstructHostedUsageCreditStripeCheckoutRequest({
      prisma: input.prisma,
      purchase: input.purchase,
    });
    let replayedSession: Stripe.Checkout.Session | null = null;
    try {
      replayedSession = await stripe.checkout.sessions.create(checkoutRequest, {
        idempotencyKey: buildHostedUsageCreditCheckoutIdempotencyKey(input.purchase.id),
      });
    } catch (error) {
      if (
        input.now.getTime() >= input.purchase.checkoutExpiresAt.getTime() &&
        isDefinitiveHostedUsageCreditStripeRequestRejection(error)
      ) {
        const matchedSession = await findHostedUsageCreditStripeSessionForExpiredAttempt({
          checkoutRequest,
          purchase: input.purchase,
          stripe,
        });
        if (!matchedSession) {
          return { kind: "absent_after_expiry" };
        }
        resolvedSessionId = matchedSession.id;
      } else {
        throw buildHostedUsageCreditStripeUnavailableError(error);
      }
    }
    if (replayedSession) {
      assertHostedUsageCreditStripeSessionMatchesPurchase({
        purchase: input.purchase,
        session: replayedSession,
      });
      resolvedSessionId = replayedSession.id;
    }
  }

  if (!resolvedSessionId) {
    throw buildHostedUsageCreditInvariantError("checkout_session_identity_invalid");
  }
  return {
    kind: "session",
    session: await retrieveAndExpireHostedUsageCreditStripeSession({
      purchase: input.purchase,
      sessionId: resolvedSessionId,
      stripe,
    }),
  };
}

async function findHostedUsageCreditStripeSessionForExpiredAttempt(input: {
  checkoutRequest: Stripe.Checkout.SessionCreateParams;
  purchase: HostedUsageCreditPurchase;
  stripe: Stripe;
}): Promise<Stripe.Checkout.Session | null> {
  const customerId = coerceStripeObjectId(input.checkoutRequest.customer);
  if (!customerId) {
    throw buildHostedUsageCreditInvariantError("checkout_customer_missing");
  }

  let matchedSession: Stripe.Checkout.Session | null = null;
  let startingAfter: string | undefined;
  const seenPageBoundaries = new Set<string>();
  while (true) {
    let page: Stripe.ApiList<Stripe.Checkout.Session>;
    try {
      page = await input.stripe.checkout.sessions.list({
        created: {
          gte: Math.max(
            0,
            Math.floor(input.purchase.createdAt.getTime() / 1_000) - 1,
          ),
          lte: Math.floor(input.purchase.checkoutExpiresAt.getTime() / 1_000),
        },
        customer: customerId,
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });
    } catch (error) {
      throw buildHostedUsageCreditStripeUnavailableError(error);
    }

    for (const session of page.data) {
      if (
        session.client_reference_id !== input.purchase.checkoutClientReferenceId &&
        session.metadata?.purchaseId !== input.purchase.id
      ) {
        continue;
      }
      assertHostedUsageCreditStripeSessionMatchesPurchase({
        purchase: input.purchase,
        session,
      });
      if (matchedSession && matchedSession.id !== session.id) {
        throw buildHostedUsageCreditInvariantError("multiple_checkout_sessions");
      }
      matchedSession = session;
    }

    if (!page.has_more) {
      return matchedSession;
    }
    const pageBoundary = page.data.at(-1)?.id;
    if (!pageBoundary || seenPageBoundaries.has(pageBoundary)) {
      throw buildHostedUsageCreditInvariantError("checkout_session_list_invalid");
    }
    seenPageBoundaries.add(pageBoundary);
    startingAfter = pageBoundary;
  }
}

async function prepareHostedUsageCreditPurchaseForAccountDeletion(input: {
  prisma: PrismaClient;
  purchase: HostedUsageCreditPurchase;
}): Promise<HostedUsageCreditPurchase> {
  return input.prisma.$transaction(async (tx) => {
    await lockHostedMemberRow(tx, input.purchase.payerMemberId);
    const current = await tx.hostedUsageCreditPurchase.findUnique({
      where: { id: input.purchase.id },
    });
    if (!current || current.payerMemberId !== input.purchase.payerMemberId) {
      throw buildHostedUsageCreditAccountDeletionUnresolvedError();
    }
    const member = await tx.hostedMember.findUnique({
      select: {
        suspendedAt: true,
      },
      where: { id: current.payerMemberId },
    });
    if (!member?.suspendedAt) {
      throw buildHostedUsageCreditAccountDeletionUnresolvedError();
    }
    return current;
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

async function persistHostedUsageCreditAccountDeletionSessionState(input: {
  now: Date;
  prisma: PrismaClient;
  purchase: HostedUsageCreditPurchase;
  session: Stripe.Checkout.Session;
}): Promise<HostedUsageCreditPurchase> {
  assertHostedUsageCreditStripeSessionMatchesPurchase({
    purchase: input.purchase,
    session: input.session,
  });
  const providerState = projectHostedUsageCreditStripeSessionState(input.session);
  if (providerState === "checkout_open") {
    throw buildHostedUsageCreditInvariantError("stripe_session_remained_open");
  }
  const sessionLookupKey = requireHostedUsageCreditLookupKey(
    createHostedStripeCheckoutSessionLookupKey(input.session.id),
    "checkout_session",
  );
  const [stripeCheckoutSessionIdEncrypted, stripeCheckoutUrlEncrypted] =
    await Promise.all([
      encryptHostedUsageCreditPurchaseStripeField({
        field: HOSTED_USAGE_CREDIT_PURCHASE_STRIPE_PRIVATE_FIELDS.checkoutSessionId,
        payerMemberId: input.purchase.payerMemberId,
        prisma: input.prisma,
        value: input.session.id,
      }),
      encryptHostedUsageCreditPurchaseStripeField({
        field: HOSTED_USAGE_CREDIT_PURCHASE_STRIPE_PRIVATE_FIELDS.checkoutUrl,
        payerMemberId: input.purchase.payerMemberId,
        prisma: input.prisma,
        value: null,
      }),
    ]);
  const nextStatus = providerState === "expired"
    ? HostedUsageCreditPurchaseStatus.expired
    : HostedUsageCreditPurchaseStatus.payment_pending;
  const nextCheckoutCreateState = providerState === "expired"
    ? HostedUsageCreditCheckoutCreateState.closed
    : HostedUsageCreditCheckoutCreateState.attached;

  return input.prisma.$transaction(async (tx) => {
    await lockHostedMemberRow(tx, input.purchase.payerMemberId);
    const current = await tx.hostedUsageCreditPurchase.findUnique({
      where: { id: input.purchase.id },
    });
    if (!current || current.payerMemberId !== input.purchase.payerMemberId) {
      throw buildHostedUsageCreditAccountDeletionUnresolvedError();
    }
    if (isHostedUsageCreditPurchaseSafeForAccountDeletion(current)) {
      return current;
    }
    if (current.status === HostedUsageCreditPurchaseStatus.payment_pending) {
      return current;
    }
    if (current.reconciliationVersion !== input.purchase.reconciliationVersion) {
      throw buildHostedUsageCreditAccountDeletionUnresolvedError();
    }
    if (
      current.stripeCheckoutSessionIdEncrypted !==
        input.purchase.stripeCheckoutSessionIdEncrypted ||
      current.stripeCheckoutSessionLookupKey !==
        input.purchase.stripeCheckoutSessionLookupKey
    ) {
      throw buildHostedUsageCreditInvariantError("checkout_session_identity_changed");
    }

    const updated = await tx.hostedUsageCreditPurchase.updateMany({
      data: {
        checkoutCreateState: nextCheckoutCreateState,
        lastReconciledAt: input.now,
        reconciliationVersion: { increment: 1n },
        status: nextStatus,
        stripeCheckoutSessionIdEncrypted: requireHostedUsageCreditEncryptedValue(
          stripeCheckoutSessionIdEncrypted,
          "checkout_session",
        ),
        stripeCheckoutSessionLookupKey: sessionLookupKey,
        stripeCheckoutUrlEncrypted,
        terminalAt: providerState === "expired" ? input.now : null,
        updatedAt: input.now,
      },
      where: {
        id: current.id,
        payerMemberId: current.payerMemberId,
        reconciliationVersion: input.purchase.reconciliationVersion,
        status: {
          in: [
            HostedUsageCreditPurchaseStatus.created,
            HostedUsageCreditPurchaseStatus.checkout_open,
            HostedUsageCreditPurchaseStatus.expired,
          ],
        },
      },
    });
    if (updated.count !== 1) {
      throw buildHostedUsageCreditAccountDeletionUnresolvedError();
    }
    const reconciled = await tx.hostedUsageCreditPurchase.findUnique({
      where: { id: current.id },
    });
    if (!reconciled) {
      throw buildHostedUsageCreditAccountDeletionUnresolvedError();
    }
    return reconciled;
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

async function persistHostedUsageCreditAccountDeletionNoSessionProof(input: {
  now: Date;
  prisma: PrismaClient;
  purchase: HostedUsageCreditPurchase;
}): Promise<HostedUsageCreditPurchase> {
  if (
    input.purchase.stripeCheckoutSessionIdEncrypted ||
    input.purchase.stripeCheckoutSessionLookupKey
  ) {
    throw buildHostedUsageCreditInvariantError("checkout_session_identity_invalid");
  }

  return input.prisma.$transaction(async (tx) => {
    await lockHostedMemberRow(tx, input.purchase.payerMemberId);
    const current = await tx.hostedUsageCreditPurchase.findUnique({
      where: { id: input.purchase.id },
    });
    if (!current || current.payerMemberId !== input.purchase.payerMemberId) {
      throw buildHostedUsageCreditAccountDeletionUnresolvedError();
    }
    if (isHostedUsageCreditPurchaseSafeForAccountDeletion(current)) {
      return current;
    }
    if (current.status === HostedUsageCreditPurchaseStatus.payment_pending) {
      return current;
    }
    if (
      current.reconciliationVersion !== input.purchase.reconciliationVersion ||
      current.stripeCheckoutSessionIdEncrypted !== null ||
      current.stripeCheckoutSessionLookupKey !== null
    ) {
      throw buildHostedUsageCreditAccountDeletionUnresolvedError();
    }

    const updated = await tx.hostedUsageCreditPurchase.updateMany({
      data: {
        checkoutCreateState: HostedUsageCreditCheckoutCreateState.closed,
        lastReconciledAt: input.now,
        reconciliationVersion: { increment: 1n },
        status: HostedUsageCreditPurchaseStatus.expired,
        stripeCheckoutUrlEncrypted: null,
        terminalAt: input.now,
        updatedAt: input.now,
      },
      where: {
        id: current.id,
        payerMemberId: current.payerMemberId,
        reconciliationVersion: input.purchase.reconciliationVersion,
        status: {
          in: [
            HostedUsageCreditPurchaseStatus.created,
            HostedUsageCreditPurchaseStatus.expired,
          ],
        },
        stripeCheckoutSessionIdEncrypted: null,
        stripeCheckoutSessionLookupKey: null,
      },
    });
    if (updated.count !== 1) {
      throw buildHostedUsageCreditAccountDeletionUnresolvedError();
    }
    const reconciled = await tx.hostedUsageCreditPurchase.findUnique({
      where: { id: current.id },
    });
    if (!reconciled) {
      throw buildHostedUsageCreditAccountDeletionUnresolvedError();
    }
    return reconciled;
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

async function retrieveHostedUsageCreditStripeSession(input: {
  purchase: HostedUsageCreditPurchase;
  sessionId: string;
  stripe: Stripe;
}): Promise<Stripe.Checkout.Session> {
  let session: Stripe.Checkout.Session;
  try {
    session = await input.stripe.checkout.sessions.retrieve(input.sessionId);
  } catch (error) {
    throw buildHostedUsageCreditStripeUnavailableError(error);
  }
  assertHostedUsageCreditStripeSessionMatchesPurchase({
    purchase: input.purchase,
    session,
  });
  return session;
}

function projectHostedUsageCreditStripeSessionState(
  session: Stripe.Checkout.Session,
): "checkout_open" | "expired" | "payment_pending" {
  if (session.payment_status === "paid" || session.status === "complete") {
    return "payment_pending";
  }
  if (session.status === "expired" && session.payment_status === "unpaid") {
    return "expired";
  }
  if (session.status === "open" && session.payment_status === "unpaid") {
    return "checkout_open";
  }
  throw buildHostedUsageCreditInvariantError("stripe_session_state_invalid");
}

function buildHostedUsageCreditAccountDeletionScope(
  memberIds: readonly string[],
): Prisma.HostedUsageCreditPurchaseWhereInput {
  return {
    OR: [
      { beneficiaryMemberId: { in: [...memberIds] } },
      { payerMemberId: { in: [...memberIds] } },
    ],
  };
}

function assertHostedUsageCreditPurchaseHasCurrentAccountDeletionOwnership(input: {
  memberIds: readonly string[];
  purchase: Pick<
    HostedUsageCreditPurchase,
    "authorizationContext" | "beneficiaryMemberId" | "payerMemberId"
  >;
}): void {
  if (
    input.purchase.authorizationContext !== HOSTED_USAGE_CREDIT_AUTHORIZATION_CONTEXT ||
    input.purchase.payerMemberId !== input.purchase.beneficiaryMemberId ||
    !input.memberIds.includes(input.purchase.payerMemberId)
  ) {
    throw buildHostedUsageCreditAccountDeletionUnresolvedError();
  }
}

function isHostedUsageCreditPurchaseSafeForAccountDeletion(input: Pick<
  HostedUsageCreditPurchase,
  | "checkoutCreateState"
  | "fulfilledAt"
  | "lastReconciledAt"
  | "paidAt"
  | "status"
  | "stripeChargeIdEncrypted"
  | "stripeChargeLookupKey"
  | "stripeCheckoutSessionIdEncrypted"
  | "stripeCheckoutSessionLookupKey"
  | "stripePaymentIntentIdEncrypted"
  | "stripePaymentIntentLookupKey"
  | "terminalAt"
>): boolean {
  if (
    input.checkoutCreateState !== HostedUsageCreditCheckoutCreateState.closed ||
    !input.lastReconciledAt ||
    !input.terminalAt
  ) {
    return false;
  }
  const hasSessionProof = Boolean(
    input.stripeCheckoutSessionIdEncrypted &&
    input.stripeCheckoutSessionLookupKey
  );
  const hasNoSessionProof =
    input.stripeCheckoutSessionIdEncrypted === null &&
    input.stripeCheckoutSessionLookupKey === null;
  if (!hasSessionProof && !hasNoSessionProof) {
    return false;
  }

  switch (input.status) {
    case HostedUsageCreditPurchaseStatus.expired:
      return true;
    case HostedUsageCreditPurchaseStatus.payment_failed:
      return hasSessionProof;
    case HostedUsageCreditPurchaseStatus.fulfilled:
      return Boolean(
        hasSessionProof &&
        input.fulfilledAt &&
        input.paidAt &&
        input.stripeChargeIdEncrypted &&
        input.stripeChargeLookupKey &&
        input.stripePaymentIntentIdEncrypted &&
        input.stripePaymentIntentLookupKey
      );
    case HostedUsageCreditPurchaseStatus.created:
    case HostedUsageCreditPurchaseStatus.checkout_open:
    case HostedUsageCreditPurchaseStatus.payment_pending:
      return false;
  }
}

async function reconstructHostedUsageCreditStripeCheckoutRequest(input: {
  prisma: HostedOnboardingReadClient;
  purchase: HostedUsageCreditPurchase;
}): Promise<Stripe.Checkout.SessionCreateParams> {
  if (
    input.purchase.authorizationContext !== HOSTED_USAGE_CREDIT_AUTHORIZATION_CONTEXT ||
    input.purchase.checkoutRequestPolicyVersion !==
      HOSTED_USAGE_CREDIT_CHECKOUT_REQUEST_POLICY_VERSION ||
    input.purchase.checkoutClientReferenceId !== input.purchase.id
  ) {
    throw buildHostedUsageCreditInvariantError("checkout_policy_mismatch");
  }

  const [priceId, stripeCustomerId] = await Promise.all([
    decryptHostedUsageCreditPurchaseStripeField({
      field: HOSTED_USAGE_CREDIT_PURCHASE_STRIPE_PRIVATE_FIELDS.priceId,
      payerMemberId: input.purchase.payerMemberId,
      prisma: input.prisma,
      value: input.purchase.stripePriceIdEncrypted,
    }),
    decryptHostedUsageCreditPurchaseStripeField({
      field: HOSTED_USAGE_CREDIT_PURCHASE_STRIPE_PRIVATE_FIELDS.customerId,
      payerMemberId: input.purchase.payerMemberId,
      prisma: input.prisma,
      value: input.purchase.stripeCustomerIdEncrypted,
    }),
  ]);
  if (!priceId || !stripeCustomerId) {
    throw buildHostedUsageCreditInvariantError("checkout_private_fields_missing");
  }
  if (
    !createHostedStripeCustomerLookupKeyReadCandidates(stripeCustomerId)
      .includes(input.purchase.stripeCustomerLookupKey)
  ) {
    throw buildHostedUsageCreditInvariantError("checkout_customer_lookup_mismatch");
  }

  const metadata = parseHostedUsageCreditCheckoutMetadata({
    purchaseId: input.purchase.id,
    value: input.purchase.checkoutMetadataJson,
  });
  const checkoutRequest = buildHostedUsageCreditStripeCheckoutRequest({
    checkoutCancelUrl: input.purchase.checkoutCancelUrl,
    checkoutExpiresAt: input.purchase.checkoutExpiresAt,
    checkoutMetadata: metadata,
    checkoutSuccessUrl: input.purchase.checkoutSuccessUrl,
    priceId,
    purchaseId: input.purchase.checkoutClientReferenceId,
    stripeCustomerId,
  });
  if (
    buildHostedUsageCreditCheckoutRequestDigest(checkoutRequest) !==
      input.purchase.checkoutRequestDigest
  ) {
    throw buildHostedUsageCreditInvariantError("checkout_request_digest_mismatch");
  }

  return checkoutRequest;
}

function buildHostedUsageCreditStripeCheckoutRequest(input: {
  checkoutCancelUrl: string;
  checkoutExpiresAt: Date;
  checkoutMetadata: Record<string, string>;
  checkoutSuccessUrl: string;
  priceId: string;
  purchaseId: string;
  stripeCustomerId: string;
}): Stripe.Checkout.SessionCreateParams {
  return {
    adaptive_pricing: { enabled: false },
    cancel_url: input.checkoutCancelUrl,
    client_reference_id: input.purchaseId,
    customer: input.stripeCustomerId,
    expires_at: Math.floor(input.checkoutExpiresAt.getTime() / 1_000),
    line_items: [{ price: input.priceId, quantity: 1 }],
    metadata: input.checkoutMetadata,
    mode: "payment",
    payment_intent_data: {
      metadata: input.checkoutMetadata,
    },
    success_url: input.checkoutSuccessUrl,
  };
}

async function assertHostedUsageCreditStripePriceMatchesPurchase(input: {
  checkoutRequest: Stripe.Checkout.SessionCreateParams;
  purchase: HostedUsageCreditPurchase;
  stripe: Stripe;
}): Promise<void> {
  const [lineItem] = input.checkoutRequest.line_items ?? [];
  const priceId = typeof lineItem?.price === "string" ? lineItem.price : null;
  if (
    !priceId ||
    !hostedLookupKeyMatchesValue({
      expectedLookupKey: input.purchase.stripePriceLookupKey,
      kind: "stripe-price",
      normalizedValue: priceId,
    })
  ) {
    throw buildHostedUsageCreditInvariantError("checkout_price_identity_invalid");
  }

  let price: Stripe.Price;
  try {
    price = await input.stripe.prices.retrieve(priceId, {
      expand: ["currency_options"],
    });
  } catch (error) {
    throw buildHostedUsageCreditStripeUnavailableError(error);
  }

  if (price.id !== priceId || price.object !== "price") {
    throw buildHostedUsageCreditPriceConfigurationError("price_identity_mismatch");
  }
  if (price.livemode !== input.purchase.stripeLiveMode) {
    throw buildHostedUsageCreditPriceConfigurationError("price_mode_mismatch");
  }
  if (!price.active) {
    throw buildHostedUsageCreditPriceConfigurationError("price_inactive");
  }
  if (price.type !== "one_time" || price.recurring !== null) {
    throw buildHostedUsageCreditPriceConfigurationError("price_not_one_time");
  }
  if (price.billing_scheme !== "per_unit") {
    throw buildHostedUsageCreditPriceConfigurationError("price_billing_scheme_invalid");
  }
  if (price.currency.toLowerCase() !== input.purchase.cashCurrency.toLowerCase()) {
    throw buildHostedUsageCreditPriceConfigurationError("price_currency_mismatch");
  }
  if (price.unit_amount !== input.purchase.cashAmountMinor) {
    throw buildHostedUsageCreditPriceConfigurationError("price_amount_mismatch");
  }
  if (price.custom_unit_amount !== null) {
    throw buildHostedUsageCreditPriceConfigurationError("price_custom_amount_unsupported");
  }
  if (price.transform_quantity !== null) {
    throw buildHostedUsageCreditPriceConfigurationError("price_transform_unsupported");
  }
  if (
    price.currency_options &&
    Object.keys(price.currency_options).length > 0
  ) {
    throw buildHostedUsageCreditPriceConfigurationError(
      "price_currency_options_unsupported",
    );
  }
}

function buildHostedUsageCreditCheckoutRequestDigest(
  request: Stripe.Checkout.SessionCreateParams,
): string {
  return sha256Hex(JSON.stringify(request));
}

function buildHostedUsageCreditCheckoutIdempotencyKey(purchaseId: string): string {
  return `hosted-usage-credit-checkout:${purchaseId}`;
}

function buildHostedUsageCreditRequestFingerprint(input: {
  beneficiaryMemberId: string;
  offerCode: HostedUsageCreditOfferCode;
  payerMemberId: string;
}): string {
  return sha256Hex(JSON.stringify({
    authorizationContext: HOSTED_USAGE_CREDIT_AUTHORIZATION_CONTEXT,
    beneficiaryMemberId: input.beneficiaryMemberId,
    offerCode: input.offerCode,
    payerMemberId: input.payerMemberId,
  }));
}

function buildHostedUsageCreditCheckoutReturnUrl(input: {
  outcome: "cancel" | "success";
  publicBaseUrl: string;
  purchaseId: string;
}): string {
  const url = new URL("/settings", input.publicBaseUrl);
  url.searchParams.set("usageCheckout", input.outcome);
  url.searchParams.set("usagePurchase", input.purchaseId);
  url.hash = "subscription";
  return url.toString();
}

function assertHostedUsageCreditPurchaseEligibility(input: {
  billingRef: Awaited<ReturnType<typeof readHostedMemberStripeBillingRef>>;
  member: {
    accountGroupMemberships: readonly { id: string }[];
    billingStatus: string;
    suspendedAt: Date | null;
    threadContainer: { memberId: string } | null;
  };
}): void {
  const billingPlanCode = parseHostedBillingPlanCode(
    input.billingRef?.currentBillingPlanCode,
  );
  if (
    input.member.billingStatus !== "active" ||
    input.member.suspendedAt ||
    input.member.threadContainer ||
    input.member.accountGroupMemberships.length > 0 ||
    !billingPlanCode ||
    parseHostedBillingPhase(input.billingRef?.currentBillingPhase) !== "paid" ||
    isHostedPulseTrialBillingState({
      currentBillingPhase: input.billingRef?.currentBillingPhase,
      currentCheckoutOffer: input.billingRef?.currentCheckoutOffer,
    })
  ) {
    throw buildHostedUsageCreditNotEligibleError();
  }
}

function assertHostedUsageCreditRequestFingerprintMatches(
  purchase: Pick<HostedUsageCreditPurchase, "requestFingerprint">,
  expected: string,
): void {
  if (purchase.requestFingerprint !== expected) {
    throw hostedOnboardingError({
      code: "HOSTED_USAGE_CREDIT_REQUEST_KEY_CONFLICT",
      httpStatus: 409,
      message: "That usage-credit request key was already used for another request.",
    });
  }
}

function assertHostedUsageCreditStripeSessionMatchesPurchase(input: {
  purchase: HostedUsageCreditPurchase;
  session: Stripe.Checkout.Session;
}): void {
  const expectedMetadata = buildHostedUsageCreditCheckoutMetadata(input.purchase.id);
  const sessionCustomerId = coerceStripeObjectId(input.session.customer);
  if (
    input.session.adaptive_pricing?.enabled !== false ||
    input.session.livemode !== input.purchase.stripeLiveMode ||
    input.session.mode !== "payment" ||
    input.session.client_reference_id !== input.purchase.checkoutClientReferenceId ||
    !sessionCustomerId ||
    !createHostedStripeCustomerLookupKeyReadCandidates(sessionCustomerId)
      .includes(input.purchase.stripeCustomerLookupKey) ||
    input.session.expires_at !== Math.floor(input.purchase.checkoutExpiresAt.getTime() / 1_000) ||
    !hostedUsageCreditMetadataEqual(input.session.metadata, expectedMetadata)
  ) {
    throw buildHostedUsageCreditInvariantError("stripe_session_mismatch");
  }
}

function parseHostedUsageCreditCheckoutMetadata(input: {
  purchaseId: string;
  value: Prisma.JsonValue;
}): Record<string, string> {
  const expected = buildHostedUsageCreditCheckoutMetadata(input.purchaseId);
  if (!isRecord(input.value) || !hostedUsageCreditMetadataEqual(input.value, expected)) {
    throw buildHostedUsageCreditInvariantError("checkout_metadata_invalid");
  }
  return expected;
}

function hostedUsageCreditMetadataEqual(
  actual: Record<string, unknown> | null,
  expected: Record<string, string>,
): boolean {
  if (!actual) {
    return false;
  }
  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = Object.keys(expected).sort();
  return actualKeys.length === expectedKeys.length &&
    actualKeys.every((key, index) =>
      key === expectedKeys[index] && actual[key] === expected[key]
    );
}

function requireHostedUsageCreditLookupKey(
  value: string | null,
  field: string,
): string {
  if (!value) {
    throw buildHostedUsageCreditInvariantError(`${field}_lookup_missing`);
  }
  return value;
}

function requireHostedUsageCreditEncryptedValue(
  value: string | null,
  field: string,
): string {
  if (!value) {
    throw buildHostedUsageCreditInvariantError(`${field}_encryption_failed`);
  }
  return value;
}

function buildHostedUsageCreditNotEligibleError() {
  return hostedOnboardingError({
    code: "HOSTED_USAGE_CREDIT_NOT_ELIGIBLE",
    httpStatus: 403,
    message: "Usage credit is available for active paid Pulse or Edge plans.",
  });
}

function buildHostedUsageCreditPurchaseNotFoundError() {
  return hostedOnboardingError({
    code: "HOSTED_USAGE_CREDIT_PURCHASE_NOT_FOUND",
    httpStatus: 404,
    message: "That usage-credit purchase was not found.",
  });
}

function buildHostedUsageCreditInvariantError(reason: string) {
  return hostedOnboardingError({
    code: "HOSTED_USAGE_CREDIT_CHECKOUT_INVARIANT_FAILED",
    details: { code: reason },
    httpStatus: 500,
    message: "Usage-credit checkout could not be verified.",
  });
}

function buildHostedUsageCreditPriceConfigurationError(reason: string) {
  return hostedOnboardingError({
    code: "HOSTED_USAGE_CREDIT_STRIPE_PRICE_INVALID",
    details: { code: reason },
    httpStatus: 500,
    message: "Usage-credit checkout is temporarily unavailable.",
  });
}

function buildHostedUsageCreditStripeUnavailableError(error: unknown) {
  return hostedOnboardingError({
    code: "HOSTED_USAGE_CREDIT_STRIPE_UNAVAILABLE",
    details: describeSafeHostedUsageCreditStripeError(error),
    httpStatus: 502,
    message: "Stripe checkout is temporarily unavailable. Try again.",
    retryable: true,
  });
}

function isDefinitiveHostedUsageCreditStripeRequestRejection(
  error: unknown,
): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const candidate = error as {
    rawType?: unknown;
    statusCode?: unknown;
    type?: unknown;
  };
  return (
    candidate.type === "StripeInvalidRequestError" ||
    candidate.rawType === "invalid_request_error"
  ) &&
    typeof candidate.statusCode === "number" &&
    candidate.statusCode >= 400 &&
    candidate.statusCode < 500 &&
    candidate.statusCode !== 409 &&
    candidate.statusCode !== 429;
}

function buildHostedUsageCreditAccountDeletionPaymentPendingError() {
  return hostedOnboardingError({
    code: "ACCOUNT_DELETION_USAGE_CREDIT_PAYMENT_PENDING",
    httpStatus: 409,
    message: "A usage-credit payment is still processing. Retry account deletion after it settles.",
    retryable: true,
  });
}

function buildHostedUsageCreditAccountDeletionUnresolvedError() {
  return hostedOnboardingError({
    code: "ACCOUNT_DELETION_USAGE_CREDIT_UNRESOLVED",
    httpStatus: 503,
    message: "A usage-credit checkout could not be safely closed. Retry account deletion.",
    retryable: true,
  });
}

function describeSafeHostedUsageCreditStripeError(error: unknown): Record<string, unknown> {
  if (!error || typeof error !== "object") {
    return {};
  }
  const candidate = error as {
    code?: unknown;
    rawType?: unknown;
    requestId?: unknown;
    statusCode?: unknown;
    type?: unknown;
  };
  return {
    ...(typeof candidate.code === "string" ? { providerErrorCode: candidate.code } : {}),
    ...(typeof candidate.rawType === "string" ? { providerErrorType: candidate.rawType } : {}),
    ...(typeof candidate.type === "string" ? { providerErrorType: candidate.type } : {}),
    ...(typeof candidate.statusCode === "number" ? { statusCode: candidate.statusCode } : {}),
    ...(typeof candidate.requestId === "string" ? { providerRequestIdPresent: true } : {}),
  };
}
