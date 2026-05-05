import {
  HostedBillingStatus,
  Prisma,
} from "@prisma/client";
import type Stripe from "stripe";

import {
  coerceStripeInvoiceSubscriptionId,
  coerceStripeObjectId,
  coerceStripeSubscriptionId,
  mapStripeSubscriptionStatusToHostedBillingStatus,
} from "./billing";
import { isHostedAccessBlockedBillingStatus } from "./entitlement";
import {
  activateHostedMemberForPositiveSourceTx,
} from "./member-activation";
import {
  upsertHostedMemberStripeCheckoutEmailIfFreshTx,
} from "./hosted-member-store";
import {
  findMemberForStripeCheckoutSession,
  findMemberForStripeInvoice,
  findMemberForStripeSubscription,
  findMemberForStripeReversal,
} from "./stripe-billing-lookup";
import {
  prepareHostedMemberStripeBillingWrite,
  suspendHostedMemberForBillingReversalTx,
  writeHostedMemberStripeBillingRefIfFreshTx,
  writeHostedMemberStripeBillingTx,
} from "./stripe-billing-policy";
import {
  type HostedStripeDispatchContext,
} from "./stripe-dispatch";

type HostedStripeActivationOutcome = {
  activatedMemberId: string | null;
  hostedExecutionEventId: string | null;
};

export async function applyStripeCheckoutCompleted(
  session: Stripe.Checkout.Session,
  prisma: Prisma.TransactionClient,
): Promise<HostedStripeActivationOutcome> {
  const member = await findMemberForStripeCheckoutSession({
    prisma,
    session,
  });

  if (!member) {
    return {
      activatedMemberId: null,
      hostedExecutionEventId: null,
    };
  }

  await bindHostedStripeBillingRefsFromCheckoutSessionTx({
    memberId: member.core.id,
    session,
    tx: prisma,
  });

  return {
    activatedMemberId: null,
    hostedExecutionEventId: null,
  };
}

export async function bindHostedStripeBillingRefsFromCheckoutSessionTx(input: {
  memberId: string;
  session: Stripe.Checkout.Session;
  tx: Prisma.TransactionClient;
}) {
  const dispatchContext = buildHostedStripeCheckoutSessionFreshness(input.session);
  const billingSnapshot = await writeHostedMemberStripeBillingRefIfFreshTx({
    dispatchContext,
    memberId: input.memberId,
    stripeCustomerId: coerceStripeObjectId(input.session.customer) ?? undefined,
    stripeSubscriptionId: coerceStripeSubscriptionId(input.session.subscription) ?? undefined,
    tx: input.tx,
  });

  await writeHostedStripeCheckoutEmailIfPresentTx({
    collectedAt: dispatchContext.eventCreatedAt,
    memberId: input.memberId,
    stripeEmailAddress: readHostedStripeCheckoutSessionEmailAddress(input.session),
    tx: input.tx,
  });

  return billingSnapshot;
}

export async function applyStripeCheckoutExpired(
  session: Stripe.Checkout.Session,
  prisma: Prisma.TransactionClient,
): Promise<void> {
  void session;
  void prisma;
}

export async function applyStripeSubscriptionUpdated(
  subscription: Stripe.Subscription,
  dispatchContext: HostedStripeDispatchContext,
  prisma: Prisma.TransactionClient,
): Promise<void> {
  const member = await findMemberForStripeSubscription({
    prisma,
    subscription,
  });

  if (!member) {
    return;
  }

  const {
    canonicalBillingStatus: resolvedCanonicalBillingStatus,
    member: preparedMember,
  } = await prepareHostedMemberStripeBillingWrite({
    canonicalBillingStatus: mapStripeSubscriptionStatusToHostedBillingStatus(subscription.status),
    dispatchContext,
    member,
  });

  await writeHostedMemberStripeBillingTx({
    billingStatus: member.core.billingStatus,
    canonicalBillingStatus: resolvedCanonicalBillingStatus,
    dispatchContext,
    member: preparedMember,
    stripeCustomerId: coerceStripeObjectId(subscription.customer) ?? member.billingRef?.stripeCustomerId ?? null,
    stripeSubscriptionId: subscription.id,
    tx: prisma,
  });
}

export async function applyStripeInvoicePaid(
  invoice: Stripe.Invoice,
  dispatchContext: HostedStripeDispatchContext,
  prisma: Prisma.TransactionClient,
  canonicalBillingStatus?: HostedBillingStatus | null,
  canonicalSubscription?: Stripe.Subscription | null,
): Promise<HostedStripeActivationOutcome> {
  const subscriptionId = coerceStripeInvoiceSubscriptionId(invoice);
  const member = await findMemberForStripeInvoice({
    invoice,
    prisma,
    subscription: canonicalSubscription,
  });

  if (!member || !subscriptionId) {
    return {
      activatedMemberId: null,
      hostedExecutionEventId: null,
    };
  }

  const hadActiveBilling = member.core.billingStatus === HostedBillingStatus.active;
  const startingBillingStatus = member.core.billingStatus;
  const {
    canonicalBillingStatus: resolvedCanonicalBillingStatus,
    member: preparedMember,
  } = await prepareHostedMemberStripeBillingWrite({
    canonicalBillingStatus,
    dispatchContext,
    member,
  });
  const updatedMember = await writeHostedMemberStripeBillingTx({
    billingStatus: HostedBillingStatus.active,
    canonicalBillingStatus: resolvedCanonicalBillingStatus,
    dispatchContext,
    freshnessPolicy: "positive-invoice-entitlement",
    member: preparedMember,
    stripeCustomerId:
      coerceStripeObjectId(invoice.customer)
      ?? coerceStripeObjectId(canonicalSubscription?.customer)
      ?? member.billingRef?.stripeCustomerId
      ?? null,
    stripeSubscriptionId: subscriptionId,
    tx: prisma,
  });

  if (!updatedMember) {
    return {
      activatedMemberId: null,
      hostedExecutionEventId: null,
    };
  }

  await writeHostedStripeCheckoutEmailIfPresentTx({
    collectedAt: dispatchContext.eventCreatedAt,
    memberId: updatedMember.core.id,
    stripeEmailAddress: readHostedStripeInvoiceEmailAddress(invoice),
    tx: prisma,
  });

  if (isHostedAccessBlockedBillingStatus(startingBillingStatus)) {
    return {
      activatedMemberId: null,
      hostedExecutionEventId: null,
    };
  }

  const activation = await activateHostedMemberForPositiveSourceTx({
    dispatchContext: buildHostedStripeInvoiceActivationDispatchContext(invoice, dispatchContext),
    memberId: updatedMember.core.id,
    prisma,
    skipIfBillingAlreadyActive: hadActiveBilling,
  });

  return {
    activatedMemberId: activation.activated ? updatedMember.core.id : null,
    hostedExecutionEventId: activation.hostedExecutionEventId,
  };
}

export async function applyStripeInvoicePaymentFailed(
  invoice: Stripe.Invoice,
  dispatchContext: HostedStripeDispatchContext,
  prisma: Prisma.TransactionClient,
  canonicalBillingStatus?: HostedBillingStatus | null,
  canonicalSubscription?: Stripe.Subscription | null,
): Promise<void> {
  const subscriptionId = coerceStripeInvoiceSubscriptionId(invoice);
  const member = await findMemberForStripeInvoice({
    invoice,
    prisma,
    subscription: canonicalSubscription,
  });

  if (!member) {
    return;
  }

  const {
    canonicalBillingStatus: resolvedCanonicalBillingStatus,
    member: preparedMember,
  } = await prepareHostedMemberStripeBillingWrite({
    canonicalBillingStatus,
    dispatchContext,
    member,
  });

  await writeHostedMemberStripeBillingTx({
    billingStatus: HostedBillingStatus.past_due,
    canonicalBillingStatus: resolvedCanonicalBillingStatus,
    dispatchContext,
    member: preparedMember,
    stripeCustomerId:
      coerceStripeObjectId(invoice.customer)
      ?? coerceStripeObjectId(canonicalSubscription?.customer)
      ?? member.billingRef?.stripeCustomerId
      ?? null,
    stripeSubscriptionId: subscriptionId ?? member.billingRef?.stripeSubscriptionId ?? null,
    tx: prisma,
  });
}

export async function applyStripeRefundCreated(
  refund: Stripe.Refund,
  dispatchContext: Pick<HostedStripeDispatchContext, "eventCreatedAt" | "sourceEventId" | "sourceType">,
  prisma: Prisma.TransactionClient,
  customerId?: string | null,
): Promise<void> {
  const member = await findMemberForStripeReversal({
    chargeId: coerceStripeObjectId(refund.charge),
    customerId: customerId ?? null,
    paymentIntentId: coerceStripeObjectId(refund.payment_intent),
    prisma,
    subscriptionId: null,
  });

  if (!member) {
    return;
  }

  const { canonicalBillingStatus, member: preparedMember } = await prepareHostedMemberStripeBillingWrite({
    dispatchContext: {
      eventCreatedAt: dispatchContext.eventCreatedAt,
      occurredAt: dispatchContext.eventCreatedAt.toISOString(),
      sourceEventId: dispatchContext.sourceEventId,
      sourceType: dispatchContext.sourceType,
    },
    member,
  });

  await suspendHostedMemberForBillingReversalTx({
    canonicalBillingStatus,
    dispatchContext,
    member: preparedMember,
    stripeCustomerId: customerId ?? undefined,
    tx: prisma,
  });
}

async function writeHostedStripeCheckoutEmailIfPresentTx(input: {
  collectedAt: Date;
  memberId: string;
  stripeEmailAddress: string | null;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  if (!input.stripeEmailAddress) {
    return;
  }

  await upsertHostedMemberStripeCheckoutEmailIfFreshTx({
    address: input.stripeEmailAddress,
    collectedAt: input.collectedAt,
    memberId: input.memberId,
    prisma: input.tx,
  });
}

function readHostedStripeCheckoutSessionEmailAddress(
  session: Stripe.Checkout.Session,
): string | null {
  return normalizeHostedStripeEmailAddress(
    session.customer_details?.email ?? session.customer_email ?? null,
  );
}

function readHostedStripeInvoiceEmailAddress(invoice: Stripe.Invoice): string | null {
  return normalizeHostedStripeEmailAddress(invoice.customer_email ?? null);
}

function normalizeHostedStripeEmailAddress(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function buildHostedStripeInvoiceActivationDispatchContext(
  invoice: Pick<Stripe.Invoice, "id">,
  dispatchContext: HostedStripeDispatchContext,
): HostedStripeDispatchContext {
  return {
    ...dispatchContext,
    sourceEventId: typeof invoice.id === "string" && invoice.id.length > 0
      ? `invoice:${invoice.id}`
      : dispatchContext.sourceEventId,
  };
}

function buildHostedStripeCheckoutSessionFreshness(
  session: Pick<Stripe.Checkout.Session, "created" | "id">,
): Pick<HostedStripeDispatchContext, "eventCreatedAt" | "sourceEventId"> {
  const eventCreatedAt = Number.isFinite(session.created)
    ? new Date(session.created * 1000)
    : new Date(0);

  return {
    eventCreatedAt,
    sourceEventId: typeof session.id === "string" && session.id.length > 0
      ? `checkout.session:${session.id}`
      : "checkout.session:unknown",
  };
}

export async function applyStripeDisputeUpdated(
  dispute: Stripe.Dispute,
  dispatchContext: Pick<HostedStripeDispatchContext, "eventCreatedAt" | "sourceEventId" | "sourceType">,
  prisma: Prisma.TransactionClient,
  customerId?: string | null,
): Promise<void> {
  const member = await findMemberForStripeReversal({
    chargeId: coerceStripeObjectId(dispute.charge),
    customerId: customerId ?? null,
    paymentIntentId: coerceStripeObjectId(dispute.payment_intent),
    prisma,
    subscriptionId: null,
  });

  if (!member) {
    return;
  }

  const { canonicalBillingStatus, member: preparedMember } = await prepareHostedMemberStripeBillingWrite({
    dispatchContext: {
      eventCreatedAt: dispatchContext.eventCreatedAt,
      occurredAt: dispatchContext.eventCreatedAt.toISOString(),
      sourceEventId: dispatchContext.sourceEventId,
      sourceType: dispatchContext.sourceType,
    },
    member,
  });

  await suspendHostedMemberForBillingReversalTx({
    canonicalBillingStatus,
    dispatchContext,
    member: preparedMember,
    stripeCustomerId: customerId ?? undefined,
    tx: prisma,
  });
}
