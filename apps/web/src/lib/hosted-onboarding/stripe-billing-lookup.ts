import type Stripe from "stripe";

import {
  coerceStripeInvoiceSubscriptionId,
  coerceStripeObjectId,
  coerceStripeSubscriptionId,
} from "./billing";
import {
  listHostedMemberStripeBillingLookupMemberIds,
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
  ownerMemberId: string | null;
}): string[] {
  return listHostedStripeUniqueMemberIds([
    input.memberId,
    input.ownerMemberId,
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
      ownerMemberId: normalizeNullableString(
        input.session.metadata?.ownerMemberId,
      ),
    }),
    prisma: input.prisma,
  });
  const stripeLookupMemberIds =
    await listHostedMemberStripeBillingLookupMemberIds({
    prisma: input.prisma,
    stripeCustomerId: coerceStripeObjectId(input.session.customer),
    stripeSubscriptionId:
      coerceStripeSubscriptionId(input.session.subscription),
  });

  return listHostedStripeUniqueMemberIds([
    ...directMemberIds,
    ...stripeLookupMemberIds,
  ]);
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
      ownerMemberId: normalizeNullableString(
        input.session.metadata?.ownerMemberId,
      ),
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

  const chargeId = input.chargeId;
  if (chargeId) {
    const charge = await withHostedStripeFailureLog(
      "charges.retrieve.customer-context",
      () => stripe.charges.retrieve(chargeId),
    );
    return {
      customerId: coerceStripeObjectId(charge.customer),
    };
  }

  const paymentIntentId = input.paymentIntentId;
  if (paymentIntentId) {
    const paymentIntent = await withHostedStripeFailureLog(
      "paymentIntents.retrieve.customer-context",
      () => stripe.paymentIntents.retrieve(paymentIntentId),
    );
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
  // A canonical signed webhook may arrive before Checkout writes the first
  // subscription binding. Metadata can establish that missing edge, but it
  // must never replace a different stored subscription or customer.
  return boundSubscriptionId === null
    || boundSubscriptionId === input.subscriptionId;
}

function listHostedStripeUniqueMemberIds(values: readonly (string | null | undefined)[]): string[] {
  return [...new Set(
    values.filter((value): value is string => typeof value === "string" && value.length > 0),
  )];
}
