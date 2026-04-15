import { coerceStripeObjectId } from "./billing";
import {
  lookupHostedMemberStripeBillingRefByStripeCustomerId,
  lookupHostedMemberStripeBillingRefByStripeSubscriptionId,
} from "./hosted-member-billing-store";
import {
  composeHostedMemberBillingSnapshot,
  type HostedMemberBillingSnapshot,
  readHostedMemberBillingSnapshot,
} from "./hosted-member-store";
import { requireHostedStripeApi } from "./runtime";
import { type HostedOnboardingReadClient } from "./shared";

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
    const member = await readHostedMemberBillingSnapshot({
      memberId: input.memberId,
      prisma: input.prisma,
    });

    if (member) {
      return member;
    }
  }

  if (input.clientReferenceId) {
    const member = await readHostedMemberBillingSnapshot({
      memberId: input.clientReferenceId,
      prisma: input.prisma,
    });

    if (member) {
      return member;
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

  if (!input.chargeId && !input.paymentIntentId) {
    return null;
  }

  const issuance = await input.prisma.hostedRevnetIssuance.findFirst({
    where: {
      OR: [
        ...(input.chargeId
          ? [
              {
                stripeChargeId: input.chargeId,
              },
            ]
          : []),
        ...(input.paymentIntentId
          ? [
              {
                stripePaymentIntentId: input.paymentIntentId,
              },
            ]
          : []),
      ],
    },
    include: {
      member: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return issuance?.member
    ? readHostedMemberBillingSnapshot({
        memberId: issuance.member.id,
        prisma: input.prisma,
      })
    : null;
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
