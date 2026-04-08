import { type Prisma } from "@prisma/client";

import { coerceStripeObjectId } from "./billing";
import {
  findHostedMemberByStripeCustomerId,
  findHostedMemberByStripeSubscriptionId,
} from "./hosted-member-billing-store";
import {
  type HostedMemberSnapshot,
  readHostedMemberSnapshot,
} from "./hosted-member-store";
import { requireHostedStripeApi } from "./runtime";

/**
 * Owns Stripe-object-to-member lookup and customer-context reads so billing
 * policy can stay focused on freshness rules and entitlement transitions.
 */
type HostedOnboardingPrismaClient = Prisma.TransactionClient;

export async function findMemberForStripeObject(input: {
  clientReferenceId: string | null;
  customerId: string | null;
  memberId: string | null;
  prisma: HostedOnboardingPrismaClient;
  subscriptionId: string | null;
}): Promise<HostedMemberSnapshot | null> {
  if (input.memberId) {
    const member = await readHostedMemberSnapshot({
      memberId: input.memberId,
      prisma: input.prisma,
    });

    if (member) {
      return member;
    }
  }

  if (input.clientReferenceId) {
    const member = await readHostedMemberSnapshot({
      memberId: input.clientReferenceId,
      prisma: input.prisma,
    });

    if (member) {
      return member;
    }
  }

  if (input.subscriptionId) {
    const member = await findHostedMemberByStripeSubscriptionId({
      prisma: input.prisma,
      stripeSubscriptionId: input.subscriptionId,
    });

    if (member) {
      return readHostedMemberSnapshot({
        memberId: member.id,
        prisma: input.prisma,
      });
    }
  }

  if (input.customerId) {
    const member = await findHostedMemberByStripeCustomerId({
      prisma: input.prisma,
      stripeCustomerId: input.customerId,
    });

    if (member) {
      return readHostedMemberSnapshot({
        memberId: member.id,
        prisma: input.prisma,
      });
    }
  }

  return null;
}

export async function findMemberForStripeReversal(input: {
  chargeId: string | null;
  customerId: string | null;
  paymentIntentId: string | null;
  prisma: HostedOnboardingPrismaClient;
  subscriptionId: string | null;
}): Promise<HostedMemberSnapshot | null> {
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
    ? readHostedMemberSnapshot({
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
