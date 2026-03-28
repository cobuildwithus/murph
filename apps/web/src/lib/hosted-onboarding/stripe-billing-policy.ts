import {
  HostedBillingCheckoutStatus,
  HostedBillingMode,
  HostedBillingStatus,
  HostedInviteStatus,
  HostedMemberStatus,
  type HostedMember,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";
import type Stripe from "stripe";

import {
  coerceStripeObjectId,
  coerceStripeSubscriptionId,
  mapStripeSubscriptionStatusToHostedBillingStatus,
} from "./billing";
import { buildHostedMemberActivationDispatch } from "./member-service";
import { revokeHostedSessionsForMember } from "./session";
import { normalizeNullableString } from "./shared";
import {
  requireHostedOnboardingStripeClient,
} from "./runtime";
import {
  createHostedWebhookDispatchSideEffect,
  createHostedWebhookRevnetIssuanceSideEffect,
  type HostedWebhookSideEffect,
} from "./webhook-receipts";
import { isHostedOnboardingRevnetEnabled } from "./revnet";

type HostedStripeDispatchContext = {
  eventCreatedAt: Date;
  occurredAt: string;
  sourceEventId: string;
  sourceType: string;
};

type HostedOnboardingPrismaClient = PrismaClient | Prisma.TransactionClient;

export async function applyStripeCheckoutCompleted(
  session: Stripe.Checkout.Session,
  dispatchContext: HostedStripeDispatchContext,
  prisma: HostedOnboardingPrismaClient,
): Promise<HostedWebhookSideEffect[]> {
  const desiredSideEffects: HostedWebhookSideEffect[] = [];
  const member = await findMemberForStripeObject({
    clientReferenceId: normalizeNullableString(session.client_reference_id),
    customerId: typeof session.customer === "string" ? session.customer : session.customer?.id ?? null,
    memberId: normalizeNullableString(session.metadata?.memberId),
    prisma,
    subscriptionId: coerceStripeSubscriptionId(session.subscription),
  });
  const inviteId = normalizeNullableString(session.metadata?.inviteId);
  const billingStatus = resolveHostedCheckoutCompletedBillingStatus({
    currentBillingStatus: member?.billingStatus ?? null,
    mode: session.mode,
    paymentStatus: session.payment_status,
    revnetSubscription:
      isHostedOnboardingRevnetEnabled() && session.mode === "subscription",
  });
  let updatedMember: HostedMember | null = null;

  if (member) {
    updatedMember = await updateHostedMemberStripeBillingIfFresh({
      member,
      prisma,
      dispatchContext,
      data: {
        billingMode: session.mode === "subscription" ? HostedBillingMode.subscription : HostedBillingMode.payment,
        billingStatus,
        status: resolveHostedMemberStatusForBillingStatus(member.status, billingStatus),
        stripeCustomerId: typeof session.customer === "string" ? session.customer : session.customer?.id ?? member.stripeCustomerId,
        stripeSubscriptionId: coerceStripeSubscriptionId(session.subscription) ?? member.stripeSubscriptionId,
        stripeLatestCheckoutSessionId: session.id,
      },
    });

    if (
      updatedMember &&
      updatedMember.status !== HostedMemberStatus.suspended &&
      billingStatus === HostedBillingStatus.active &&
      !(isHostedOnboardingRevnetEnabled() && session.mode === "subscription")
    ) {
      desiredSideEffects.push(
        createHostedWebhookDispatchSideEffect({
          dispatch: buildHostedMemberActivationDispatch({
            memberId: updatedMember.id,
            occurredAt: dispatchContext.occurredAt,
            sourceEventId: dispatchContext.sourceEventId,
            sourceType: "stripe.checkout.session.completed",
          }),
        }),
      );
    }
  }

  await prisma.hostedBillingCheckout.updateMany({
    where: {
      stripeCheckoutSessionId: session.id,
    },
    data: {
      amountTotal: session.amount_total ?? null,
      completedAt: new Date(),
      currency: session.currency ?? null,
      status: HostedBillingCheckoutStatus.completed,
      stripeCustomerId: typeof session.customer === "string" ? session.customer : session.customer?.id ?? null,
      stripeSubscriptionId: coerceStripeSubscriptionId(session.subscription),
    },
  });

  if (inviteId && updatedMember && billingStatus === HostedBillingStatus.active) {
    await prisma.hostedInvite.updateMany({
      where: { id: inviteId },
      data: {
        paidAt: new Date(),
        status: HostedInviteStatus.paid,
      },
    });
  }

  return desiredSideEffects;
}

export async function applyStripeCheckoutExpired(
  session: Stripe.Checkout.Session,
  dispatchContext: HostedStripeDispatchContext,
  prisma: HostedOnboardingPrismaClient,
): Promise<void> {
  await prisma.hostedBillingCheckout.updateMany({
    where: {
      stripeCheckoutSessionId: session.id,
    },
    data: {
      expiredAt: new Date(),
      status: HostedBillingCheckoutStatus.expired,
    },
  });

  const member = await findMemberForStripeObject({
    clientReferenceId: normalizeNullableString(session.client_reference_id),
    customerId: typeof session.customer === "string" ? session.customer : session.customer?.id ?? null,
    memberId: normalizeNullableString(session.metadata?.memberId),
    prisma,
    subscriptionId: coerceStripeSubscriptionId(session.subscription),
  });

  if (
    member &&
    member.billingStatus === HostedBillingStatus.checkout_open &&
    member.stripeLatestCheckoutSessionId === session.id
  ) {
    await updateHostedMemberStripeBillingIfFresh({
      member,
      prisma,
      dispatchContext,
      data: {
        billingStatus: HostedBillingStatus.not_started,
        stripeLatestCheckoutSessionId: session.id,
      },
    });
  }
}

export async function applyStripeSubscriptionUpdated(
  subscription: Stripe.Subscription,
  dispatchContext: HostedStripeDispatchContext,
  prisma: HostedOnboardingPrismaClient,
): Promise<HostedWebhookSideEffect[]> {
  const desiredSideEffects: HostedWebhookSideEffect[] = [];
  const member = await findMemberForStripeObject({
    clientReferenceId: null,
    customerId: typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id,
    memberId: normalizeNullableString(subscription.metadata?.memberId),
    prisma,
    subscriptionId: subscription.id,
  });

  if (!member) {
    return desiredSideEffects;
  }

  const billingStatus = resolveHostedSubscriptionBillingStatus({
    currentBillingStatus: member.billingStatus,
    nextBillingStatus: mapStripeSubscriptionStatusToHostedBillingStatus(subscription.status),
    revnetEnabled: isHostedOnboardingRevnetEnabled(),
  });

  const updatedMember = await updateHostedMemberStripeBillingIfFresh({
    member,
    prisma,
    dispatchContext,
    data: {
      billingMode: HostedBillingMode.subscription,
      billingStatus,
      status: resolveHostedMemberStatusForBillingStatus(member.status, billingStatus),
      stripeCustomerId:
        typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id,
      stripeSubscriptionId: subscription.id,
    },
  });

  if (!updatedMember) {
    return desiredSideEffects;
  }

  if (
    updatedMember.status === HostedMemberStatus.suspended &&
    member.status !== HostedMemberStatus.suspended &&
    shouldSuspendHostedMemberForBillingStatus(billingStatus)
  ) {
    await revokeHostedSessionsForMember({
      memberId: updatedMember.id,
      prisma,
      reason: `billing_status:${billingStatus}`,
    });
  }

  if (
    updatedMember.status !== HostedMemberStatus.suspended &&
    billingStatus === HostedBillingStatus.active &&
    !isHostedOnboardingRevnetEnabled()
  ) {
    desiredSideEffects.push(
      createHostedWebhookDispatchSideEffect({
        dispatch: buildHostedMemberActivationDispatch({
          memberId: updatedMember.id,
          occurredAt: dispatchContext.occurredAt,
          sourceEventId: dispatchContext.sourceEventId,
          sourceType: dispatchContext.sourceType,
        }),
      }),
    );
  }
  await prisma.hostedBillingCheckout.updateMany({
    where: {
      memberId: member.id,
      stripeSubscriptionId: null,
    },
    data: {
      stripeSubscriptionId: subscription.id,
    },
  });

  return desiredSideEffects;
}

export async function applyStripeInvoicePaid(
  invoice: Stripe.Invoice,
  dispatchContext: HostedStripeDispatchContext,
  prisma: HostedOnboardingPrismaClient,
): Promise<HostedWebhookSideEffect[]> {
  const desiredSideEffects: HostedWebhookSideEffect[] = [];
  const subscriptionId = resolveStripeInvoiceSubscriptionId(invoice);
  const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id ?? null;
  const member = await findMemberForStripeObject({
    clientReferenceId: null,
    customerId,
    memberId: null,
    prisma,
    subscriptionId,
  });

  if (!member) {
    return desiredSideEffects;
  }

  if (isHostedOnboardingRevnetEnabled()) {
    desiredSideEffects.push(
      createHostedWebhookRevnetIssuanceSideEffect({
        amountPaid: typeof invoice.amount_paid === "number" ? invoice.amount_paid : 0,
        chargeId: coerceStripeObjectId(
          (invoice as Stripe.Invoice & { charge?: string | { id?: unknown } | null }).charge ?? null,
        ),
        currency: normalizeNullableString(invoice.currency)?.toLowerCase() ?? null,
        invoiceId: invoice.id,
        memberId: member.id,
        paymentIntentId: coerceStripeObjectId(
          (invoice as Stripe.Invoice & { payment_intent?: string | { id?: unknown } | null }).payment_intent ??
            null,
        ),
      }),
    );
  }

  const updatedMember = await updateHostedMemberStripeBillingIfFresh({
    member,
    prisma,
    dispatchContext,
    data: {
      billingMode: subscriptionId ? HostedBillingMode.subscription : member.billingMode,
      billingStatus: HostedBillingStatus.active,
      status: resolveHostedMemberStatusForBillingStatus(member.status, HostedBillingStatus.active),
      stripeCustomerId: customerId ?? member.stripeCustomerId,
      stripeSubscriptionId: subscriptionId ?? member.stripeSubscriptionId,
    },
  });

  if (!updatedMember) {
    return desiredSideEffects;
  }

  if (updatedMember.status === HostedMemberStatus.suspended) {
    return desiredSideEffects;
  }
  await prisma.hostedInvite.updateMany({
    where: {
      memberId: member.id,
      paidAt: null,
    },
    data: {
      paidAt: new Date(),
      status: HostedInviteStatus.paid,
    },
  });
  desiredSideEffects.push(
    createHostedWebhookDispatchSideEffect({
      dispatch: buildHostedMemberActivationDispatch({
        memberId: updatedMember.id,
        occurredAt: dispatchContext.occurredAt,
        sourceEventId: dispatchContext.sourceEventId,
        sourceType: "stripe.invoice.paid",
      }),
    }),
  );

  return desiredSideEffects;
}

export async function applyStripeInvoicePaymentFailed(
  invoice: Stripe.Invoice,
  dispatchContext: HostedStripeDispatchContext,
  prisma: HostedOnboardingPrismaClient,
): Promise<void> {
  const subscriptionId = resolveStripeInvoiceSubscriptionId(invoice);
  const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id ?? null;
  const member = await findMemberForStripeObject({
    clientReferenceId: null,
    customerId,
    memberId: null,
    prisma,
    subscriptionId,
  });

  if (!member) {
    return;
  }

  await updateHostedMemberStripeBillingIfFresh({
    member,
    prisma,
    dispatchContext,
    data: {
      billingStatus: member.billingMode === HostedBillingMode.subscription
        ? HostedBillingStatus.past_due
        : HostedBillingStatus.incomplete,
      stripeCustomerId: customerId ?? member.stripeCustomerId,
      stripeSubscriptionId: subscriptionId ?? member.stripeSubscriptionId,
    },
  });
}

export async function applyStripeRefundCreated(
  refund: Stripe.Refund,
  dispatchContext: Pick<HostedStripeDispatchContext, "eventCreatedAt" | "sourceEventId" | "sourceType">,
  prisma: HostedOnboardingPrismaClient,
): Promise<void> {
  const customerContext = await resolveStripeCustomerContext({
    chargeId: coerceStripeObjectId(refund.charge),
    paymentIntentId: coerceStripeObjectId(refund.payment_intent),
  });
  const member = await findMemberForStripeReversal({
    chargeId: coerceStripeObjectId(refund.charge),
    customerId: customerContext.customerId,
    paymentIntentId: coerceStripeObjectId(refund.payment_intent),
    prisma,
    subscriptionId: null,
  });

  if (!member) {
    return;
  }

  await suspendHostedMemberForBillingReversal({
    dispatchContext,
    member,
    prisma,
    reason: dispatchContext.sourceType,
    stripeCustomerId: customerContext.customerId,
  });
}

export async function applyStripeDisputeUpdated(
  dispute: Stripe.Dispute,
  dispatchContext: Pick<HostedStripeDispatchContext, "eventCreatedAt" | "sourceEventId" | "sourceType">,
  prisma: HostedOnboardingPrismaClient,
): Promise<void> {
  const paymentIntentId = coerceStripeObjectId(dispute.payment_intent);
  const chargeId = coerceStripeObjectId(dispute.charge);
  const customerContext = await resolveStripeCustomerContext({
    chargeId,
    paymentIntentId,
  });
  const member = await findMemberForStripeReversal({
    chargeId,
    customerId: customerContext.customerId,
    paymentIntentId,
    prisma,
    subscriptionId: null,
  });

  if (!member) {
    return;
  }

  await suspendHostedMemberForBillingReversal({
    dispatchContext,
    member,
    prisma,
    reason: dispatchContext.sourceType,
    stripeCustomerId: customerContext.customerId,
  });
}

function resolveHostedCheckoutCompletedBillingStatus(input: {
  currentBillingStatus: HostedBillingStatus | null;
  mode: Stripe.Checkout.Session.Mode | null;
  paymentStatus: Stripe.Checkout.Session.PaymentStatus | null;
  revnetSubscription: boolean;
}): HostedBillingStatus {
  if (input.mode === "subscription") {
    const paymentSettled =
      input.paymentStatus === "paid" || input.paymentStatus === "no_payment_required";

    if (!paymentSettled) {
      return HostedBillingStatus.incomplete;
    }

    if (
      input.revnetSubscription &&
      input.currentBillingStatus !== HostedBillingStatus.active
    ) {
      return HostedBillingStatus.incomplete;
    }

    return HostedBillingStatus.active;
  }

  return input.paymentStatus === "paid"
    ? HostedBillingStatus.active
    : HostedBillingStatus.checkout_open;
}

function resolveHostedSubscriptionBillingStatus(input: {
  currentBillingStatus: HostedBillingStatus;
  nextBillingStatus: HostedBillingStatus;
  revnetEnabled: boolean;
}): HostedBillingStatus {
  if (
    input.revnetEnabled &&
    input.nextBillingStatus === HostedBillingStatus.active &&
    input.currentBillingStatus !== HostedBillingStatus.active
  ) {
    return HostedBillingStatus.incomplete;
  }

  return input.nextBillingStatus;
}

function resolveHostedMemberStatusForBillingStatus(
  currentStatus: HostedMemberStatus,
  billingStatus: HostedBillingStatus,
): HostedMemberStatus {
  if (currentStatus === HostedMemberStatus.suspended) {
    return HostedMemberStatus.suspended;
  }

  if (shouldSuspendHostedMemberForBillingStatus(billingStatus)) {
    return HostedMemberStatus.suspended;
  }

  return billingStatus === HostedBillingStatus.active
    ? HostedMemberStatus.active
    : currentStatus;
}

function shouldSuspendHostedMemberForBillingStatus(
  billingStatus: HostedBillingStatus,
): boolean {
  return (
    billingStatus === HostedBillingStatus.canceled ||
    billingStatus === HostedBillingStatus.paused ||
    billingStatus === HostedBillingStatus.unpaid
  );
}

async function updateHostedMemberStripeBillingIfFresh(input: {
  data: Prisma.HostedMemberUpdateInput;
  dispatchContext: HostedStripeDispatchContext;
  member: HostedMember;
  prisma: HostedOnboardingPrismaClient;
}): Promise<HostedMember | null> {
  if (typeof input.prisma.hostedMember.updateMany !== "function") {
    return input.prisma.hostedMember.update({
      where: {
        id: input.member.id,
      },
      data: {
        ...input.data,
        stripeLatestBillingEventCreatedAt: input.dispatchContext.eventCreatedAt,
        stripeLatestBillingEventId: input.dispatchContext.sourceEventId,
      },
    });
  }

  const freshnessWhere: Prisma.HostedMemberWhereInput = {
    id: input.member.id,
    OR: [
      {
        stripeLatestBillingEventCreatedAt: null,
      },
      {
        stripeLatestBillingEventCreatedAt: {
          lt: input.dispatchContext.eventCreatedAt,
        },
      },
      {
        stripeLatestBillingEventCreatedAt: input.dispatchContext.eventCreatedAt,
        stripeLatestBillingEventId: input.dispatchContext.sourceEventId,
      },
    ],
  };
  const updateResult = await input.prisma.hostedMember.updateMany({
    where: freshnessWhere,
    data: {
      ...input.data,
      stripeLatestBillingEventCreatedAt: input.dispatchContext.eventCreatedAt,
      stripeLatestBillingEventId: input.dispatchContext.sourceEventId,
    },
  });

  if (updateResult.count !== 1) {
    return null;
  }

  return input.prisma.hostedMember.findUnique({
    where: {
      id: input.member.id,
    },
  });
}

function resolveStripeInvoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  return coerceStripeObjectId(
    (
      invoice as Stripe.Invoice & {
        parent?: {
          subscription_details?: {
            subscription?: unknown;
          } | null;
        } | null;
      }
    ).parent?.subscription_details?.subscription ?? null,
  );
}

async function suspendHostedMemberForBillingReversal(input: {
  dispatchContext: Pick<HostedStripeDispatchContext, "eventCreatedAt" | "sourceEventId">;
  member: HostedMember;
  prisma: HostedOnboardingPrismaClient;
  reason: string;
  stripeCustomerId?: string | null;
}): Promise<void> {
  const updatedMember = await updateHostedMemberStripeBillingIfFresh({
    member: input.member,
    prisma: input.prisma,
    dispatchContext: {
      eventCreatedAt: input.dispatchContext.eventCreatedAt,
      occurredAt: input.dispatchContext.eventCreatedAt.toISOString(),
      sourceEventId: input.dispatchContext.sourceEventId,
      sourceType: input.reason,
    },
    data: {
      billingStatus: HostedBillingStatus.unpaid,
      status: HostedMemberStatus.suspended,
      stripeCustomerId: input.stripeCustomerId ?? input.member.stripeCustomerId,
    },
  });

  if (!updatedMember) {
    return;
  }

  await revokeHostedSessionsForMember({
    memberId: updatedMember.id,
    prisma: input.prisma,
    reason: `billing_reversal:${input.reason}`,
  });
}

async function findMemberForStripeObject(input: {
  clientReferenceId: string | null;
  customerId: string | null;
  memberId: string | null;
  prisma: HostedOnboardingPrismaClient;
  subscriptionId: string | null;
}): Promise<HostedMember | null> {
  if (input.memberId) {
    const member = await input.prisma.hostedMember.findUnique({
      where: {
        id: input.memberId,
      },
    });

    if (member) {
      return member;
    }
  }

  if (input.clientReferenceId) {
    const member = await input.prisma.hostedMember.findUnique({
      where: {
        id: input.clientReferenceId,
      },
    });

    if (member) {
      return member;
    }
  }

  if (input.subscriptionId) {
    const member = await input.prisma.hostedMember.findUnique({
      where: {
        stripeSubscriptionId: input.subscriptionId,
      },
    });

    if (member) {
      return member;
    }
  }

  if (input.customerId) {
    const member = await input.prisma.hostedMember.findUnique({
      where: {
        stripeCustomerId: input.customerId,
      },
    });

    if (member) {
      return member;
    }
  }

  return null;
}

async function findMemberForStripeReversal(input: {
  chargeId: string | null;
  customerId: string | null;
  paymentIntentId: string | null;
  prisma: HostedOnboardingPrismaClient;
  subscriptionId: string | null;
}): Promise<HostedMember | null> {
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

  return issuance?.member ?? null;
}

async function resolveStripeCustomerContext(input: {
  chargeId: string | null;
  paymentIntentId: string | null;
}): Promise<{ customerId: string | null }> {
  if (input.chargeId) {
    const stripe = resolveStripeCustomerLookupClient();
    const charge = await stripe.charges.retrieve(input.chargeId);

    return {
      customerId: coerceStripeObjectId((charge as Stripe.Charge & { customer?: unknown }).customer ?? null),
    };
  }

  if (input.paymentIntentId) {
    const stripe = resolveStripeCustomerLookupClient();
    const paymentIntent = await stripe.paymentIntents.retrieve(input.paymentIntentId);

    return {
      customerId: coerceStripeObjectId(
        (paymentIntent as Stripe.PaymentIntent & { customer?: unknown }).customer ?? null,
      ),
    };
  }

  return {
    customerId: null,
  };
}

function resolveStripeCustomerLookupClient() {
  const { stripe } = requireHostedOnboardingStripeClient();

  return {
    charges: stripe.charges,
    paymentIntents: stripe.paymentIntents,
  };
}
