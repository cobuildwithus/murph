import {
  HostedBillingCheckoutStatus,
  type HostedBillingMode,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";

import { generateHostedCheckoutId } from "./shared";

type HostedBillingAttemptClient = PrismaClient | Prisma.TransactionClient;

export async function findOpenHostedBillingAttempt(input: {
  memberId: string;
  mode: HostedBillingMode;
  priceId: string;
  prisma: HostedBillingAttemptClient;
}) {
  return input.prisma.hostedBillingCheckout.findFirst({
    where: {
      memberId: input.memberId,
      mode: input.mode,
      priceId: input.priceId,
      status: HostedBillingCheckoutStatus.open,
    },
    orderBy: {
      createdAt: "desc",
    },
  });
}

export async function supersedeOpenHostedBillingAttempts(input: {
  excludeCheckoutSessionId?: string | null;
  inviteId: string | null;
  memberId: string;
  prisma: HostedBillingAttemptClient;
}) {
  await input.prisma.hostedBillingCheckout.updateMany({
    where: {
      memberId: input.memberId,
      inviteId: input.inviteId,
      status: HostedBillingCheckoutStatus.open,
      ...(input.excludeCheckoutSessionId
        ? {
          stripeCheckoutSessionId: {
            not: input.excludeCheckoutSessionId,
          },
        }
        : {}),
    },
    data: {
      status: HostedBillingCheckoutStatus.superseded,
      supersededAt: new Date(),
    },
  });
}

export async function createHostedBillingAttempt(input: {
  checkoutUrl: string;
  inviteId: string;
  memberId: string;
  mode: HostedBillingMode;
  priceId: string;
  prisma: HostedBillingAttemptClient;
  stripeCheckoutSessionId: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
}) {
  return input.prisma.hostedBillingCheckout.create({
    data: {
      id: generateHostedCheckoutId(),
      memberId: input.memberId,
      inviteId: input.inviteId,
      stripeCheckoutSessionId: input.stripeCheckoutSessionId,
      stripeCustomerId: input.stripeCustomerId,
      stripeSubscriptionId: input.stripeSubscriptionId,
      priceId: input.priceId,
      mode: input.mode,
      status: HostedBillingCheckoutStatus.open,
      checkoutUrl: input.checkoutUrl,
    },
  });
}

export async function completeHostedBillingAttemptBySessionId(input: {
  amountTotal: number | null;
  completedAt?: Date;
  currency: string | null;
  prisma: HostedBillingAttemptClient;
  stripeCheckoutSessionId: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
}) {
  await input.prisma.hostedBillingCheckout.updateMany({
    where: {
      stripeCheckoutSessionId: input.stripeCheckoutSessionId,
    },
    data: {
      amountTotal: input.amountTotal,
      completedAt: input.completedAt ?? new Date(),
      currency: input.currency,
      status: HostedBillingCheckoutStatus.completed,
      stripeCustomerId: input.stripeCustomerId,
      stripeSubscriptionId: input.stripeSubscriptionId,
    },
  });
}

export async function expireHostedBillingAttemptBySessionId(input: {
  expiredAt?: Date;
  prisma: HostedBillingAttemptClient;
  stripeCheckoutSessionId: string;
}) {
  await input.prisma.hostedBillingCheckout.updateMany({
    where: {
      stripeCheckoutSessionId: input.stripeCheckoutSessionId,
      status: HostedBillingCheckoutStatus.open,
    },
    data: {
      expiredAt: input.expiredAt ?? new Date(),
      status: HostedBillingCheckoutStatus.expired,
    },
  });
}
