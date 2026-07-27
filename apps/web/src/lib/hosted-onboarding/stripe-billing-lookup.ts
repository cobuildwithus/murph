import type Stripe from "stripe";

import {
  coerceStripeInvoiceSubscriptionId,
  coerceStripeObjectId,
  coerceStripeSubscriptionId,
} from "./billing";
import {
  HOSTED_FAMILY_MAX_SEATS,
  HOSTED_STANDARD_CHECKOUT_OFFER,
} from "./billing-plans";
import {
  lookupHostedMemberStripeBillingRefByStripeCustomerId,
  lookupHostedMemberStripeBillingRefByStripeSubscriptionId,
} from "./hosted-member-billing-store";
import {
  composeHostedMemberBillingSnapshot,
  type HostedMemberBillingSnapshot,
  readHostedMemberBillingSnapshot,
  readHostedMemberCoreState,
} from "./hosted-member-store";
import { requireHostedStripeApi } from "./runtime";
import {
  normalizeNullableString,
  type HostedOnboardingReadClient,
} from "./shared";
import {
  classifyHostedStripeInvoiceCollectionState,
  type HostedStripeInvoiceCollectionState,
  retrieveHostedStripeInvoiceCollectionSnapshot,
} from "./stripe-billing-state";
import { withHostedStripeFailureLog } from "./stripe-error-log";

/**
 * Owns Stripe-object-to-member lookup and customer-context reads so billing
 * policy can stay focused on freshness rules and entitlement transitions.
 */

export async function findMemberForStripeObject(input: {
  clientReferenceId: string | null;
  customerId: string | null;
  memberId: string | null;
  prisma: HostedOnboardingReadClient;
  requireMatchingSubscription?: boolean;
  subscriptionId: string | null;
}): Promise<HostedMemberBillingSnapshot | null> {
  if (input.memberId) {
    const directMember = await readHostedMemberBillingSnapshotForDirectLookup({
      memberId: input.memberId,
      prisma: input.prisma,
      requireMatchingSubscription: input.requireMatchingSubscription,
    });

    if (canUseHostedStripeBillingLookupCandidate({
      customerId: input.customerId,
      member: directMember,
      requireMatchingSubscription: input.requireMatchingSubscription,
      subscriptionId: input.subscriptionId,
    })) {
      return directMember;
    }
  }

  if (input.clientReferenceId) {
    const directMember = await readHostedMemberBillingSnapshotForDirectLookup({
      memberId: input.clientReferenceId,
      prisma: input.prisma,
      requireMatchingSubscription: input.requireMatchingSubscription,
    });

    if (canUseHostedStripeBillingLookupCandidate({
      customerId: input.customerId,
      member: directMember,
      requireMatchingSubscription: input.requireMatchingSubscription,
      subscriptionId: input.subscriptionId,
    })) {
      return directMember;
    }
  }

  if (input.subscriptionId) {
    const billingLookup = await lookupHostedMemberStripeBillingRefByStripeSubscriptionId({
      prisma: input.prisma,
      stripeSubscriptionId: input.subscriptionId,
    });

    if (billingLookup) {
      return composeHostedMemberBillingSnapshot(
        billingLookup.core,
        billingLookup.billingRef,
      );
    }
  }

  if (input.customerId) {
    const billingLookup = await lookupHostedMemberStripeBillingRefByStripeCustomerId({
      prisma: input.prisma,
      stripeCustomerId: input.customerId,
    });

    if (
      billingLookup &&
      canUseHostedStripeBillingLookupCandidate({
        customerId: input.customerId,
        member: {
          billingRef: billingLookup.billingRef,
          core: billingLookup.core,
        },
        requireMatchingSubscription: input.requireMatchingSubscription,
        subscriptionId: input.subscriptionId,
      })
    ) {
      return composeHostedMemberBillingSnapshot(
        billingLookup.core,
        billingLookup.billingRef,
      );
    }
  }

  return null;
}

export function listHostedStripeDirectMemberIds(input: {
  clientReferenceId: string | null;
  memberId: string | null;
}): string[] {
  return listHostedStripeUniqueMemberIds([
    input.memberId,
    input.clientReferenceId,
  ]);
}

export async function listHostedStripeCheckoutSessionMemberIds(input: {
  prisma: HostedOnboardingReadClient;
  session: Stripe.Checkout.Session;
}): Promise<string[]> {
  const directMemberIds = await filterExistingHostedMemberIds({
    memberIds: listHostedStripeDirectMemberIds({
      clientReferenceId: normalizeNullableString(input.session.client_reference_id),
      memberId: normalizeNullableString(input.session.metadata?.memberId),
    }),
    prisma: input.prisma,
  });
  const stripeLookupMemberIds = await listHostedStripeBillingLookupMemberIds({
    customerId: coerceStripeObjectId(input.session.customer),
    prisma: input.prisma,
    subscriptionId: coerceStripeSubscriptionId(input.session.subscription),
  });

  return listHostedStripeUniqueMemberIds([
    ...directMemberIds,
    ...stripeLookupMemberIds,
  ]);
}

async function listHostedStripeBillingLookupMemberIds(input: {
  customerId: string | null;
  prisma: HostedOnboardingReadClient;
  subscriptionId: string | null;
}): Promise<string[]> {
  const memberIds: string[] = [];

  if (input.subscriptionId) {
    const billingLookup = await lookupHostedMemberStripeBillingRefByStripeSubscriptionId({
      prisma: input.prisma,
      stripeSubscriptionId: input.subscriptionId,
    });
    if (billingLookup) {
      memberIds.push(billingLookup.core.id);
    }
  }

  if (input.customerId) {
    const billingLookup = await lookupHostedMemberStripeBillingRefByStripeCustomerId({
      prisma: input.prisma,
      stripeCustomerId: input.customerId,
    });
    if (billingLookup) {
      memberIds.push(billingLookup.core.id);
    }
  }

  return listHostedStripeUniqueMemberIds(memberIds);
}

async function filterExistingHostedMemberIds(input: {
  memberIds: string[];
  prisma: HostedOnboardingReadClient;
}): Promise<string[]> {
  if (input.memberIds.length === 0) {
    return [];
  }

  const members = await input.prisma.hostedMember.findMany({
    select: {
      id: true,
    },
    where: {
      id: {
        in: input.memberIds,
      },
    },
  });

  return listHostedStripeUniqueMemberIds(members.map((member) => member.id));
}

export async function listHostedStripeCheckoutSessionDirectMemberIds(input: {
  prisma: HostedOnboardingReadClient;
  session: Stripe.Checkout.Session;
}): Promise<string[]> {
  return filterExistingHostedMemberIds({
    memberIds: listHostedStripeDirectMemberIds({
      clientReferenceId: normalizeNullableString(input.session.client_reference_id),
      memberId: normalizeNullableString(input.session.metadata?.memberId),
    }),
    prisma: input.prisma,
  });
}

export async function findMemberForStripeCheckoutSession(input: {
  prisma: HostedOnboardingReadClient;
  session: Stripe.Checkout.Session;
}): Promise<HostedMemberBillingSnapshot | null> {
  return findMemberForStripeObject({
    clientReferenceId: normalizeNullableString(input.session.client_reference_id),
    customerId: coerceStripeObjectId(input.session.customer),
    memberId: normalizeNullableString(input.session.metadata?.memberId),
    prisma: input.prisma,
    subscriptionId: coerceStripeSubscriptionId(input.session.subscription),
  });
}

export async function findMemberForStripeSubscription(input: {
  prisma: HostedOnboardingReadClient;
  subscription: Stripe.Subscription;
}): Promise<HostedMemberBillingSnapshot | null> {
  return findMemberForStripeObject({
    clientReferenceId: null,
    customerId: coerceStripeObjectId(input.subscription.customer),
    memberId: normalizeNullableString(input.subscription.metadata?.memberId),
    prisma: input.prisma,
    requireMatchingSubscription: true,
    subscriptionId: input.subscription.id,
  });
}

/**
 * A standard Checkout subscription is not authoritative until its exact
 * completed Session wins the member's durable attempt compare-and-set.
 * Generic subscription and invoice events may identify the member so they can
 * take the correct lock, but must not use that metadata to establish billing
 * ownership ahead of Checkout completion.
 */
export function isHostedStripeStandardCheckoutAwaitingSessionAcceptance(input: {
  member: HostedMemberBillingSnapshot;
  subscription: Stripe.Subscription;
}): boolean {
  const metadata = input.subscription.metadata;
  if (
    normalizeNullableString(metadata.checkoutOffer) !==
      HOSTED_STANDARD_CHECKOUT_OFFER
  ) {
    return false;
  }

  return input.member.billingRef?.stripeSubscriptionId !==
    input.subscription.id;
}

export async function findMemberForStripeInvoice(input: {
  invoice: Stripe.Invoice;
  prisma: HostedOnboardingReadClient;
  subscription?: Stripe.Subscription | null;
}): Promise<HostedMemberBillingSnapshot | null> {
  const directMember = await findMemberForStripeObject({
    clientReferenceId: null,
    customerId: coerceStripeObjectId(input.invoice.customer),
    memberId: null,
    prisma: input.prisma,
    requireMatchingSubscription: true,
    subscriptionId: coerceStripeInvoiceSubscriptionId(input.invoice),
  });

  if (directMember) {
    return directMember;
  }

  const liveSubscription = input.subscription ?? await readStripeInvoiceCanonicalSubscription(input.invoice);
  return liveSubscription
    ? findMemberForStripeSubscription({
        prisma: input.prisma,
        subscription: liveSubscription,
      })
    : null;
}

export async function resolveStripeFinancialContext(input: {
  chargeId: string | null;
  paymentIntentId: string | null;
}): Promise<{
  customerId: string | null;
  invoiceId: string;
  paymentIntentId: string | null;
  subscriptionId: string | null;
}> {
  const stripe = requireHostedStripeApi();
  const charge = input.chargeId
    ? await withHostedStripeFailureLog(
        "charges.retrieve.financial-context",
        () => stripe.charges.retrieve(input.chargeId!),
      )
    : null;
  if (charge && input.chargeId && charge.id !== input.chargeId) {
    throw new Error("Stripe returned the wrong Charge for a financial event.");
  }
  const chargePaymentIntentId = coerceStripeObjectId(charge?.payment_intent);
  if (
    charge &&
    input.paymentIntentId &&
    chargePaymentIntentId !== input.paymentIntentId
  ) {
    throw new Error("Stripe financial event Charge and PaymentIntent did not match.");
  }

  const paymentIntentId = input.paymentIntentId ?? chargePaymentIntentId;
  const paymentRelation: HostedStripeInvoicePaymentRelation | null =
    paymentIntentId
      ? { id: paymentIntentId, kind: "payment_intent" }
      : charge
      ? { id: charge.id, kind: "charge" }
      : null;
  if (!paymentRelation) {
    throw new Error(
      "Stripe recurring financial event did not expose an exact payment for invoice resolution.",
    );
  }
  const [paymentIntent, listedInvoicePayments] = await Promise.all([
    paymentIntentId
      ? withHostedStripeFailureLog(
          "paymentIntents.retrieve.financial-context",
          () => stripe.paymentIntents.retrieve(paymentIntentId),
        )
      : Promise.resolve(null),
    withHostedStripeFailureLog(
      "invoicePayments.list.financial-context",
      () =>
        paymentRelation.kind === "payment_intent"
          ? stripe.invoicePayments.list({
              expand: ["data.invoice"],
              limit: 100,
              payment: {
                payment_intent: paymentRelation.id,
                type: "payment_intent",
              },
              status: "paid",
            })
          : listHostedStripeLegacyChargeInvoicePayments({
              charge,
              stripe,
            }),
    ),
  ]);
  if (
    listedInvoicePayments.has_more ||
    listedInvoicePayments.data.length === 0
  ) {
    throw new Error(
      "Stripe recurring financial payment did not resolve to a bounded paid invoice set.",
    );
  }

  const invoices = await Promise.all(
    listedInvoicePayments.data.map(async (invoicePayment) => {
      if (
        invoicePayment.status !== "paid" ||
        !doesHostedStripeInvoicePaymentMatchRelation(
          invoicePayment,
          paymentRelation,
        )
      ) {
        throw new Error(
          "Stripe returned an invalid recurring InvoicePayment relationship.",
        );
      }
      return readStripeInvoicePaymentInvoice(invoicePayment.invoice);
    }),
  );
  const subscriptionIds = new Set(
    invoices.map(coerceStripeInvoiceSubscriptionId),
  );
  if (subscriptionIds.size !== 1 || subscriptionIds.has(null)) {
    throw new Error(
      "Stripe recurring financial payment spanned multiple recurring owners.",
    );
  }
  const paymentIntentCustomerId = coerceStripeObjectId(paymentIntent?.customer);
  const chargeCustomerId = coerceStripeObjectId(charge?.customer);
  const invoiceCustomerIds = new Set(
    invoices.map((invoice) => coerceStripeObjectId(invoice.customer)),
  );
  if (invoiceCustomerIds.size !== 1 || invoiceCustomerIds.has(null)) {
    throw new Error(
      "Stripe recurring financial invoices did not resolve to one customer.",
    );
  }
  const invoiceCustomerId = [...invoiceCustomerIds][0] ?? null;
  if (
    (chargeCustomerId &&
      paymentIntentCustomerId &&
      chargeCustomerId !== paymentIntentCustomerId) ||
    (invoiceCustomerId &&
      chargeCustomerId &&
      invoiceCustomerId !== chargeCustomerId) ||
    (invoiceCustomerId &&
      paymentIntentCustomerId &&
      invoiceCustomerId !== paymentIntentCustomerId)
  ) {
    throw new Error("Stripe recurring financial customer relationship did not match.");
  }

  return {
    customerId: paymentIntentCustomerId ?? chargeCustomerId ?? invoiceCustomerId,
    invoiceId: invoices[0]!.id,
    paymentIntentId,
    subscriptionId: [...subscriptionIds][0] ?? null,
  };
}

type HostedStripeInvoicePaymentRelation =
  | { id: string; kind: "charge" }
  | { id: string; kind: "payment_intent" };

const HOSTED_STRIPE_LEGACY_CHARGE_INVOICE_SCAN_LIMIT = 500;

async function listHostedStripeLegacyChargeInvoicePayments(input: {
  charge: Stripe.Charge | null;
  stripe: Stripe;
}) {
  const charge = input.charge;
  const customerId = coerceStripeObjectId(charge?.customer);
  if (!charge || !customerId) {
    throw new Error(
      "Legacy recurring Charge did not expose an exact customer for invoice resolution.",
    );
  }

  const matchingPayments: Stripe.InvoicePayment[] = [];
  let scannedInvoiceCount = 0;
  let startingAfter: string | undefined;
  for (;;) {
    const invoices = await input.stripe.invoices.list({
      customer: customerId,
      expand: ["data.payments"],
      ...(startingAfter ? { starting_after: startingAfter } : {}),
      limit: 100,
      status: "paid",
    });
    scannedInvoiceCount += invoices.data.length;
    if (scannedInvoiceCount > HOSTED_STRIPE_LEGACY_CHARGE_INVOICE_SCAN_LIMIT) {
      throw new Error(
        "Legacy recurring Charge exceeded the bounded customer invoice scan.",
      );
    }
    for (const invoice of invoices.data) {
      if (coerceStripeObjectId(invoice.customer) !== customerId) {
        throw new Error(
          "Stripe returned an invoice for the wrong legacy Charge customer.",
        );
      }
      let invoicePayments: Stripe.InvoicePayment[];
      if (invoice.payments && !invoice.payments.has_more) {
        invoicePayments = invoice.payments.data;
      } else {
        const listedPayments = await input.stripe.invoicePayments.list({
          expand: ["data.invoice", "data.payment.charge"],
          invoice: invoice.id,
          limit: 100,
          status: "paid",
        });
        if (listedPayments.has_more) {
          throw new Error(
            "Legacy recurring invoice exceeded the bounded payment scan.",
          );
        }
        invoicePayments = listedPayments.data;
      }
      for (const invoicePayment of invoicePayments) {
        if (coerceStripeObjectId(invoicePayment.invoice) !== invoice.id) {
          throw new Error(
            "Stripe returned an InvoicePayment for the wrong legacy invoice.",
          );
        }
        if (
          invoicePayment.status === "paid" &&
          invoicePayment.payment.type === "charge" &&
          coerceStripeObjectId(invoicePayment.payment.charge) === charge.id
        ) {
          matchingPayments.push({
            ...invoicePayment,
            invoice,
          });
        }
      }
    }
    const lastInvoiceId = invoices.data.at(-1)?.id;
    if (!invoices.has_more || !lastInvoiceId) {
      return {
        data: matchingPayments,
        has_more: false,
      };
    }
    if (
      scannedInvoiceCount >= HOSTED_STRIPE_LEGACY_CHARGE_INVOICE_SCAN_LIMIT
    ) {
      throw new Error(
        "Legacy recurring Charge exceeded the bounded customer invoice scan.",
      );
    }
    startingAfter = lastInvoiceId;
  }
}

function doesHostedStripeInvoicePaymentMatchRelation(
  invoicePayment: Stripe.InvoicePayment,
  relation: HostedStripeInvoicePaymentRelation,
): boolean {
  return relation.kind === "payment_intent"
    ? invoicePayment.payment.type === "payment_intent" &&
      coerceStripeObjectId(invoicePayment.payment.payment_intent) === relation.id
    : invoicePayment.payment.type === "charge" &&
      coerceStripeObjectId(invoicePayment.payment.charge) === relation.id;
}

async function readStripeInvoicePaymentInvoice(
  value: Stripe.InvoicePayment["invoice"],
): Promise<Stripe.Invoice> {
  if (typeof value === "string") {
    return withHostedStripeFailureLog(
      "invoices.retrieve.financial-context",
      () => requireHostedStripeApi().invoices.retrieve(value),
    );
  }
  if ("deleted" in value && value.deleted) {
    throw new Error("Stripe recurring financial Invoice was deleted.");
  }
  return value;
}

export type HostedStripeRecurringFinancialState = {
  collectionState: HostedStripeInvoiceCollectionState;
  fullyRefunded: boolean;
  invoiceId: string | null;
  outstandingDispute: boolean;
};

const HOSTED_STRIPE_RECURRING_FINANCIAL_MAX_CURRENT_INVOICES = 100;
const HOSTED_STRIPE_RECURRING_FINANCIAL_MAX_BALANCE_TRANSACTIONS = 100;
const HOSTED_STRIPE_RECURRING_FINANCIAL_MAX_PAYMENT_ALLOCATIONS = 100;
const HOSTED_STRIPE_RECURRING_FINANCIAL_INVOICE_LOOKBACK_SECONDS =
  7 * 24 * 60 * 60;
const HOSTED_STRIPE_RECURRING_FINANCIAL_READ_CONCURRENCY = 4;
// Each collection snapshot starts one Invoice and one InvoicePayment read.
const HOSTED_STRIPE_RECURRING_FINANCIAL_SNAPSHOT_CONCURRENCY = 2;
export const HOSTED_STRIPE_RECURRING_FINANCIAL_REQUEST_OPTIONS = {
  maxNetworkRetries: 0,
  timeout: 5_000,
} as const satisfies Stripe.RequestOptions;

type HostedStripeRecurringFinancialHealth =
  | {
      kind: "healthy";
    }
  | {
      collectionState: HostedStripeInvoiceCollectionState;
      kind: "blocked";
      reason:
        | "collection_missing"
        | "collection_unsettled"
        | "fully_refunded"
        | "outstanding_dispute";
    };

/**
 * Pure provider-fact gate for chargeable recurring mutations. A subscription
 * is financially healthy only when its current-period collection is paid and
 * its funding has neither been fully refunded nor remains disputed.
 */
export function classifyHostedStripeRecurringFinancialHealth(
  state: HostedStripeRecurringFinancialState,
): HostedStripeRecurringFinancialHealth {
  if (state.outstandingDispute) {
    return {
      collectionState: state.collectionState,
      kind: "blocked",
      reason: "outstanding_dispute",
    };
  }
  if (state.fullyRefunded) {
    return {
      collectionState: state.collectionState,
      kind: "blocked",
      reason: "fully_refunded",
    };
  }
  if (state.collectionState.kind === "none") {
    return {
      collectionState: state.collectionState,
      kind: "blocked",
      reason: "collection_missing",
    };
  }
  if (state.collectionState.kind !== "paid") {
    return {
      collectionState: state.collectionState,
      kind: "blocked",
      reason: "collection_unsettled",
    };
  }
  return { kind: "healthy" };
}

export async function readHostedStripeRecurringFinancialState(
  subscription: Stripe.Subscription,
): Promise<HostedStripeRecurringFinancialState> {
  const stripe = requireHostedStripeApi();
  const latestInvoiceId = coerceStripeObjectId(subscription.latest_invoice);
  if (!latestInvoiceId) {
    return {
      collectionState: { kind: "none" },
      fullyRefunded: false,
      invoiceId: null,
      outstandingDispute: false,
    };
  }

  const {
    collectionSnapshot,
    paidEntitlementSnapshots,
  } = await readHostedStripeCurrentPeriodFinancialSnapshots({
    latestInvoiceId,
    stripe,
    subscription,
  });
  const financialState = await readHostedStripePaidInvoicesFinancialState({
    snapshots: paidEntitlementSnapshots,
    stripe,
    subscription,
  });

  return {
    collectionState: classifyHostedStripeInvoiceCollectionState(
      collectionSnapshot?.invoice ?? null,
      collectionSnapshot?.invoicePayments ?? [],
    ),
    fullyRefunded: financialState.fullyRefunded,
    invoiceId: collectionSnapshot?.invoice.id ?? null,
    outstandingDispute: financialState.outstandingDispute,
  };
}

async function readHostedStripeCurrentPeriodFinancialSnapshots(input: {
  latestInvoiceId: string;
  stripe: Stripe;
  subscription: Stripe.Subscription;
}): Promise<{
  collectionSnapshot: Awaited<
    ReturnType<typeof retrieveHostedStripeInvoiceCollectionSnapshot>
  > | null;
  paidEntitlementSnapshots: Awaited<
    ReturnType<typeof retrieveHostedStripeInvoiceCollectionSnapshot>
  >[];
}> {
  const latest = await withHostedStripeFailureLog(
    "invoice.retrieve.recurring-financial-state",
    () => retrieveHostedStripeInvoiceCollectionSnapshot({
      invoiceId: input.latestInvoiceId,
      requestOptions: HOSTED_STRIPE_RECURRING_FINANCIAL_REQUEST_OPTIONS,
      stripe: input.stripe,
    }),
  );
  assertHostedStripeInvoiceMatchesSubscription({
    invoice: latest.invoice,
    subscriptionId: input.subscription.id,
  });
  const currentPeriod = readHostedStripeCurrentFinancialPeriod({
    subscription: input.subscription,
  });
  const currentInvoiceCandidates = new Map(
    (
      await listHostedStripeCurrentPeriodInvoices({
        currentPeriod,
        stripe: input.stripe,
        subscriptionId: input.subscription.id,
      })
    ).map((invoice) => [invoice.id, invoice]),
  );
  if (
    await classifyStripeInvoiceSubscriptionPeriod({
      currentPeriod,
      invoice: latest.invoice,
      stripe: input.stripe,
      subscriptionId: input.subscription.id,
    }) === "current"
  ) {
    currentInvoiceCandidates.set(latest.invoice.id, latest.invoice);
  }
  if (
    currentInvoiceCandidates.size >
      HOSTED_STRIPE_RECURRING_FINANCIAL_MAX_CURRENT_INVOICES
  ) {
    throw new Error(
      "Stripe exceeded the bounded current-period invoice reconciliation shape.",
    );
  }
  const paidEntitlementInvoices = [...currentInvoiceCandidates.values()]
    .filter((invoice) => invoice.status === "paid");
  const unresolvedEntitlementInvoices = [...currentInvoiceCandidates.values()]
    .filter((invoice) => invoice.status !== "paid")
    .sort((left, right) =>
      (readStripeUnixSeconds(right.created) ?? 0) -
        (readStripeUnixSeconds(left.created) ?? 0)
    );
  const paidEntitlementSnapshots =
    await mapHostedStripeRecurringFinancialReads(
      paidEntitlementInvoices
        .sort((left, right) =>
          (readStripeUnixSeconds(right.created) ?? 0) -
            (readStripeUnixSeconds(left.created) ?? 0)
        ),
      HOSTED_STRIPE_RECURRING_FINANCIAL_SNAPSHOT_CONCURRENCY,
      (invoice) =>
        invoice.id === latest.invoice.id
          ? Promise.resolve(latest)
          : withHostedStripeFailureLog(
              "invoice.retrieve.current-entitlement",
              () => retrieveHostedStripeInvoiceCollectionSnapshot({
                invoiceId: invoice.id,
                requestOptions:
                  HOSTED_STRIPE_RECURRING_FINANCIAL_REQUEST_OPTIONS,
                stripe: input.stripe,
              }),
            )
    );
  for (const snapshot of paidEntitlementSnapshots) {
    assertHostedStripeInvoiceMatchesSubscription({
      invoice: snapshot.invoice,
      subscriptionId: input.subscription.id,
    });
    if (
      snapshot.invoice.status !== "paid"
    ) {
      throw new Error(
        "Canonical current-period entitlement invoice was no longer paid.",
      );
    }
  }

  const unresolvedEntitlementSnapshots =
    await mapHostedStripeRecurringFinancialReads(
      unresolvedEntitlementInvoices,
      HOSTED_STRIPE_RECURRING_FINANCIAL_SNAPSHOT_CONCURRENCY,
      (invoice) =>
        invoice.id === latest.invoice.id
          ? Promise.resolve(latest)
          : withHostedStripeFailureLog(
              "invoice.retrieve.current-entitlement-unresolved",
              () => retrieveHostedStripeInvoiceCollectionSnapshot({
                invoiceId: invoice.id,
                requestOptions:
                  HOSTED_STRIPE_RECURRING_FINANCIAL_REQUEST_OPTIONS,
                stripe: input.stripe,
              }),
            )
    );
  const relevantUnresolvedSnapshots = unresolvedEntitlementSnapshots
    .filter((snapshot) => {
      assertHostedStripeInvoiceMatchesSubscription({
        invoice: snapshot.invoice,
        subscriptionId: input.subscription.id,
      });
      if (snapshot.invoice.status === "paid") {
        throw new Error(
          "Canonical current-period collection invoice was no longer unresolved.",
        );
      }
      return !isHostedStripeUnappliedPendingUpdateInvoice({
        invoice: snapshot.invoice,
        subscription: input.subscription,
      });
    })
    .sort(compareHostedStripeUnresolvedCollectionPriority);
  const controllingUnresolvedSnapshot =
    relevantUnresolvedSnapshots[0] ?? null;
  const latestIsUnappliedTransition =
    isHostedStripeUnappliedPendingUpdateInvoice({
      invoice: latest.invoice,
      subscription: input.subscription,
    });
  return {
    collectionSnapshot:
      controllingUnresolvedSnapshot ??
      (latestIsUnappliedTransition
        ? paidEntitlementSnapshots[0] ?? null
        : latest),
    paidEntitlementSnapshots,
  };
}

function compareHostedStripeUnresolvedCollectionPriority(
  left: Awaited<
    ReturnType<typeof retrieveHostedStripeInvoiceCollectionSnapshot>
  >,
  right: Awaited<
    ReturnType<typeof retrieveHostedStripeInvoiceCollectionSnapshot>
  >,
): number {
  const leftProcessing =
    classifyHostedStripeInvoiceCollectionState(
      left.invoice,
      left.invoicePayments,
    ).kind === "processing";
  const rightProcessing =
    classifyHostedStripeInvoiceCollectionState(
      right.invoice,
      right.invoicePayments,
    ).kind === "processing";
  if (leftProcessing !== rightProcessing) {
    return leftProcessing ? 1 : -1;
  }
  return (readStripeUnixSeconds(right.invoice.created) ?? 0) -
    (readStripeUnixSeconds(left.invoice.created) ?? 0);
}

async function readHostedStripePaidInvoicesFinancialState(
  input: {
    snapshots: readonly Awaited<
      ReturnType<typeof retrieveHostedStripeInvoiceCollectionSnapshot>
    >[];
    stripe: Stripe;
    subscription: Stripe.Subscription;
  },
): Promise<{
  fullyRefunded: boolean;
  outstandingDispute: boolean;
}> {
  const allocations = listStripeInvoicePaymentAllocations(input.snapshots);
  if (
    allocations.length >
      HOSTED_STRIPE_RECURRING_FINANCIAL_MAX_PAYMENT_ALLOCATIONS
  ) {
    throw new Error(
      "Stripe exceeded the bounded current-period payment reconciliation shape.",
    );
  }
  const paymentReferences = listStripeInvoicePaymentReferences(allocations);
  const refunds = await listStripeSuccessfulRefunds({
    payments: paymentReferences,
    stripe: input.stripe,
  });
  const disputes = await listStripeDisputes({
    payments: paymentReferences,
    stripe: input.stripe,
  });
  const baseInvoiceId = [...input.snapshots]
    .sort(compareHostedStripeBaseEntitlementInvoice)[0]?.invoice.id ?? null;
  const entitlementFunding =
    await readHostedStripeEntitlementInvoiceFunding({
      snapshots: input.snapshots,
      stripe: input.stripe,
      subscription: input.subscription,
    });
  const requiredInvoiceIds = entitlementFunding.requiredInvoiceIds;
  if (baseInvoiceId) {
    requiredInvoiceIds.add(baseInvoiceId);
  }
  const fullyRefundedInvoiceIds = new Set(
    input.snapshots
      .map((snapshot) => snapshot.invoice.id)
      .filter((invoiceId) =>
        isHostedStripeInvoiceFullyRefunded({
          allocations,
          invoiceId,
          refunds,
        })
      ),
  );
  const directlyRefunded = [...requiredInvoiceIds].some((invoiceId) =>
    fullyRefundedInvoiceIds.has(invoiceId)
  );
  const balanceFundedByRefundedInvoice = directlyRefunded
    ? false
    : await hasHostedStripeRequiredRefundedBalanceFunding({
        creditSourceInvoiceIdsByInvoiceId:
          entitlementFunding.creditSourceInvoiceIdsByInvoiceId,
        currentPeriodStart:
          readHostedStripeCurrentFinancialPeriod({
            subscription: input.subscription,
          }).start,
        fullyRefundedInvoiceIds,
        requiredInvoiceIds,
        stripe: input.stripe,
        subscription: input.subscription,
      });
  return {
    fullyRefunded: directlyRefunded || balanceFundedByRefundedInvoice,
    outstandingDispute: disputes.some(hasStripeDisputeFundsOutstanding),
  };
}

async function readHostedStripeEntitlementInvoiceFunding(input: {
  snapshots: readonly Awaited<
    ReturnType<typeof retrieveHostedStripeInvoiceCollectionSnapshot>
  >[];
  stripe: Stripe;
  subscription: Stripe.Subscription;
}): Promise<{
  creditSourceInvoiceIdsByInvoiceId: Map<string, ReadonlySet<string>>;
  requiredInvoiceIds: Set<string>;
}> {
  // Stripe may consolidate same-price items without proration, so item IDs
  // cannot own economic provenance. Build full paid-history quantities per
  // price, then replay those aggregate transitions backward from the current
  // licensed subscription. Active units are still represented; units missing
  // after a later non-invoiced unwind are inactive.
  let currentFundingStates =
    new Map<string, boolean[]>();
  const currentItemIds = new Set<string>();
  for (const item of input.subscription.items.data) {
    if (currentItemIds.has(item.id)) {
      throw new Error(
        "Stripe subscription contained duplicate current entitlement items.",
      );
    }
    currentItemIds.add(item.id);
    if (item.price.recurring?.usage_type === "metered") {
      continue;
    }
    const priceId = coerceStripeObjectId(item.price);
    const quantity = readStripePositiveInteger(item.quantity);
    if (
      !priceId ||
      !quantity ||
      quantity > HOSTED_FAMILY_MAX_SEATS
    ) {
      throw new Error(
        "Stripe subscription contained an invalid current entitlement item.",
      );
    }
    const currentPriceFunding = currentFundingStates.get(priceId) ?? [];
    currentPriceFunding.push(
      ...Array.from({ length: quantity }, () => true),
    );
    currentFundingStates.set(priceId, currentPriceFunding);
  }
  assertHostedStripeEntitlementQuantityBound(
    new Map(
      [...currentFundingStates].map(([priceId, units]) => [
        priceId,
        units.length,
      ]),
    ),
  );

  const updateSnapshots = [...input.snapshots]
    .filter((snapshot) =>
      snapshot.invoice.billing_reason === "subscription_update"
    );
  const updateLines = await mapHostedStripeRecurringFinancialReads(
    updateSnapshots,
    HOSTED_STRIPE_RECURRING_FINANCIAL_SNAPSHOT_CONCURRENCY,
    async (snapshot): Promise<HostedStripeEntitlementInvoiceDelta> => {
      const created = readStripeUnixSeconds(snapshot.invoice.created);
      if (created === null) {
        throw new Error(
          "Stripe update invoice contained an invalid creation time.",
        );
      }
      const lines = await readStripeInvoiceLines({
        invoice: snapshot.invoice,
        stripe: input.stripe,
      });
      return {
        creditSourceInvoiceIds:
          readHostedStripeEntitlementCreditSourceInvoiceIds({
            lines,
            subscriptionId: input.subscription.id,
          }),
        created,
        invoiceId: snapshot.invoice.id,
        quantityDeltaByPrice:
          readHostedStripeEntitlementInvoiceQuantityDelta({
            lines,
            subscriptionId: input.subscription.id,
          }),
      };
    },
  );
  const creditSourceInvoiceIdsByInvoiceId = new Map(
    updateLines
      .filter((update) => update.creditSourceInvoiceIds.size > 0)
      .map((update) => [
        update.invoiceId,
        update.creditSourceInvoiceIds,
      ]),
  );
  if (updateLines.length === 0) {
    return {
      creditSourceInvoiceIdsByInvoiceId,
      requiredInvoiceIds: new Set(),
    };
  }

  const baseSnapshot = [...input.snapshots]
    .filter((snapshot) =>
      snapshot.invoice.billing_reason === "subscription_create" ||
      snapshot.invoice.billing_reason === "subscription_cycle"
    )
    .sort(compareHostedStripeBaseEntitlementInvoice)[0];
  if (!baseSnapshot) {
    // Without the paid period-start quantities, Stripe has not supplied enough
    // causal evidence to discard any paid update from the required set.
    return {
      creditSourceInvoiceIdsByInvoiceId,
      requiredInvoiceIds:
        new Set(updateLines.map((update) => update.invoiceId)),
    };
  }

  const entitlementPriceIds = new Set(currentFundingStates.keys());
  for (const update of updateLines) {
    for (const priceId of update.quantityDeltaByPrice.keys()) {
      entitlementPriceIds.add(priceId);
    }
  }
  const baseQuantities = readHostedStripeBaseEntitlementQuantities({
    entitlementPriceIds,
    lines: await readStripeInvoiceLines({
      invoice: baseSnapshot.invoice,
      stripe: input.stripe,
    }),
    subscriptionId: input.subscription.id,
  });
  const transitionGroups =
    buildHostedStripeEntitlementTransitionGroups({
      baseQuantities,
      updates: updateLines,
    });

  const requiredInvoiceIds = new Set<string>();
  for (const transition of [...transitionGroups].reverse()) {
    const replay = replayHostedStripeEntitlementTransitionBackward({
      currentFundingStates,
      transition,
    });
    currentFundingStates = replay.beforeFundingStates;
    if (replay.required) {
      // Stripe timestamps have second precision. Multiple paid updates in one
      // second lack a provider-backed causal order, so while any contribution
      // remains, keep every invoice in the group rather than ordering by an
      // opaque invoice ID.
      for (const invoiceId of transition.invoiceIds) {
        requiredInvoiceIds.add(invoiceId);
      }
    }
  }
  return {
    creditSourceInvoiceIdsByInvoiceId,
    requiredInvoiceIds,
  };
}

type HostedStripeEntitlementQuantityMap = Map<string, number>;

interface HostedStripeEntitlementInvoiceDelta {
  creditSourceInvoiceIds: ReadonlySet<string>;
  created: number;
  invoiceId: string;
  quantityDeltaByPrice: HostedStripeEntitlementQuantityMap;
}

interface HostedStripeEntitlementTransitionGroup {
  afterQuantities: HostedStripeEntitlementQuantityMap;
  beforeQuantities: HostedStripeEntitlementQuantityMap;
  invoiceIds: string[];
}

interface HostedStripeEntitlementTransitionState {
  priceId: string;
  quantity: number;
}

interface HostedStripeEntitlementItemTransition {
  after: HostedStripeEntitlementTransitionState | null;
  before: HostedStripeEntitlementTransitionState | null;
}

function readHostedStripeEntitlementCreditSourceInvoiceIds(input: {
  lines: readonly Stripe.InvoiceLineItem[];
  subscriptionId: string;
}): Set<string> {
  const invoiceIds = new Set<string>();
  for (const line of input.lines) {
    const details = line.parent?.subscription_item_details;
    if (
      line.amount >= 0 ||
      !details?.proration ||
      coerceStripeObjectId(details.subscription) !== input.subscriptionId
    ) {
      continue;
    }
    const creditedItems = details.proration_details?.credited_items;
    if (!creditedItems) {
      continue;
    }
    const invoiceId = normalizeNullableString(creditedItems.invoice);
    if (
      !invoiceId ||
      creditedItems.invoice_line_items.length === 0 ||
      creditedItems.invoice_line_items.some((lineId) =>
        !normalizeNullableString(lineId)
      )
    ) {
      throw new Error(
        "Stripe credit proration contained an invalid credited invoice.",
      );
    }
    invoiceIds.add(invoiceId);
  }
  return invoiceIds;
}

function readHostedStripeEntitlementInvoiceQuantityDelta(input: {
  lines: readonly Stripe.InvoiceLineItem[];
  subscriptionId: string;
}): HostedStripeEntitlementQuantityMap {
  const itemTransitions =
    new Map<string, HostedStripeEntitlementItemTransition>();
  for (const line of input.lines) {
    const details = line.parent?.subscription_item_details;
    if (
      !details?.proration ||
      coerceStripeObjectId(details.subscription) !== input.subscriptionId
    ) {
      continue;
    }
    const itemId = normalizeNullableString(details.subscription_item);
    const priceId = coerceStripeObjectId(
      line.pricing?.price_details?.price,
    );
    if (
      !itemId ||
      !priceId ||
      !Number.isSafeInteger(line.amount)
    ) {
      throw new Error(
        "Stripe update invoice contained an invalid entitlement transition line.",
      );
    }
    if (line.amount === 0) {
      continue;
    }
    const quantity = readStripePositiveInteger(line.quantity);
    if (!quantity || quantity > HOSTED_FAMILY_MAX_SEATS) {
      throw new Error(
        "Stripe update invoice contained an invalid entitlement transition quantity.",
      );
    }
    const transition = itemTransitions.get(itemId) ?? {
      after: null,
      before: null,
    };
    const position = line.amount < 0 ? "before" : "after";
    const candidate = { priceId, quantity };
    const existing = transition[position];
    if (
      existing &&
      (
        existing.priceId !== candidate.priceId ||
        existing.quantity !== candidate.quantity
      )
    ) {
      throw new Error(
        "Stripe update invoice contained an ambiguous entitlement transition.",
      );
    }
    transition[position] = candidate;
    itemTransitions.set(itemId, transition);
  }

  const quantityDeltaByPrice: HostedStripeEntitlementQuantityMap =
    new Map();
  for (const transition of itemTransitions.values()) {
    if (transition.before) {
      addHostedStripeEntitlementQuantityDelta({
        delta: -transition.before.quantity,
        priceId: transition.before.priceId,
        quantityDeltaByPrice,
      });
    }
    if (transition.after) {
      addHostedStripeEntitlementQuantityDelta({
        delta: transition.after.quantity,
        priceId: transition.after.priceId,
        quantityDeltaByPrice,
      });
    }
  }
  return quantityDeltaByPrice;
}

function readHostedStripeBaseEntitlementQuantities(input: {
  entitlementPriceIds: ReadonlySet<string>;
  lines: readonly Stripe.InvoiceLineItem[];
  subscriptionId: string;
}): HostedStripeEntitlementQuantityMap {
  const itemQuantities =
    new Map<string, HostedStripeEntitlementTransitionState>();
  for (const line of input.lines) {
    const details = line.parent?.subscription_item_details;
    if (
      !details ||
      details.proration ||
      coerceStripeObjectId(details.subscription) !== input.subscriptionId
    ) {
      continue;
    }
    const itemId = normalizeNullableString(details.subscription_item);
    const priceId = coerceStripeObjectId(
      line.pricing?.price_details?.price,
    );
    if (!itemId || !priceId) {
      throw new Error(
        "Stripe base invoice contained an invalid entitlement line.",
      );
    }
    if (!input.entitlementPriceIds.has(priceId)) {
      continue;
    }
    const quantity = readStripePositiveInteger(line.quantity);
    if (!quantity || quantity > HOSTED_FAMILY_MAX_SEATS) {
      throw new Error(
        "Stripe base invoice contained an invalid entitlement quantity.",
      );
    }
    const candidate = { priceId, quantity };
    const existing = itemQuantities.get(itemId);
    if (
      existing &&
      (
        existing.priceId !== candidate.priceId ||
        existing.quantity !== candidate.quantity
      )
    ) {
      throw new Error(
        "Stripe base invoice contained an ambiguous entitlement item.",
      );
    }
    itemQuantities.set(itemId, candidate);
  }

  const quantities: HostedStripeEntitlementQuantityMap = new Map();
  for (const item of itemQuantities.values()) {
    quantities.set(
      item.priceId,
      (quantities.get(item.priceId) ?? 0) + item.quantity,
    );
  }
  assertHostedStripeEntitlementQuantityBound(quantities);
  return quantities;
}

function addHostedStripeEntitlementQuantityDelta(input: {
  delta: number;
  priceId: string;
  quantityDeltaByPrice: HostedStripeEntitlementQuantityMap;
}): void {
  const next =
    (input.quantityDeltaByPrice.get(input.priceId) ?? 0) + input.delta;
  if (!Number.isSafeInteger(next)) {
    throw new Error(
      "Stripe entitlement quantity delta exceeded the bounded integer shape.",
    );
  }
  if (next === 0) {
    input.quantityDeltaByPrice.delete(input.priceId);
  } else {
    input.quantityDeltaByPrice.set(input.priceId, next);
  }
}

function buildHostedStripeEntitlementTransitionGroups(input: {
  baseQuantities: HostedStripeEntitlementQuantityMap;
  updates: readonly HostedStripeEntitlementInvoiceDelta[];
}): HostedStripeEntitlementTransitionGroup[] {
  const updates = [...input.updates].sort(
    (left, right) => left.created - right.created,
  );
  const groups: HostedStripeEntitlementTransitionGroup[] = [];
  let currentQuantities = new Map(input.baseQuantities);

  for (let index = 0; index < updates.length;) {
    const created = updates[index]!.created;
    const sameCreatedUpdates: HostedStripeEntitlementInvoiceDelta[] = [];
    while (
      index < updates.length &&
      updates[index]!.created === created
    ) {
      sameCreatedUpdates.push(updates[index]!);
      index += 1;
    }
    const groupedDelta: HostedStripeEntitlementQuantityMap = new Map();
    for (const update of sameCreatedUpdates) {
      for (const [priceId, delta] of update.quantityDeltaByPrice) {
        addHostedStripeEntitlementQuantityDelta({
          delta,
          priceId,
          quantityDeltaByPrice: groupedDelta,
        });
      }
    }
    const beforeQuantities = new Map(currentQuantities);
    const afterQuantities = applyHostedStripeEntitlementQuantityDelta({
      currentQuantities,
      quantityDeltaByPrice: groupedDelta,
    });
    groups.push({
      afterQuantities,
      beforeQuantities,
      invoiceIds: sameCreatedUpdates.map((update) => update.invoiceId),
    });
    currentQuantities = afterQuantities;
  }
  return groups;
}

function applyHostedStripeEntitlementQuantityDelta(input: {
  currentQuantities: HostedStripeEntitlementQuantityMap;
  quantityDeltaByPrice: HostedStripeEntitlementQuantityMap;
}): HostedStripeEntitlementQuantityMap {
  const nextQuantities = new Map(input.currentQuantities);
  for (const [priceId, delta] of input.quantityDeltaByPrice) {
    const next = (nextQuantities.get(priceId) ?? 0) + delta;
    if (
      !Number.isSafeInteger(next) ||
      next < 0 ||
      next > HOSTED_FAMILY_MAX_SEATS
    ) {
      throw new Error(
        "Stripe paid entitlement history contained an invalid aggregate quantity.",
      );
    }
    if (next === 0) {
      nextQuantities.delete(priceId);
    } else {
      nextQuantities.set(priceId, next);
    }
  }
  assertHostedStripeEntitlementQuantityBound(nextQuantities);
  return nextQuantities;
}

function assertHostedStripeEntitlementQuantityBound(
  quantities: ReadonlyMap<string, number>,
): void {
  let total = 0;
  for (const quantity of quantities.values()) {
    if (
      !Number.isSafeInteger(quantity) ||
      quantity <= 0 ||
      quantity > HOSTED_FAMILY_MAX_SEATS
    ) {
      throw new Error(
        "Stripe entitlement history contained an invalid aggregate quantity.",
      );
    }
    total += quantity;
  }
  if (total > HOSTED_FAMILY_MAX_SEATS) {
    throw new Error(
      "Stripe entitlement history exceeded the bounded licensed quantity.",
    );
  }
}

function replayHostedStripeEntitlementTransitionBackward(input: {
  currentFundingStates: ReadonlyMap<string, readonly boolean[]>;
  transition: HostedStripeEntitlementTransitionGroup;
}): {
  beforeFundingStates: Map<string, boolean[]>;
  required: boolean;
} {
  const priceIds = new Set([
    ...input.currentFundingStates.keys(),
    ...input.transition.afterQuantities.keys(),
    ...input.transition.beforeQuantities.keys(),
  ]);
  const priceStates = [...priceIds]
    .sort()
    .map((priceId) => {
      const beforeQuantity =
        input.transition.beforeQuantities.get(priceId) ?? 0;
      const afterQuantity =
        input.transition.afterQuantities.get(priceId) ?? 0;
      const commonQuantity = Math.min(beforeQuantity, afterQuantity);
      const currentFunding = [
        ...(input.currentFundingStates.get(priceId) ?? []),
      ].sort((left, right) => Number(right) - Number(left));
      const afterFunding = currentFunding.slice(0, afterQuantity);
      if (afterFunding.length < afterQuantity) {
        afterFunding.push(
          ...Array.from(
            { length: afterQuantity - afterFunding.length },
            () => false,
          ),
        );
      }
      return {
        afterSurplusFunding: afterFunding.slice(commonQuantity),
        beforeQuantity,
        commonFunding: afterFunding.slice(0, commonQuantity),
        currentBeyondAfter: currentFunding.slice(afterQuantity),
        priceId,
      };
    });
  const transferFunding = priceStates
    .flatMap((state) => state.afterSurplusFunding)
    .sort((left, right) => Number(right) - Number(left));
  const required = transferFunding.some(Boolean);
  const beforeFundingStates = new Map<string, boolean[]>();
  for (const state of priceStates) {
    const beforeFunding = [...state.commonFunding];
    const needed = state.beforeQuantity - beforeFunding.length;
    if (needed > 0) {
      beforeFunding.push(
        ...state.currentBeyondAfter.slice(0, needed),
      );
    }
    const transferNeeded = state.beforeQuantity - beforeFunding.length;
    if (transferNeeded > 0) {
      beforeFunding.push(...transferFunding.splice(0, transferNeeded));
    }
    if (beforeFunding.length < state.beforeQuantity) {
      beforeFunding.push(
        ...Array.from(
          { length: state.beforeQuantity - beforeFunding.length },
          () => false,
        ),
      );
    }
    if (beforeFunding.length > 0) {
      beforeFundingStates.set(state.priceId, beforeFunding);
    }
  }
  return {
    beforeFundingStates,
    required,
  };
}

function isHostedStripeInvoiceFullyRefunded(input: {
  allocations: readonly StripeInvoicePaymentAllocation[];
  invoiceId: string;
  refunds: readonly Stripe.Refund[];
}): boolean {
  const invoiceAllocations = input.allocations.filter(
    (allocation) => allocation.invoiceId === input.invoiceId,
  );
  const invoicePaymentKeys = new Set(
    invoiceAllocations
      .map(stripeInvoicePaymentReferenceKey)
      .filter((key): key is string => key !== null),
  );
  return invoiceAllocations.length > 0 &&
    invoiceAllocations.every(
      (allocation) => stripeInvoicePaymentReferenceKey(allocation) !== null,
    ) &&
    [...invoicePaymentKeys].every((paymentKey) => {
      const allocatedAmount = input.allocations
        .filter((allocation) =>
          stripeInvoicePaymentReferenceKey(allocation) === paymentKey
        )
        .reduce((sum, allocation) => sum + allocation.amountPaid, 0);
      const refundedAmount = input.refunds
        .filter((refund) =>
          stripeRefundPaymentReferenceKey(refund) === paymentKey
        )
        .reduce((sum, refund) => sum + refund.amount, 0);
      return allocatedAmount > 0 && refundedAmount >= allocatedAmount;
    });
}

async function hasHostedStripeRequiredRefundedBalanceFunding(input: {
  creditSourceInvoiceIdsByInvoiceId: ReadonlyMap<
    string,
    ReadonlySet<string>
  >;
  currentPeriodStart: number;
  fullyRefundedInvoiceIds: ReadonlySet<string>;
  requiredInvoiceIds: ReadonlySet<string>;
  stripe: Stripe;
  subscription: Stripe.Subscription;
}): Promise<boolean> {
  const invalidCreditInvoiceIds = new Set(
    [...input.creditSourceInvoiceIdsByInvoiceId]
      .filter(([, sourceInvoiceIds]) =>
        [...sourceInvoiceIds].some((invoiceId) =>
          input.fullyRefundedInvoiceIds.has(invoiceId)
        )
      )
      .map(([invoiceId]) => invoiceId),
  );
  if (invalidCreditInvoiceIds.size === 0) {
    return false;
  }
  const customerId = coerceStripeObjectId(input.subscription.customer);
  if (!customerId) {
    throw new Error(
      "Stripe recurring subscription did not expose its Customer.",
    );
  }
  const page = await withHostedStripeFailureLog(
    "customers.listBalanceTransactions.recurring-financial-state",
    () => input.stripe.customers.listBalanceTransactions(customerId, {
      created: {
        gte: input.currentPeriodStart,
      },
      limit: HOSTED_STRIPE_RECURRING_FINANCIAL_MAX_BALANCE_TRANSACTIONS,
    }, HOSTED_STRIPE_RECURRING_FINANCIAL_REQUEST_OPTIONS),
  );
  if (
    page.has_more ||
    page.data.length >
      HOSTED_STRIPE_RECURRING_FINANCIAL_MAX_BALANCE_TRANSACTIONS
  ) {
    throw new Error(
      "Stripe exceeded the bounded current-period Customer balance shape.",
    );
  }
  for (const transaction of page.data) {
    assertHostedStripeRecurringBalanceTransaction({
      currentPeriodStart: input.currentPeriodStart,
      customerId,
      transaction,
    });
  }
  const transactions = [...page.data].sort((left, right) =>
    left.created - right.created
  );
  // Stripe's Customer balance is fungible and does not assign source-credit
  // buckets to later applications. Consume invalid Family credit first,
  // including within a same-second group, so ambiguous value cannot preserve
  // entitlement after its source payment was returned.
  const taintedApplicationsByInvoiceId = new Map<string, number>();
  let taintedCredit = 0;
  for (let index = 0; index < transactions.length;) {
    const created = readStripeUnixSeconds(transactions[index]?.created);
    if (created === null) {
      throw new Error(
        "Stripe Customer balance transaction contained an invalid creation time.",
      );
    }
    const sameCreated: Stripe.CustomerBalanceTransaction[] = [];
    while (
      index < transactions.length &&
      transactions[index]?.created === created
    ) {
      sameCreated.push(transactions[index]!);
      index += 1;
    }
    for (const transaction of sameCreated.filter((candidate) =>
      candidate.amount < 0
    )) {
      const invoiceId = coerceStripeObjectId(transaction.invoice);
      if (transaction.type === "unapplied_from_invoice") {
        if (!invoiceId) {
          throw new Error(
            "Stripe reversed Customer balance without an invoice owner.",
          );
        }
        const priorApplication =
          taintedApplicationsByInvoiceId.get(invoiceId) ?? 0;
        const restored = Math.min(-transaction.amount, priorApplication);
        taintedCredit = addHostedStripeRecurringBalanceAmount(
          taintedCredit,
          restored,
        );
        const remainingApplication = priorApplication - restored;
        if (remainingApplication === 0) {
          taintedApplicationsByInvoiceId.delete(invoiceId);
        } else {
          taintedApplicationsByInvoiceId.set(
            invoiceId,
            remainingApplication,
          );
        }
        continue;
      }
      if (
        invoiceId &&
        invalidCreditInvoiceIds.has(invoiceId) &&
        isHostedStripeInvoiceBalanceApplication(transaction)
      ) {
        taintedCredit = addHostedStripeRecurringBalanceAmount(
          taintedCredit,
          -transaction.amount,
        );
      }
    }
    const positiveTransactions = sameCreated.filter((candidate) =>
      candidate.amount > 0
    ).sort((left, right) =>
      Number(
        !isHostedStripeRequiredBalanceApplication({
          requiredInvoiceIds: input.requiredInvoiceIds,
          transaction: left,
        }),
      ) -
      Number(
        !isHostedStripeRequiredBalanceApplication({
          requiredInvoiceIds: input.requiredInvoiceIds,
          transaction: right,
        }),
      )
    );
    for (const transaction of positiveTransactions) {
      const consumedTaintedCredit = Math.min(
        transaction.amount,
        taintedCredit,
      );
      taintedCredit -= consumedTaintedCredit;
      if (
        consumedTaintedCredit === 0 ||
        !isHostedStripeInvoiceBalanceApplication(transaction)
      ) {
        continue;
      }
      const invoiceId = coerceStripeObjectId(transaction.invoice);
      if (!invoiceId) {
        throw new Error(
          "Stripe applied Customer balance without an invoice owner.",
        );
      }
      taintedApplicationsByInvoiceId.set(
        invoiceId,
        addHostedStripeRecurringBalanceAmount(
          taintedApplicationsByInvoiceId.get(invoiceId) ?? 0,
          consumedTaintedCredit,
        ),
      );
    }
  }
  return [...taintedApplicationsByInvoiceId].some(
    ([invoiceId, amount]) =>
      amount > 0 && input.requiredInvoiceIds.has(invoiceId),
  );
}

function assertHostedStripeRecurringBalanceTransaction(input: {
  currentPeriodStart: number;
  customerId: string;
  transaction: Stripe.CustomerBalanceTransaction;
}): void {
  if (
    coerceStripeObjectId(input.transaction.customer) !== input.customerId ||
    !Number.isSafeInteger(input.transaction.amount) ||
    input.transaction.amount === 0 ||
    !Number.isSafeInteger(input.transaction.ending_balance) ||
    readStripeUnixSeconds(input.transaction.created) === null ||
    input.transaction.created < input.currentPeriodStart
  ) {
    throw new Error(
      "Stripe returned an invalid recurring Customer balance transaction.",
    );
  }
}

function isHostedStripeInvoiceBalanceApplication(
  transaction: Stripe.CustomerBalanceTransaction,
): boolean {
  return transaction.type === "applied_to_invoice" ||
    transaction.type === "checkout_session_subscription_payment";
}

function isHostedStripeRequiredBalanceApplication(input: {
  requiredInvoiceIds: ReadonlySet<string>;
  transaction: Stripe.CustomerBalanceTransaction;
}): boolean {
  const invoiceId = coerceStripeObjectId(input.transaction.invoice);
  return isHostedStripeInvoiceBalanceApplication(input.transaction) &&
    invoiceId !== null &&
    input.requiredInvoiceIds.has(invoiceId);
}

function addHostedStripeRecurringBalanceAmount(
  left: number,
  right: number,
): number {
  const total = left + right;
  if (
    !Number.isSafeInteger(left) ||
    !Number.isSafeInteger(right) ||
    !Number.isSafeInteger(total) ||
    left < 0 ||
    right < 0
  ) {
    throw new Error(
      "Stripe recurring Customer balance exceeded the safe integer shape.",
    );
  }
  return total;
}

function compareHostedStripeBaseEntitlementInvoice(
  left: Awaited<
    ReturnType<typeof retrieveHostedStripeInvoiceCollectionSnapshot>
  >,
  right: Awaited<
    ReturnType<typeof retrieveHostedStripeInvoiceCollectionSnapshot>
  >,
): number {
  const leftIsBase =
    left.invoice.billing_reason === "subscription_create" ||
    left.invoice.billing_reason === "subscription_cycle";
  const rightIsBase =
    right.invoice.billing_reason === "subscription_create" ||
    right.invoice.billing_reason === "subscription_cycle";
  if (leftIsBase !== rightIsBase) {
    return leftIsBase ? -1 : 1;
  }
  return (readStripeUnixSeconds(left.invoice.created) ?? 0) -
    (readStripeUnixSeconds(right.invoice.created) ?? 0);
}

export function isHostedStripeUnappliedPendingUpdateInvoice(input: {
  invoice: Stripe.Invoice;
  subscription: Stripe.Subscription;
}): boolean {
  if (
    input.invoice.billing_reason !== "subscription_update" ||
    input.invoice.status === "paid" ||
    (
      input.subscription.status !== "active" &&
      input.subscription.status !== "trialing"
    ) ||
    coerceStripeInvoiceSubscriptionId(input.invoice) !== input.subscription.id ||
    coerceStripeObjectId(input.subscription.latest_invoice) !== input.invoice.id
  ) {
    return false;
  }

  const pendingUpdate = input.subscription.pending_update;
  const pendingItems = pendingUpdate?.subscription_items;
  if (!pendingUpdate) {
    return isHostedStripeExpiredUnappliedUpdateInvoice(input);
  }
  if (
    !Number.isFinite(pendingUpdate.expires_at) ||
    pendingUpdate.expires_at <= 0 ||
    !Array.isArray(pendingItems) ||
    pendingItems.length === 0
  ) {
    return false;
  }

  const currentItems = new Map(
    input.subscription.items.data.map((item) => [item.id, item]),
  );
  if (currentItems.size !== input.subscription.items.data.length) {
    return false;
  }

  const seenPendingItemIds = new Set<string>();
  let hasUnappliedTarget = false;
  for (const pendingItem of pendingItems) {
    const pendingItemId = normalizeNullableString(pendingItem.id);
    const currentItem = pendingItemId ? currentItems.get(pendingItemId) : null;
    const pendingPriceId = coerceStripeObjectId(pendingItem.price);
    const currentPriceId = coerceStripeObjectId(currentItem?.price);
    if (
      !pendingItemId ||
      seenPendingItemIds.has(pendingItemId) ||
      !currentItem ||
      !pendingPriceId ||
      !currentPriceId
    ) {
      return false;
    }
    seenPendingItemIds.add(pendingItemId);
    const currentQuantity = currentItem.quantity ?? null;
    const pendingQuantity =
      pendingItem.quantity === undefined
        ? currentQuantity
        : pendingItem.quantity;
    if (
      pendingPriceId !== currentPriceId ||
      pendingQuantity !== currentQuantity
    ) {
      hasUnappliedTarget = true;
    }
  }
  return hasUnappliedTarget;
}

function isHostedStripeExpiredUnappliedUpdateInvoice(input: {
  invoice: Stripe.Invoice;
  subscription: Stripe.Subscription;
}): boolean {
  const lines = input.invoice.lines;
  if (
    input.invoice.status !== "void" ||
    !lines ||
    lines.has_more
  ) {
    return false;
  }

  const currentItems = new Map(
    input.subscription.items.data.map((item) => [item.id, item]),
  );
  if (currentItems.size !== input.subscription.items.data.length) {
    return false;
  }

  return lines.data.some((line) => {
    const details = line.parent?.subscription_item_details;
    if (
      !details?.proration ||
      details.subscription !== input.subscription.id ||
      !Number.isSafeInteger(line.amount) ||
      line.amount <= 0
    ) {
      return false;
    }
    const currentItem = currentItems.get(details.subscription_item);
    const targetPriceId = coerceStripeObjectId(
      line.pricing?.price_details?.price,
    );
    const targetQuantity = line.quantity;
    if (
      !targetPriceId ||
      !Number.isSafeInteger(targetQuantity) ||
      targetQuantity === null ||
      targetQuantity <= 0
    ) {
      return false;
    }
    if (!currentItem) {
      return ![...currentItems.values()].some(
        (item) => coerceStripeObjectId(item.price) === targetPriceId,
      );
    }
    const currentPriceId = coerceStripeObjectId(currentItem.price);
    const currentQuantity = currentItem.quantity;
    return Boolean(
      currentPriceId &&
      currentQuantity !== null &&
      (
        targetPriceId !== currentPriceId ||
        targetQuantity !== currentQuantity
      )
    );
  });
}

function assertHostedStripeInvoiceMatchesSubscription(input: {
  invoice: Stripe.Invoice;
  subscriptionId: string;
}): void {
  if (coerceStripeInvoiceSubscriptionId(input.invoice) !== input.subscriptionId) {
    throw new Error(
      "Stripe invoice did not match its recurring subscription owner.",
    );
  }
}

function readHostedStripeCurrentFinancialPeriod(input: {
  subscription: Stripe.Subscription;
}): {
  end: number;
  start: number;
} {
  const candidates = [
    readStripeObjectFinancialPeriod(input.subscription),
    ...(input.subscription.items?.data ?? []).map(
      readStripeObjectFinancialPeriod,
    ),
  ].filter((period): period is { end: number; start: number } =>
    period !== null
  );
  const current = candidates[0];
  if (!current) {
    throw new Error(
      "Stripe subscription did not expose a bounded current billing period.",
    );
  }
  for (const candidate of candidates.slice(1)) {
    if (
      candidate.start !== current.start ||
      candidate.end !== current.end
    ) {
      throw new Error(
        "Stripe subscription current billing period was internally inconsistent.",
      );
    }
  }
  return current;
}

async function listHostedStripeCurrentPeriodInvoices(input: {
  currentPeriod: { end: number; start: number };
  stripe: Stripe;
  subscriptionId: string;
}): Promise<Stripe.Invoice[]> {
  const currentInvoices = new Map<string, Stripe.Invoice>();
  const page = await withHostedStripeFailureLog(
    "invoices.list.current-entitlement",
    () => input.stripe.invoices.list({
      created: {
        gte: Math.max(
          1,
          input.currentPeriod.start -
            HOSTED_STRIPE_RECURRING_FINANCIAL_INVOICE_LOOKBACK_SECONDS,
        ),
      },
      limit: HOSTED_STRIPE_RECURRING_FINANCIAL_MAX_CURRENT_INVOICES,
      subscription: input.subscriptionId,
    }, HOSTED_STRIPE_RECURRING_FINANCIAL_REQUEST_OPTIONS),
  );
  if (
    page.has_more ||
    page.data.length >
      HOSTED_STRIPE_RECURRING_FINANCIAL_MAX_CURRENT_INVOICES
  ) {
    throw new Error(
      "Stripe exceeded the bounded current-period invoice reconciliation shape.",
    );
  }
  const classifiedInvoices = await mapHostedStripeRecurringFinancialReads(
    page.data,
    HOSTED_STRIPE_RECURRING_FINANCIAL_READ_CONCURRENCY,
    async (invoice) => ({
      invoice,
      period: await classifyStripeInvoiceSubscriptionPeriod({
        currentPeriod: input.currentPeriod,
        invoice,
        stripe: input.stripe,
        subscriptionId: input.subscriptionId,
      }),
    }),
  );
  for (const { invoice, period } of classifiedInvoices) {
    assertHostedStripeInvoiceMatchesSubscription({
      invoice,
      subscriptionId: input.subscriptionId,
    });
    if (period === "current") {
      currentInvoices.set(invoice.id, invoice);
    }
  }
  return [...currentInvoices.values()];
}

async function classifyStripeInvoiceSubscriptionPeriod(input: {
  currentPeriod: { end: number; start: number };
  invoice: Stripe.Invoice;
  stripe: Stripe;
  subscriptionId: string;
}): Promise<"current" | "future" | "past"> {
  const invoiceLines = await readStripeInvoiceLines({
    invoice: input.invoice,
    stripe: input.stripe,
  });
  const subscriptionPeriods = invoiceLines.flatMap((line) => {
    const subscriptionId = coerceStripeObjectId(line.subscription) ??
      coerceStripeObjectId(
        line.parent?.subscription_item_details?.subscription,
      ) ??
      coerceStripeObjectId(
        line.parent?.invoice_item_details?.subscription,
      );
    if (subscriptionId !== input.subscriptionId) {
      return [];
    }
    const periodStart = readStripeUnixSeconds(line.period?.start);
    const periodEnd = readStripeUnixSeconds(line.period?.end);
    if (periodStart === null || periodEnd === null) {
      throw new Error(
        "Stripe subscription invoice line did not expose a bounded service period.",
      );
    }
    return [{ end: periodEnd, start: periodStart }];
  });
  if (subscriptionPeriods.length === 0) {
    throw new Error(
      "Stripe paid subscription invoice did not contain an exact subscription line.",
    );
  }
  if (subscriptionPeriods.some((period) => {
    const spansCurrentPeriod =
      period.start <= input.currentPeriod.start &&
      period.end >= input.currentPeriod.end;
    const fundsCurrentPeriodDelta =
      period.start >= input.currentPeriod.start &&
      period.start < input.currentPeriod.end &&
      period.end === input.currentPeriod.end;
    return spansCurrentPeriod || fundsCurrentPeriodDelta;
  })) {
    return "current";
  }
  if (subscriptionPeriods.every((period) =>
    period.end <= input.currentPeriod.start
  )) {
    return "past";
  }
  if (subscriptionPeriods.every((period) =>
    period.start >= input.currentPeriod.end
  )) {
    return "future";
  }
  throw new Error(
    "Stripe paid subscription invoice service period overlapped the current period ambiguously.",
  );
}

async function readStripeInvoiceLines(input: {
  invoice: Stripe.Invoice;
  stripe: Stripe;
}): Promise<readonly Stripe.InvoiceLineItem[]> {
  if (input.invoice.lines && !input.invoice.lines.has_more) {
    if (input.invoice.lines.data.length > 25) {
      throw new Error(
        "Stripe exceeded the bounded current-entitlement invoice line shape.",
      );
    }
    return input.invoice.lines.data;
  }
  const lines = await withHostedStripeFailureLog(
    "invoice.lines.list.current-entitlement",
    () => input.stripe.invoices.listLineItems(input.invoice.id, {
      limit: 25,
    }, HOSTED_STRIPE_RECURRING_FINANCIAL_REQUEST_OPTIONS),
  );
  if (lines.has_more) {
    throw new Error(
      "Stripe exceeded the bounded current-entitlement invoice line shape.",
    );
  }
  for (const line of lines.data) {
    if (line.invoice !== input.invoice.id) {
      throw new Error(
        "Stripe returned an invoice line for the wrong current-entitlement invoice.",
      );
    }
  }
  return lines.data;
}

function readStripeObjectFinancialPeriod(
  value: object,
): {
  end: number;
  start: number;
} | null {
  const record = Object.fromEntries(Object.entries(value));
  const start = readStripeUnixSeconds(record.current_period_start) ??
    readStripeUnixSeconds(record.period_start);
  const end = readStripeUnixSeconds(record.current_period_end) ??
    readStripeUnixSeconds(record.period_end);
  return start !== null && end !== null && start < end
    ? { end, start }
    : null;
}

function readStripeUnixSeconds(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) > 0
    ? value as number
    : null;
}

type StripeInvoicePaymentReference = {
  chargeId: string | null;
  paymentIntentId: string | null;
};

type StripeInvoicePaymentAllocation = StripeInvoicePaymentReference & {
  amountPaid: number;
  invoiceId: string;
  invoicePaymentId: string;
};

function listStripeInvoicePaymentAllocations(
  snapshots: readonly Awaited<
    ReturnType<typeof retrieveHostedStripeInvoiceCollectionSnapshot>
  >[],
): StripeInvoicePaymentAllocation[] {
  const unique = new Map<string, StripeInvoicePaymentAllocation>();
  for (const snapshot of snapshots) {
    for (const invoicePayment of snapshot.invoicePayments) {
      if (invoicePayment.status !== "paid") {
        continue;
      }
      const amountPaid = readStripeNonnegativeInteger(
        invoicePayment.amount_paid,
      );
      if (amountPaid === null) {
        throw new Error(
          "Stripe paid InvoicePayment did not expose a non-negative allocation.",
        );
      }
      if (amountPaid === 0) {
        continue;
      }
      const allocation = {
        amountPaid,
        invoiceId: snapshot.invoice.id,
        invoicePaymentId: invoicePayment.id,
        ...readStripeInvoicePaymentReference(invoicePayment),
      };
      const existing = unique.get(invoicePayment.id);
      if (
        existing &&
        (
          existing.amountPaid !== allocation.amountPaid ||
          existing.invoiceId !== allocation.invoiceId ||
          existing.chargeId !== allocation.chargeId ||
          existing.paymentIntentId !== allocation.paymentIntentId
        )
      ) {
        throw new Error(
          "Stripe repeated an InvoicePayment with conflicting allocation facts.",
        );
      }
      unique.set(invoicePayment.id, allocation);
    }
  }
  return [...unique.values()];
}

function readStripeInvoicePaymentReference(
  invoicePayment: Stripe.InvoicePayment,
): StripeInvoicePaymentReference {
  const paymentIntent = invoicePayment.payment.payment_intent;
  const paymentIntentId = coerceStripeObjectId(paymentIntent);
  const chargeId = coerceStripeObjectId(invoicePayment.payment.charge) ??
    (
      paymentIntent &&
        typeof paymentIntent === "object" &&
        paymentIntent.object === "payment_intent"
        ? coerceStripeObjectId(paymentIntent.latest_charge)
        : null
    );
  return { chargeId, paymentIntentId };
}

function listStripeInvoicePaymentReferences(
  allocations: readonly StripeInvoicePaymentAllocation[],
): StripeInvoicePaymentReference[] {
  const unique: StripeInvoicePaymentReference[] = [];
  for (const { chargeId, paymentIntentId } of allocations) {
    const payment = {
      chargeId,
      paymentIntentId,
    };
    if (!stripeInvoicePaymentReferenceKey(payment)) {
      continue;
    }
    const matchingIndexes = unique.flatMap((candidate, index) =>
      (
        chargeId &&
        candidate.chargeId === chargeId
      ) || (
        paymentIntentId &&
        candidate.paymentIntentId === paymentIntentId
      )
        ? [index]
        : []
    );
    if (matchingIndexes.length === 0) {
      unique.push(payment);
      continue;
    }
    const matchingPayments = matchingIndexes.map((index) => unique[index]!);
    const chargeIds = new Set(
      [chargeId, ...matchingPayments.map((candidate) => candidate.chargeId)]
        .filter((id): id is string => id !== null),
    );
    const paymentIntentIds = new Set(
      [
        paymentIntentId,
        ...matchingPayments.map((candidate) => candidate.paymentIntentId),
      ].filter((id): id is string => id !== null),
    );
    if (chargeIds.size > 1 || paymentIntentIds.size > 1) {
      throw new Error(
        "Stripe current-period InvoicePayments exposed conflicting payment relationships.",
      );
    }
    for (const index of matchingIndexes.reverse()) {
      unique.splice(index, 1);
    }
    unique.push({
      chargeId: [...chargeIds][0] ?? null,
      paymentIntentId: [...paymentIntentIds][0] ?? null,
    });
  }
  return unique;
}

function stripeInvoicePaymentReferenceKey(
  payment: StripeInvoicePaymentReference,
): string | null {
  return payment.paymentIntentId
    ? `payment_intent:${payment.paymentIntentId}`
    : payment.chargeId
    ? `charge:${payment.chargeId}`
    : null;
}

function stripeRefundPaymentReferenceKey(refund: Stripe.Refund): string | null {
  const paymentIntentId = coerceStripeObjectId(refund.payment_intent);
  if (paymentIntentId) {
    return `payment_intent:${paymentIntentId}`;
  }
  const chargeId = coerceStripeObjectId(refund.charge);
  return chargeId ? `charge:${chargeId}` : null;
}

async function listStripeSuccessfulRefunds(
  input: {
    payments: readonly StripeInvoicePaymentReference[];
    stripe: Stripe;
  },
): Promise<Stripe.Refund[]> {
  const refunds = new Map<string, Stripe.Refund>();
  const pages = await mapHostedStripeRecurringFinancialReads(
    input.payments,
    HOSTED_STRIPE_RECURRING_FINANCIAL_READ_CONCURRENCY,
    async (payment) => {
      const filter = payment.chargeId
        ? { charge: payment.chargeId }
        : payment.paymentIntentId
        ? { payment_intent: payment.paymentIntentId }
        : null;
      if (!filter) {
        return { page: null, payment };
      }
      const page = await withHostedStripeFailureLog(
        "refunds.list.recurring-financial-state",
        () => input.stripe.refunds.list({
          ...filter,
          limit: 20,
        }, HOSTED_STRIPE_RECURRING_FINANCIAL_REQUEST_OPTIONS),
      );
      if (page.has_more) {
        throw new Error(
          "Stripe exceeded the bounded recurring refund reconciliation shape.",
        );
      }
      return { page, payment };
    },
  );
  for (const { page, payment } of pages) {
    for (const refund of page?.data ?? []) {
      assertStripeRefundMatchesInvoicePayment({
        payment,
        refund,
      });
      if (
        refund.status === "succeeded" &&
        readStripePositiveInteger(refund.amount) !== null
      ) {
        refunds.set(refund.id, refund);
      }
    }
  }
  return [...refunds.values()];
}

async function listStripeDisputes(
  input: {
    payments: readonly StripeInvoicePaymentReference[];
    stripe: Stripe;
  },
): Promise<Stripe.Dispute[]> {
  const disputes = new Map<string, Stripe.Dispute>();
  const pages = await mapHostedStripeRecurringFinancialReads(
    input.payments,
    HOSTED_STRIPE_RECURRING_FINANCIAL_READ_CONCURRENCY,
    async (payment) => {
      const filter = payment.chargeId
        ? { charge: payment.chargeId }
        : payment.paymentIntentId
        ? { payment_intent: payment.paymentIntentId }
        : null;
      if (!filter) {
        return { page: null, payment };
      }
      const page = await withHostedStripeFailureLog(
        "disputes.list.recurring-financial-state",
        () => input.stripe.disputes.list({
          ...filter,
          limit: 20,
        }, HOSTED_STRIPE_RECURRING_FINANCIAL_REQUEST_OPTIONS),
      );
      if (page.has_more) {
        throw new Error(
          "Stripe exceeded the bounded recurring dispute reconciliation shape.",
        );
      }
      return { page, payment };
    },
  );
  for (const { page, payment } of pages) {
    for (const dispute of page?.data ?? []) {
      assertStripeDisputeMatchesInvoicePayment({
        dispute,
        payment,
      });
      disputes.set(dispute.id, dispute);
    }
  }
  return [...disputes.values()];
}

function assertStripeRefundMatchesInvoicePayment(input: {
  payment: StripeInvoicePaymentReference;
  refund: Stripe.Refund;
}): void {
  if (
    input.payment.chargeId &&
    coerceStripeObjectId(input.refund.charge) !== input.payment.chargeId
  ) {
    throw new Error(
      "Stripe returned a Refund for the wrong current-entitlement Charge.",
    );
  }
  if (
    input.payment.paymentIntentId &&
    coerceStripeObjectId(input.refund.payment_intent) !==
      input.payment.paymentIntentId
  ) {
    throw new Error(
      "Stripe returned a Refund for the wrong current-entitlement PaymentIntent.",
    );
  }
}

function assertStripeDisputeMatchesInvoicePayment(input: {
  dispute: Stripe.Dispute;
  payment: StripeInvoicePaymentReference;
}): void {
  if (
    input.payment.chargeId &&
    coerceStripeObjectId(input.dispute.charge) !== input.payment.chargeId
  ) {
    throw new Error(
      "Stripe returned a Dispute for the wrong current-entitlement Charge.",
    );
  }
  if (
    input.payment.paymentIntentId &&
    coerceStripeObjectId(input.dispute.payment_intent) !==
      input.payment.paymentIntentId
  ) {
    throw new Error(
      "Stripe returned a Dispute for the wrong current-entitlement PaymentIntent.",
    );
  }
}

function hasStripeDisputeFundsOutstanding(dispute: Stripe.Dispute): boolean {
  const balanceByCurrency = new Map<string, number>();
  for (const transaction of dispute.balance_transactions) {
    if (!Number.isSafeInteger(transaction.amount) || transaction.amount === 0) {
      throw new Error("Stripe Dispute contained an invalid balance transaction.");
    }
    const currency = normalizeNullableString(transaction.currency)?.toLowerCase();
    if (!currency) {
      throw new Error("Stripe Dispute balance transaction omitted currency.");
    }
    balanceByCurrency.set(
      currency,
      (balanceByCurrency.get(currency) ?? 0) + transaction.amount,
    );
  }
  return [...balanceByCurrency.values()].some((amount) => amount < 0);
}

function readStripePositiveInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) > 0
    ? value as number
    : null;
}

function readStripeNonnegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

async function mapHostedStripeRecurringFinancialReads<TInput, TOutput>(
  values: readonly TInput[],
  concurrency: number,
  read: (value: TInput) => Promise<TOutput>,
): Promise<TOutput[]> {
  const results: TOutput[] = [];
  for (let offset = 0; offset < values.length; offset += concurrency) {
    results.push(
      ...await Promise.all(
        values.slice(offset, offset + concurrency).map(read),
      ),
    );
  }
  return results;
}

async function readStripeInvoiceCanonicalSubscription(
  invoice: Stripe.Invoice,
): Promise<Stripe.Subscription | null> {
  const subscriptionId = coerceStripeInvoiceSubscriptionId(invoice);

  if (!subscriptionId) {
    return null;
  }

  return withHostedStripeFailureLog(
    "subscription.retrieve.invoice-canonical",
    () => requireHostedStripeApi().subscriptions.retrieve(subscriptionId),
  );
}

async function readHostedMemberBillingSnapshotForDirectLookup(input: {
  memberId: string;
  prisma: HostedOnboardingReadClient;
  requireMatchingSubscription?: boolean;
}): Promise<HostedMemberBillingSnapshot | null> {
  if (input.requireMatchingSubscription) {
    return readHostedMemberBillingSnapshot({
      memberId: input.memberId,
      prisma: input.prisma,
    });
  }

  const memberCore = await readHostedMemberCoreState(input);
  return memberCore ? composeHostedMemberBillingSnapshot(memberCore, null) : null;
}

function canUseHostedStripeBillingLookupCandidate(input: {
  customerId: string | null;
  member: HostedMemberBillingSnapshot | null;
  requireMatchingSubscription?: boolean;
  subscriptionId: string | null;
}): input is {
  customerId: string | null;
  member: HostedMemberBillingSnapshot;
  requireMatchingSubscription?: boolean;
  subscriptionId: string | null;
} {
  if (!input.member) {
    return false;
  }

  if (!input.requireMatchingSubscription || !input.subscriptionId) {
    return true;
  }

  const boundCustomerId = input.member.billingRef?.stripeCustomerId ?? null;
  if (boundCustomerId && input.customerId && boundCustomerId !== input.customerId) {
    return false;
  }

  const boundSubscriptionId = input.member.billingRef?.stripeSubscriptionId ?? null;
  return !boundSubscriptionId || boundSubscriptionId === input.subscriptionId;
}

function listHostedStripeUniqueMemberIds(values: readonly (string | null | undefined)[]): string[] {
  return [...new Set(
    values.filter((value): value is string => typeof value === "string" && value.length > 0),
  )];
}
