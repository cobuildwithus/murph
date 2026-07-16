import type Stripe from "stripe";

import {
  HostedUsageCreditPurchaseStatus,
  type HostedUsageCreditPurchase,
  type PrismaClient,
} from "@prisma/client";

import {
  createHostedStripeCheckoutSessionLookupKey,
  createHostedStripeCustomerLookupKey,
  createHostedStripePriceLookupKey,
} from "./contact-privacy";
import { hostedOnboardingError, isHostedOnboardingError } from "./errors";
import { readHostedMemberStripeBillingRef } from "./hosted-member-billing-store";
import { readHostedPersonalUsageCreditOfferCodes } from "./personal-usage-credit-eligibility";
import {
  requireHostedOnboardingPublicBaseUrl,
  requireHostedStripeApiMode,
  requireHostedStripeUsageCreditCheckoutConfig,
} from "./runtime";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  lockHostedMemberRow,
} from "./shared";
import {
  getHostedUsageCreditOfferDefinition,
  HOSTED_USAGE_CREDIT_CHECKOUT_REQUEST_POLICY_VERSION,
  parseHostedUsageCreditOfferCode,
  type HostedUsageCreditOfferCode,
} from "./usage-credit-offers";
import {
  buildHostedUsageCreditPurchaseNotFoundError,
  canRetryHostedUsageCreditCheckoutCreate,
  closeExpiredUnattachedHostedUsageCreditPurchasesTx,
  projectHostedUsageCreditCheckoutResult,
  type HostedUsageCreditCheckoutResult,
} from "./usage-credit-purchase-status-service";
import {
  assertHostedUsageCreditStripePriceMatchesPurchase,
  assertHostedUsageCreditStripeSessionMatchesPurchase,
  buildHostedUsageCreditCheckoutIdempotencyKey,
  buildHostedUsageCreditInvariantError,
  decryptHostedUsageCreditPurchaseStripeField,
  describeSafeHostedUsageCreditStripeError,
  encryptHostedUsageCreditPurchaseStripeField,
  HOSTED_USAGE_CREDIT_PURCHASE_STRIPE_PRIVATE_FIELDS,
  reconstructHostedUsageCreditStripeCheckoutRequest,
  requireHostedUsageCreditEncryptedValue,
  requireHostedUsageCreditLookupKey,
} from "./usage-credit-purchase-stripe";
import { generateHostedRandomPrefixedId } from "../primitives";
import { getPrisma } from "../prisma";

export {
  assertHostedUsageCreditPurchasesReadyForAccountDeletionTx,
  closeHostedUsageCreditPurchasesForAccountDeletion,
} from "./usage-credit-purchase-account-deletion";
export {
  expireHostedUsageCreditCheckout,
  HOSTED_USAGE_CREDIT_PUBLIC_PURCHASE_STATUSES,
  readHostedActiveUsageCreditPurchaseForPayer,
  readHostedUsageCreditPurchaseStatus,
} from "./usage-credit-purchase-status-service";
export type {
  HostedActiveUsageCreditPurchaseProjection,
  HostedUsageCreditCheckoutResult,
  HostedUsageCreditPublicPurchaseStatus,
  HostedUsageCreditPurchaseStatusResult,
} from "./usage-credit-purchase-status-service";
export {
  buildHostedUsageCreditCheckoutMetadata,
  decryptHostedUsageCreditPurchaseStripeField,
  encryptHostedUsageCreditPurchaseStripeField,
  HOSTED_USAGE_CREDIT_PURCHASE_STRIPE_PRIVATE_FIELDS,
} from "./usage-credit-purchase-stripe";
export type {
  HostedUsageCreditPurchaseStripePrivateField,
} from "./usage-credit-purchase-stripe";

const HOSTED_USAGE_CREDIT_CHECKOUT_EXPIRY_DURATION_MS = 90 * 60 * 1_000;
const HOSTED_USAGE_CREDIT_CLIENT_REQUEST_KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/u;

const HOSTED_USAGE_CREDIT_NONTERMINAL_PURCHASE_STATUSES = [
  HostedUsageCreditPurchaseStatus.created,
  HostedUsageCreditPurchaseStatus.checkout_open,
  HostedUsageCreditPurchaseStatus.payment_pending,
] as const;

export interface HostedUsageCreditCheckoutRequest {
  clientRequestKey: string;
  offerCode: HostedUsageCreditOfferCode;
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
  const resolution = await prisma.$transaction(async (tx) => {
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
      assertHostedUsageCreditRequestMatches({
        memberId: input.memberId,
        offerCode: input.offerCode,
        purchase: racedExisting,
      });
      return {
        purchase: racedExisting,
        recovered: false,
      };
    }

    await closeExpiredUnattachedHostedUsageCreditPurchasesTx({
      now,
      payerMemberId: input.memberId,
      tx,
    });

    const existingActive = await tx.hostedUsageCreditPurchase.findFirst({
      where: {
        payerMemberId: input.memberId,
        status: {
          in: [...HOSTED_USAGE_CREDIT_NONTERMINAL_PURCHASE_STATUSES],
        },
      },
    });
    if (existingActive) {
      return {
        purchase: existingActive,
        recovered: true,
      };
    }

    const authorizedOfferCodes =
      await readHostedPersonalUsageCreditOfferCodes({
        memberId: input.memberId,
        prisma: tx,
      });
    if (!authorizedOfferCodes.includes(input.offerCode)) {
      throw buildHostedUsageCreditNotEligibleError();
    }

    const billingRef = await readHostedMemberStripeBillingRef({
      memberId: input.memberId,
      prisma: tx,
    });
    const stripeCustomerId = billingRef?.stripeCustomerId;
    if (!stripeCustomerId || !billingRef?.stripeSubscriptionId) {
      throw hostedOnboardingError({
        code: "HOSTED_USAGE_CREDIT_BILLING_NOT_READY",
        httpStatus: 409,
        message: "Your subscription is not ready for usage-credit checkout yet.",
      });
    }

    const checkoutConfig = requireHostedStripeUsageCreditCheckoutConfig({
      offerCode: input.offerCode,
    });
    const publicBaseUrl = requireHostedOnboardingPublicBaseUrl();
    const purchaseId = generateHostedRandomPrefixedId("hucp");
    const offer = getHostedUsageCreditOfferDefinition(input.offerCode);
    const checkoutExpiresAt = new Date(
      now.getTime() + HOSTED_USAGE_CREDIT_CHECKOUT_EXPIRY_DURATION_MS,
    );
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
        beneficiaryMemberId: input.memberId,
        cashAmountMinor: offer.cashAmountMinor,
        cashCurrency: offer.cashCurrency,
        checkoutCancelUrl,
        checkoutExpiresAt,
        checkoutRequestPolicyVersion: HOSTED_USAGE_CREDIT_CHECKOUT_REQUEST_POLICY_VERSION,
        clientRequestKey: input.clientRequestKey,
        createdAt: now,
        grantUsdMicros: offer.grantUsdMicros,
        id: purchaseId,
        offerCode: offer.code,
        payerMemberId: input.memberId,
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
    return {
      purchase: created,
      recovered: false,
    };
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);

  try {
    const checkout = await continueHostedUsageCreditCheckout({
      now,
      prisma,
      purchase: resolution.purchase,
    });
    return resolution.recovered
      ? { ...checkout, recovered: true }
      : checkout;
  } catch (error) {
    if (
      resolution.recovered &&
      isHostedOnboardingError(error) &&
      error.code === "HOSTED_USAGE_CREDIT_STRIPE_UNAVAILABLE"
    ) {
      const purchase = await prepareHostedUsageCreditPurchaseForCheckout({
        now,
        prisma,
        purchase: resolution.purchase,
      });
      const checkout = await projectHostedUsageCreditCheckoutResult({
        prisma,
        purchase,
      });
      return {
        ...checkout,
        recovered: true,
        ...(canRetryHostedUsageCreditCheckoutCreate({ now, purchase })
          ? { retryAllowed: true as const }
          : {}),
      };
    }
    throw error;
  }
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
    purchase.status !== HostedUsageCreditPurchaseStatus.created ||
    !canRetryHostedUsageCreditCheckoutCreate({
      now: input.now,
      purchase,
    })
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
    assertHostedUsageCreditRequestMatches({
      memberId: input.purchase.payerMemberId,
      offerCode: parseHostedUsageCreditOfferCode(input.purchase.offerCode),
      purchase: current,
    });

    if (
      current.status === HostedUsageCreditPurchaseStatus.created &&
      input.now.getTime() >= current.checkoutExpiresAt.getTime()
    ) {
      const closed = await tx.hostedUsageCreditPurchase.updateMany({
        data: {
          reconciliationVersion: { increment: 1n },
          status: HostedUsageCreditPurchaseStatus.expired,
          terminalAt: input.now,
          updatedAt: input.now,
        },
        where: {
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
        reconciliationVersion: current.reconciliationVersion + 1n,
        status: HostedUsageCreditPurchaseStatus.expired,
        terminalAt: input.now,
        updatedAt: input.now,
      };
    }
    return current;
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

    if (current.status !== HostedUsageCreditPurchaseStatus.created) {
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
        reconciliationVersion: { increment: 1n },
        status,
        stripeCheckoutSessionIdEncrypted,
        stripeCheckoutSessionLookupKey: sessionLookupKey,
        stripeCheckoutUrlEncrypted,
        terminalAt: terminal ? input.now : null,
        updatedAt: input.now,
      },
      where: {
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

function assertHostedUsageCreditRequestMatches(input: {
  memberId: string;
  offerCode: HostedUsageCreditOfferCode | null;
  purchase: Pick<
    HostedUsageCreditPurchase,
    "beneficiaryMemberId" | "offerCode" | "payerMemberId"
  >;
}): void {
  if (
    !input.offerCode ||
    input.purchase.offerCode !== input.offerCode ||
    input.purchase.payerMemberId !== input.memberId ||
    input.purchase.beneficiaryMemberId !== input.memberId
  ) {
    throw hostedOnboardingError({
      code: "HOSTED_USAGE_CREDIT_REQUEST_KEY_CONFLICT",
      httpStatus: 409,
      message: "That usage-credit request key was already used for another request.",
    });
  }
}

function buildHostedUsageCreditNotEligibleError() {
  return hostedOnboardingError({
    code: "HOSTED_USAGE_CREDIT_NOT_ELIGIBLE",
    httpStatus: 403,
    message: "Usage credit is available for active paid Pulse or Edge plans.",
  });
}
