import {
  type HostedBillingStatus,
  HostedStripeEventStatus,
  Prisma,
  type PrismaClient,
} from "@prisma/client";
import type Stripe from "stripe";

import {
  clearHostedBillingPlanSwitchToPulsePendingFieldsForScheduleTx,
  recordHostedBillingPlanSwitchScheduleCreatedTx,
  refreshHostedBillingPlanSwitchToPulsePendingFieldsFromScheduleTx,
} from "./billing-plan-switch-to-pulse-service";
import {
  applyStripeCheckoutCompleted,
  applyStripeCheckoutExpired,
  applyStripeDisputeUpdated,
  applyStripeInvoicePaid,
  applyStripeInvoicePaymentFailed,
  applyStripeRefundCreated,
  applyStripeSubscriptionUpdated,
  cancelHostedPulseTrialCheckoutLoserSubscription,
  type HostedStripeActivatedMemberOutcome,
  type HostedSubscriptionCancellationEmailCandidate,
} from "./stripe-billing-events";
import {
  HOSTED_FAMILY_STRIPE_METADATA_KIND,
} from "./family-plan";
import {
  findMemberForStripeInvoice,
  findMemberForStripeCheckoutSession,
  findMemberForStripeSubscription,
  listHostedStripeCheckoutSessionMemberIds,
  resolveStripeCustomerContext,
} from "./stripe-billing-lookup";
import {
  buildHostedStripeDispatchContext,
  type HostedStripeDispatchContext,
} from "./stripe-dispatch";
import {
  coerceStripeInvoiceSubscriptionId,
  coerceStripeObjectId,
  mapStripeSubscriptionStatusToHostedBillingStatus,
} from "./billing";
import {
  HOSTED_PULSE_TRIAL_OFFER,
} from "./billing-plans";
import {
  sanitizeHostedOnboardingPersistedErrorCode,
  sanitizeHostedOnboardingPersistedErrorMessage,
  sanitizeHostedOnboardingLogString,
} from "./http";
import {
  deriveHostedOnboardingTimingErrorName,
  finishHostedOnboardingTiming,
  startHostedOnboardingTiming,
} from "./logging";
import { requireHostedStripeApi } from "./runtime";
import { HOSTED_ONBOARDING_TRANSACTION_OPTIONS } from "./shared";
import {
  sendHostedSignupWelcomeEmailForMemberBestEffort,
} from "./signup-welcome-email";
import {
  sendHostedSignupNotificationEmailForMemberBestEffort,
} from "./signup-notification-email";
import {
  sendHostedSubscriptionCancellationEmailForMember,
} from "./subscription-cancellation-email";
import {
  lookupHostedMemberStripeBillingRefByStripeSubscriptionId,
  lookupHostedMemberStripeBillingRefByStripeSubscriptionScheduleId,
  withHostedMemberStripeMutationLock,
} from "./hosted-member-billing-store";

// One pinned Stripe event retrieve can consume six minutes, the shared member
// mutation transaction can consume thirteen, and post-commit side effects plus
// receipt finalization need a bounded two-minute margin.
const STRIPE_EVENT_LEASE_MS = 21 * 60_000;
const STRIPE_EVENT_MAX_ATTEMPTS = 6;
const STRIPE_EVENT_RETRY_DELAYS_MS = [
  15 * 1000,
  60 * 1000,
  5 * 60 * 1000,
  15 * 60 * 1000,
  60 * 60 * 1000,
] as const;
const STRIPE_EVENT_LOG_STRING_MAX_LENGTH = 500;
const STRIPE_EVENT_SAFE_PRISMA_META_KEYS = new Set([
  "column",
  "constraint",
  "field_name",
  "modelName",
  "table",
  "target",
]);

export type HostedStripeEventReconcileResult = {
  activatedMemberId: string | null;
  activatedMembers?: HostedStripeActivatedMemberOutcome[];
  eventId: string;
  hostedExecutionEventId: string | null;
  status: "completed" | "failed";
};

export async function recordHostedStripeEvent(input: {
  event: Stripe.Event;
  prisma: PrismaClient;
}): Promise<{ duplicate: boolean; type: string }> {
  const stripeCreatedAt = Number.isFinite(input.event.created)
    ? new Date(input.event.created * 1000)
    : new Date();

  try {
    await input.prisma.hostedStripeEvent.create({
      data: {
        attemptCount: 0,
        eventId: input.event.id,
        nextAttemptAt: new Date(),
        receivedAt: new Date(),
        status: HostedStripeEventStatus.pending,
        stripeCreatedAt,
        type: input.event.type,
      },
    });

    return {
      duplicate: false,
      type: input.event.type,
    };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return {
        duplicate: true,
        type: input.event.type,
      };
    }

    throw error;
  }
}

export async function reconcileDueHostedStripeEvents(input: {
  limit?: number;
  prisma: PrismaClient;
}): Promise<string[]> {
  const reconciledEventIds: string[] = [];
  const now = new Date();
  const candidates = await input.prisma.hostedStripeEvent.findMany({
    where: buildDueHostedStripeEventWhere(now),
    orderBy: [
      {
        stripeCreatedAt: "asc",
      },
      {
        createdAt: "asc",
      },
    ],
    take: input.limit ?? 25,
  });

  for (const candidate of candidates) {
    const claimed = await claimHostedStripeEvent({
      eventId: candidate.eventId,
      now,
      prisma: input.prisma,
      updatedAt: candidate.updatedAt,
    });

    if (!claimed) {
      continue;
    }

    const result = await processClaimedHostedStripeEvent(claimed, input.prisma);
    if (result.status === "completed") {
      reconciledEventIds.push(result.eventId);
    }
  }

  return reconciledEventIds;
}

export async function reconcileHostedStripeEventById(input: {
  eventId: string;
  prisma: PrismaClient;
}): Promise<HostedStripeEventReconcileResult | null> {
  const now = new Date();
  const candidate = await input.prisma.hostedStripeEvent.findUnique({
    where: {
      eventId: input.eventId,
    },
  });

  if (!candidate) {
    return null;
  }

  const claimed = await claimHostedStripeEvent({
    eventId: candidate.eventId,
    now,
    prisma: input.prisma,
    updatedAt: candidate.updatedAt,
  });

  if (!claimed) {
    return null;
  }

  return processClaimedHostedStripeEvent(claimed, input.prisma);
}

async function claimHostedStripeEvent(input: {
  eventId: string;
  now: Date;
  prisma: PrismaClient;
  updatedAt: Date;
}) {
  const result = await input.prisma.hostedStripeEvent.updateMany({
    where: buildClaimableHostedStripeEventWhere(input),
    data: {
      attemptCount: {
        increment: 1,
      },
      claimExpiresAt: new Date(Date.now() + STRIPE_EVENT_LEASE_MS),
      lastErrorCode: null,
      lastErrorMessage: null,
      nextAttemptAt: new Date(),
      status: HostedStripeEventStatus.processing,
    },
  });

  if (result.count !== 1) {
    return null;
  }

  return input.prisma.hostedStripeEvent.findUnique({
    where: {
      eventId: input.eventId,
    },
  });
}

async function processHostedStripeEventRecord(
  event: Stripe.Event,
  processingContext: HostedStripeEventProcessingContext,
  prisma: Prisma.TransactionClient,
): Promise<{
  activatedMemberId: string | null;
  activatedMembers: HostedStripeActivatedMemberOutcome[];
  cleanupPulseTrialStripeSubscriptionId: string | null;
  hostedExecutionEventId: string | null;
  subscriptionCancellationEmail: HostedSubscriptionCancellationEmailCandidate | null;
  welcomeEmailMemberId: string | null;
}> {
  const payload = event.data.object;
  const dispatchContext: HostedStripeDispatchContext = buildHostedStripeDispatchContext(event);

  switch (event.type) {
    case "checkout.session.completed":
      return mapHostedStripeActivationOutcome(
        await applyStripeCheckoutCompleted(
          payload as Stripe.Checkout.Session,
          prisma,
          dispatchContext,
        ),
      );
    case "checkout.session.expired":
      await applyStripeCheckoutExpired(payload as Stripe.Checkout.Session, prisma);
      return buildEmptyHostedStripeEventProcessingResult();
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
    case "customer.subscription.paused":
    case "customer.subscription.resumed":
      return mapHostedStripeSubscriptionUpdateOutcome(
        await applyStripeSubscriptionUpdated(
          requireHostedStripeCanonicalSubscription(processingContext, event.type),
          dispatchContext,
          prisma,
        ),
      );
    case "customer.subscription.trial_will_end":
      return buildEmptyHostedStripeEventProcessingResult();
    case "subscription_schedule.created":
      await recordHostedBillingPlanSwitchScheduleCreatedTx({
        schedule: payload as Stripe.SubscriptionSchedule,
        tx: prisma,
      });
      return buildEmptyHostedStripeEventProcessingResult();
    case "subscription_schedule.updated":
      await refreshHostedBillingPlanSwitchToPulsePendingFieldsFromScheduleTx({
        schedule: payload as Stripe.SubscriptionSchedule,
        tx: prisma,
      });
      return buildEmptyHostedStripeEventProcessingResult();
    case "subscription_schedule.released":
    case "subscription_schedule.completed":
    case "subscription_schedule.canceled":
    case "subscription_schedule.aborted":
      await clearHostedBillingPlanSwitchToPulsePendingFieldsForScheduleTx({
        stripeSubscriptionScheduleId: (payload as Stripe.SubscriptionSchedule).id,
        tx: prisma,
      });
      return buildEmptyHostedStripeEventProcessingResult();
    case "subscription_schedule.expiring":
      return buildEmptyHostedStripeEventProcessingResult();
    case "invoice.paid":
      return mapHostedStripeActivationOutcome(
        await applyStripeInvoicePaid(
          payload as Stripe.Invoice,
          dispatchContext,
          prisma,
          processingContext.canonicalBillingStatus,
          processingContext.canonicalSubscription,
        ),
      );
    case "invoice.payment_failed":
      await applyStripeInvoicePaymentFailed(
        payload as Stripe.Invoice,
        dispatchContext,
        prisma,
        processingContext.canonicalBillingStatus,
        processingContext.canonicalSubscription,
      );
      return buildEmptyHostedStripeEventProcessingResult();
    case "refund.created":
      await applyStripeRefundCreated(
        payload as Stripe.Refund,
        dispatchContext,
        prisma,
        processingContext.customerId,
      );
      return buildEmptyHostedStripeEventProcessingResult();
    case "charge.dispute.created":
    case "charge.dispute.closed":
    case "charge.dispute.funds_reinstated":
    case "charge.dispute.funds_withdrawn":
      await applyStripeDisputeUpdated(
        payload as Stripe.Dispute,
        dispatchContext,
        prisma,
        processingContext.customerId,
      );
      return buildEmptyHostedStripeEventProcessingResult();
    default:
      return buildEmptyHostedStripeEventProcessingResult();
  }
}

type HostedStripeEventProcessingContext = {
  canonicalBillingStatus: HostedBillingStatus | null;
  canonicalSubscription: Stripe.Subscription | null;
  customerId: string | null;
};

async function prepareHostedStripeEventProcessingContext(
  event: Stripe.Event,
): Promise<HostedStripeEventProcessingContext> {
  const canonicalSubscription = await resolveHostedStripeEventCanonicalSubscription(event);
  const canonicalBillingStatus = canonicalSubscription
    ? mapStripeSubscriptionStatusToHostedBillingStatus(canonicalSubscription.status)
    : null;

  if (event.type !== "refund.created" && !event.type.startsWith("charge.dispute.")) {
    return {
      canonicalBillingStatus,
      canonicalSubscription,
      customerId: null,
    };
  }

  const object = readHostedStripeEventObject(event.data.object);
  const customerContext = await resolveStripeCustomerContext({
    chargeId: readHostedStripeEventChargeId(event.type, object),
    paymentIntentId: readHostedStripeEventPaymentIntentId(event.type, object),
  });

  return {
    canonicalBillingStatus,
    canonicalSubscription,
    customerId: customerContext.customerId,
  };
}

async function resolveHostedStripeEventDirectBillingMemberId(
  event: Stripe.Event,
  prisma: PrismaClient,
): Promise<string | null> {
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.metadata?.checkoutOffer === HOSTED_PULSE_TRIAL_OFFER) {
      const memberIds = await listHostedStripeCheckoutSessionMemberIds({
        prisma,
        session,
      });
      return memberIds.length === 1 ? memberIds[0] ?? null : null;
    }
    const member = await findMemberForStripeCheckoutSession({
      prisma,
      session,
    });
    return member?.core.id ?? null;
  }

  if (isHostedStripeSubscriptionBillingEvent(event.type)) {
    const subscription = event.data.object as Stripe.Subscription;
    const member = await findMemberForStripeSubscription({
      prisma,
      subscription,
    });
    return member?.core.id ?? null;
  }

  if (event.type !== "invoice.paid" && event.type !== "invoice.payment_failed") {
    return null;
  }

  const member = await findMemberForStripeInvoice({
    invoice: event.data.object as Stripe.Invoice,
    prisma,
  });
  return member?.core.id ?? null;
}

async function resolveHostedStripeEventProcessingMemberId(
  event: Stripe.Event,
  processingContext: HostedStripeEventProcessingContext,
  prisma: Prisma.TransactionClient | PrismaClient,
): Promise<string | null> {
  if (event.type.startsWith("subscription_schedule.")) {
    const schedule = event.data.object as Stripe.SubscriptionSchedule;
    const scheduleLookup = await lookupHostedMemberStripeBillingRefByStripeSubscriptionScheduleId({
      prisma,
      stripeSubscriptionScheduleId: schedule.id,
    });
    if (scheduleLookup) {
      return scheduleLookup.core.id;
    }

    const stripeSubscriptionId = coerceStripeObjectId(schedule.subscription);
    if (!stripeSubscriptionId) {
      return null;
    }
    const subscriptionLookup = await lookupHostedMemberStripeBillingRefByStripeSubscriptionId({
      prisma,
      stripeSubscriptionId,
    });
    return subscriptionLookup?.core.id ?? null;
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.metadata?.checkoutOffer === HOSTED_PULSE_TRIAL_OFFER) {
      const memberIds = await listHostedStripeCheckoutSessionMemberIds({
        prisma,
        session,
      });
      return memberIds.length === 1 ? memberIds[0] ?? null : null;
    }
    const member = await findMemberForStripeCheckoutSession({
      prisma,
      session,
    });
    return member?.core.id ?? null;
  }

  if (isHostedStripeSubscriptionBillingEvent(event.type)) {
    if (!processingContext.canonicalSubscription) {
      return null;
    }
    const member = await findMemberForStripeSubscription({
      prisma,
      subscription: processingContext.canonicalSubscription,
    });
    return member?.core.id ?? null;
  }

  if (event.type !== "invoice.paid" && event.type !== "invoice.payment_failed") {
    return null;
  }

  const canonicalMember = processingContext.canonicalSubscription
    ? await findMemberForStripeSubscription({
        prisma,
        subscription: processingContext.canonicalSubscription,
      })
    : null;
  const effectiveMember = await findMemberForStripeInvoice({
    invoice: event.data.object as Stripe.Invoice,
    prisma,
    subscription: processingContext.canonicalSubscription,
  });
  if (
    canonicalMember &&
    effectiveMember &&
    canonicalMember.core.id !== effectiveMember.core.id
  ) {
    throw new Error("Canonical Stripe billing ownership changed before processing.");
  }
  return effectiveMember?.core.id ?? canonicalMember?.core.id ?? null;
}

function isHostedStripeSubscriptionBillingEvent(type: string): boolean {
  return type === "customer.subscription.created"
    || type === "customer.subscription.updated"
    || type === "customer.subscription.deleted"
    || type === "customer.subscription.paused"
    || type === "customer.subscription.resumed";
}

async function resolveHostedStripeEventCanonicalSubscription(
  event: Stripe.Event,
): Promise<Stripe.Subscription | null> {
  if (event.type === "customer.subscription.trial_will_end") {
    return null;
  }

  if (event.type.startsWith("customer.subscription.")) {
    const subscription = event.data.object as Stripe.Subscription;
    return requireHostedStripeApi().subscriptions.retrieve(subscription.id);
  }

  if (event.type === "invoice.paid" || event.type === "invoice.payment_failed") {
    const subscriptionId = coerceStripeInvoiceSubscriptionId(event.data.object as Stripe.Invoice);

    if (!subscriptionId) {
      return null;
    }

    return requireHostedStripeApi().subscriptions.retrieve(subscriptionId);
  }

  return null;
}

function requireHostedStripeCanonicalSubscription(
  processingContext: HostedStripeEventProcessingContext,
  eventType: string,
): Stripe.Subscription {
  if (processingContext.canonicalSubscription) {
    return processingContext.canonicalSubscription;
  }

  throw new Error(`Canonical Stripe subscription is required for ${eventType}.`);
}

function readHostedStripeEventObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(Object.entries(value));
}

function readHostedStripeEventChargeId(type: string, object: Record<string, unknown>): string | null {
  if (type === "refund.created") {
    return coerceStripeObjectId(object.charge as never);
  }

  if (type.startsWith("charge.dispute.")) {
    return coerceStripeObjectId(object.charge as never);
  }

  if (type === "invoice.paid") {
    return coerceStripeObjectId(object.charge as never);
  }

  return null;
}

function readHostedStripeEventPaymentIntentId(type: string, object: Record<string, unknown>): string | null {
  if (type === "refund.created") {
    return coerceStripeObjectId(object.payment_intent as never);
  }

  if (type.startsWith("charge.dispute.")) {
    return coerceStripeObjectId(object.payment_intent as never);
  }

  if (type === "invoice.paid") {
    return coerceStripeObjectId(object.payment_intent as never);
  }

  return null;
}

function deriveHostedStripeEventErrorCode(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }

  if (error instanceof Error && error.name) {
    return error.name;
  }

  return "HOSTED_STRIPE_EVENT_FAILED";
}

function computeHostedStripeEventNextAttemptAt(attemptCount: number, now = new Date()): Date {
  const delayMs =
    STRIPE_EVENT_RETRY_DELAYS_MS[
      Math.min(Math.max(attemptCount - 1, 0), STRIPE_EVENT_RETRY_DELAYS_MS.length - 1)
    ];
  return new Date(now.getTime() + delayMs);
}

async function processClaimedHostedStripeEvent(
  claimed: NonNullable<Awaited<ReturnType<typeof claimHostedStripeEvent>>>,
  prisma: PrismaClient,
): Promise<HostedStripeEventReconcileResult> {
  const timing = startHostedOnboardingTiming("hosted-onboarding.stripe.reconcile-event", {
    attemptCount: claimed.attemptCount,
    eventType: claimed.type,
  });

  try {
    const stripeEvent = await fetchHostedStripeEventForReconciliation(claimed.eventId);
    const directBillingMemberId = await resolveHostedStripeEventDirectBillingMemberId(
      stripeEvent,
      prisma,
    );
    const processing = directBillingMemberId
      ? await processHostedStripeEventWithVerifiedMemberLock({
          memberId: directBillingMemberId,
          prisma,
          stripeEvent,
        })
      : await processHostedStripeEventWithDiscoveredMemberLock(
          stripeEvent,
          prisma,
        );
    const { memberId: processingMemberId, result } = processing;
    if (result.cleanupPulseTrialStripeSubscriptionId) {
      if (!processingMemberId) {
        throw new Error("Pulse Trial cleanup requires a direct billing member.");
      }
      await cancelHostedPulseTrialCheckoutLoserSubscription({
        memberId: processingMemberId,
        prisma,
        subscriptionId: result.cleanupPulseTrialStripeSubscriptionId,
      });
    }
    if (result.welcomeEmailMemberId) {
      await sendHostedSignupWelcomeEmailForMemberBestEffort({
        memberId: result.welcomeEmailMemberId,
        prisma,
      });
      await sendHostedSignupNotificationEmailForMemberBestEffort({
        memberId: result.welcomeEmailMemberId,
        prisma,
        sourceEventId: claimed.eventId,
        sourceEventType: claimed.type,
      });
    }
    if (result.subscriptionCancellationEmail) {
      if (!claimed.subscriptionCancellationEmailSentAt) {
        const cancellationEmailResult = await sendHostedSubscriptionCancellationEmailForMember({
          memberId: result.subscriptionCancellationEmail.memberId,
          prisma,
          stripeSubscriptionId: result.subscriptionCancellationEmail.stripeSubscriptionId,
        });

        if (cancellationEmailResult.status === "sent") {
          await markHostedStripeSubscriptionCancellationEmailSent({
            eventId: claimed.eventId,
            prisma,
            sentAt: new Date(),
          });
        }
      }
    }
    await prisma.hostedStripeEvent.updateMany({
      where: {
        attemptCount: claimed.attemptCount,
        eventId: claimed.eventId,
        status: HostedStripeEventStatus.processing,
      },
      data: {
        claimExpiresAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        processedAt: new Date(),
        status: HostedStripeEventStatus.completed,
      },
    });
    finishHostedOnboardingTiming(timing, "completed", {
      activatedMember: Boolean(result.activatedMemberId),
      activatedMemberCount: result.activatedMembers?.length ?? 0,
      hostedExecutionEventScheduled: Boolean(result.hostedExecutionEventId),
      subscriptionCancellationEmailCandidate:
        Boolean(result.subscriptionCancellationEmail),
      welcomeEmailCandidate: Boolean(result.welcomeEmailMemberId),
    });

    const activatedMembers = result.activatedMembers ?? [];

    return {
      activatedMemberId: result.activatedMemberId,
      ...(activatedMembers.length > 0 ? { activatedMembers } : {}),
      eventId: claimed.eventId,
      hostedExecutionEventId: result.hostedExecutionEventId,
      status: "completed",
    };
  } catch (error) {
    logHostedStripeEventReconciliationFailure({
      attemptCount: claimed.attemptCount,
      error,
      eventId: claimed.eventId,
      eventType: claimed.type,
      poisoned: claimed.attemptCount >= STRIPE_EVENT_MAX_ATTEMPTS,
    });
    await prisma.hostedStripeEvent.updateMany({
      where: {
        attemptCount: claimed.attemptCount,
        eventId: claimed.eventId,
        status: HostedStripeEventStatus.processing,
      },
      data: {
        claimExpiresAt: null,
        lastErrorCode: sanitizeHostedOnboardingPersistedErrorCode(
          deriveHostedStripeEventErrorCode(error),
        ),
        lastErrorMessage: sanitizeHostedOnboardingPersistedErrorMessage(
          error instanceof Error ? error.message : String(error),
        ),
        nextAttemptAt: computeHostedStripeEventNextAttemptAt(claimed.attemptCount),
        status:
          claimed.attemptCount >= STRIPE_EVENT_MAX_ATTEMPTS
            ? HostedStripeEventStatus.poisoned
            : HostedStripeEventStatus.failed,
      },
    });
    finishHostedOnboardingTiming(timing, "failed", {
      errorName: deriveHostedOnboardingTimingErrorName(error),
      poisoned:
        claimed.attemptCount >= STRIPE_EVENT_MAX_ATTEMPTS,
    });

    return {
      activatedMemberId: null,
      eventId: claimed.eventId,
      hostedExecutionEventId: null,
      status: "failed",
    };
  }
}

async function processHostedStripeEventWithDiscoveredMemberLock(
  stripeEvent: Stripe.Event,
  prisma: PrismaClient,
): Promise<{
  memberId: string | null;
  result: Awaited<ReturnType<typeof processHostedStripeEventRecord>>;
}> {
  const processingContext = await prepareHostedStripeEventProcessingContext(stripeEvent);
  const discoveredMemberId = await resolveHostedStripeEventProcessingMemberId(
    stripeEvent,
    processingContext,
    prisma,
  );
  if (discoveredMemberId) {
    return processHostedStripeEventWithVerifiedMemberLock({
      memberId: discoveredMemberId,
      prisma,
      stripeEvent,
    });
  }

  if (stripeEvent.type === "checkout.session.completed") {
    const session = stripeEvent.data.object as Stripe.Checkout.Session;
    if (session.metadata?.kind !== HOSTED_FAMILY_STRIPE_METADATA_KIND) {
      return {
        memberId: null,
        result: buildEmptyHostedStripeEventProcessingResult(),
      };
    }
  }
  if (
    (
      isHostedStripeSubscriptionBillingEvent(stripeEvent.type) ||
      stripeEvent.type === "invoice.paid" ||
      stripeEvent.type === "invoice.payment_failed"
    ) &&
    processingContext.canonicalSubscription?.metadata.kind !==
      HOSTED_FAMILY_STRIPE_METADATA_KIND
  ) {
    throw new Error("Canonical Stripe billing owner was unavailable for locked processing.");
  }

  return {
    memberId: null,
    result: await prisma.$transaction(
      (transaction) => processHostedStripeEventRecord(
        stripeEvent,
        processingContext,
        transaction,
      ),
      HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
    ),
  };
}

async function processHostedStripeEventWithVerifiedMemberLock(input: {
  memberId: string;
  prisma: PrismaClient;
  stripeEvent: Stripe.Event;
}): Promise<{
  memberId: string;
  result: Awaited<ReturnType<typeof processHostedStripeEventRecord>>;
}> {
  const result = await withHostedMemberStripeMutationLock({
    memberId: input.memberId,
    prisma: input.prisma,
    run: async (transaction) => {
      const processingContext = await prepareHostedStripeEventProcessingContext(
        input.stripeEvent,
      );
      const processingMemberId = await resolveHostedStripeEventProcessingMemberId(
        input.stripeEvent,
        processingContext,
        transaction,
      );
      if (processingMemberId !== input.memberId) {
        throw new Error("Canonical Stripe billing ownership changed before processing.");
      }
      return processHostedStripeEventRecord(
        input.stripeEvent,
        processingContext,
        transaction,
      );
    },
  });
  return {
    memberId: input.memberId,
    result,
  };
}

async function markHostedStripeSubscriptionCancellationEmailSent(input: {
  eventId: string;
  prisma: PrismaClient;
  sentAt: Date;
}): Promise<void> {
  await input.prisma.hostedStripeEvent.updateMany({
    where: {
      eventId: input.eventId,
      subscriptionCancellationEmailSentAt: null,
    },
    data: {
      subscriptionCancellationEmailSentAt: input.sentAt,
    },
  });
}

function logHostedStripeEventReconciliationFailure(input: {
  attemptCount: number;
  error: unknown;
  eventId: string;
  eventType: string;
  poisoned: boolean;
}): void {
  console.error("Hosted Stripe event reconciliation failed.", {
    attemptCount: input.attemptCount,
    errorName: deriveHostedOnboardingTimingErrorName(input.error),
    eventIdSuffix: input.eventId.slice(-6),
    eventType: sanitizeHostedOnboardingLogString(
      input.eventType,
      STRIPE_EVENT_LOG_STRING_MAX_LENGTH,
    ) ?? "unknown",
    poisoned: input.poisoned,
    ...describeHostedStripeEventReconciliationErrorForLog(input.error),
  });
}

function describeHostedStripeEventReconciliationErrorForLog(
  error: unknown,
): Record<string, unknown> {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const prismaMessage = sanitizeHostedOnboardingLogString(
      error.message,
      STRIPE_EVENT_LOG_STRING_MAX_LENGTH,
    );
    const prismaMeta = sanitizeHostedStripeEventPrismaMeta(error.meta);

    return {
      errorCode: error.code,
      prismaClientVersion: error.clientVersion,
      prismaCode: error.code,
      ...(prismaMessage ? { prismaMessage } : {}),
      ...(prismaMeta ? { prismaMeta } : {}),
    };
  }

  if (error instanceof Prisma.PrismaClientInitializationError) {
    const prismaMessage = sanitizeHostedOnboardingLogString(
      error.message,
      STRIPE_EVENT_LOG_STRING_MAX_LENGTH,
    );

    return {
      ...(typeof error.errorCode === "string" && error.errorCode
        ? { errorCode: error.errorCode, prismaCode: error.errorCode }
        : {}),
      ...(typeof error.clientVersion === "string" && error.clientVersion
        ? { prismaClientVersion: error.clientVersion }
        : {}),
      ...(prismaMessage ? { prismaMessage } : {}),
    };
  }

  const errorMessage = error instanceof Error
    ? sanitizeHostedOnboardingLogString(error.message, STRIPE_EVENT_LOG_STRING_MAX_LENGTH)
    : sanitizeHostedOnboardingLogString(String(error), STRIPE_EVENT_LOG_STRING_MAX_LENGTH);

  return errorMessage ? { errorMessage } : {};
}

function sanitizeHostedStripeEventPrismaMeta(meta: unknown): Record<string, unknown> | null {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
    return null;
  }

  const entries = Object.entries(meta).flatMap(([key, value]) => {
    if (!STRIPE_EVENT_SAFE_PRISMA_META_KEYS.has(key)) {
      return [];
    }

    const sanitizedValue = sanitizeHostedStripeEventPrismaMetaValue(value);
    return sanitizedValue === null ? [] : [[key, sanitizedValue] as const];
  });

  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

function sanitizeHostedStripeEventPrismaMetaValue(value: unknown): unknown {
  if (typeof value === "string") {
    return sanitizeHostedOnboardingLogString(value, STRIPE_EVENT_LOG_STRING_MAX_LENGTH);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    const sanitized = value
      .map((entry) => sanitizeHostedStripeEventPrismaMetaValue(entry))
      .filter((entry) => entry !== null);

    return sanitized.length > 0 ? sanitized : null;
  }

  return null;
}

async function fetchHostedStripeEventForReconciliation(eventId: string): Promise<Stripe.Event> {
  return requireHostedStripeApi().events.retrieve(eventId);
}

function buildDueHostedStripeEventWhere(now: Date): Prisma.HostedStripeEventWhereInput {
  return {
    OR: [
      {
        nextAttemptAt: {
          lte: now,
        },
        status: HostedStripeEventStatus.pending,
      },
      {
        nextAttemptAt: {
          lte: now,
        },
        status: HostedStripeEventStatus.failed,
      },
      {
        status: HostedStripeEventStatus.processing,
        claimExpiresAt: {
          lte: now,
        },
      },
    ],
  };
}

function mapHostedStripeActivationOutcome(
  outcome: {
    activatedMemberId: string | null;
    activatedMembers?: HostedStripeActivatedMemberOutcome[];
    cleanupPulseTrialStripeSubscriptionId?: string | null;
    hostedExecutionEventId: string | null;
    welcomeEmailMemberId?: string | null;
  },
): {
  activatedMemberId: string | null;
  activatedMembers: HostedStripeActivatedMemberOutcome[];
  cleanupPulseTrialStripeSubscriptionId: string | null;
  hostedExecutionEventId: string | null;
  subscriptionCancellationEmail: HostedSubscriptionCancellationEmailCandidate | null;
  welcomeEmailMemberId: string | null;
} {
  return {
    activatedMemberId: outcome.activatedMemberId,
    activatedMembers: outcome.activatedMembers ?? [],
    cleanupPulseTrialStripeSubscriptionId:
      outcome.cleanupPulseTrialStripeSubscriptionId ?? null,
    hostedExecutionEventId: outcome.hostedExecutionEventId,
    subscriptionCancellationEmail: null,
    welcomeEmailMemberId: outcome.welcomeEmailMemberId ?? null,
  };
}

function mapHostedStripeSubscriptionUpdateOutcome(
  outcome: {
    activatedMemberId?: string | null;
    activatedMembers?: HostedStripeActivatedMemberOutcome[];
    cleanupPulseTrialStripeSubscriptionId?: string | null;
    hostedExecutionEventId?: string | null;
    subscriptionCancellationEmail?: HostedSubscriptionCancellationEmailCandidate | null;
    welcomeEmailMemberId?: string | null;
  } | null | undefined,
): {
  activatedMemberId: string | null;
  activatedMembers: HostedStripeActivatedMemberOutcome[];
  cleanupPulseTrialStripeSubscriptionId: string | null;
  hostedExecutionEventId: string | null;
  subscriptionCancellationEmail: HostedSubscriptionCancellationEmailCandidate | null;
  welcomeEmailMemberId: string | null;
} {
  return {
    activatedMemberId: outcome?.activatedMemberId ?? null,
    activatedMembers: outcome?.activatedMembers ?? [],
    cleanupPulseTrialStripeSubscriptionId:
      outcome?.cleanupPulseTrialStripeSubscriptionId ?? null,
    hostedExecutionEventId: outcome?.hostedExecutionEventId ?? null,
    subscriptionCancellationEmail:
      outcome?.subscriptionCancellationEmail ?? null,
    welcomeEmailMemberId: outcome?.welcomeEmailMemberId ?? null,
  };
}

function buildEmptyHostedStripeEventProcessingResult(): {
  activatedMemberId: string | null;
  activatedMembers: HostedStripeActivatedMemberOutcome[];
  cleanupPulseTrialStripeSubscriptionId: string | null;
  hostedExecutionEventId: string | null;
  subscriptionCancellationEmail: HostedSubscriptionCancellationEmailCandidate | null;
  welcomeEmailMemberId: string | null;
} {
  return {
    activatedMemberId: null,
    activatedMembers: [],
    cleanupPulseTrialStripeSubscriptionId: null,
    hostedExecutionEventId: null,
    subscriptionCancellationEmail: null,
    welcomeEmailMemberId: null,
  };
}

function buildClaimableHostedStripeEventWhere(input: {
  eventId: string;
  now: Date;
  updatedAt: Date;
}): Prisma.HostedStripeEventWhereInput {
  return {
    eventId: input.eventId,
    updatedAt: input.updatedAt,
    ...buildDueHostedStripeEventWhere(input.now),
  };
}
