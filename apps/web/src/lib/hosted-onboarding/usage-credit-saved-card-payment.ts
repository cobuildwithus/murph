import {
  type HostedBillingStatus,
  HostedUsageCreditPurchaseStatus,
  type HostedUsageCreditPurchase,
  type PrismaClient,
} from "@prisma/client";
import type Stripe from "stripe";

import { coerceStripeObjectId } from "./billing";
import {
  hasHostedAccountGroupAccess,
  readHostedAccountGroupStripeBillingRef,
} from "./family-plan";
import { hasHostedMemberOwnPaidBilling } from "./entitlement";
import { readHostedMemberBillingSnapshot } from "./hosted-member-store";
import {
  createHostedStripeBillingEventLookupKey,
  hostedLookupKeyMatchesValue,
} from "./contact-privacy";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  lockHostedMemberRow,
  normalizeNullableString,
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
import {
  lockHostedUsageCreditPurchaseReservationOwnersTx,
} from "./usage-credit-purchase-reservation-lock";
import {
  HOSTED_USAGE_CREDIT_CHECKOUT_PURPOSE,
  HOSTED_USAGE_CREDIT_CHECKOUT_REQUEST_POLICY_VERSION,
  HOSTED_USAGE_CREDIT_CHECKOUT_REQUEST_POLICY_V4,
  isHostedUsageCreditSavedCardPolicyVersion,
  parseHostedUsageCreditCheckoutRequestPolicyVersion,
  type HostedUsageCreditCheckoutRequestPolicyVersion,
} from "./usage-credit-offers";
import {
  assertHostedUsageCreditBoundPaymentIntentMatchesPurchase,
  assertHostedUsageCreditPaymentIntentMatchesPurchase,
} from "./usage-credit-stripe-payment-proof";
import {
  hasHostedGroupSponsorshipPaymentAuthorityTx,
  type HostedGroupSponsorshipPaymentAuthority,
} from "../hosted-groups/group-sponsorship-authorization";

const HOSTED_USAGE_CREDIT_SAVED_CARD_IDEMPOTENCY_PREFIX =
  "hosted-usage-credit-saved-card";

type HostedUsageCreditDirectPaymentBinding =
  | {
      kind: "bound";
      purchase: HostedUsageCreditPurchase;
    }
  | {
      kind: "not_bound";
      purchase: HostedUsageCreditPurchase;
    };

export type HostedUsageCreditSavedCardBillingAuthority =
  | {
      familyGroupId: string;
      kind: "family";
      subscription: HostedUsageCreditSavedCardSubscriptionAuthority | null;
    }
  | {
      automaticSponsorship?: HostedGroupSponsorshipPaymentAuthority;
      kind: "group";
    }
  | {
      kind: "personal";
      subscription: HostedUsageCreditSavedCardSubscriptionAuthority | null;
    };

export interface HostedUsageCreditSavedCardSubscriptionAuthority {
  billingStatus: HostedBillingStatus;
  lastStripeEventCreatedAt: Date | null;
  stripeSubscriptionId: string;
  suspendedAt: Date | null;
}

export async function tryChargeHostedUsageCreditSavedCard(input: {
  billingAuthority: HostedUsageCreditSavedCardBillingAuthority;
  checkoutRequest: Stripe.Checkout.SessionCreateParams;
  now: Date;
  policyVersion: HostedUsageCreditCheckoutRequestPolicyVersion;
  prisma: PrismaClient;
  purchase: HostedUsageCreditPurchase;
  stripe: Stripe;
}): Promise<HostedUsageCreditPurchase | null> {
  let current = await readCurrentHostedUsageCreditPurchase(input);
  const payerMemberId = requireHostedUsageCreditPurchasePayerMemberId(current);
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
      current.checkoutRequestPolicyVersion !== input.policyVersion ||
      !isHostedUsageCreditSavedCardPolicyVersion(input.policyVersion)
    ) {
      return current.status === HostedUsageCreditPurchaseStatus.created
        ? null
        : current;
    }
    const paymentMethodId = await resolveHostedUsageCreditSavedCard({
      billingAuthority: input.billingAuthority,
      customerId,
      prisma: input.prisma,
      purchase: current,
      stripe: input.stripe,
    });
    if (!paymentMethodId) {
      return null;
    }
    paymentIntent = await createOrRecoverHostedUsageCreditPaymentIntent({
      customerId,
      paymentMethodId,
      policyVersion: input.policyVersion,
      purchase: current,
      stripe: input.stripe,
    });
    assertHostedUsageCreditPaymentIntentMatchesPurchase({
      paymentIntent,
      purchase: current,
    });
    const binding = await bindHostedUsageCreditDirectPaymentIntent({
      billingAuthority: input.billingAuthority,
      customerId,
      now: input.now,
      payerMemberId,
      paymentIntent,
      prisma: input.prisma,
      purchase: current,
    });
    if (binding.kind === "not_bound") {
      return cancelUnboundHostedUsageCreditDirectPaymentIntent({
        billingAuthority: input.billingAuthority,
        now: input.now,
        paymentIntent,
        prisma: input.prisma,
        purchase: binding.purchase,
        stripe: input.stripe,
      });
    }
    current = binding.purchase;
  }
  assertHostedUsageCreditBoundPaymentIntentMatchesPurchase({
    paymentIntent,
    purchase: current,
  });

  if (
    paymentIntent.status === "succeeded" ||
    paymentIntent.status === "processing"
  ) {
    return requireHostedUsageCreditDirectPaymentBinding(
      await bindHostedUsageCreditDirectPaymentIntent({
        billingAuthority: input.billingAuthority,
        now: input.now,
        payerMemberId,
        paymentIntent,
        prisma: input.prisma,
        purchase: current,
      }),
    );
  }
  if (paymentIntent.status === "canceled") {
    return transitionCanceledHostedUsageCreditDirectPaymentIntent({
      billingAuthority: input.billingAuthority,
      now: input.now,
      paymentIntent,
      prisma: input.prisma,
      purchase: current,
      transition: "release",
    });
  }

  let resolvedPaymentIntent = paymentIntent;
  if (
    paymentIntent.status === "requires_confirmation" &&
    input.now.getTime() < current.checkoutExpiresAt.getTime()
  ) {
    if (!(await hasCurrentHostedUsageCreditAutomaticPaymentAuthority({
      billingAuthority: input.billingAuthority,
      now: input.now,
      payerMemberId,
      prisma: input.prisma,
      purchase: current,
    }))) {
      const canceled = await cancelHostedUsageCreditDirectPaymentIntent({
        paymentIntent,
        purchase: current,
        stripe: input.stripe,
      });
      assertHostedUsageCreditBoundPaymentIntentMatchesPurchase({
        paymentIntent: canceled,
        purchase: current,
      });
      if (canceled.status === "succeeded" || canceled.status === "processing") {
        return requireHostedUsageCreditDirectPaymentBinding(
          await bindHostedUsageCreditDirectPaymentIntent({
            billingAuthority: input.billingAuthority,
            now: input.now,
            payerMemberId,
            paymentIntent: canceled,
            prisma: input.prisma,
            purchase: current,
          }),
        );
      }
      if (canceled.status !== "canceled") {
        throw buildHostedUsageCreditStripeUnavailableError(
          new Error(
            "Unauthorized saved-card PaymentIntent did not reach a safe terminal state.",
          ),
          "paymentIntents.cancel.saved-card-authority",
        );
      }
      const expired = await transitionCanceledHostedUsageCreditDirectPaymentIntent({
        billingAuthority: input.billingAuthority,
        now: input.now,
        paymentIntent: canceled,
        prisma: input.prisma,
        purchase: current,
        transition: "expire",
      });
      if (!expired) {
        throw buildHostedUsageCreditInvariantError(
          "saved_card_payment_expire_failed",
        );
      }
      return expired;
    }
    resolvedPaymentIntent =
      await confirmOrRecoverHostedUsageCreditPaymentIntent({
        paymentIntent,
        purchase: current,
        stripe: input.stripe,
      });
    assertHostedUsageCreditBoundPaymentIntentMatchesPurchase({
      paymentIntent: resolvedPaymentIntent,
      purchase: current,
    });
  }
  if (
    resolvedPaymentIntent.status === "succeeded" ||
    resolvedPaymentIntent.status === "processing"
  ) {
    return requireHostedUsageCreditDirectPaymentBinding(
      await bindHostedUsageCreditDirectPaymentIntent({
        billingAuthority: input.billingAuthority,
        now: input.now,
        payerMemberId,
        paymentIntent: resolvedPaymentIntent,
        prisma: input.prisma,
        purchase: current,
      }),
    );
  }

  const canceled = await cancelHostedUsageCreditDirectPaymentIntent({
    paymentIntent: resolvedPaymentIntent,
    purchase: current,
    stripe: input.stripe,
  });
  assertHostedUsageCreditBoundPaymentIntentMatchesPurchase({
    paymentIntent: canceled,
    purchase: current,
  });
  if (canceled.status === "succeeded" || canceled.status === "processing") {
    return requireHostedUsageCreditDirectPaymentBinding(
      await bindHostedUsageCreditDirectPaymentIntent({
        billingAuthority: input.billingAuthority,
        now: input.now,
        payerMemberId,
        paymentIntent: canceled,
        prisma: input.prisma,
        purchase: current,
      }),
    );
  }
  if (canceled.status !== "canceled") {
    throw buildHostedUsageCreditStripeUnavailableError(
      new Error("Saved-card PaymentIntent did not reach a safe terminal state."),
      "paymentIntents.cancel.saved-card",
    );
  }
  return transitionCanceledHostedUsageCreditDirectPaymentIntent({
    billingAuthority: input.billingAuthority,
    now: input.now,
    paymentIntent: canceled,
    prisma: input.prisma,
    purchase: current,
    transition: "release",
  });
}

async function readCurrentHostedUsageCreditPurchase(input: {
  billingAuthority: HostedUsageCreditSavedCardBillingAuthority;
  prisma: PrismaClient;
  purchase: HostedUsageCreditPurchase;
}): Promise<HostedUsageCreditPurchase> {
  const payerMemberId = requireHostedUsageCreditPurchasePayerMemberId(
    input.purchase,
  );
  return input.prisma.$transaction(async (tx) => {
    if (input.billingAuthority.kind === "group") {
      await lockHostedMemberRow(tx, input.purchase.beneficiaryMemberId);
    }
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

async function hasCurrentHostedUsageCreditAutomaticPaymentAuthority(input: {
  billingAuthority: HostedUsageCreditSavedCardBillingAuthority;
  now: Date;
  payerMemberId: string;
  prisma: PrismaClient;
  purchase: HostedUsageCreditPurchase;
}): Promise<boolean> {
  const automaticSponsorship = input.billingAuthority.kind === "group"
    ? input.billingAuthority.automaticSponsorship
    : undefined;
  if (!automaticSponsorship) {
    return true;
  }
  return input.prisma.$transaction(async (tx) => {
    return hasHostedGroupSponsorshipPaymentAuthorityTx({
      authority: automaticSponsorship,
      now: input.now,
      payerMemberId: input.payerMemberId,
      purchaseId: input.purchase.id,
      tx,
    });
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

async function resolveHostedUsageCreditSavedCard(input: {
  billingAuthority: HostedUsageCreditSavedCardBillingAuthority;
  customerId: string;
  prisma: PrismaClient;
  purchase: HostedUsageCreditPurchase;
  stripe: Stripe;
}): Promise<string | null> {
  if (
    input.billingAuthority.kind === "group" &&
    input.billingAuthority.automaticSponsorship
  ) {
    if (input.billingAuthority.automaticSponsorship.mode === "payer_recovery") {
      return null;
    }
    return resolveHostedGroupSponsorshipPaymentMethod({
      authority: input.billingAuthority.automaticSponsorship,
      customerId: input.customerId,
      prisma: input.prisma,
      purchase: input.purchase,
      stripe: input.stripe,
    });
  }

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
  let boundSubscriptionDefaultInvalid = false;
  let boundSubscriptionDefaultPaymentMethodId: string | null = null;
  let boundSubscriptionDefaultSourcePresent = false;
  let boundSubscriptionMatched = false;
  const customerDefaultSourcePresent = Boolean(
    coerceStripeObjectId(customer.default_source),
  );
  const customerDefaultPaymentMethodId = coerceStripeObjectId(
    customer.invoice_settings.default_payment_method,
  );
  const stripeSubscriptionId = input.billingAuthority.kind === "group"
    ? null
    : input.billingAuthority.subscription?.stripeSubscriptionId ?? null;
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
      isHostedUsageCreditExactSavedCardPolicy(
        input.purchase.checkoutRequestPolicyVersion,
      ) &&
      stripeSubscriptionId &&
      subscription.id === stripeSubscriptionId
    ) {
      boundSubscriptionMatched = true;
      boundSubscriptionDefaultSourcePresent = Boolean(
        coerceStripeObjectId(subscription.default_source),
      );
      if (
        subscriptionPaymentMethodId &&
        !attachedPaymentMethodIds.has(subscriptionPaymentMethodId)
      ) {
        boundSubscriptionDefaultInvalid = true;
      } else {
        boundSubscriptionDefaultPaymentMethodId =
          subscriptionPaymentMethodId;
      }
    }
    if (
      subscriptionPaymentMethodId &&
      attachedPaymentMethodIds.has(subscriptionPaymentMethodId)
    ) {
      preferredPaymentMethodIds.add(subscriptionPaymentMethodId);
    }
  }
  if (
    isHostedUsageCreditExactSavedCardPolicy(
      input.purchase.checkoutRequestPolicyVersion,
    )
  ) {
    if (stripeSubscriptionId) {
      if (!boundSubscriptionMatched || boundSubscriptionDefaultInvalid) {
        return null;
      }
      if (boundSubscriptionDefaultPaymentMethodId) {
        return boundSubscriptionDefaultPaymentMethodId;
      }
      if (boundSubscriptionDefaultSourcePresent) {
        return null;
      }
      if (customerDefaultPaymentMethodId) {
        return attachedPaymentMethodIds.has(customerDefaultPaymentMethodId)
          ? customerDefaultPaymentMethodId
          : null;
      }
      return null;
    }
    if (input.billingAuthority.kind !== "group") {
      return null;
    }
    if (customerDefaultPaymentMethodId) {
      return attachedPaymentMethodIds.has(customerDefaultPaymentMethodId)
        ? customerDefaultPaymentMethodId
        : null;
    }
    if (customerDefaultSourcePresent) {
      return null;
    }
    return attachedPaymentMethodIds.size === 1
      ? [...attachedPaymentMethodIds][0] ?? null
      : null;
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

async function resolveHostedGroupSponsorshipPaymentMethod(input: {
  authority: HostedGroupSponsorshipPaymentAuthority;
  customerId: string;
  prisma: PrismaClient;
  purchase: HostedUsageCreditPurchase;
  stripe: Stripe;
}): Promise<string | null> {
  const payerMemberId = requireHostedUsageCreditPurchasePayerMemberId(
    input.purchase,
  );
  const source = await input.prisma.hostedUsageCreditPurchase.findFirst({
    orderBy: [{ paidAt: "desc" }, { id: "desc" }],
    where: {
      beneficiaryMemberId: input.authority.beneficiaryMemberId,
      groupSponsorshipAuthorizationId: input.authority.authorizationId,
      paidAt: { not: null },
      payerMemberId,
      status: HostedUsageCreditPurchaseStatus.fulfilled,
      OR: [
        { groupSponsorshipChargeOrdinal: 0 },
        { stripeCheckoutSessionLookupKey: { not: null } },
      ],
      stripePaymentIntentIdEncrypted: { not: null },
      stripePaymentIntentLookupKey: { not: null },
    },
  });
  if (!source) {
    return null;
  }

  const paymentIntent = await retrieveBoundHostedUsageCreditPaymentIntent({
    prisma: input.prisma,
    purchase: source,
    stripe: input.stripe,
  });
  if (source.stripeCheckoutSessionLookupKey) {
    assertHostedGroupSponsorshipCheckoutPaymentIntent({
      customerId: input.customerId,
      paymentIntent,
      purchase: source,
    });
  } else {
    if (source.groupSponsorshipChargeOrdinal !== 0) {
      throw buildHostedUsageCreditInvariantError(
        "group_sponsorship_payment_source_invalid",
      );
    }
    assertHostedUsageCreditPaymentIntentMatchesPurchase({
      paymentIntent,
      purchase: source,
    });
    if (paymentIntent.status !== "succeeded") {
      throw buildHostedUsageCreditInvariantError(
        "group_sponsorship_payment_identity_invalid",
      );
    }
  }
  const paymentMethodId = coerceStripeObjectId(paymentIntent.payment_method);
  if (!paymentMethodId) {
    throw buildHostedUsageCreditInvariantError(
      "group_sponsorship_payment_method_missing",
    );
  }

  let paymentMethod: Stripe.PaymentMethod;
  try {
    paymentMethod = await input.stripe.paymentMethods.retrieve(paymentMethodId);
  } catch (error) {
    throw buildHostedUsageCreditStripeUnavailableError(
      error,
      "paymentMethods.retrieve.group-sponsorship",
    );
  }
  if (
    paymentMethod.id !== paymentMethodId ||
    paymentMethod.livemode !== input.purchase.stripeLiveMode
  ) {
    throw buildHostedUsageCreditInvariantError(
      "group_sponsorship_payment_method_invalid",
    );
  }
  if (paymentMethod.type !== "card") {
    return null;
  }
  return coerceStripeObjectId(paymentMethod.customer) === input.customerId
    ? paymentMethod.id
    : null;
}

function assertHostedGroupSponsorshipCheckoutPaymentIntent(input: {
  customerId: string;
  paymentIntent: Stripe.PaymentIntent;
  purchase: HostedUsageCreditPurchase;
}): void {
  const policyVersion = parseHostedUsageCreditCheckoutRequestPolicyVersion(
    input.purchase.checkoutRequestPolicyVersion,
  );
  const metadata = input.paymentIntent.metadata;
  const expectedMetadata = policyVersion
    ? {
        policyVersion,
        purchaseId: input.purchase.id,
        purpose: HOSTED_USAGE_CREDIT_CHECKOUT_PURPOSE,
      }
    : null;
  const chargeId = coerceStripeObjectId(input.paymentIntent.latest_charge);
  if (
    !expectedMetadata ||
    input.paymentIntent.status !== "succeeded" ||
    input.paymentIntent.livemode !== input.purchase.stripeLiveMode ||
    coerceStripeObjectId(input.paymentIntent.customer) !== input.customerId ||
    !hostedLookupKeyMatchesValue({
      expectedLookupKey: input.purchase.stripePaymentIntentLookupKey,
      kind: "stripe-billing-event",
      normalizedValue: input.paymentIntent.id,
    }) ||
    !hostedLookupKeyMatchesValue({
      expectedLookupKey: input.purchase.stripeChargeLookupKey,
      kind: "stripe-billing-event",
      normalizedValue: chargeId,
    }) ||
    !Number.isSafeInteger(input.paymentIntent.amount) ||
    input.paymentIntent.amount !== input.purchase.cashAmountMinor ||
    input.paymentIntent.amount_received !== input.purchase.cashAmountMinor ||
    normalizeNullableString(input.paymentIntent.currency)?.toLowerCase() !==
      input.purchase.cashCurrency.toLowerCase() ||
    Object.keys(metadata).length !== Object.keys(expectedMetadata).length ||
    Object.entries(expectedMetadata).some(
      ([key, value]) => metadata[key] !== value,
    )
  ) {
    throw buildHostedUsageCreditInvariantError(
      "group_sponsorship_payment_identity_invalid",
    );
  }
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
  policyVersion: HostedUsageCreditCheckoutRequestPolicyVersion;
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
      metadata: buildHostedUsageCreditSavedCardMetadata(
        input.purchase.id,
        input.policyVersion,
      ),
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
    let recovered: Stripe.PaymentIntent;
    try {
      recovered = await input.stripe.paymentIntents.retrieve(
        input.paymentIntent.id,
        { expand: ["latest_charge"] },
      );
    } catch (retrieveError) {
      throw buildHostedUsageCreditStripeUnavailableError(
        retrieveError,
        "paymentIntents.retrieve.saved-card-confirm-recovery",
      );
    }
    if (recovered.status === "requires_confirmation") {
      throw buildHostedUsageCreditStripeUnavailableError(
        error,
        "paymentIntents.confirm.saved-card",
      );
    }
    return recovered;
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

async function cancelUnboundHostedUsageCreditDirectPaymentIntent(input: {
  billingAuthority: HostedUsageCreditSavedCardBillingAuthority;
  now: Date;
  paymentIntent: Stripe.PaymentIntent;
  prisma: PrismaClient;
  purchase: HostedUsageCreditPurchase;
  stripe: Stripe;
}): Promise<HostedUsageCreditPurchase | null> {
  const canceled = await cancelHostedUsageCreditDirectPaymentIntent({
    paymentIntent: input.paymentIntent,
    purchase: input.purchase,
    stripe: input.stripe,
  });
  assertHostedUsageCreditPaymentIntentMatchesPurchase({
    paymentIntent: canceled,
    purchase: input.purchase,
  });
  if (canceled.status !== "canceled") {
    throw buildHostedUsageCreditStripeUnavailableError(
      new Error(
        "Unbound saved-card PaymentIntent could not be proven canceled.",
      ),
      "paymentIntents.cancel.saved-card-unbound",
    );
  }
  if (input.purchase.stripePaymentIntentLookupKey) {
    throw buildHostedUsageCreditInvariantError(
      "saved_card_unbound_payment_became_bound",
    );
  }
  const automaticSponsorship = input.billingAuthority.kind === "group"
    ? input.billingAuthority.automaticSponsorship
    : undefined;
  if (!automaticSponsorship || automaticSponsorship.mode !== "automatic") {
    return null;
  }
  return transitionCanceledHostedUsageCreditDirectPaymentIntent({
    billingAuthority: input.billingAuthority,
    now: input.now,
    paymentIntent: canceled,
    prisma: input.prisma,
    purchase: input.purchase,
    transition: "expire_unbound",
  });
}

export function canCancelHostedUsageCreditDirectPayment(
  purchase: Pick<
    HostedUsageCreditPurchase,
    | "status"
    | "stripeCheckoutSessionLookupKey"
    | "stripePaymentIntentIdEncrypted"
    | "stripePaymentIntentLookupKey"
  >,
): boolean {
  return purchase.status === HostedUsageCreditPurchaseStatus.payment_pending &&
    !purchase.stripeCheckoutSessionLookupKey &&
    Boolean(
      purchase.stripePaymentIntentIdEncrypted &&
      purchase.stripePaymentIntentLookupKey,
    );
}

export async function cancelHostedUsageCreditDirectPayment(input: {
  groupBeneficiaryMemberId?: string;
  now: Date;
  prisma: PrismaClient;
  purchase: HostedUsageCreditPurchase;
  stripe: Stripe;
}): Promise<HostedUsageCreditPurchase> {
  const payerMemberId = requireHostedUsageCreditPurchasePayerMemberId(
    input.purchase,
  );
  const paymentIntent = await retrieveBoundHostedUsageCreditPaymentIntent({
    prisma: input.prisma,
    purchase: input.purchase,
    stripe: input.stripe,
  });
  assertHostedUsageCreditBoundPaymentIntentMatchesPurchase({
    paymentIntent,
    purchase: input.purchase,
  });
  if (
    paymentIntent.status === "succeeded" ||
    paymentIntent.status === "processing"
  ) {
    return requireHostedUsageCreditDirectPaymentBinding(
      await bindHostedUsageCreditDirectPaymentIntent({
        groupBeneficiaryMemberId: input.groupBeneficiaryMemberId,
        now: input.now,
        payerMemberId,
        paymentIntent,
        prisma: input.prisma,
        purchase: input.purchase,
      }),
    );
  }

  const canceled = await cancelHostedUsageCreditDirectPaymentIntent({
    paymentIntent,
    purchase: input.purchase,
    stripe: input.stripe,
  });
  assertHostedUsageCreditBoundPaymentIntentMatchesPurchase({
    paymentIntent: canceled,
    purchase: input.purchase,
  });
  if (canceled.status === "succeeded" || canceled.status === "processing") {
    return requireHostedUsageCreditDirectPaymentBinding(
      await bindHostedUsageCreditDirectPaymentIntent({
        groupBeneficiaryMemberId: input.groupBeneficiaryMemberId,
        now: input.now,
        payerMemberId,
        paymentIntent: canceled,
        prisma: input.prisma,
        purchase: input.purchase,
      }),
    );
  }
  if (canceled.status !== "canceled") {
    throw buildHostedUsageCreditStripeUnavailableError(
      new Error("Saved-card PaymentIntent did not reach a safe terminal state."),
      "paymentIntents.cancel.saved-card-expire",
    );
  }
  const expired = await transitionCanceledHostedUsageCreditDirectPaymentIntent({
    groupBeneficiaryMemberId: input.groupBeneficiaryMemberId,
    now: input.now,
    paymentIntent: canceled,
    prisma: input.prisma,
    purchase: input.purchase,
    transition: "expire",
  });
  if (!expired) {
    throw buildHostedUsageCreditInvariantError(
      "saved_card_payment_expire_failed",
    );
  }
  return expired;
}

async function transitionCanceledHostedUsageCreditDirectPaymentIntent(input: {
  billingAuthority?: HostedUsageCreditSavedCardBillingAuthority;
  groupBeneficiaryMemberId?: string;
  now: Date;
  paymentIntent: Stripe.PaymentIntent;
  prisma: PrismaClient;
  purchase: HostedUsageCreditPurchase;
  transition: "expire" | "expire_unbound" | "release";
}): Promise<HostedUsageCreditPurchase | null> {
  if (input.paymentIntent.status !== "canceled") {
    throw buildHostedUsageCreditInvariantError(
      "saved_card_payment_not_canceled",
    );
  }
  const payerMemberId = requireHostedUsageCreditPurchasePayerMemberId(
    input.purchase,
  );
  const groupBeneficiaryMemberId =
    input.billingAuthority?.kind === "group"
      ? input.purchase.beneficiaryMemberId
      : input.groupBeneficiaryMemberId ??
        (input.purchase.groupSponsorshipAuthorizationId
          ? input.purchase.beneficiaryMemberId
          : null);
  return input.prisma.$transaction(async (tx) => {
    if (input.transition === "release") {
      if (groupBeneficiaryMemberId) {
        await lockHostedMemberRow(tx, groupBeneficiaryMemberId);
      }
      await lockHostedMemberRow(tx, payerMemberId);
    } else {
      await lockHostedUsageCreditPurchaseReservationOwnersTx({
        beneficiaryMemberId: input.purchase.beneficiaryMemberId,
        payerMemberId,
        tx,
      });
    }
    const current = await tx.hostedUsageCreditPurchase.findUnique({
      where: { id: input.purchase.id },
    });
    if (
      !current ||
      current.payerMemberId !== payerMemberId ||
      current.beneficiaryMemberId !== input.purchase.beneficiaryMemberId
    ) {
      throw buildHostedUsageCreditInvariantError(
        "saved_card_purchase_missing",
      );
    }
    if (input.transition === "expire_unbound") {
      if (
        current.status !== HostedUsageCreditPurchaseStatus.created ||
        current.stripePaymentIntentLookupKey
      ) {
        return current;
      }
      const expired = await tx.hostedUsageCreditPurchase.updateMany({
        data: {
          grantSlotReleasedAt: input.now,
          lastReconciledAt: input.now,
          reconciliationVersion: { increment: 1n },
          status: HostedUsageCreditPurchaseStatus.expired,
          terminalAt: input.now,
          updatedAt: input.now,
        },
        where: {
          id: current.id,
          grantSlotReleasedAt: null,
          paidAt: null,
          reconciliationVersion: current.reconciliationVersion,
          status: HostedUsageCreditPurchaseStatus.created,
          stripePaymentIntentLookupKey: null,
        },
      });
      if (expired.count !== 1) {
        throw buildHostedUsageCreditInvariantError(
          "saved_card_payment_expire_failed",
        );
      }
      return tx.hostedUsageCreditPurchase.findUnique({
        where: { id: current.id },
      });
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
        ...(input.transition === "expire"
          ? { grantSlotReleasedAt: input.now }
          : {}),
        lastReconciledAt: input.transition === "expire" ? input.now : null,
        reconciliationVersion: { increment: 1n },
        status: input.transition === "expire"
          ? HostedUsageCreditPurchaseStatus.expired
          : HostedUsageCreditPurchaseStatus.created,
        ...(input.transition === "release"
          ? {
              stripeChargeIdEncrypted: null,
              stripeChargeLookupKey: null,
              stripePaymentIntentIdEncrypted: null,
              stripePaymentIntentLookupKey: null,
            }
          : {}),
        terminalAt: input.transition === "expire" ? input.now : null,
        updatedAt: input.now,
      },
      where: {
        grantSlotReleasedAt: null,
        id: current.id,
        ...(input.transition === "expire" ? { paidAt: null } : {}),
        reconciliationVersion: current.reconciliationVersion,
        status: HostedUsageCreditPurchaseStatus.payment_pending,
        stripePaymentIntentLookupKey: current.stripePaymentIntentLookupKey,
      },
    });
    if (released.count !== 1) {
      throw buildHostedUsageCreditInvariantError(
        input.transition === "expire"
          ? "saved_card_payment_expire_failed"
          : "saved_card_payment_release_failed",
      );
    }
    if (input.transition === "release") {
      return null;
    }
    const expired = await tx.hostedUsageCreditPurchase.findUnique({
      where: { id: current.id },
    });
    if (!expired) {
      throw buildHostedUsageCreditInvariantError(
        "saved_card_purchase_missing_after_expire",
      );
    }
    return expired;
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

async function bindHostedUsageCreditDirectPaymentIntent(input: {
  billingAuthority?: HostedUsageCreditSavedCardBillingAuthority;
  customerId?: string;
  groupBeneficiaryMemberId?: string;
  now: Date;
  payerMemberId: string;
  paymentIntent: Stripe.PaymentIntent;
  prisma: PrismaClient;
  purchase: HostedUsageCreditPurchase;
}): Promise<HostedUsageCreditDirectPaymentBinding> {
  const payerMemberId = input.payerMemberId;
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
  const groupBeneficiaryMemberId =
    input.billingAuthority?.kind === "group"
      ? input.purchase.beneficiaryMemberId
      : input.groupBeneficiaryMemberId ??
        (input.purchase.groupSponsorshipAuthorizationId
          ? input.purchase.beneficiaryMemberId
          : null);
  return input.prisma.$transaction(async (tx) => {
    if (groupBeneficiaryMemberId) {
      await lockHostedMemberRow(tx, groupBeneficiaryMemberId);
    }
    await lockHostedMemberRow(tx, payerMemberId);
    const current = await tx.hostedUsageCreditPurchase.findUnique({
      where: { id: input.purchase.id },
    });
    const payer = await tx.hostedMember.findUnique({
      select: { suspendedAt: true },
      where: { id: payerMemberId },
    });
    if (!current) {
      throw buildHostedUsageCreditInvariantError(
        "saved_card_purchase_missing",
      );
    }
    const alreadyBound = Boolean(
      current.stripePaymentIntentLookupKey &&
      hostedLookupKeyMatchesValue({
        expectedLookupKey: current.stripePaymentIntentLookupKey,
        kind: "stripe-billing-event",
        normalizedValue: input.paymentIntent.id,
      }),
    );
    if (
      current.stripePaymentIntentLookupKey &&
      !alreadyBound
    ) {
      throw buildHostedUsageCreditInvariantError(
        "saved_card_payment_identity_changed",
      );
    }
    if (current.payerMemberId !== payerMemberId) {
      if (
        current.payerMemberId === null &&
        (
          (
            alreadyBound &&
            current.status === HostedUsageCreditPurchaseStatus.fulfilled
          ) ||
          (
            !alreadyBound &&
            current.status !== HostedUsageCreditPurchaseStatus.created &&
            current.status !== HostedUsageCreditPurchaseStatus.payment_pending
          )
        )
      ) {
        return {
          kind: alreadyBound ? "bound" : "not_bound",
          purchase: current,
        };
      }
      throw buildHostedUsageCreditInvariantError(
        "saved_card_purchase_missing",
      );
    }
    if (
      alreadyBound &&
      current.status === HostedUsageCreditPurchaseStatus.fulfilled
    ) {
      return { kind: "bound", purchase: current };
    }
    if (
      (
        alreadyBound &&
        current.status !== HostedUsageCreditPurchaseStatus.payment_pending
      ) ||
      (
        !alreadyBound &&
        (
          current.status !== HostedUsageCreditPurchaseStatus.created ||
          !payer ||
          payer.suspendedAt
        )
      )
    ) {
      return { kind: "not_bound", purchase: current };
    }
    if (
      !alreadyBound &&
      isHostedUsageCreditExactSavedCardPolicy(
        current.checkoutRequestPolicyVersion,
      )
    ) {
      if (!input.billingAuthority || !input.customerId) {
        throw buildHostedUsageCreditInvariantError(
          "saved_card_billing_authority_missing",
        );
      }
      const billingAuthority = input.billingAuthority;
      if (
        billingAuthority.kind === "group" &&
        billingAuthority.automaticSponsorship &&
        !(await hasHostedGroupSponsorshipPaymentAuthorityTx({
          authority: billingAuthority.automaticSponsorship,
          now: input.now,
          payerMemberId,
          purchaseId: current.id,
          tx,
        }))
      ) {
        return { kind: "not_bound", purchase: current };
      }
      if (billingAuthority.kind !== "group") {
        const subscription = billingAuthority.subscription;
        let authorityStillCurrent = false;
        if (subscription && billingAuthority.kind === "family") {
          const billingRef = await readHostedAccountGroupStripeBillingRef({
            groupId: billingAuthority.familyGroupId,
            prisma: tx,
          });
          authorityStillCurrent = Boolean(
            billingRef &&
            hasHostedAccountGroupAccess(billingRef.group) &&
            billingRef.group.billingStatus === subscription.billingStatus &&
            hostedUsageCreditBillingDateMatches(
              billingRef.group.suspendedAt,
              subscription.suspendedAt,
            ) &&
            hostedUsageCreditBillingDateMatches(
              billingRef.lastStripeEventCreatedAt,
              subscription.lastStripeEventCreatedAt,
            ) &&
            billingRef.stripeCustomerId === input.customerId &&
            billingRef.stripeSubscriptionId ===
              subscription.stripeSubscriptionId
          );
        } else if (subscription) {
          const member = await readHostedMemberBillingSnapshot({
            memberId: payerMemberId,
            prisma: tx,
          });
          authorityStillCurrent = Boolean(
            member?.billingRef &&
            hasHostedMemberOwnPaidBilling({
              ...member.core,
              billingRef: member.billingRef,
            }) &&
            member.core.billingStatus === subscription.billingStatus &&
            hostedUsageCreditBillingDateMatches(
              member.core.suspendedAt,
              subscription.suspendedAt,
            ) &&
            hostedUsageCreditBillingDateMatches(
              member.billingRef.lastStripeEventCreatedAt,
              subscription.lastStripeEventCreatedAt,
            ) &&
            member.billingRef.stripeCustomerId === input.customerId &&
            member.billingRef.stripeSubscriptionId ===
              subscription.stripeSubscriptionId
          );
        }
        if (!authorityStillCurrent) {
          return { kind: "not_bound", purchase: current };
        }
      }
    }

    const [stripePaymentIntentIdEncrypted, stripeChargeIdEncrypted] =
      await Promise.all([
        encryptHostedUsageCreditPurchaseStripeField({
          field:
            HOSTED_USAGE_CREDIT_PURCHASE_STRIPE_PRIVATE_FIELDS.paymentIntentId,
          payerMemberId,
          prisma: tx,
          value: input.paymentIntent.id,
        }),
        encryptHostedUsageCreditPurchaseStripeField({
          field: HOSTED_USAGE_CREDIT_PURCHASE_STRIPE_PRIVATE_FIELDS.chargeId,
          payerMemberId,
          prisma: tx,
          value: chargeId,
        }),
      ]);
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
        status: alreadyBound
          ? HostedUsageCreditPurchaseStatus.payment_pending
          : HostedUsageCreditPurchaseStatus.created,
        stripePaymentIntentLookupKey: alreadyBound
          ? current.stripePaymentIntentLookupKey
          : null,
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
    return { kind: "bound", purchase: bound };
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

function hostedUsageCreditBillingDateMatches(
  current: Date | null | undefined,
  expected: Date | null,
): boolean {
  return (current?.getTime() ?? null) === (expected?.getTime() ?? null);
}

function isHostedUsageCreditExactSavedCardPolicy(value: string): boolean {
  return value === HOSTED_USAGE_CREDIT_CHECKOUT_REQUEST_POLICY_V4 ||
    value === HOSTED_USAGE_CREDIT_CHECKOUT_REQUEST_POLICY_VERSION;
}

function requireHostedUsageCreditDirectPaymentBinding(
  binding: HostedUsageCreditDirectPaymentBinding,
): HostedUsageCreditPurchase {
  if (binding.kind === "not_bound") {
    throw buildHostedUsageCreditInvariantError(
      "saved_card_payment_binding_lost",
    );
  }
  return binding.purchase;
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
