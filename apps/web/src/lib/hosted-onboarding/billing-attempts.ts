import {
  HostedBillingCheckoutStatus,
  type HostedBillingCheckout,
  type HostedBillingMode,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";

import { generateHostedCheckoutId } from "./shared";

type HostedBillingAttemptClient = PrismaClient | Prisma.TransactionClient;

export async function findActiveHostedBillingAttemptForMember(input: {
  memberId: string;
  prisma: HostedBillingAttemptClient;
}): Promise<HostedBillingCheckout | null> {
  return input.prisma.hostedBillingCheckout.findFirst({
    where: {
      memberId: input.memberId,
      status: {
        in: [
          HostedBillingCheckoutStatus.pending,
          HostedBillingCheckoutStatus.open,
        ],
      },
    } as Prisma.HostedBillingCheckoutWhereInput,
    orderBy: {
      createdAt: "desc",
    },
  });
}

export async function createPendingHostedBillingAttempt(input: {
  hasShareContext: boolean;
  inviteId: string;
  memberId: string;
  mode: HostedBillingMode;
  priceId: string;
  prisma: HostedBillingAttemptClient;
  stripeCustomerId: string | null;
}): Promise<HostedBillingCheckout> {
  const data = {
    id: generateHostedCheckoutId(),
    hasShareContext: input.hasShareContext,
    memberId: input.memberId,
    inviteId: input.inviteId,
    stripeCheckoutSessionId: null,
    stripeCustomerId: input.stripeCustomerId,
    stripeSubscriptionId: null,
    priceId: input.priceId,
    mode: input.mode,
    status: HostedBillingCheckoutStatus.pending,
    checkoutUrl: null,
  } as Prisma.HostedBillingCheckoutUncheckedCreateInput;

  return input.prisma.hostedBillingCheckout.create({
    data,
  });
}

export async function finalizeHostedBillingAttemptById(input: {
  checkoutId: string;
  checkoutUrl: string;
  prisma: HostedBillingAttemptClient;
  stripeCheckoutSessionId: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
}) {
  return input.prisma.hostedBillingCheckout.update({
    where: {
      id: input.checkoutId,
    },
    data: {
      checkoutUrl: input.checkoutUrl,
      status: HostedBillingCheckoutStatus.open,
      stripeCheckoutSessionId: input.stripeCheckoutSessionId,
      stripeCustomerId: input.stripeCustomerId,
      stripeSubscriptionId: input.stripeSubscriptionId,
    },
  });
}

export async function failHostedBillingAttemptById(input: {
  checkoutId: string;
  prisma: HostedBillingAttemptClient;
  statuses?: HostedBillingCheckoutStatus[];
  stripeCheckoutSessionId?: string | null;
}) {
  await input.prisma.hostedBillingCheckout.updateMany({
    where: {
      id: input.checkoutId,
      status: {
        in: input.statuses ?? [HostedBillingCheckoutStatus.pending],
      },
    },
    data: {
      checkoutUrl: null,
      status: HostedBillingCheckoutStatus.failed,
      ...(input.stripeCheckoutSessionId
        ? {
          stripeCheckoutSessionId: input.stripeCheckoutSessionId,
        }
        : {}),
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
      checkoutUrl: null,
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
      checkoutUrl: null,
      expiredAt: input.expiredAt ?? new Date(),
      status: HostedBillingCheckoutStatus.expired,
    },
  });
}
