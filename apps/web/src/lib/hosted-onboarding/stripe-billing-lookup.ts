import type Stripe from "stripe";

import {
  coerceStripeInvoiceSubscriptionId,
  coerceStripeObjectId,
  coerceStripeSubscriptionId,
} from "./billing";
import {
  lookupHostedMemberStripeBillingRefByStripeCustomerId,
  lookupHostedMemberStripeBillingRefByStripeSubscriptionId,
} from "./hosted-member-billing-store";
import {
  composeHostedMemberBillingSnapshot,
  type HostedMemberBillingSnapshot,
  readHostedMemberCoreState,
} from "./hosted-member-store";
import { requireHostedStripeApi } from "./runtime";
import {
  normalizeNullableString,
  type HostedOnboardingReadClient,
} from "./shared";

/**
 * Owns Stripe-object-to-member lookup and customer-context reads so billing
 * policy can stay focused on freshness rules and entitlement transitions.
 */

export async function findMemberForStripeObject(input: {
  clientReferenceId: string | null;
  customerId: string | null;
  memberId: string | null;
  prisma: HostedOnboardingReadClient;
  subscriptionId: string | null;
}): Promise<HostedMemberBillingSnapshot | null> {
  if (input.memberId) {
    const directMember = await readHostedMemberBillingSnapshotWithoutRef({
      memberId: input.memberId,
      prisma: input.prisma,
    });

    if (directMember) {
      return directMember;
    }
  }

  if (input.clientReferenceId) {
    const directMember = await readHostedMemberBillingSnapshotWithoutRef({
      memberId: input.clientReferenceId,
      prisma: input.prisma,
    });

    if (directMember) {
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

    if (billingLookup) {
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
  const directMemberIds = listHostedStripeDirectMemberIds({
    clientReferenceId: normalizeNullableString(input.session.client_reference_id),
    memberId: normalizeNullableString(input.session.metadata?.memberId),
  });

  if (directMemberIds.length > 0) {
    return directMemberIds;
  }

  const matchedMember = await findMemberForStripeCheckoutSession(input);
  return matchedMember ? [matchedMember.core.id] : [];
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
    subscriptionId: input.subscription.id,
  });
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

export async function findMemberForStripeReversal(input: {
  chargeId: string | null;
  customerId: string | null;
  paymentIntentId: string | null;
  prisma: HostedOnboardingReadClient;
  subscriptionId: string | null;
}): Promise<HostedMemberBillingSnapshot | null> {
  const directMember = await findMemberForStripeObject({
    clientReferenceId: null,
    customerId: input.customerId,
    memberId: null,
    prisma: input.prisma,
    subscriptionId: input.subscriptionId,
  });

  if (directMember) {
    return directMember;
  }

  return null;
}

export async function resolveStripeCustomerContext(input: {
  chargeId: string | null;
  paymentIntentId: string | null;
}): Promise<{ customerId: string | null }> {
  const stripe = requireHostedStripeApi();

  if (input.chargeId) {
    const charge = await stripe.charges.retrieve(input.chargeId);
    return {
      customerId: coerceStripeObjectId(charge.customer),
    };
  }

  if (input.paymentIntentId) {
    const paymentIntent = await stripe.paymentIntents.retrieve(input.paymentIntentId);
    return {
      customerId: coerceStripeObjectId(paymentIntent.customer),
    };
  }

  return {
    customerId: null,
  };
}

async function readStripeInvoiceCanonicalSubscription(
  invoice: Stripe.Invoice,
): Promise<Stripe.Subscription | null> {
  const subscriptionId = coerceStripeInvoiceSubscriptionId(invoice);

  if (!subscriptionId) {
    return null;
  }

  return requireHostedStripeApi().subscriptions.retrieve(subscriptionId);
}

async function readHostedMemberBillingSnapshotWithoutRef(input: {
  memberId: string;
  prisma: HostedOnboardingReadClient;
}): Promise<HostedMemberBillingSnapshot | null> {
  const memberCore = await readHostedMemberCoreState(input);
  return memberCore ? composeHostedMemberBillingSnapshot(memberCore, null) : null;
}

function listHostedStripeUniqueMemberIds(values: readonly (string | null | undefined)[]): string[] {
  return [...new Set(
    values.filter((value): value is string => typeof value === "string" && value.length > 0),
  )];
}
