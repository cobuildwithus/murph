import {
  HostedUsageCreditPurchaseStatus,
  type HostedUsageCreditPurchase,
  type PrismaClient,
} from "@prisma/client";
import type Stripe from "stripe";

import { coerceStripeObjectId } from "./billing";
import {
  createHostedStripeBillingEventLookupKey,
  hostedLookupKeyMatchesValue,
} from "./contact-privacy";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  lockHostedMemberRow,
} from "./shared";
import {
  buildHostedUsageCreditSavedCardMetadata,
  buildHostedUsageCreditInvariantError,
  buildHostedUsageCreditStripeUnavailableError,
  decryptHostedUsageCreditPurchaseStripeField,
  encryptHostedUsageCreditPurchaseStripeField,
  HOSTED_USAGE_CREDIT_PURCHASE_STRIPE_PRIVATE_FIELDS,
  requireHostedUsageCreditEncryptedValue,
  requireHostedUsageCreditLookupKey,
  requireHostedUsageCreditPurchasePayerMemberId,
} from "./usage-credit-purchase-stripe";
import { HOSTED_USAGE_CREDIT_CHECKOUT_REQUEST_POLICY_VERSION } from
  "./usage-credit-offers";
import { assertHostedUsageCreditPaymentIntentMatchesPurchase } from
  "./usage-credit-stripe-payment-proof";

const HOSTED_USAGE_CREDIT_SAVED_CARD_IDEMPOTENCY_PREFIX =
  "hosted-usage-credit-saved-card";

export async function tryChargeHostedUsageCreditSavedCard(input: {
  checkoutRequest: Stripe.Checkout.SessionCreateParams;
  now: Date;
  prisma: PrismaClient;
  purchase: HostedUsageCreditPurchase;
  stripe: Stripe;
}): Promise<HostedUsageCreditPurchase | null> {
  let current = await readCurrentHostedUsageCreditPurchase(input);
  if (
    current.stripeCheckoutSessionLookupKey ||
    (
      current.status !== HostedUsageCreditPurchaseStatus.created &&
      current.status !== HostedUsageCreditPurchaseStatus.payment_pending
    )
  ) {
    return current;
  }

  const customerId = coerceStripeObjectId(input.checkoutRequest.customer);
  if (
    !customerId ||
    !hostedLookupKeyMatchesValue({
      expectedLookupKey: current.stripeCustomerLookupKey,
      kind: "stripe-customer",
      normalizedValue: customerId,
    })
  ) {
    throw buildHostedUsageCreditInvariantError(
      "saved_card_customer_identity_invalid",
    );
  }

  let paymentIntent: Stripe.PaymentIntent;
  if (current.stripePaymentIntentLookupKey) {
    paymentIntent = await retrieveBoundHostedUsageCreditPaymentIntent({
      prisma: input.prisma,
      purchase: current,
      stripe: input.stripe,
    });
  } else {
    if (
      current.status !== HostedUsageCreditPurchaseStatus.created ||
      current.checkoutRequestPolicyVersion !==
        HOSTED_USAGE_CREDIT_CHECKOUT_REQUEST_POLICY_VERSION
    ) {
      return current.status === HostedUsageCreditPurchaseStatus.created
        ? null
        : current;
    }
    const paymentMethodId = await resolveHostedUsageCreditSavedCard({
      customerId,
      purchase: current,
      stripe: input.stripe,
    });
    if (!paymentMethodId) {
      return null;
    }
    paymentIntent = await createOrRecoverHostedUsageCreditPaymentIntent({
      customerId,
      paymentMethodId,
      purchase: current,
      stripe: input.stripe,
    });
    assertHostedUsageCreditPaymentIntentMatchesPurchase({
      paymentIntent,
      purchase: current,
    });
    current = await bindHostedUsageCreditDirectPaymentIntent({
      now: input.now,
      paymentIntent,
      prisma: input.prisma,
      purchase: current,
    });
  }
  assertHostedUsageCreditPaymentIntentMatchesPurchase({
    paymentIntent,
    purchase: current,
  });

  if (
    paymentIntent.status === "succeeded" ||
    paymentIntent.status === "processing"
  ) {
    return bindHostedUsageCreditDirectPaymentIntent({
      now: input.now,
      paymentIntent,
      prisma: input.prisma,
      purchase: current,
    });
  }
  if (paymentIntent.status === "canceled") {
    return releaseCanceledHostedUsageCreditDirectPaymentIntent({
      now: input.now,
      paymentIntent,
      prisma: input.prisma,
      purchase: current,
    });
  }

  let resolvedPaymentIntent = paymentIntent;
  if (
    paymentIntent.status === "requires_confirmation" &&
    input.now.getTime() < current.checkoutExpiresAt.getTime()
  ) {
    resolvedPaymentIntent =
      await confirmOrRecoverHostedUsageCreditPaymentIntent({
        paymentIntent,
        purchase: current,
        stripe: input.stripe,
      });
    assertHostedUsageCreditPaymentIntentMatchesPurchase({
      paymentIntent: resolvedPaymentIntent,
      purchase: current,
    });
  }
  if (
    resolvedPaymentIntent.status === "succeeded" ||
    resolvedPaymentIntent.status === "processing"
  ) {
    return bindHostedUsageCreditDirectPaymentIntent({
      now: input.now,
      paymentIntent: resolvedPaymentIntent,
      prisma: input.prisma,
      purchase: current,
    });
  }

  const canceled = await cancelHostedUsageCreditDirectPaymentIntent({
    paymentIntent: resolvedPaymentIntent,
    purchase: current,
    stripe: input.stripe,
  });
  assertHostedUsageCreditPaymentIntentMatchesPurchase({
    paymentIntent: canceled,
    purchase: current,
  });
  if (canceled.status === "succeeded" || canceled.status === "processing") {
    return bindHostedUsageCreditDirectPaymentIntent({
      now: input.now,
      paymentIntent: canceled,
      prisma: input.prisma,
      purchase: current,
    });
  }
  if (canceled.status !== "canceled") {
    throw buildHostedUsageCreditStripeUnavailableError(
      new Error("Saved-card PaymentIntent did not reach a safe terminal state."),
      "paymentIntents.cancel.saved-card",
    );
  }
  return releaseCanceledHostedUsageCreditDirectPaymentIntent({
    now: input.now,
    paymentIntent: canceled,
    prisma: input.prisma,
    purchase: current,
  });
}

async function readCurrentHostedUsageCreditPurchase(input: {
  prisma: PrismaClient;
  purchase: HostedUsageCreditPurchase;
}): Promise<HostedUsageCreditPurchase> {
  const payerMemberId = requireHostedUsageCreditPurchasePayerMemberId(
    input.purchase,
  );
  return input.prisma.$transaction(async (tx) => {
    await lockHostedMemberRow(tx, payerMemberId);
    const current = await tx.hostedUsageCreditPurchase.findUnique({
      where: { id: input.purchase.id },
    });
    if (
      !current ||
      current.payerMemberId !== payerMemberId ||
      current.beneficiaryMemberId !== input.purchase.beneficiaryMemberId ||
      current.offerCode !== input.purchase.offerCode
    ) {
      throw buildHostedUsageCreditInvariantError(
        "saved_card_purchase_identity_changed",
      );
    }
    return current;
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

async function resolveHostedUsageCreditSavedCard(input: {
  customerId: string;
  purchase: HostedUsageCreditPurchase;
  stripe: Stripe;
}): Promise<string | null> {
  let customer: Stripe.Customer | Stripe.DeletedCustomer;
  let paymentMethods: Stripe.ApiList<Stripe.PaymentMethod>;
  let subscriptions: Stripe.ApiList<Stripe.Subscription>;
  try {
    [customer, paymentMethods, subscriptions] = await Promise.all([
      input.stripe.customers.retrieve(input.customerId, {
        expand: ["invoice_settings.default_payment_method"],
      }),
      input.stripe.paymentMethods.list({
        customer: input.customerId,
        limit: 100,
        type: "card",
      }),
      input.stripe.subscriptions.list({
        customer: input.customerId,
        limit: 100,
        status: "all",
      }),
    ]);
  } catch (error) {
    throw buildHostedUsageCreditStripeUnavailableError(
      error,
      "paymentMethods.list.saved-card",
    );
  }

  if ("deleted" in customer && customer.deleted) {
    throw buildHostedUsageCreditInvariantError(
      "saved_card_customer_deleted",
    );
  }
  if (
    customer.id !== input.customerId ||
    customer.livemode !== input.purchase.stripeLiveMode
  ) {
    throw buildHostedUsageCreditInvariantError(
      "saved_card_customer_state_invalid",
    );
  }
  if (paymentMethods.has_more || subscriptions.has_more) {
    return null;
  }

  const attachedPaymentMethodIds = new Set<string>();
  for (const paymentMethod of paymentMethods.data) {
    if (
      paymentMethod.type !== "card" ||
      coerceStripeObjectId(paymentMethod.customer) !== input.customerId ||
      paymentMethod.livemode !== input.purchase.stripeLiveMode
    ) {
      throw buildHostedUsageCreditInvariantError(
        "saved_card_payment_method_invalid",
      );
    }
    attachedPaymentMethodIds.add(paymentMethod.id);
  }

  const preferredPaymentMethodIds = new Set<string>();
  const customerDefaultPaymentMethodId = coerceStripeObjectId(
    customer.invoice_settings.default_payment_method,
  );
  if (
    customerDefaultPaymentMethodId &&
    attachedPaymentMethodIds.has(customerDefaultPaymentMethodId)
  ) {
    preferredPaymentMethodIds.add(customerDefaultPaymentMethodId);
  }
  for (const subscription of subscriptions.data) {
    if (
      subscription.livemode !== input.purchase.stripeLiveMode ||
      coerceStripeObjectId(subscription.customer) !== input.customerId
    ) {
      throw buildHostedUsageCreditInvariantError(
        "saved_card_subscription_invalid",
      );
    }
    if (
      subscription.status === "canceled" ||
      subscription.status === "incomplete_expired"
    ) {
      continue;
    }
    const subscriptionPaymentMethodId = coerceStripeObjectId(
      subscription.default_payment_method,
    );
    if (
      subscriptionPaymentMethodId &&
      attachedPaymentMethodIds.has(subscriptionPaymentMethodId)
    ) {
      preferredPaymentMethodIds.add(subscriptionPaymentMethodId);
    }
  }
  if (preferredPaymentMethodIds.size === 1) {
    return [...preferredPaymentMethodIds][0] ?? null;
  }
  if (preferredPaymentMethodIds.size > 1) {
    return null;
  }
  return attachedPaymentMethodIds.size === 1
    ? [...attachedPaymentMethodIds][0] ?? null
    : null;
}

async function retrieveBoundHostedUsageCreditPaymentIntent(input: {
  prisma: PrismaClient;
  purchase: HostedUsageCreditPurchase;
  stripe: Stripe;
}): Promise<Stripe.PaymentIntent> {
  const payerMemberId = requireHostedUsageCreditPurchasePayerMemberId(
    input.purchase,
  );
  const paymentIntentId =
    await decryptHostedUsageCreditPurchaseStripeField({
      field:
        HOSTED_USAGE_CREDIT_PURCHASE_STRIPE_PRIVATE_FIELDS.paymentIntentId,
      payerMemberId,
      prisma: input.prisma,
      value: input.purchase.stripePaymentIntentIdEncrypted,
    });
  if (
    !paymentIntentId ||
    !hostedLookupKeyMatchesValue({
      expectedLookupKey: input.purchase.stripePaymentIntentLookupKey,
      kind: "stripe-billing-event",
      normalizedValue: paymentIntentId,
    })
  ) {
    throw buildHostedUsageCreditInvariantError(
      "saved_card_payment_identity_invalid",
    );
  }
  try {
    return await input.stripe.paymentIntents.retrieve(paymentIntentId, {
      expand: ["latest_charge"],
    });
  } catch (error) {
    throw buildHostedUsageCreditStripeUnavailableError(
      error,
      "paymentIntents.retrieve.saved-card",
    );
  }
}

async function createOrRecoverHostedUsageCreditPaymentIntent(input: {
  customerId: string;
  paymentMethodId: string;
  purchase: HostedUsageCreditPurchase;
  stripe: Stripe;
}): Promise<Stripe.PaymentIntent> {
  const idempotencyKey = buildHostedUsageCreditSavedCardIdempotencyKey(
    input.purchase.id,
  );
  try {
    return await input.stripe.paymentIntents.create({
      amount: input.purchase.cashAmountMinor,
      capture_method: "automatic",
      currency: input.purchase.cashCurrency,
      customer: input.customerId,
      expand: ["latest_charge"],
      metadata: buildHostedUsageCreditSavedCardMetadata(input.purchase.id),
      payment_method: input.paymentMethodId,
      payment_method_types: ["card"],
      setup_future_usage: "off_session",
    }, { idempotencyKey });
  } catch (error) {
    const paymentIntentId = readHostedStripeErrorPaymentIntentId(error);
    if (!paymentIntentId) {
      throw buildHostedUsageCreditStripeUnavailableError(
        error,
        "paymentIntents.create.saved-card",
      );
    }
    try {
      return await input.stripe.paymentIntents.retrieve(paymentIntentId, {
        expand: ["latest_charge"],
      });
    } catch (retrieveError) {
      throw buildHostedUsageCreditStripeUnavailableError(
        retrieveError,
        "paymentIntents.retrieve.saved-card-recovery",
      );
    }
  }
}

async function confirmOrRecoverHostedUsageCreditPaymentIntent(input: {
  paymentIntent: Stripe.PaymentIntent;
  purchase: HostedUsageCreditPurchase;
  stripe: Stripe;
}): Promise<Stripe.PaymentIntent> {
  try {
    return await input.stripe.paymentIntents.confirm(
      input.paymentIntent.id,
      {
        expand: ["latest_charge"],
        off_session: true,
      },
      {
        idempotencyKey:
          `${buildHostedUsageCreditSavedCardIdempotencyKey(input.purchase.id)}:confirm`,
      },
    );
  } catch (error) {
    const errorPaymentIntentId = readHostedStripeErrorPaymentIntentId(error);
    if (
      errorPaymentIntentId &&
      errorPaymentIntentId !== input.paymentIntent.id
    ) {
      throw buildHostedUsageCreditInvariantError(
        "saved_card_confirmation_identity_changed",
      );
    }
    try {
      return await input.stripe.paymentIntents.retrieve(
        input.paymentIntent.id,
        { expand: ["latest_charge"] },
      );
    } catch (retrieveError) {
      throw buildHostedUsageCreditStripeUnavailableError(
        retrieveError,
        "paymentIntents.retrieve.saved-card-confirm-recovery",
      );
    }
  }
}

async function cancelHostedUsageCreditDirectPaymentIntent(input: {
  paymentIntent: Stripe.PaymentIntent;
  purchase: HostedUsageCreditPurchase;
  stripe: Stripe;
}): Promise<Stripe.PaymentIntent> {
  if (input.paymentIntent.status === "canceled") {
    return input.paymentIntent;
  }
  try {
    return await input.stripe.paymentIntents.cancel(
      input.paymentIntent.id,
      { cancellation_reason: "abandoned" },
      {
        idempotencyKey:
          `${buildHostedUsageCreditSavedCardIdempotencyKey(input.purchase.id)}:cancel`,
      },
    );
  } catch {
    try {
      return await input.stripe.paymentIntents.retrieve(
        input.paymentIntent.id,
        { expand: ["latest_charge"] },
      );
    } catch (retrieveError) {
      throw buildHostedUsageCreditStripeUnavailableError(
        retrieveError,
        "paymentIntents.retrieve.saved-card-cancel-recovery",
      );
    }
  }
}

async function releaseCanceledHostedUsageCreditDirectPaymentIntent(input: {
  now: Date;
  paymentIntent: Stripe.PaymentIntent;
  prisma: PrismaClient;
  purchase: HostedUsageCreditPurchase;
}): Promise<HostedUsageCreditPurchase | null> {
  if (input.paymentIntent.status !== "canceled") {
    throw buildHostedUsageCreditInvariantError(
      "saved_card_payment_not_canceled",
    );
  }
  const payerMemberId = requireHostedUsageCreditPurchasePayerMemberId(
    input.purchase,
  );
  return input.prisma.$transaction(async (tx) => {
    await lockHostedMemberRow(tx, payerMemberId);
    const current = await tx.hostedUsageCreditPurchase.findUnique({
      where: { id: input.purchase.id },
    });
    if (!current || current.payerMemberId !== payerMemberId) {
      throw buildHostedUsageCreditInvariantError(
        "saved_card_purchase_missing",
      );
    }
    if (
      !current.stripePaymentIntentLookupKey ||
      !hostedLookupKeyMatchesValue({
        expectedLookupKey: current.stripePaymentIntentLookupKey,
        kind: "stripe-billing-event",
        normalizedValue: input.paymentIntent.id,
      })
    ) {
      return current;
    }
    if (current.status !== HostedUsageCreditPurchaseStatus.payment_pending) {
      return current;
    }

    const released = await tx.hostedUsageCreditPurchase.updateMany({
      data: {
        lastReconciledAt: null,
        reconciliationVersion: { increment: 1n },
        status: HostedUsageCreditPurchaseStatus.created,
        stripeChargeIdEncrypted: null,
        stripeChargeLookupKey: null,
        stripePaymentIntentIdEncrypted: null,
        stripePaymentIntentLookupKey: null,
        terminalAt: null,
        updatedAt: input.now,
      },
      where: {
        id: current.id,
        reconciliationVersion: current.reconciliationVersion,
        status: HostedUsageCreditPurchaseStatus.payment_pending,
        stripePaymentIntentLookupKey: current.stripePaymentIntentLookupKey,
      },
    });
    if (released.count !== 1) {
      throw buildHostedUsageCreditInvariantError(
        "saved_card_payment_release_failed",
      );
    }
    return null;
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

async function bindHostedUsageCreditDirectPaymentIntent(input: {
  now: Date;
  paymentIntent: Stripe.PaymentIntent;
  prisma: PrismaClient;
  purchase: HostedUsageCreditPurchase;
}): Promise<HostedUsageCreditPurchase> {
  const payerMemberId = requireHostedUsageCreditPurchasePayerMemberId(
    input.purchase,
  );
  const paymentIntentLookupKey = requireHostedUsageCreditLookupKey(
    createHostedStripeBillingEventLookupKey(input.paymentIntent.id),
    "payment_intent",
  );
  const chargeId = coerceStripeObjectId(input.paymentIntent.latest_charge);
  const chargeLookupKey = chargeId
    ? requireHostedUsageCreditLookupKey(
        createHostedStripeBillingEventLookupKey(chargeId),
        "charge",
      )
    : null;
  const [stripePaymentIntentIdEncrypted, stripeChargeIdEncrypted] =
    await Promise.all([
      encryptHostedUsageCreditPurchaseStripeField({
        field: HOSTED_USAGE_CREDIT_PURCHASE_STRIPE_PRIVATE_FIELDS.paymentIntentId,
        payerMemberId,
        prisma: input.prisma,
        value: input.paymentIntent.id,
      }),
      encryptHostedUsageCreditPurchaseStripeField({
        field: HOSTED_USAGE_CREDIT_PURCHASE_STRIPE_PRIVATE_FIELDS.chargeId,
        payerMemberId,
        prisma: input.prisma,
        value: chargeId,
      }),
    ]);

  return input.prisma.$transaction(async (tx) => {
    await lockHostedMemberRow(tx, payerMemberId);
    const current = await tx.hostedUsageCreditPurchase.findUnique({
      where: { id: input.purchase.id },
    });
    if (!current || current.payerMemberId !== payerMemberId) {
      throw buildHostedUsageCreditInvariantError(
        "saved_card_purchase_missing",
      );
    }
    if (
      current.stripePaymentIntentLookupKey &&
      !hostedLookupKeyMatchesValue({
        expectedLookupKey: current.stripePaymentIntentLookupKey,
        kind: "stripe-billing-event",
        normalizedValue: input.paymentIntent.id,
      })
    ) {
      throw buildHostedUsageCreditInvariantError(
        "saved_card_payment_identity_changed",
      );
    }
    if (current.status === HostedUsageCreditPurchaseStatus.fulfilled) {
      return current;
    }
    if (
      current.status !== HostedUsageCreditPurchaseStatus.created &&
      current.status !== HostedUsageCreditPurchaseStatus.payment_pending
    ) {
      return current;
    }

    const updated = await tx.hostedUsageCreditPurchase.updateMany({
      data: {
        reconciliationVersion: { increment: 1n },
        status: HostedUsageCreditPurchaseStatus.payment_pending,
        stripeChargeIdEncrypted: chargeId
          ? requireHostedUsageCreditEncryptedValue(
              stripeChargeIdEncrypted,
              "charge",
            )
          : null,
        stripeChargeLookupKey: chargeLookupKey,
        stripePaymentIntentIdEncrypted: requireHostedUsageCreditEncryptedValue(
          stripePaymentIntentIdEncrypted,
          "payment_intent",
        ),
        stripePaymentIntentLookupKey: paymentIntentLookupKey,
        terminalAt: null,
        updatedAt: input.now,
      },
      where: {
        id: current.id,
        reconciliationVersion: current.reconciliationVersion,
        status: {
          in: [
            HostedUsageCreditPurchaseStatus.created,
            HostedUsageCreditPurchaseStatus.payment_pending,
          ],
        },
      },
    });
    if (updated.count !== 1) {
      throw buildHostedUsageCreditInvariantError(
        "saved_card_purchase_bind_failed",
      );
    }
    const bound = await tx.hostedUsageCreditPurchase.findUnique({
      where: { id: current.id },
    });
    if (!bound) {
      throw buildHostedUsageCreditInvariantError(
        "saved_card_purchase_missing_after_bind",
      );
    }
    return bound;
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

export function buildHostedUsageCreditSavedCardIdempotencyKey(
  purchaseId: string,
): string {
  return `${HOSTED_USAGE_CREDIT_SAVED_CARD_IDEMPOTENCY_PREFIX}:${purchaseId}`;
}

function readHostedStripeErrorPaymentIntentId(error: unknown): string | null {
  if (!error || typeof error !== "object") {
    return null;
  }
  const direct = readHostedStripeErrorField(error, "payment_intent");
  const raw = readHostedStripeErrorField(error, "raw");
  return coerceStripeObjectId(
    direct as Stripe.PaymentIntent | string | null,
  ) ?? (
    raw && typeof raw === "object"
      ? coerceStripeObjectId(
          readHostedStripeErrorField(raw, "payment_intent") as
            | Stripe.PaymentIntent
            | string
            | null,
        )
      : null
  );
}

function readHostedStripeErrorField(error: object, field: string): unknown {
  try {
    return Reflect.get(error, field);
  } catch {
    return null;
  }
}
