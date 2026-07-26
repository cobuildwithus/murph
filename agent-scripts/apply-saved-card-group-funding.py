from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text()


def write(path: str, content: str) -> None:
    (ROOT / path).write_text(content)


def replace_once(path: str, old: str, new: str) -> None:
    content = read(path)
    count = content.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one match, found {count}: {old[:80]!r}")
    write(path, content.replace(old, new))


def replace_first(path: str, old: str, new: str) -> None:
    content = read(path)
    if old not in content:
        raise RuntimeError(f"{path}: missing first-match text: {old[:80]!r}")
    write(path, content.replace(old, new, 1))


def replace_all(path: str, old: str, new: str, expected: int) -> None:
    content = read(path)
    count = content.count(old)
    if count != expected:
        raise RuntimeError(
            f"{path}: expected {expected} matches, found {count}: {old[:80]!r}"
        )
    write(path, content.replace(old, new))


# Give direct charges an unambiguous Stripe identity distinct from Checkout.
replace_once(
    "apps/web/src/lib/hosted-onboarding/usage-credit-offers.ts",
    '''export const HOSTED_USAGE_CREDIT_CHECKOUT_PURPOSE =
  "hosted_usage_credit" as const;
''',
    '''export const HOSTED_USAGE_CREDIT_CHECKOUT_PURPOSE =
  "hosted_usage_credit" as const;
export const HOSTED_USAGE_CREDIT_SAVED_CARD_PURPOSE =
  "hosted_usage_credit_saved_card" as const;
''',
)

replace_once(
    "apps/web/src/lib/hosted-onboarding/usage-credit-purchase-stripe.ts",
    '''  HOSTED_USAGE_CREDIT_CHECKOUT_PURPOSE,
  HOSTED_USAGE_CREDIT_CHECKOUT_REQUEST_POLICY_VERSION,
''',
    '''  HOSTED_USAGE_CREDIT_CHECKOUT_PURPOSE,
  HOSTED_USAGE_CREDIT_CHECKOUT_REQUEST_POLICY_VERSION,
  HOSTED_USAGE_CREDIT_SAVED_CARD_PURPOSE,
''',
)
replace_once(
    "apps/web/src/lib/hosted-onboarding/usage-credit-purchase-stripe.ts",
    '''export function buildHostedUsageCreditCheckoutMetadata(
  purchaseId: string,
): Record<string, string> {
  return {
    policyVersion: HOSTED_USAGE_CREDIT_CHECKOUT_REQUEST_POLICY_VERSION,
    purchaseId,
    purpose: HOSTED_USAGE_CREDIT_CHECKOUT_PURPOSE,
  };
}
''',
    '''export function buildHostedUsageCreditCheckoutMetadata(
  purchaseId: string,
): Record<string, string> {
  return {
    policyVersion: HOSTED_USAGE_CREDIT_CHECKOUT_REQUEST_POLICY_VERSION,
    purchaseId,
    purpose: HOSTED_USAGE_CREDIT_CHECKOUT_PURPOSE,
  };
}

export function buildHostedUsageCreditSavedCardMetadata(
  purchaseId: string,
): Record<string, string> {
  return {
    policyVersion: HOSTED_USAGE_CREDIT_CHECKOUT_REQUEST_POLICY_VERSION,
    purchaseId,
    purpose: HOSTED_USAGE_CREDIT_SAVED_CARD_PURPOSE,
  };
}
''',
)
replace_once(
    "apps/web/src/lib/hosted-onboarding/usage-credit-purchase-stripe.ts",
    '''    payment_intent_data: {
      metadata: input.checkoutMetadata,
    },
''',
    '''    payment_intent_data: {
      metadata: input.checkoutMetadata,
      setup_future_usage: "off_session",
    },
''',
)

# Reuse customer or subscription defaults conservatively; ambiguous cards stay in Checkout.
replace_once(
    "apps/web/src/lib/hosted-onboarding/usage-credit-saved-card-payment.ts",
    '''  buildHostedUsageCreditCheckoutMetadata,
''',
    '''  buildHostedUsageCreditSavedCardMetadata,
''',
)
replace_once(
    "apps/web/src/lib/hosted-onboarding/usage-credit-saved-card-payment.ts",
    '''  let customer: Stripe.Customer | Stripe.DeletedCustomer;
  let paymentMethods: Stripe.ApiList<Stripe.PaymentMethod>;
  try {
    [customer, paymentMethods] = await Promise.all([
      input.stripe.customers.retrieve(input.customerId, {
        expand: ["invoice_settings.default_payment_method"],
      }),
      input.stripe.paymentMethods.list({
        customer: input.customerId,
        limit: 100,
        type: "card",
      }),
    ]);
''',
    '''  let customer: Stripe.Customer | Stripe.DeletedCustomer;
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
''',
)
replace_once(
    "apps/web/src/lib/hosted-onboarding/usage-credit-saved-card-payment.ts",
    '''  if (paymentMethods.has_more) {
    return null;
  }

  const attachedPaymentMethodIds = new Set<string>();
''',
    '''  if (paymentMethods.has_more || subscriptions.has_more) {
    return null;
  }

  const attachedPaymentMethodIds = new Set<string>();
''',
)
replace_once(
    "apps/web/src/lib/hosted-onboarding/usage-credit-saved-card-payment.ts",
    '''  const defaultPaymentMethodId = coerceStripeObjectId(
    customer.invoice_settings.default_payment_method,
  );
  if (
    defaultPaymentMethodId &&
    attachedPaymentMethodIds.has(defaultPaymentMethodId)
  ) {
    return defaultPaymentMethodId;
  }
  return attachedPaymentMethodIds.size === 1
    ? [...attachedPaymentMethodIds][0] ?? null
    : null;
''',
    '''  const preferredPaymentMethodIds = new Set<string>();
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
''',
)
replace_once(
    "apps/web/src/lib/hosted-onboarding/usage-credit-saved-card-payment.ts",
    '''      metadata: buildHostedUsageCreditCheckoutMetadata(input.purchase.id),
''',
    '''      metadata: buildHostedUsageCreditSavedCardMetadata(input.purchase.id),
''',
)

# A direct payment has no Checkout Session reference.
replace_once(
    "apps/web/src/lib/hosted-onboarding/usage-credit-stripe-reconciliation-context.ts",
    '''  sessionId: string;
''',
    '''  sessionId: string | null;
''',
)

# Extend the existing payment proof without weakening Checkout validation.
replace_once(
    "apps/web/src/lib/hosted-onboarding/usage-credit-stripe-payment-proof.ts",
    '''  HOSTED_USAGE_CREDIT_CHECKOUT_PURPOSE,
  HOSTED_USAGE_CREDIT_CHECKOUT_REQUEST_POLICY_VERSION,
''',
    '''  HOSTED_USAGE_CREDIT_CHECKOUT_PURPOSE,
  HOSTED_USAGE_CREDIT_CHECKOUT_REQUEST_POLICY_VERSION,
  HOSTED_USAGE_CREDIT_SAVED_CARD_PURPOSE,
''',
)
replace_once(
    "apps/web/src/lib/hosted-onboarding/usage-credit-stripe-payment-proof.ts",
    '''export type HostedUsageCreditPaidCheckoutAuthorization = {
  paymentIntentId: string;
  purchaseId: string;
  sessionId: string;
};
''',
    '''export type HostedUsageCreditPaymentAuthorization = {
  paymentIntentId: string;
  purchaseId: string;
  sessionId: string | null;
};

export type HostedUsageCreditPaidCheckoutAuthorization =
  HostedUsageCreditPaymentAuthorization & {
    sessionId: string;
  };
''',
)
replace_once(
    "apps/web/src/lib/hosted-onboarding/usage-credit-stripe-payment-proof.ts",
    '''export function assertHostedUsageCreditChargeContext(input: {
''',
    '''export function assertHostedUsageCreditPaymentIntentMatchesPurchase(input: {
  paymentIntent: Stripe.PaymentIntent;
  purchase: HostedUsageCreditPurchaseForReconciliation;
}): void {
  const { paymentIntent, purchase } = input;
  if (paymentIntent.livemode !== purchase.stripeLiveMode) {
    throw new Error("Usage-credit PaymentIntent environment did not match.");
  }
  assertHostedUsageCreditMetadataForPurpose({
    metadata: paymentIntent.metadata,
    purchase,
    purpose: HOSTED_USAGE_CREDIT_SAVED_CARD_PURPOSE,
  });
  assertHostedStripeLookupMatches({
    expectedLookupKey: purchase.stripeCustomerLookupKey,
    kind: "stripe-customer",
    value: coerceStripeObjectId(paymentIntent.customer),
  });
  if (
    !Number.isSafeInteger(paymentIntent.amount) ||
    !Number.isSafeInteger(paymentIntent.amount_received) ||
    paymentIntent.amount !== purchase.cashAmountMinor ||
    paymentIntent.amount_received < 0 ||
    paymentIntent.amount_received > purchase.cashAmountMinor ||
    normalizeNullableString(paymentIntent.currency)?.toLowerCase() !==
      purchase.cashCurrency.toLowerCase() ||
    (
      paymentIntent.status === "succeeded" &&
      paymentIntent.amount_received !== purchase.cashAmountMinor
    )
  ) {
    throw new Error("Usage-credit PaymentIntent amount or currency did not match.");
  }
  assertHostedStripeBillingEventLookupMatches({
    expectedLookupKey: purchase.stripePaymentIntentLookupKey,
    value: paymentIntent.id,
  });
  const chargeId = coerceStripeObjectId(paymentIntent.latest_charge);
  if (purchase.stripeChargeLookupKey) {
    assertHostedStripeBillingEventLookupMatches({
      expectedLookupKey: purchase.stripeChargeLookupKey,
      value: chargeId ?? "",
    });
  }
  if (paymentIntent.status === "succeeded" && !chargeId) {
    throw new Error("Succeeded usage-credit PaymentIntent did not include a Charge.");
  }
}

export function buildHostedUsageCreditDirectPaymentAuthorization(input: {
  paymentIntent: Stripe.PaymentIntent;
  purchase: HostedUsageCreditPurchaseForReconciliation;
}): HostedUsageCreditPaymentAuthorization {
  assertHostedUsageCreditPaymentIntentMatchesPurchase(input);
  if (input.paymentIntent.status !== "succeeded") {
    throw new Error("Usage-credit direct payment was not succeeded.");
  }
  return {
    paymentIntentId: input.paymentIntent.id,
    purchaseId: input.purchase.id,
    sessionId: null,
  };
}

export function readHostedUsageCreditSavedCardPurchaseId(
  metadata: Prisma.JsonValue | Stripe.Metadata | null,
): string | null {
  const value = readStringRecord(metadata);
  if (value?.purpose !== HOSTED_USAGE_CREDIT_SAVED_CARD_PURPOSE) {
    return null;
  }
  const expectedKeys = ["policyVersion", "purchaseId", "purpose"];
  if (
    Object.keys(value).length !== expectedKeys.length ||
    expectedKeys.some((key) => !(key in value)) ||
    value.policyVersion !== HOSTED_USAGE_CREDIT_CHECKOUT_REQUEST_POLICY_VERSION ||
    !normalizeNullableString(value.purchaseId)
  ) {
    throw new Error("Saved-card usage-credit metadata did not match.");
  }
  return value.purchaseId;
}

export function assertHostedUsageCreditChargeContext(input: {
''',
)
# Rename all legacy metadata calls to the Checkout-specific validator, then make
# the financial Charge validator accept either exact payment purpose.
replace_all(
    "apps/web/src/lib/hosted-onboarding/usage-credit-stripe-payment-proof.ts",
    "assertHostedUsageCreditMetadata({",
    "assertHostedUsageCreditCheckoutMetadata({",
    expected=3,
)
replace_first(
    "apps/web/src/lib/hosted-onboarding/usage-credit-stripe-payment-proof.ts",
    "assertHostedUsageCreditCheckoutMetadata({",
    "assertHostedUsageCreditFinancialMetadata({",
)
replace_once(
    "apps/web/src/lib/hosted-onboarding/usage-credit-stripe-payment-proof.ts",
    '''function assertHostedUsageCreditCheckoutMetadata(input: {
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
''',
    '''function assertHostedUsageCreditCheckoutMetadata(input: {
  metadata: Prisma.JsonValue | Stripe.Metadata | null;
  purchase: HostedUsageCreditPurchaseForReconciliation;
}): void {
  assertHostedUsageCreditMetadataForPurpose({
    ...input,
    purpose: HOSTED_USAGE_CREDIT_CHECKOUT_PURPOSE,
  });
}

function assertHostedUsageCreditFinancialMetadata(input: {
  metadata: Prisma.JsonValue | Stripe.Metadata | null;
  purchase: HostedUsageCreditPurchaseForReconciliation;
}): void {
  const metadata = readStringRecord(input.metadata);
  const purpose = metadata?.purpose;
  if (
    purpose !== HOSTED_USAGE_CREDIT_CHECKOUT_PURPOSE &&
    purpose !== HOSTED_USAGE_CREDIT_SAVED_CARD_PURPOSE
  ) {
    throw new Error("Usage-credit payment metadata purpose did not match.");
  }
  assertHostedUsageCreditMetadataForPurpose({
    ...input,
    purpose,
  });
}

function assertHostedUsageCreditMetadataForPurpose(input: {
  metadata: Prisma.JsonValue | Stripe.Metadata | null;
  purchase: HostedUsageCreditPurchaseForReconciliation;
  purpose:
    | typeof HOSTED_USAGE_CREDIT_CHECKOUT_PURPOSE
    | typeof HOSTED_USAGE_CREDIT_SAVED_CARD_PURPOSE;
}): void {
  const metadata = readStringRecord(input.metadata);
  const expected = {
    policyVersion: HOSTED_USAGE_CREDIT_CHECKOUT_REQUEST_POLICY_VERSION,
    purchaseId: input.purchase.id,
    purpose: input.purpose,
  };
  if (
    input.purchase.checkoutRequestPolicyVersion !==
      HOSTED_USAGE_CREDIT_CHECKOUT_REQUEST_POLICY_VERSION ||
    !metadata ||
    Object.keys(metadata).length !== Object.keys(expected).length ||
    Object.entries(expected).some(([key, value]) => metadata[key] !== value)
  ) {
    throw new Error("Usage-credit payment metadata did not match.");
  }
}
''',
)

# Financial refunds/disputes converge through the same ledger for either path.
replace_once(
    "apps/web/src/lib/hosted-onboarding/usage-credit-stripe-financial-reconciliation.ts",
    '''  assertHostedUsageCreditFinancialEventLinks,
  type HostedUsageCreditChargeContext,
  type HostedUsageCreditPaidCheckoutAuthorization,
  type HostedUsageCreditPreparedPaidCheckout,
  validateHostedUsageCreditPreparedPaidCheckout,
''',
    '''  assertHostedUsageCreditFinancialEventLinks,
  buildHostedUsageCreditDirectPaymentAuthorization,
  readHostedUsageCreditSavedCardPurchaseId,
  type HostedUsageCreditChargeContext,
  type HostedUsageCreditPaymentAuthorization,
  type HostedUsageCreditPreparedPaidCheckout,
  validateHostedUsageCreditPreparedPaidCheckout,
''',
)
replace_once(
    "apps/web/src/lib/hosted-onboarding/usage-credit-stripe-financial-reconciliation.ts",
    '''export type HostedUsageCreditPreparedFinancialEvent = {
  paidCheckout: HostedUsageCreditPreparedPaidCheckout;
  privateReferences: HostedUsageCreditStripePrivateReferences;
  snapshot: HostedUsageCreditFinancialSnapshot;
};
''',
    '''type HostedUsageCreditPreparedFinancialPayment =
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
''',
)
replace_once(
    "apps/web/src/lib/hosted-onboarding/usage-credit-stripe-financial-reconciliation.ts",
    '''  const paidCheckout = await prepareHostedUsageCreditFinancialSnapshotCheckout({
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
''',
    '''  const payment = await prepareHostedUsageCreditFinancialSnapshotPayment({
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
''',
)
replace_once(
    "apps/web/src/lib/hosted-onboarding/usage-credit-stripe-financial-reconciliation.ts",
    '''  return reconcileAndBindHostedUsageCreditFinancialSnapshotTx({
    checkoutAuthorization: validateHostedUsageCreditPreparedPaidCheckout({
      eventLiveMode: input.event.livemode,
      paidCheckout: input.prepared.paidCheckout,
      purchase: input.purchase,
    }),
''',
    '''  const paymentAuthorization = input.prepared.payment.kind === "checkout"
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
''',
)
replace_once(
    "apps/web/src/lib/hosted-onboarding/usage-credit-stripe-financial-reconciliation.ts",
    '''async function prepareHostedUsageCreditFinancialSnapshotCheckout(input: {
  context: HostedUsageCreditStripePreparationContext;
  eventLiveMode: boolean;
  paymentIntent: Stripe.PaymentIntent;
  prisma: HostedUsageCreditPurchaseReadClient;
  purchase: HostedUsageCreditPurchaseForReconciliation;
}): Promise<HostedUsageCreditPreparedPaidCheckout> {
  let sessionId: string | null = null;
''',
    '''async function prepareHostedUsageCreditFinancialSnapshotPayment(input: {
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
''',
)
replace_once(
    "apps/web/src/lib/hosted-onboarding/usage-credit-stripe-financial-reconciliation.ts",
    '''  return paidCheckout;
}

function assertHostedUsageCreditPreparedFinancialEvent''',
    '''  return {
    kind: "checkout",
    paidCheckout,
  };
}

function assertHostedUsageCreditPreparedFinancialEvent''',
)
replace_all(
    "apps/web/src/lib/hosted-onboarding/usage-credit-stripe-financial-reconciliation.ts",
    "checkoutAuthorization: HostedUsageCreditPaidCheckoutAuthorization;",
    "paymentAuthorization: HostedUsageCreditPaymentAuthorization;",
    expected=2,
)
replace_all(
    "apps/web/src/lib/hosted-onboarding/usage-credit-stripe-financial-reconciliation.ts",
    "input.checkoutAuthorization",
    "input.paymentAuthorization",
    expected=4,
)
replace_once(
    "apps/web/src/lib/hosted-onboarding/usage-credit-stripe-financial-reconciliation.ts",
    '"Usage-credit financial snapshot lacked Checkout authorization."',
    '"Usage-credit financial snapshot lacked payment authorization."',
)

# Rename the convergence argument at its Checkout and direct call sites.
replace_once(
    "apps/web/src/lib/hosted-onboarding/usage-credit-stripe-checkout-reconciliation.ts",
    '''      checkoutAuthorization,
      effectiveAt:''',
    '''      paymentAuthorization: checkoutAuthorization,
      effectiveAt:''',
)
replace_once(
    "apps/web/src/lib/hosted-onboarding/usage-credit-stripe-direct-payment-reconciliation.ts",
    '''      checkoutAuthorization: buildHostedUsageCreditDirectPaymentAuthorization({
''',
    '''      paymentAuthorization: buildHostedUsageCreditDirectPaymentAuthorization({
''',
)

# Route direct PaymentIntent events through the same reconciliation lock.
replace_once(
    "apps/web/src/lib/hosted-onboarding/usage-credit-stripe-reconciliation.ts",
    '''  HOSTED_USAGE_CREDIT_CHECKOUT_PURPOSE,
  HOSTED_USAGE_CREDIT_CHECKOUT_REQUEST_POLICY_VERSION,
''',
    '''  HOSTED_USAGE_CREDIT_CHECKOUT_PURPOSE,
  HOSTED_USAGE_CREDIT_CHECKOUT_REQUEST_POLICY_VERSION,
  HOSTED_USAGE_CREDIT_SAVED_CARD_PURPOSE,
''',
)
replace_once(
    "apps/web/src/lib/hosted-onboarding/usage-credit-stripe-reconciliation.ts",
    '''import {
  isHostedUsageCreditFinancialReversalEvent,
''',
    '''import {
  isHostedUsageCreditDirectPaymentEvent,
  prepareHostedUsageCreditDirectPaymentEvent,
  reconcileHostedUsageCreditDirectPaymentEventTx,
  type HostedUsageCreditPreparedDirectPaymentEvent,
} from "./usage-credit-stripe-direct-payment-reconciliation";
import {
  isHostedUsageCreditFinancialReversalEvent,
''',
)
replace_once(
    "apps/web/src/lib/hosted-onboarding/usage-credit-stripe-reconciliation.ts",
    '''import { readStringRecord } from "./usage-credit-stripe-payment-proof";
''',
    '''import {
  readHostedUsageCreditSavedCardPurchaseId,
  readStringRecord,
} from "./usage-credit-stripe-payment-proof";
''',
)
replace_once(
    "apps/web/src/lib/hosted-onboarding/usage-credit-stripe-reconciliation.ts",
    '''  eventKind: "checkout" | "dispute" | "refund";
''',
    '''  eventKind: "checkout" | "direct_payment" | "dispute" | "refund";
''',
)
replace_once(
    "apps/web/src/lib/hosted-onboarding/usage-credit-stripe-reconciliation.ts",
    '''  | {
      eventKind: "dispute" | "refund";
      reconciliationVersion: bigint;
      value: HostedUsageCreditPreparedFinancialEvent;
    };
''',
    '''  | {
      eventKind: "direct_payment";
      reconciliationVersion: bigint;
      value: HostedUsageCreditPreparedDirectPaymentEvent;
    }
  | {
      eventKind: "dispute" | "refund";
      reconciliationVersion: bigint;
      value: HostedUsageCreditPreparedFinancialEvent;
    };
''',
)
replace_once(
    "apps/web/src/lib/hosted-onboarding/usage-credit-stripe-reconciliation.ts",
    '''        return prepared.eventKind === "checkout"
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
''',
    '''        if (prepared.eventKind === "checkout") {
          return reconcileHostedUsageCreditCheckoutEventTx({
            event: input.event,
            expectedReconciliationVersion: prepared.reconciliationVersion,
            prepared: prepared.value,
            purchase,
            tx,
          });
        }
        if (prepared.eventKind === "direct_payment") {
          return reconcileHostedUsageCreditDirectPaymentEventTx({
            event: input.event,
            expectedReconciliationVersion: prepared.reconciliationVersion,
            prepared: prepared.value,
            purchase,
            tx,
          });
        }
        return reconcileHostedUsageCreditFinancialEventTx({
          event: input.event,
          eventKind: prepared.eventKind,
          expectedReconciliationVersion: prepared.reconciliationVersion,
          prepared: prepared.value,
          purchase,
          tx,
        });
''',
)
replace_once(
    "apps/web/src/lib/hosted-onboarding/usage-credit-stripe-reconciliation.ts",
    '''  return {
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
''',
    '''  const prepared = await prepareHostedUsageCreditStripeEvent({
    candidate,
    context: input.context,
    event: input.event,
    prisma: input.prisma,
    purchase,
  });
  return prepared
    ? {
        candidate,
        kind: "prepared",
        prepared,
      }
    : { kind: "unhandled" };
''',
)
replace_once(
    "apps/web/src/lib/hosted-onboarding/usage-credit-stripe-reconciliation.ts",
    '''  if (!isHostedUsageCreditFinancialReversalEvent(input.event.type)) {
    return null;
  }

  const {
''',
    '''  if (isHostedUsageCreditDirectPaymentEvent(input.event.type)) {
    const paymentIntent = input.event.data.object as Stripe.PaymentIntent;
    const purchaseId = readHostedUsageCreditSavedCardPurchaseId(
      paymentIntent.metadata,
    );
    if (!purchaseId) {
      return null;
    }
    const purchase = await findHostedUsageCreditPurchaseById({
      prisma: input.prisma,
      purchaseId,
    });
    return {
      beneficiaryMemberId: purchase.beneficiaryMemberId,
      eventKind: "direct_payment",
      purchaseId: purchase.id,
    };
  }

  if (!isHostedUsageCreditFinancialReversalEvent(input.event.type)) {
    return null;
  }

  const {
''',
)
replace_once(
    "apps/web/src/lib/hosted-onboarding/usage-credit-stripe-reconciliation.ts",
    '''  if (
    normalizeNullableString(metadata?.purpose) !==
      HOSTED_USAGE_CREDIT_CHECKOUT_PURPOSE
  ) {
    return null;
  }
''',
    '''  const purpose = normalizeNullableString(metadata?.purpose);
  if (
    purpose !== HOSTED_USAGE_CREDIT_CHECKOUT_PURPOSE &&
    purpose !== HOSTED_USAGE_CREDIT_SAVED_CARD_PURPOSE
  ) {
    return null;
  }
''',
)
replace_once(
    "apps/web/src/lib/hosted-onboarding/usage-credit-stripe-reconciliation.ts",
    ''')}): Promise<HostedUsageCreditPreparedStripeEvent> {
  if (input.candidate.eventKind === "checkout") {
''',
    ''')}): Promise<HostedUsageCreditPreparedStripeEvent | null> {
  if (input.candidate.eventKind === "checkout") {
''',
)
replace_once(
    "apps/web/src/lib/hosted-onboarding/usage-credit-stripe-reconciliation.ts",
    '''  return {
    eventKind: input.candidate.eventKind,
    reconciliationVersion: input.purchase.reconciliationVersion,
    value: await prepareHostedUsageCreditFinancialEvent({
''',
    '''  if (input.candidate.eventKind === "direct_payment") {
    return {
      eventKind: "direct_payment",
      reconciliationVersion: input.purchase.reconciliationVersion,
      value: await prepareHostedUsageCreditDirectPaymentEvent({
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
''',
)
replace_once(
    "apps/web/src/lib/hosted-onboarding/usage-credit-stripe-reconciliation.ts",
    '''function shouldGuardHostedUsageCreditStripeEvent(event: Stripe.Event): boolean {
  if (isHostedUsageCreditFinancialReversalEvent(event.type)) {
    return true;
  }
  if (!isHostedUsageCreditCheckoutEvent(event.type)) {
    return false;
  }
''',
    '''function shouldGuardHostedUsageCreditStripeEvent(event: Stripe.Event): boolean {
  if (isHostedUsageCreditFinancialReversalEvent(event.type)) {
    return true;
  }
  if (isHostedUsageCreditDirectPaymentEvent(event.type)) {
    return readHostedUsageCreditSavedCardPurchaseId(
      (event.data.object as Stripe.PaymentIntent).metadata,
    ) !== null;
  }
  if (!isHostedUsageCreditCheckoutEvent(event.type)) {
    return false;
  }
''',
)

# Only group funding takes the one-click path; personal/Family behavior stays stable.
replace_once(
    "apps/web/src/lib/hosted-onboarding/usage-credit-purchase-service.ts",
    '''import { logHostedStripeFailure } from "./stripe-error-log";
''',
    '''import { logHostedStripeFailure } from "./stripe-error-log";
import { tryChargeHostedUsageCreditSavedCard } from
  "./usage-credit-saved-card-payment";
''',
)
replace_once(
    "apps/web/src/lib/hosted-onboarding/usage-credit-purchase-service.ts",
    '''  await assertHostedUsageCreditStripePriceMatchesPurchase({
    checkoutRequest,
    purchase,
    stripe,
  });
  let session: Stripe.Checkout.Session;
''',
    '''  await assertHostedUsageCreditStripePriceMatchesPurchase({
    checkoutRequest,
    purchase,
    stripe,
  });
  if (projectHostedUsageCreditPurchaseTarget(purchase).kind === "group") {
    const directPaymentPurchase = await tryChargeHostedUsageCreditSavedCard({
      checkoutRequest,
      now: input.now,
      prisma: input.prisma,
      purchase,
      stripe,
    });
    if (directPaymentPurchase) {
      const projection = await projectHostedUsageCreditCheckoutForCurrentTarget({
        now: input.now,
        prisma: input.prisma,
        purchase: directPaymentPurchase,
      });
      return projection.checkout;
    }
  }
  let session: Stripe.Checkout.Session;
''',
)

# Make the click's authorization and fallback behavior clear in the UI.
replace_once(
    "apps/web/src/components/settings/hosted-usage-top-up-dialog.tsx",
    '''                  ? "Shared with everyone in the chat."
''',
    '''                  ? "Shared with everyone in the chat. We’ll use your saved card when available; Stripe handles card entry or verification when needed."
''',
)
replace_once(
    "apps/web/src/components/settings/hosted-usage-top-up-dialog.tsx",
    '''                  {controller.checkoutInFlight
                    ? "Opening checkout…"
                    : controller.selectedOffer
                      ? `Continue to checkout · ${controller.selectedOffer.amountLabel}`
                      : "Choose an amount"}
''',
    '''                  {controller.checkoutInFlight
                    ? props.scope === "group"
                      ? "Adding messages…"
                      : "Opening checkout…"
                    : controller.selectedOffer
                      ? props.scope === "group"
                        ? `Add messages · ${controller.selectedOffer.amountLabel}`
                        : `Continue to checkout · ${controller.selectedOffer.amountLabel}`
                      : "Choose an amount"}
''',
)

# UI tests assert the explicit group authorization wording.
replace_once(
    "apps/web/test/hosted-usage-top-up-dialog.test.tsx",
    '''    assert.match(
      rendered.container.textContent ?? "",
      /Shared with everyone in the chat\./,
    );
''',
    '''    assert.match(
      rendered.container.textContent ?? "",
      /Shared with everyone in the chat\./,
    );
    assert.match(
      rendered.container.textContent ?? "",
      /saved card when available/,
    );
''',
)
replace_once(
    "apps/web/test/hosted-usage-top-up-dialog.test.tsx",
    '''      "Continue to checkout · $5",
''',
    '''      "Add messages · $5",
''',
)

# Existing service tests need the additional Stripe surface, plus one focused
# assertion that a group purchase skips Checkout when a canonical card exists.
replace_once(
    "apps/web/test/hosted-usage-credit-purchase-service.test.ts",
    '''  createHostedStripeCheckoutSessionLookupKey: vi.fn((value: string | null | undefined) =>
    value ? `checkout:${value}` : null
  ),
''',
    '''  createHostedStripeBillingEventLookupKey: vi.fn(
    (value: string | null | undefined) => value ? `billing:${value}` : null,
  ),
  createHostedStripeCheckoutSessionLookupKey: vi.fn((value: string | null | undefined) =>
    value ? `checkout:${value}` : null
  ),
''',
)
replace_once(
    "apps/web/test/hosted-usage-credit-purchase-service.test.ts",
    '''  }) => input.expectedLookupKey === `${
    input.kind === "stripe-price" ? "price" : "checkout"
  }:${input.normalizedValue}`),
''',
    '''  }) => input.expectedLookupKey === `${
    input.kind === "stripe-price"
      ? "price"
      : input.kind === "stripe-customer"
        ? "customer"
        : input.kind === "stripe-billing-event"
          ? "billing"
          : "checkout"
  }:${input.normalizedValue}`),
''',
)
replace_once(
    "apps/web/test/hosted-usage-credit-purchase-service.test.ts",
    '''  stripeCheckoutRetrieve: vi.fn(),
  stripePriceRetrieve: vi.fn(),
''',
    '''  stripeCheckoutRetrieve: vi.fn(),
  stripeCustomerRetrieve: vi.fn(),
  stripePaymentIntentCancel: vi.fn(),
  stripePaymentIntentCreate: vi.fn(),
  stripePaymentIntentRetrieve: vi.fn(),
  stripePaymentMethodsList: vi.fn(),
  stripePriceRetrieve: vi.fn(),
  stripeSubscriptionsList: vi.fn(),
''',
)
replace_once(
    "apps/web/test/hosted-usage-credit-purchase-service.test.ts",
    '''vi.mock("@/src/lib/hosted-onboarding/contact-privacy", () => ({
  createHostedStripeCheckoutSessionLookupKey:
''',
    '''vi.mock("@/src/lib/hosted-onboarding/contact-privacy", () => ({
  createHostedStripeBillingEventLookupKey:
    mocks.createHostedStripeBillingEventLookupKey,
  createHostedStripeCheckoutSessionLookupKey:
''',
)
stripe_surface_old = '''        prices: { retrieve: mocks.stripePriceRetrieve },
'''
stripe_surface_new = '''        customers: { retrieve: mocks.stripeCustomerRetrieve },
        paymentIntents: {
          cancel: mocks.stripePaymentIntentCancel,
          create: mocks.stripePaymentIntentCreate,
          retrieve: mocks.stripePaymentIntentRetrieve,
        },
        paymentMethods: { list: mocks.stripePaymentMethodsList },
        prices: { retrieve: mocks.stripePriceRetrieve },
        subscriptions: { list: mocks.stripeSubscriptionsList },
'''
replace_all(
    "apps/web/test/hosted-usage-credit-purchase-service.test.ts",
    stripe_surface_old,
    stripe_surface_new,
    expected=2,
)
replace_once(
    "apps/web/test/hosted-usage-credit-purchase-service.test.ts",
    '''  mocks.stripeCheckoutRetrieve.mockReset();
  mocks.stripePriceRetrieve.mockReset();
''',
    '''  mocks.stripeCheckoutRetrieve.mockReset();
  mocks.stripeCustomerRetrieve.mockReset();
  mocks.stripePaymentIntentCancel.mockReset();
  mocks.stripePaymentIntentCreate.mockReset();
  mocks.stripePaymentIntentRetrieve.mockReset();
  mocks.stripePaymentMethodsList.mockReset();
  mocks.stripePriceRetrieve.mockReset();
  mocks.stripeSubscriptionsList.mockReset();
''',
)
replace_once(
    "apps/web/test/hosted-usage-credit-purchase-service.test.ts",
    '''  mocks.stripePriceRetrieve.mockImplementation(async (priceId: string) =>
    buildStripePriceForId(priceId)
  );
''',
    '''  mocks.stripeCustomerRetrieve.mockResolvedValue({
    id: "cus_group_payer",
    invoice_settings: { default_payment_method: null },
    livemode: false,
    object: "customer",
  });
  mocks.stripePaymentMethodsList.mockResolvedValue({
    data: [],
    has_more: false,
    object: "list",
    url: "/v1/payment_methods",
  });
  mocks.stripeSubscriptionsList.mockResolvedValue({
    data: [],
    has_more: false,
    object: "list",
    url: "/v1/subscriptions",
  });
  mocks.stripePriceRetrieve.mockImplementation(async (priceId: string) =>
    buildStripePriceForId(priceId)
  );
''',
)
replace_once(
    "apps/web/test/hosted-usage-credit-purchase-service.test.ts",
    '''  it("rechecks the exact group thread-container target inside checkout", async () => {
''',
    '''  it("charges a canonical saved card without opening Checkout", async () => {
    const fake = createFakePrisma();
    mocks.stripeCustomerRetrieve.mockResolvedValueOnce({
      id: "cus_group_payer",
      invoice_settings: { default_payment_method: "pm_saved_card_123" },
      livemode: false,
      object: "customer",
    });
    mocks.stripePaymentMethodsList.mockResolvedValueOnce({
      data: [{
        customer: "cus_group_payer",
        id: "pm_saved_card_123",
        livemode: false,
        object: "payment_method",
        type: "card",
      }],
      has_more: false,
      object: "list",
      url: "/v1/payment_methods",
    });
    mocks.stripePaymentIntentCreate.mockImplementationOnce(
      async (request: Record<string, unknown>) => ({
        amount: request.amount,
        amount_received: request.amount,
        currency: request.currency,
        customer: request.customer,
        id: "pi_saved_card_123",
        latest_charge: "ch_saved_card_123",
        livemode: false,
        metadata: request.metadata,
        object: "payment_intent",
        status: "succeeded",
      }),
    );

    const result = await createHostedGroupUsageCreditCheckout({
      clientRequestKey: CLIENT_REQUEST_KEY,
      joinCode: "group_join_code_1234",
      now: NOW,
      offerCode: "usage_10_usd",
      payerMemberId: MEMBER_ID,
      prisma: fake.prisma as never,
    });

    expect(result).toMatchObject({ status: "payment_pending" });
    expect(result).not.toHaveProperty("url");
    expect(mocks.stripePaymentIntentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 1_000,
        confirm: true,
        currency: "usd",
        customer: "cus_group_payer",
        off_session: true,
        payment_method: "pm_saved_card_123",
        setup_future_usage: "off_session",
      }),
      {
        idempotencyKey: expect.stringMatching(
          /^hosted-usage-credit-saved-card:hucp_/,
        ),
      },
    );
    expect(mocks.stripeCheckoutCreate).not.toHaveBeenCalled();
    expect(onlyPurchase(fake.purchases)).toMatchObject({
      status: "payment_pending",
      stripeChargeIdEncrypted: "encrypted:ch_saved_card_123",
      stripeChargeLookupKey: "billing:ch_saved_card_123",
      stripePaymentIntentIdEncrypted: "encrypted:pi_saved_card_123",
      stripePaymentIntentLookupKey: "billing:pi_saved_card_123",
    });
  });

  it("rechecks the exact group thread-container target inside checkout", async () => {
''',
)
replace_once(
    "apps/web/test/hosted-usage-credit-purchase-service.test.ts",
    '''        payment_intent_data: {
          metadata: {
            policyVersion: "hosted-usage-credit-checkout-v1",
            purchaseId: purchase.id,
            purpose: "hosted_usage_credit",
          },
        },
''',
    '''        payment_intent_data: {
          metadata: {
            policyVersion: "hosted-usage-credit-checkout-v1",
            purchaseId: purchase.id,
            purpose: "hosted_usage_credit",
          },
          setup_future_usage: "off_session",
        },
''',
)
replace_once(
    "apps/web/test/hosted-usage-credit-purchase-service.test.ts",
    '''  mocks.stripeCheckoutRetrieve.mockClear();
  mocks.stripePriceRetrieve.mockClear();
''',
    '''  mocks.stripeCheckoutRetrieve.mockClear();
  mocks.stripeCustomerRetrieve.mockClear();
  mocks.stripePaymentIntentCancel.mockClear();
  mocks.stripePaymentIntentCreate.mockClear();
  mocks.stripePaymentIntentRetrieve.mockClear();
  mocks.stripePaymentMethodsList.mockClear();
  mocks.stripePriceRetrieve.mockClear();
  mocks.stripeSubscriptionsList.mockClear();
''',
)
replace_once(
    "apps/web/test/hosted-usage-credit-purchase-service.test.ts",
    '''  expect(mocks.stripeCheckoutRetrieve).not.toHaveBeenCalled();
  expect(mocks.stripePriceRetrieve).not.toHaveBeenCalled();
''',
    '''  expect(mocks.stripeCheckoutRetrieve).not.toHaveBeenCalled();
  expect(mocks.stripeCustomerRetrieve).not.toHaveBeenCalled();
  expect(mocks.stripePaymentIntentCancel).not.toHaveBeenCalled();
  expect(mocks.stripePaymentIntentCreate).not.toHaveBeenCalled();
  expect(mocks.stripePaymentIntentRetrieve).not.toHaveBeenCalled();
  expect(mocks.stripePaymentMethodsList).not.toHaveBeenCalled();
  expect(mocks.stripePriceRetrieve).not.toHaveBeenCalled();
  expect(mocks.stripeSubscriptionsList).not.toHaveBeenCalled();
''',
)

# Document the consent and deployment contract next to the existing top-up spec.
spec_path = "agent-docs/product-specs/hosted-usage-topups.md"
spec = read(spec_path)
section = '''

## Saved-card group funding

Group funding uses an explicit click-to-charge contract. Choosing an amount does
nothing by itself; pressing **Add messages** authorizes exactly that one-time
amount for the server-resolved group beneficiary. It never creates recurring
billing or an automatic refill.

For a signed-in payer, Murph first looks for one unambiguous reusable card: the
Customer invoice default, a nonterminal Subscription default, or the sole card
attached to the Customer. Conflicting defaults or multiple cards without a
canonical default fall back to Stripe Checkout rather than guessing.

The saved-card attempt is a confirmed off-session PaymentIntent with a frozen
amount, currency, Customer, beneficiary purchase, metadata purpose, and
purchase-scoped idempotency key. A definitive authentication requirement or
card failure is canceled before Checkout is created. Ambiguous provider/network
outcomes remain reconciling and must never start a second charge.

Checkout remains the card-entry and authentication fallback and requests
`setup_future_usage=off_session`, so a card entered there can be reused on a
later group contribution. PaymentIntent, refund, and dispute events converge
through the same encrypted purchase references and usage-credit ledger as
Checkout. The Stripe webhook endpoint must subscribe to
`payment_intent.succeeded`, `payment_intent.processing`,
`payment_intent.payment_failed`, and `payment_intent.canceled` in addition to
the existing Checkout/refund/dispute events.
'''
if "## Saved-card group funding" not in spec:
    write(spec_path, spec.rstrip() + section + "\n")

print("Applied saved-card group funding integration.")
