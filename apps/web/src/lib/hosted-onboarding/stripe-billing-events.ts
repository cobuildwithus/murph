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
import {
  HOSTED_PULSE_TRIAL_OFFER,
  HOSTED_PULSE_TRIAL_POLICY_VERSION,
  HOSTED_STANDARD_CHECKOUT_OFFER,
  getHostedBillingPlanDefinition,
  HOSTED_BILLING_PLAN_CODES,
  parseHostedBillingCheckoutOffer,
  parseHostedBillingPhase,
  parseHostedBillingPlanCode,
} from "./billing-plans";
import { isHostedAccessBlockedBillingStatus } from "./entitlement";
import {
  activateHostedMemberForPositiveSourceTx,
} from "./member-activation";
import {
  type HostedMemberBillingSnapshot,
  upsertHostedMemberStripeCheckoutEmailIfFreshTx,
} from "./hosted-member-store";
import {
  findMemberForStripeCheckoutSession,
  findMemberForStripeInvoice,
  findMemberForStripeSubscription,
  findMemberForStripeReversal,
  listHostedStripeCheckoutSessionMemberIds,
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
import { requireHostedStripeApi } from "./runtime";

type HostedStripeActivationOutcome = {
  activatedMemberId: string | null;
  hostedExecutionEventId: string | null;
  welcomeEmailMemberId: string | null;
};

export async function applyStripeCheckoutCompleted(
  session: Stripe.Checkout.Session,
  prisma: Prisma.TransactionClient,
  dispatchContext?: HostedStripeDispatchContext,
  checkoutSessionSubscription?: Stripe.Subscription | null,
): Promise<HostedStripeActivationOutcome> {
  const member = await findMemberForStripeCheckoutSession({
    prisma,
    session,
  });

  if (!member) {
    return {
      activatedMemberId: null,
      hostedExecutionEventId: null,
      welcomeEmailMemberId: null,
    };
  }

  if (session.metadata?.checkoutOffer === HOSTED_PULSE_TRIAL_OFFER) {
    return applyPulseTrialCheckoutCompletedTx({
      dispatchContext: dispatchContext ?? buildHostedStripeCheckoutSessionDispatchContext(session),
      member,
      session,
      subscription: checkoutSessionSubscription ?? null,
      tx: prisma,
    });
  }

  await bindHostedStripeBillingRefsFromCheckoutSessionTx({
    dispatchContext: dispatchContext ?? buildHostedStripeCheckoutSessionDispatchContext(session),
    memberId: member.core.id,
    session,
    tx: prisma,
  });

  return {
    activatedMemberId: null,
    hostedExecutionEventId: null,
    welcomeEmailMemberId: member.core.id,
  };
}

export async function bindHostedStripeBillingRefsFromCheckoutSessionTx(input: {
  dispatchContext?: Pick<HostedStripeDispatchContext, "eventCreatedAt" | "sourceEventId">;
  memberId: string;
  session: Stripe.Checkout.Session;
  tx: Prisma.TransactionClient;
}) {
  const dispatchContext = input.dispatchContext ?? buildHostedStripeCheckoutSessionDispatchContext(input.session);
  const billingSnapshot = await writeHostedMemberStripeBillingRefIfFreshTx({
    currentCheckoutOffer: HOSTED_STANDARD_CHECKOUT_OFFER,
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

export async function applyPulseTrialCheckoutCompletedTx(input: {
  dispatchContext: HostedStripeDispatchContext;
  member: HostedMemberBillingSnapshot;
  session: Stripe.Checkout.Session;
  subscription?: Stripe.Subscription | null;
  tx: Prisma.TransactionClient;
}): Promise<HostedStripeActivationOutcome> {
  if (!isPulseTrialCheckoutSessionEntitlementCandidate(input.session, input.member.core.id)) {
    return {
      activatedMemberId: null,
      hostedExecutionEventId: null,
      welcomeEmailMemberId: null,
    };
  }

  const candidateMemberIds = await listHostedStripeCheckoutSessionMemberIds({
    prisma: input.tx,
    session: input.session,
  });
  if (candidateMemberIds.length !== 1 || candidateMemberIds[0] !== input.member.core.id) {
    return {
      activatedMemberId: null,
      hostedExecutionEventId: null,
      welcomeEmailMemberId: null,
    };
  }

  if (input.member.billingRef?.pulseTrialRedeemedAt) {
    return {
      activatedMemberId: null,
      hostedExecutionEventId: null,
      welcomeEmailMemberId: isHostedStripeSamePulseTrialCheckoutSubscription({
        billingRefSubscriptionId: input.member.billingRef.stripeSubscriptionId,
        session: input.session,
      })
        ? input.member.core.id
        : null,
    };
  }

  const subscription = input.subscription ??
    await readHostedStripeCheckoutSessionSubscription(input.session);
  if (!subscription || !isValidPulseTrialCheckoutSubscription({
    eventCreatedAt: input.dispatchContext.eventCreatedAt,
    session: input.session,
    subscription,
  })) {
    return {
      activatedMemberId: null,
      hostedExecutionEventId: null,
      welcomeEmailMemberId: null,
    };
  }

  const currentPeriodStart = readHostedStripeSubscriptionDate(subscription, "current_period_start");
  const currentPeriodEnd = readHostedStripeSubscriptionDate(subscription, "current_period_end");
  const currentTrialStartedAt = readHostedStripeSubscriptionDate(subscription, "trial_start");
  const currentTrialEndsAt = readHostedStripeSubscriptionDate(subscription, "trial_end");
  const currentPeriodSnapshot = buildHostedPulseTrialCheckoutCurrentPeriodSnapshot({
    currentPeriodEnd,
    currentPeriodStart,
    currentTrialEndsAt,
    currentTrialStartedAt,
  });

  if (
    !currentTrialStartedAt ||
    !currentTrialEndsAt ||
    currentTrialStartedAt.getTime() >= currentTrialEndsAt.getTime()
  ) {
    return {
      activatedMemberId: null,
      hostedExecutionEventId: null,
      welcomeEmailMemberId: null,
    };
  }

  const hadActiveBilling = input.member.core.billingStatus === HostedBillingStatus.active;
  const updatedMember = await writeHostedMemberStripeBillingTx({
    billingStatus: HostedBillingStatus.active,
    canonicalBillingStatus: HostedBillingStatus.active,
    currentBillingPhase: "trial",
    currentBillingPlanCode: "launch_monthly",
    currentCheckoutOffer: HOSTED_PULSE_TRIAL_OFFER,
    ...currentPeriodSnapshot,
    currentTrialEndsAt,
    currentTrialStartedAt,
    dispatchContext: input.dispatchContext,
    freshnessPolicy: "trial-checkout-entitlement",
    member: input.member,
    pulseTrialPolicyVersion: HOSTED_PULSE_TRIAL_POLICY_VERSION,
    pulseTrialRedeemedAt: currentTrialStartedAt,
    stripeCustomerId: coerceStripeObjectId(input.session.customer)
      ?? coerceStripeObjectId(subscription.customer)
      ?? null,
    stripeSubscriptionId: subscription.id,
    tx: input.tx,
  });

  if (!updatedMember || hadActiveBilling) {
    if (updatedMember) {
      await writeHostedStripeCheckoutEmailIfPresentTx({
        collectedAt: input.dispatchContext.eventCreatedAt,
        memberId: updatedMember.core.id,
        stripeEmailAddress: readHostedStripeCheckoutSessionEmailAddress(input.session),
        tx: input.tx,
      });
    }

    return {
      activatedMemberId: null,
      hostedExecutionEventId: null,
      welcomeEmailMemberId: null,
    };
  }

  await writeHostedStripeCheckoutEmailIfPresentTx({
    collectedAt: input.dispatchContext.eventCreatedAt,
    memberId: updatedMember.core.id,
    stripeEmailAddress: readHostedStripeCheckoutSessionEmailAddress(input.session),
    tx: input.tx,
  });

  const activation = await activateHostedMemberForPositiveSourceTx({
    dispatchContext: input.dispatchContext,
    memberId: updatedMember.core.id,
    prisma: input.tx,
    skipIfBillingAlreadyActive: false,
  });

  return {
    activatedMemberId: activation.activated ? updatedMember.core.id : null,
    hostedExecutionEventId: activation.hostedExecutionEventId,
    welcomeEmailMemberId: isHostedStripeActivationWelcomeCandidate(activation)
      ? updatedMember.core.id
      : null,
  };
}

function buildHostedPulseTrialCheckoutCurrentPeriodSnapshot(input: {
  currentPeriodEnd: Date | null;
  currentPeriodStart: Date | null;
  currentTrialEndsAt: Date | null;
  currentTrialStartedAt: Date | null;
}): {
  currentPeriodEnd: Date | null;
  currentPeriodStart: Date | null;
} {
  if (
    !input.currentPeriodStart ||
    !input.currentPeriodEnd ||
    !input.currentTrialStartedAt ||
    !input.currentTrialEndsAt
  ) {
    return {
      currentPeriodEnd: null,
      currentPeriodStart: null,
    };
  }

  if (
    input.currentPeriodStart.getTime() >= input.currentPeriodEnd.getTime() ||
    input.currentPeriodStart.getTime() > input.currentTrialStartedAt.getTime() ||
    input.currentPeriodEnd.getTime() < input.currentTrialEndsAt.getTime()
  ) {
    return {
      currentPeriodEnd: null,
      currentPeriodStart: null,
    };
  }

  return {
    currentPeriodEnd: input.currentPeriodEnd,
    currentPeriodStart: input.currentPeriodStart,
  };
}

function isHostedStripeActivationWelcomeCandidate(input: {
  activated: boolean;
  hostedExecutionEventId: string | null;
}): boolean {
  return input.activated || Boolean(input.hostedExecutionEventId);
}

function isHostedStripeSamePulseTrialCheckoutSubscription(input: {
  billingRefSubscriptionId?: string | null;
  session: Stripe.Checkout.Session;
}): boolean {
  const sessionSubscriptionId = coerceStripeSubscriptionId(input.session.subscription);

  return Boolean(
    input.billingRefSubscriptionId &&
    sessionSubscriptionId &&
    input.billingRefSubscriptionId === sessionSubscriptionId,
  );
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
    ...buildHostedStripeSubscriptionBillingPeriodSnapshot(subscription),
    ...buildHostedStripeSubscriptionBillingPhaseSnapshot(
      subscription,
      member,
      dispatchContext.sourceType,
    ),
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
      welcomeEmailMemberId: null,
    };
  }

  if (isHostedStripeInitialPulseTrialInvoice({
    invoice,
    member,
    subscription: canonicalSubscription,
  })) {
    return {
      activatedMemberId: null,
      hostedExecutionEventId: null,
      welcomeEmailMemberId: null,
    };
  }

  if (
    isHostedStripeTrialConversionInvoiceCandidate(member, canonicalSubscription) &&
    !isHostedStripeAcceptedTrialConversionInvoice({
      invoice,
      subscription: canonicalSubscription,
      subscriptionId,
    })
  ) {
    return {
      activatedMemberId: null,
      hostedExecutionEventId: null,
      welcomeEmailMemberId: null,
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
    ...(canonicalSubscription
      ? buildHostedStripeSubscriptionBillingPeriodSnapshot(canonicalSubscription)
      : {}),
    ...(canonicalSubscription
      ? buildHostedStripeInvoicePaidBillingPhaseSnapshot(canonicalSubscription, member, invoice)
      : {}),
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
      welcomeEmailMemberId: null,
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
      welcomeEmailMemberId: null,
    };
  }

  const activation = await activateHostedMemberForPositiveSourceTx({
    dispatchContext: buildHostedStripeInvoiceActivationDispatchContext(invoice, dispatchContext),
    memberId: updatedMember.core.id,
    prisma,
    skipIfBillingAlreadyActive: hadActiveBilling,
    skipIfPreviouslyActivated: true,
  });

  return {
    activatedMemberId: activation.activated ? updatedMember.core.id : null,
    hostedExecutionEventId: activation.hostedExecutionEventId,
    welcomeEmailMemberId: isHostedStripeActivationWelcomeCandidate(activation)
      ? updatedMember.core.id
      : null,
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
    ...(canonicalSubscription
      ? buildHostedStripeSubscriptionBillingPeriodSnapshot(canonicalSubscription)
      : {}),
    ...(canonicalSubscription
      ? buildHostedStripeSubscriptionBillingPhaseSnapshot(canonicalSubscription, member)
      : {}),
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
  if (!isHostedStripeSucceededRefund(refund)) {
    return;
  }

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

  if (!await isHostedStripeCurrentEntitlementFullRefund({
    member,
    refund,
  })) {
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
    stripeCustomerId: customerId ?? member.billingRef?.stripeCustomerId ?? undefined,
    tx: prisma,
  });
}

function isHostedStripeSucceededRefund(refund: Stripe.Refund): boolean {
  return refund.status === "succeeded" && readHostedStripePositiveAmount(refund.amount) !== null;
}

async function isHostedStripeCurrentEntitlementFullRefund(input: {
  member: HostedMemberBillingSnapshot;
  refund: Stripe.Refund;
}): Promise<boolean> {
  const subscription = await readHostedMemberStripeSubscription(input.member);
  if (!subscription || mapStripeSubscriptionStatusToHostedBillingStatus(subscription.status) !== HostedBillingStatus.active) {
    return false;
  }

  const invoice = await readHostedStripeSubscriptionLatestInvoice(subscription);
  if (!invoice || !await hostedStripeRefundMatchesInvoice(input.refund, invoice)) {
    return false;
  }

  const refundAmount = readHostedStripePositiveAmount(input.refund.amount);
  const paidAmount = readHostedStripePositiveAmount((invoice as Stripe.Invoice & { amount_paid?: unknown }).amount_paid);
  return refundAmount !== null && paidAmount !== null && refundAmount >= paidAmount;
}

async function readHostedStripeSubscriptionLatestInvoice(
  subscription: Stripe.Subscription,
): Promise<Stripe.Invoice | null> {
  const latestInvoice = (subscription as Stripe.Subscription & { latest_invoice?: unknown }).latest_invoice;
  if (latestInvoice && typeof latestInvoice === "object") {
    return latestInvoice as Stripe.Invoice;
  }

  const invoiceId = coerceStripeObjectId(latestInvoice);
  if (!invoiceId) {
    return null;
  }

  return requireHostedStripeApi().invoices.retrieve(invoiceId, {
    expand: [
      "payments.data.payment.charge",
      "payments.data.payment.payment_intent",
    ],
  });
}

async function hostedStripeRefundMatchesInvoice(refund: Stripe.Refund, invoice: Stripe.Invoice): Promise<boolean> {
  const payments = readHostedStripeInvoicePayments(invoice);
  if (payments.some((payment) => hostedStripeRefundMatchesInvoicePayment(refund, payment))) {
    return true;
  }

  if (!invoice.id) {
    return false;
  }

  const listedPayments = await requireHostedStripeApi().invoicePayments.list({
    invoice: invoice.id,
    limit: 100,
    status: "paid",
    expand: [
      "data.payment.charge",
      "data.payment.payment_intent",
    ],
  });
  if (listedPayments.data.some((payment) => hostedStripeRefundMatchesInvoicePayment(refund, payment))) {
    return true;
  }

  return hostedStripeRefundMatchesLegacyInvoicePaymentFields(refund, invoice);
}

function readHostedStripeInvoicePayments(invoice: Stripe.Invoice): Stripe.InvoicePayment[] {
  const payments = (invoice as Stripe.Invoice & {
    payments?: { data?: unknown };
  }).payments?.data;
  return Array.isArray(payments)
    ? payments.filter((payment): payment is Stripe.InvoicePayment =>
        Boolean(payment && typeof payment === "object" && !Array.isArray(payment))
      )
    : [];
}

function hostedStripeRefundMatchesInvoicePayment(
  refund: Stripe.Refund,
  invoicePayment: Stripe.InvoicePayment,
): boolean {
  if (invoicePayment.status !== "paid") {
    return false;
  }

  const refundChargeId = coerceStripeObjectId(refund.charge);
  const refundPaymentIntentId = coerceStripeObjectId(refund.payment_intent);
  const invoiceChargeId = coerceUnknownStripeObjectId(invoicePayment.payment.charge);
  const invoicePaymentIntentId = coerceUnknownStripeObjectId(invoicePayment.payment.payment_intent);
  return (
    Boolean(refundChargeId && refundChargeId === invoiceChargeId) ||
    Boolean(refundPaymentIntentId && refundPaymentIntentId === invoicePaymentIntentId)
  );
}

function hostedStripeRefundMatchesLegacyInvoicePaymentFields(
  refund: Stripe.Refund,
  invoice: Stripe.Invoice,
): boolean {
  const refundChargeId = coerceStripeObjectId(refund.charge);
  const refundPaymentIntentId = coerceStripeObjectId(refund.payment_intent);
  const invoiceChargeId = coerceUnknownStripeObjectId(
    (invoice as Stripe.Invoice & { charge?: unknown }).charge,
  );
  const invoicePaymentIntentId = coerceUnknownStripeObjectId(
    (invoice as Stripe.Invoice & { payment_intent?: unknown }).payment_intent,
  );
  return (
    Boolean(refundChargeId && refundChargeId === invoiceChargeId) ||
    Boolean(refundPaymentIntentId && refundPaymentIntentId === invoicePaymentIntentId)
  );
}

function coerceUnknownStripeObjectId(value: unknown): string | null {
  if (
    typeof value === "string" ||
    value === null ||
    value === undefined
  ) {
    return coerceStripeObjectId(value);
  }

  if (typeof value === "object" && !Array.isArray(value)) {
    return coerceStripeObjectId(value as { id?: unknown });
  }

  return null;
}

function readHostedStripePositiveAmount(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
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

function buildHostedStripeSubscriptionBillingPeriodSnapshot(
  subscription: Stripe.Subscription,
): {
  currentBillingPlanCode?: string | null;
  currentPeriodEnd?: Date | null;
  currentPeriodStart?: Date | null;
} {
  const currentBillingPlanCode = resolveHostedStripeSubscriptionBillingPlanCode(subscription);
  const currentPeriod = readHostedStripeSubscriptionCurrentPeriod(subscription);

  return {
    ...(currentBillingPlanCode ? { currentBillingPlanCode } : {}),
    ...(currentPeriod
      ? {
          currentPeriodEnd: currentPeriod.currentPeriodEnd,
          currentPeriodStart: currentPeriod.currentPeriodStart,
        }
      : {}),
  };
}

function buildHostedStripeSubscriptionBillingPhaseSnapshot(
  subscription: Stripe.Subscription,
  member: HostedMemberBillingSnapshot,
  sourceType?: string | null,
): {
  currentBillingPhase?: string | null;
  currentCheckoutOffer?: string | null;
  currentTrialEndsAt?: Date | null;
  currentTrialStartedAt?: Date | null;
} {
  const metadataOffer = parseHostedBillingCheckoutOffer(subscription.metadata?.checkoutOffer);
  const sameSubscription = member.billingRef?.stripeSubscriptionId === subscription.id;
  const currentOffer = sameSubscription
    ? parseHostedBillingCheckoutOffer(member.billingRef?.currentCheckoutOffer)
    : null;
  const currentPhase = sameSubscription
    ? parseHostedBillingPhase(member.billingRef?.currentBillingPhase)
    : null;
  const checkoutOffer = metadataOffer ?? (sameSubscription ? currentOffer : null);
  const hasRedeemedCurrentPulseTrial = sameSubscription &&
    checkoutOffer === HOSTED_PULSE_TRIAL_OFFER &&
    Boolean(member.billingRef?.pulseTrialRedeemedAt);

  if (subscription.status === "trialing" && checkoutOffer === HOSTED_PULSE_TRIAL_OFFER) {
    return {
      currentBillingPhase: "trial",
      currentCheckoutOffer: HOSTED_PULSE_TRIAL_OFFER,
      ...buildHostedStripeSubscriptionTrialDateSnapshot(subscription),
    };
  }

  if (subscription.status === "active") {
    if (
      sourceType === "stripe.customer.subscription.resumed" &&
      checkoutOffer === HOSTED_PULSE_TRIAL_OFFER &&
      hasRedeemedCurrentPulseTrial
    ) {
      return {
        currentBillingPhase: "paid",
        currentCheckoutOffer: HOSTED_PULSE_TRIAL_OFFER,
        ...buildHostedStripeSubscriptionTrialDateSnapshot(subscription),
      };
    }

    if (
      checkoutOffer === HOSTED_PULSE_TRIAL_OFFER &&
      (currentPhase === "trial" ||
        (hasRedeemedCurrentPulseTrial && currentPhase !== "paid"))
    ) {
      return {
        currentBillingPhase: "trial",
        currentCheckoutOffer: HOSTED_PULSE_TRIAL_OFFER,
        ...buildHostedStripeSubscriptionTrialDateSnapshot(subscription),
      };
    }

    return {
      currentBillingPhase: "paid",
      currentCheckoutOffer: checkoutOffer ?? HOSTED_STANDARD_CHECKOUT_OFFER,
    };
  }

  if (
    subscription.status === "canceled" ||
    subscription.status === "incomplete" ||
    subscription.status === "incomplete_expired" ||
    subscription.status === "past_due" ||
    subscription.status === "paused" ||
    subscription.status === "unpaid"
  ) {
    return {
      currentBillingPhase: null,
      ...(checkoutOffer ? { currentCheckoutOffer: checkoutOffer } : {}),
    };
  }

  return checkoutOffer ? { currentCheckoutOffer: checkoutOffer } : {};
}

function buildHostedStripeInvoicePaidBillingPhaseSnapshot(
  subscription: Stripe.Subscription,
  member: HostedMemberBillingSnapshot,
  invoice: Stripe.Invoice,
): {
  currentBillingPhase?: string | null;
  currentCheckoutOffer?: string | null;
  currentTrialEndsAt?: Date | null;
  currentTrialStartedAt?: Date | null;
} {
  if (!isHostedStripeTrialConversionInvoiceCandidate(member, subscription)) {
    return buildHostedStripeSubscriptionBillingPhaseSnapshot(subscription, member);
  }

  if (!isHostedStripeAcceptedTrialConversionInvoice({
    invoice,
    subscription,
    subscriptionId: coerceStripeInvoiceSubscriptionId(invoice),
  })) {
    return {};
  }

  return {
    currentBillingPhase: "paid",
    currentCheckoutOffer: HOSTED_PULSE_TRIAL_OFFER,
    ...buildHostedStripeSubscriptionTrialDateSnapshot(subscription),
  };
}

function buildHostedStripeSubscriptionTrialDateSnapshot(
  subscription: Stripe.Subscription,
): {
  currentTrialEndsAt?: Date | null;
  currentTrialStartedAt?: Date | null;
} {
  const currentTrialStartedAt = readHostedStripeSubscriptionDate(subscription, "trial_start");
  const currentTrialEndsAt = readHostedStripeSubscriptionDate(subscription, "trial_end");

  return {
    ...(currentTrialStartedAt ? { currentTrialStartedAt } : {}),
    ...(currentTrialEndsAt ? { currentTrialEndsAt } : {}),
  };
}

function isHostedStripeInitialPulseTrialInvoice(input: {
  invoice: Stripe.Invoice;
  member: HostedMemberBillingSnapshot;
  subscription?: Stripe.Subscription | null;
}): boolean {
  if (!isHostedStripeTrialConversionInvoiceCandidate(input.member, input.subscription)) {
    return false;
  }

  return input.subscription?.status === "trialing" ||
    readHostedStripeInvoiceBillingReason(input.invoice) === "subscription_create";
}

function isHostedStripeTrialConversionInvoiceCandidate(
  member: HostedMemberBillingSnapshot,
  subscription?: Stripe.Subscription | null,
): boolean {
  if (!subscription) {
    return false;
  }

  const subscriptionOffer = parseHostedBillingCheckoutOffer(subscription?.metadata?.checkoutOffer);
  const sameSubscription = member.billingRef?.stripeSubscriptionId === subscription.id;
  const currentOffer = sameSubscription
    ? parseHostedBillingCheckoutOffer(member.billingRef?.currentCheckoutOffer)
    : null;
  const currentPhase = sameSubscription
    ? parseHostedBillingPhase(member.billingRef?.currentBillingPhase)
    : null;

  return subscriptionOffer === HOSTED_PULSE_TRIAL_OFFER ||
    currentOffer === HOSTED_PULSE_TRIAL_OFFER ||
    currentPhase === "trial";
}

function isHostedStripeAcceptedTrialConversionInvoice(input: {
  invoice: Stripe.Invoice;
  subscription?: Stripe.Subscription | null;
  subscriptionId: string | null;
}): boolean {
  if (!input.subscription || !input.subscriptionId) {
    return false;
  }

  return input.subscription.id === input.subscriptionId &&
    input.subscription.status === "active" &&
    readHostedStripeInvoiceBillingReason(input.invoice) !== "subscription_create";
}

function readHostedStripeInvoiceBillingReason(invoice: Stripe.Invoice): string | null {
  const value = (invoice as Stripe.Invoice & { billing_reason?: unknown }).billing_reason;
  return typeof value === "string" ? value : null;
}

export function resolveHostedStripeSubscriptionBillingPlanCode(
  subscription: Stripe.Subscription,
): ReturnType<typeof parseHostedBillingPlanCode> {
  const priceIds = readHostedStripeSubscriptionPriceIds(subscription);
  for (const code of HOSTED_BILLING_PLAN_CODES) {
    const expectedPriceId = process.env[getHostedBillingPlanDefinition(code).priceIdEnvKey];
    if (expectedPriceId && priceIds.includes(expectedPriceId)) {
      return code;
    }
  }

  return parseHostedBillingPlanCode(subscription.metadata?.billingPlanCode);
}

function readHostedStripeSubscriptionPriceIds(
  subscription: Stripe.Subscription,
): string[] {
  const items = subscription.items?.data ?? [];
  const priceIds: string[] = [];
  for (const item of items) {
    const priceId = typeof item.price?.id === "string" ? item.price.id : null;
    if (priceId) {
      priceIds.push(priceId);
    }
  }

  return priceIds;
}

function readHostedStripeSubscriptionCurrentPeriod(
  subscription: Stripe.Subscription,
): {
  currentPeriodEnd: Date;
  currentPeriodStart: Date;
} | null {
  return readHostedStripeObjectCurrentPeriod(subscription) ??
    readHostedStripeSubscriptionItemCurrentPeriod(subscription);
}

function readHostedStripeSubscriptionItemCurrentPeriod(
  subscription: Stripe.Subscription,
): {
  currentPeriodEnd: Date;
  currentPeriodStart: Date;
} | null {
  const items = subscription.items?.data ?? [];
  for (const item of items) {
    const currentPeriod = readHostedStripeObjectCurrentPeriod(item);
    if (currentPeriod) {
      return currentPeriod;
    }
  }

  return null;
}

function readHostedStripeObjectCurrentPeriod(
  value: object,
): {
  currentPeriodEnd: Date;
  currentPeriodStart: Date;
} | null {
  const currentPeriodStart = readHostedStripeObjectDate(value, "current_period_start");
  const currentPeriodEnd = readHostedStripeObjectDate(value, "current_period_end");

  if (
    !currentPeriodStart ||
    !currentPeriodEnd ||
    currentPeriodStart.getTime() >= currentPeriodEnd.getTime()
  ) {
    return null;
  }

  return {
    currentPeriodEnd,
    currentPeriodStart,
  };
}

function readHostedStripeSubscriptionDate(
  subscription: Stripe.Subscription,
  field: "current_period_end" | "current_period_start" | "trial_end" | "trial_start",
): Date | null {
  return readHostedStripeObjectDate(subscription, field);
}

function readHostedStripeObjectDate(
  value: object,
  field: "current_period_end" | "current_period_start" | "trial_end" | "trial_start",
): Date | null {
  const raw = Reflect.get(value, field);
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) {
    return null;
  }

  return new Date(raw * 1000);
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

async function readHostedStripeCheckoutSessionSubscription(
  session: Stripe.Checkout.Session,
): Promise<Stripe.Subscription | null> {
  const subscriptionId = coerceStripeSubscriptionId(session.subscription);
  if (!subscriptionId) {
    return null;
  }

  if (
    session.subscription &&
    typeof session.subscription === "object" &&
    "id" in session.subscription &&
    session.subscription.id === subscriptionId
  ) {
    return session.subscription as Stripe.Subscription;
  }

  return requireHostedStripeApi().subscriptions.retrieve(subscriptionId);
}

function isPulseTrialCheckoutSessionEntitlementCandidate(
  session: Stripe.Checkout.Session,
  memberId: string,
): boolean {
  return session.status === "complete" &&
    session.mode === "subscription" &&
    session.client_reference_id === memberId &&
    session.metadata?.memberId === memberId &&
    session.metadata?.billingPlanCode === "launch_monthly" &&
    session.metadata?.checkoutOffer === HOSTED_PULSE_TRIAL_OFFER &&
    session.metadata?.trialPolicyVersion === HOSTED_PULSE_TRIAL_POLICY_VERSION;
}

function isValidPulseTrialCheckoutSubscription(input: {
  eventCreatedAt: Date;
  session: Stripe.Checkout.Session;
  subscription: Stripe.Subscription;
}): boolean {
  const sessionSubscriptionId = coerceStripeSubscriptionId(input.session.subscription);
  const sessionCustomerId = coerceStripeObjectId(input.session.customer);
  const subscriptionCustomerId = coerceStripeObjectId(input.subscription.customer);
  const trialEnd = readHostedStripeSubscriptionDate(input.subscription, "trial_end");

  return Boolean(
    sessionSubscriptionId &&
    input.subscription.id === sessionSubscriptionId &&
    sessionCustomerId &&
    subscriptionCustomerId &&
    sessionCustomerId === subscriptionCustomerId &&
    input.subscription.status === "trialing" &&
    trialEnd &&
    trialEnd.getTime() > input.eventCreatedAt.getTime(),
  );
}

function buildHostedStripeCheckoutSessionDispatchContext(
  session: Pick<Stripe.Checkout.Session, "created" | "id">,
): HostedStripeDispatchContext {
  const eventCreatedAt = Number.isFinite(session.created)
    ? new Date(session.created * 1000)
    : new Date(0);

  return {
    eventCreatedAt,
    occurredAt: eventCreatedAt.toISOString(),
    sourceEventId: typeof session.id === "string" && session.id.length > 0
      ? `checkout.session:${session.id}`
      : "checkout.session:unknown",
    sourceType: "stripe.checkout.session.completed",
  };
}

export async function applyStripeDisputeUpdated(
  dispute: Stripe.Dispute,
  dispatchContext: Pick<HostedStripeDispatchContext, "eventCreatedAt" | "sourceEventId" | "sourceType">,
  prisma: Prisma.TransactionClient,
  customerId?: string | null,
): Promise<void> {
  const outcome = classifyHostedStripeDisputeOutcome(dispute, dispatchContext.sourceType);
  if (outcome === "ignore") {
    return;
  }

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

  const billingDispatchContext = {
    eventCreatedAt: dispatchContext.eventCreatedAt,
    occurredAt: dispatchContext.eventCreatedAt.toISOString(),
    sourceEventId: dispatchContext.sourceEventId,
    sourceType: dispatchContext.sourceType,
  };

  if (outcome === "restore") {
    const subscription = await readHostedMemberStripeSubscription(member);
    if (!subscription) {
      return;
    }

    const canonicalBillingStatus = mapStripeSubscriptionStatusToHostedBillingStatus(subscription.status);
    if (canonicalBillingStatus !== HostedBillingStatus.active) {
      return;
    }

    const { canonicalBillingStatus: resolvedCanonicalBillingStatus, member: preparedMember } =
      await prepareHostedMemberStripeBillingWrite({
        canonicalBillingStatus,
        dispatchContext: billingDispatchContext,
        member,
      });

    await writeHostedMemberStripeBillingTx({
      billingStatus: HostedBillingStatus.active,
      canonicalBillingStatus: resolvedCanonicalBillingStatus,
      ...buildHostedStripeSubscriptionBillingPeriodSnapshot(subscription),
      ...buildHostedStripeSubscriptionBillingPhaseSnapshot(subscription, member),
      dispatchContext: billingDispatchContext,
      member: preparedMember,
      stripeCustomerId:
        customerId ??
        coerceStripeObjectId(subscription.customer) ??
        member.billingRef?.stripeCustomerId ??
        null,
      stripeSubscriptionId: subscription.id,
      suspendedAtOverride: null,
      tx: prisma,
    });
    return;
  }

  const { canonicalBillingStatus, member: preparedMember } = await prepareHostedMemberStripeBillingWrite({
    dispatchContext: billingDispatchContext,
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

type HostedStripeDisputeOutcome = "ignore" | "restore" | "suspend";

function classifyHostedStripeDisputeOutcome(
  dispute: Stripe.Dispute,
  sourceType: string,
): HostedStripeDisputeOutcome {
  if (sourceType === "stripe.charge.dispute.funds_reinstated") {
    return "restore";
  }

  if (sourceType === "stripe.charge.dispute.funds_withdrawn") {
    return "suspend";
  }

  const status = dispute.status as string;

  if (status === "won" || status === "warning_closed") {
    return "restore";
  }

  if (status === "lost" || status === "charge_refunded") {
    return "suspend";
  }

  return "ignore";
}

async function readHostedMemberStripeSubscription(
  member: HostedMemberBillingSnapshot,
): Promise<Stripe.Subscription | null> {
  const subscriptionId = member.billingRef?.stripeSubscriptionId;
  if (!subscriptionId) {
    return null;
  }

  return requireHostedStripeApi().subscriptions.retrieve(subscriptionId);
}
