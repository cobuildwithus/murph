import {
  HostedBillingStatus,
  HostedStripeEventStatus,
  Prisma,
  type PrismaClient,
} from "@prisma/client";
import type Stripe from "stripe";

import {
  clearHostedBillingPlanSwitchToPulsePendingFieldsForScheduleTx,
  refreshHostedBillingPlanSwitchToPulsePendingFieldsFromScheduleTx,
} from "./billing-plan-switch-to-pulse-service";
import {
  applyStripeCheckoutCompleted,
  applyStripeCheckoutExpired,
  applyStripeInvoiceCollectionStateChanged,
  applyStripeInvoicePaid,
  applyStripeRecurringFinancialState,
  applyStripeSubscriptionUpdated,
  cancelHostedPulseTrialCheckoutLoserSubscription,
  type HostedStripeActivatedMemberOutcome,
  type HostedSubscriptionCancellationEmailCandidate,
} from "./stripe-billing-events";
import {
  convergeHostedFamilyDirectPaidOwnershipTx,
  HOSTED_FAMILY_STRIPE_METADATA_KIND,
  prepareHostedLegacySyntheticFamilyCleanupTx,
  readHostedFamilyDirectPaidTransitionContext,
  reconcileHostedFamilyDirectPaidTransitionSubscription,
} from "./family-plan";
import {
  findMemberForStripeInvoice,
  findMemberForStripeCheckoutSession,
  findMemberForStripeSubscription,
  listHostedStripeCheckoutSessionDirectMemberIds,
  listHostedStripeCheckoutSessionMemberIds,
  isHostedStripeUnappliedPendingUpdateInvoice,
  resolveStripeFinancialContext,
} from "./stripe-billing-lookup";
import {
  resolveHostedStripeBillingOwner,
  type HostedStripeBillingOwner,
} from "./stripe-billing-owner";
import {
  HOSTED_STRIPE_BILLING_SUBSCRIPTION_EXPANSIONS,
  isHostedStripeDefinitiveRequestRejection,
  isHostedStripeRetryableFailure,
} from "./stripe-billing-state";
import {
  executeHostedCheckoutSubscriptionCleanup,
  type HostedCheckoutSubscriptionCleanupCandidate,
} from "./stripe-checkout-subscription-cleanup";
import {
  buildHostedStripeDispatchContext,
  type HostedStripeDispatchContext,
} from "./stripe-dispatch";
import {
  coerceStripeInvoiceSubscriptionId,
  coerceStripeObjectId,
  mapStripeSubscriptionStatusToHostedBillingStatus,
  readStripeShouldRetryDirective,
} from "./billing";
import {
  HOSTED_PULSE_TRIAL_OFFER,
  HOSTED_STANDARD_CHECKOUT_OFFER,
  parseHostedBillingCheckoutOffer,
  parseHostedBillingPlanCode,
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
import {
  logHostedStripeFailure,
  withHostedStripeFailureLog,
} from "./stripe-error-log";
import { readActiveHostedFamilySponsorship } from "./member-access";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  normalizeNullableString,
} from "./shared";
import { readHostedMemberBillingSnapshot } from "./hosted-member-store";
import {
  createHostedPostCommitDeadline,
  waitForHostedPostCommitOperation,
} from "./bounded-post-commit";
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
  HOSTED_MEMBER_STRIPE_MUTATION_TRANSACTION_TIMEOUT_MS,
  withHostedMemberStripeMutationLock,
} from "./hosted-member-billing-store";
import { isHostedOnboardingError } from "./errors";
import {
  HOSTED_USAGE_CREDIT_STRIPE_PREPARATION_BUDGET,
  isHostedUsageCreditStripeRetryableError,
  reconcileHostedUsageCreditStripeEvent,
} from "./usage-credit-stripe-reconciliation";
import { signalHostedRuntimeRecheckRuntime } from "../hosted-orchestration/signal-runtime";

// Top-up reads use no SDK retries, hard per-request/KMS bounds, an aggregate
// read-only preparation deadline, and a request-count ceiling. Keep the receipt
// lease large enough for every bounded top-up phase so new provider work cannot
// silently outrun it.
const HOSTED_STRIPE_EVENT_LEASE_PHASES = {
  eventRetrieveMs: 6 * 60_000,
  marginMs: 60_000,
  memberMutationMs: HOSTED_MEMBER_STRIPE_MUTATION_TRANSACTION_TIMEOUT_MS,
  postCommitMs: 2 * 60_000,
  usageCreditPreparationMs:
    HOSTED_USAGE_CREDIT_STRIPE_PREPARATION_BUDGET.timeoutMs,
} as const;
export const HOSTED_STRIPE_EVENT_LEASE_BUDGET = {
  ...HOSTED_STRIPE_EVENT_LEASE_PHASES,
  totalMs:
    HOSTED_STRIPE_EVENT_LEASE_PHASES.eventRetrieveMs +
    HOSTED_STRIPE_EVENT_LEASE_PHASES.usageCreditPreparationMs +
    HOSTED_STRIPE_EVENT_LEASE_PHASES.memberMutationMs +
    HOSTED_STRIPE_EVENT_LEASE_PHASES.postCommitMs +
    HOSTED_STRIPE_EVENT_LEASE_PHASES.marginMs,
} as const;
const STRIPE_EVENT_LEASE_MS = HOSTED_STRIPE_EVENT_LEASE_BUDGET.totalMs;
const STRIPE_EVENT_RECEIPT_FINALIZATION_MARGIN_MS = 30_000;
export const HOSTED_USAGE_CREDIT_RUNTIME_RECHECK_TIMEOUT_MS =
  HOSTED_STRIPE_EVENT_LEASE_BUDGET.postCommitMs -
  STRIPE_EVENT_RECEIPT_FINALIZATION_MARGIN_MS;
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
const HOSTED_LEGACY_FAMILY_REFUND_INVOICE_METADATA_KEY =
  "hosted_family_legacy_invoice_id";

class HostedLegacyFamilyCleanupPendingError extends Error {
  readonly code = "HOSTED_LEGACY_FAMILY_CLEANUP_PENDING";
}

class HostedStripeEventRetrieveRetryableError extends Error {
  readonly code = "HOSTED_STRIPE_EVENT_RETRIEVE_RETRYABLE";
  readonly providerDirectedRetry: boolean;

  constructor(cause: unknown) {
    super(
      cause instanceof Error
        ? cause.message
        : "Stripe event retrieval must be retried.",
      { cause },
    );
    this.name = "HostedStripeEventRetrieveRetryableError";
    this.providerDirectedRetry =
      readStripeShouldRetryDirective(cause) !== false;
  }
}

export type HostedStripeEventReconcileResult = {
  activatedMemberId: string | null;
  activatedMembers?: HostedStripeActivatedMemberOutcome[];
  eventId: string;
  hostedExecutionEventId: string | null;
  status: "completed" | "failed";
  usageCreditGrantedMemberId?: string;
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
  observedAt: Date,
): Promise<{
  activatedMemberId: string | null;
  activatedMembers: HostedStripeActivatedMemberOutcome[];
  cleanupCheckoutSubscription: HostedCheckoutSubscriptionCleanupCandidate | null;
  cleanupPulseTrialStripeSubscriptionId: string | null;
  hostedExecutionEventId: string | null;
  subscriptionCancellationEmail: HostedSubscriptionCancellationEmailCandidate | null;
  welcomeEmailMemberId: string | null;
}> {
  const payload = event.data.object;
  const dispatchContext: HostedStripeDispatchContext = buildHostedStripeDispatchContext(event);
  if (
    processingContext.billingOwner &&
    processingContext.canonicalSubscription &&
    (
      isHostedStripeFinancialReversalEvent(event.type) ||
      isHostedStripePositiveBillingProjectionEvent(
        event.type,
        processingContext.canonicalBillingStatus,
      )
    )
  ) {
    const financialProjection = await applyStripeRecurringFinancialState({
      dispatchContext,
      owner: processingContext.billingOwner,
      restoreWhenHealthy: isHostedStripeFinancialReversalEvent(event.type),
      subscription: processingContext.canonicalSubscription,
      tx: prisma,
    });
    if (isHostedStripeFinancialReversalEvent(event.type)) {
      return buildEmptyHostedStripeEventProcessingResult();
    }
    if (financialProjection.blockActiveProjection) {
      return buildEmptyHostedStripeEventProcessingResult();
    }
  }

  switch (event.type) {
    case "checkout.session.completed":
      return mapHostedStripeActivationOutcome(
        await applyStripeCheckoutCompleted(
          payload as Stripe.Checkout.Session,
          prisma,
          dispatchContext,
          observedAt,
        ),
      );
    case "checkout.session.expired":
      await applyStripeCheckoutExpired(
        payload as Stripe.Checkout.Session,
        prisma,
      );
      return buildEmptyHostedStripeEventProcessingResult();
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
    case "customer.subscription.paused":
    case "customer.subscription.resumed":
    case "customer.subscription.pending_update_applied":
    case "customer.subscription.pending_update_expired":
      return mapHostedStripeSubscriptionUpdateOutcome(
        await applyStripeSubscriptionUpdated(
          requireHostedStripeCanonicalSubscription(processingContext, event.type),
          dispatchContext,
          prisma,
        ),
      );
    case "customer.subscription.trial_will_end":
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
    case "subscription_schedule.created":
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
    case "invoice.payment_action_required":
    case "invoice.payment_attempt_required":
    case "invoice.finalization_failed":
    case "invoice.marked_uncollectible":
    case "invoice.voided":
      await applyStripeInvoiceCollectionStateChanged(
        dispatchContext,
        prisma,
        processingContext.canonicalSubscription,
        processingContext.billingOwner,
      );
      return buildEmptyHostedStripeEventProcessingResult();
    case "refund.created":
    case "refund.updated":
    case "refund.failed":
    case "charge.refund.updated":
    case "charge.refunded":
    case "charge.dispute.created":
    case "charge.dispute.updated":
    case "charge.dispute.closed":
    case "charge.dispute.funds_reinstated":
    case "charge.dispute.funds_withdrawn":
      return buildEmptyHostedStripeEventProcessingResult();
    default:
      return buildEmptyHostedStripeEventProcessingResult();
  }
}

type HostedStripeEventProcessingContext = {
  billingOwner: HostedStripeBillingOwner | null;
  canonicalBillingStatus: HostedBillingStatus | null;
  canonicalSubscription: Stripe.Subscription | null;
  familyTransitionOwnerMemberId: string | null;
};

async function prepareHostedStripeEventProcessingContext(
  event: Stripe.Event,
  prisma: PrismaClient | Prisma.TransactionClient,
): Promise<HostedStripeEventProcessingContext> {
  const object = readHostedStripeEventObject(event.data.object);
  const financialContext = isHostedStripeFinancialReversalEvent(event.type)
    ? await resolveStripeFinancialContext({
        chargeId: readHostedStripeEventChargeId(event.type, object),
        paymentIntentId: readHostedStripeEventPaymentIntentId(event.type, object),
      })
    : null;
  const canonicalSubscription = await resolveHostedStripeEventCanonicalSubscription(
    event,
    financialContext?.subscriptionId ?? null,
  );
  if (
    financialContext &&
    !financialContext.subscriptionId
  ) {
    throw new Error(
      "Stripe recurring financial event did not resolve to a subscription.",
    );
  }
  const canonicalBillingStatus = canonicalSubscription
    ? mapStripeSubscriptionStatusToHostedBillingStatus(canonicalSubscription.status)
    : null;
  const billingOwner = canonicalSubscription
    ? await resolveHostedStripeBillingOwner({
        prisma,
        stripeSubscriptionId: canonicalSubscription.id,
      })
    : null;
  const familyTransition = canonicalSubscription
    ? readHostedFamilyDirectPaidTransitionContext(canonicalSubscription)
    : null;
  const legacyFamilyTransitionOwnerMemberId =
    canonicalSubscription?.metadata.kind ===
        HOSTED_FAMILY_STRIPE_METADATA_KIND &&
      billingOwner?.kind === "member"
      ? billingOwner.memberId
      : null;

  return {
    billingOwner,
    canonicalBillingStatus,
    canonicalSubscription,
    familyTransitionOwnerMemberId:
      familyTransition?.ownerMemberId ??
      legacyFamilyTransitionOwnerMemberId,
  };
}

async function reconcileHostedFamilyTransitionUnderVerifiedOwnerLock(input: {
  eventCreatedAt: Date | null;
  memberId: string;
  processingContext: HostedStripeEventProcessingContext;
  stripeEvent: Stripe.Event;
  tx: Prisma.TransactionClient;
}): Promise<HostedStripeEventProcessingContext> {
  const subscription = input.processingContext.canonicalSubscription;
  if (
    !subscription ||
    input.processingContext.familyTransitionOwnerMemberId === null
  ) {
    return input.processingContext;
  }
  if (
    input.processingContext.familyTransitionOwnerMemberId !== input.memberId
  ) {
    throw new Error(
      "Family billing transition no longer matched its verified owner lock.",
    );
  }

  const terminalProviderProof =
    input.stripeEvent.type ===
        "customer.subscription.pending_update_expired"
      ? "pending_update_expired" as const
      : input.stripeEvent.type === "invoice.voided" &&
          isHostedStripeUnappliedPendingUpdateInvoice({
            invoice: input.stripeEvent.data.object as Stripe.Invoice,
            subscription,
          })
      ? "invoice_voided" as const
      : null;
  const reconciled =
    await reconcileHostedFamilyDirectPaidTransitionSubscription({
      prisma: input.tx,
      stripe: requireHostedStripeApi(),
      subscription,
      ...(terminalProviderProof
        ? { terminalProviderProof }
        : {}),
      verifiedOwnerMemberId: input.memberId,
    });
  await convergeHostedFamilyDirectPaidOwnershipTx({
    eventCreatedAt: input.eventCreatedAt,
    subscription: reconciled,
    tx: input.tx,
    verifiedOwnerMemberId: input.memberId,
  });
  const billingOwner = await resolveHostedStripeBillingOwner({
    prisma: input.tx,
    stripeSubscriptionId: reconciled.id,
  });
  if (billingOwner && billingOwner.lockMemberId !== input.memberId) {
    throw new Error(
      "Canonical Stripe billing ownership changed during Family transition reconciliation.",
    );
  }

  return {
    billingOwner,
    canonicalBillingStatus:
      mapStripeSubscriptionStatusToHostedBillingStatus(reconciled.status),
    canonicalSubscription: reconciled,
    familyTransitionOwnerMemberId:
      readHostedFamilyDirectPaidTransitionContext(reconciled)?.ownerMemberId ??
      null,
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
    if (
      session.metadata?.checkoutOffer === HOSTED_STANDARD_CHECKOUT_OFFER &&
      normalizeNullableString(session.client_reference_id) !== null &&
      normalizeNullableString(session.client_reference_id) ===
        normalizeNullableString(session.metadata?.memberId)
    ) {
      const directMemberIds =
        await listHostedStripeCheckoutSessionDirectMemberIds({
          prisma,
          session,
        });
      if (directMemberIds.length === 1) {
        return directMemberIds[0] ?? null;
      }
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
    return member?.core.id ?? await resolveFamilySponsoredDirectSubscriptionMemberId({
      prisma,
      subscription,
    });
  }

  if (!isHostedStripeInvoiceBillingEvent(event.type)) {
    return null;
  }

  const member = await findMemberForStripeInvoice({
    invoice: event.data.object as Stripe.Invoice,
    prisma,
  });
  if (member) {
    return member.core.id;
  }
  const canonicalSubscription = await resolveHostedStripeEventCanonicalSubscription(event);
  return canonicalSubscription
    ? resolveFamilySponsoredDirectSubscriptionMemberId({
        prisma,
        subscription: canonicalSubscription,
      })
    : null;
}

async function resolveHostedStripeEventProcessingMemberId(
  event: Stripe.Event,
  processingContext: HostedStripeEventProcessingContext,
  prisma: Prisma.TransactionClient | PrismaClient,
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
    if (
      session.metadata?.checkoutOffer === HOSTED_STANDARD_CHECKOUT_OFFER &&
      normalizeNullableString(session.client_reference_id) !== null &&
      normalizeNullableString(session.client_reference_id) ===
        normalizeNullableString(session.metadata?.memberId)
    ) {
      const directMemberIds =
        await listHostedStripeCheckoutSessionDirectMemberIds({
          prisma,
          session,
        });
      if (directMemberIds.length === 1) {
        return directMemberIds[0] ?? null;
      }
    }
    const member = await findMemberForStripeCheckoutSession({
      prisma,
      session,
    });
    return member?.core.id ?? null;
  }

  if (processingContext.billingOwner) {
    return processingContext.billingOwner.lockMemberId;
  }
  if (processingContext.familyTransitionOwnerMemberId) {
    return processingContext.familyTransitionOwnerMemberId;
  }

  if (isHostedStripeSubscriptionBillingEvent(event.type)) {
    if (!processingContext.canonicalSubscription) {
      return null;
    }
    const member = await findMemberForStripeSubscription({
      prisma,
      subscription: processingContext.canonicalSubscription,
    });
    return member?.core.id ?? await resolveFamilySponsoredDirectSubscriptionMemberId({
      prisma,
      subscription: processingContext.canonicalSubscription,
    });
  }

  if (isHostedStripeFinancialReversalEvent(event.type)) {
    return null;
  }

  if (!isHostedStripeInvoiceBillingEvent(event.type)) {
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
  if (effectiveMember || canonicalMember) {
    return effectiveMember?.core.id ?? canonicalMember?.core.id ?? null;
  }
  return processingContext.canonicalSubscription
    ? resolveFamilySponsoredDirectSubscriptionMemberId({
        prisma,
        subscription: processingContext.canonicalSubscription,
      })
    : null;
}

async function resolveFamilySponsoredDirectSubscriptionMemberId(input: {
  prisma: Prisma.TransactionClient | PrismaClient;
  subscription: Stripe.Subscription;
}): Promise<string | null> {
  const memberId = normalizeNullableString(input.subscription.metadata?.memberId);
  if (
    !memberId ||
    !parseHostedBillingPlanCode(input.subscription.metadata?.billingPlanCode) ||
    !parseHostedBillingCheckoutOffer(input.subscription.metadata?.checkoutOffer)
  ) {
    return null;
  }
  return await readActiveHostedFamilySponsorship({
    memberId,
    prisma: input.prisma,
  })
    ? memberId
    : null;
}

function isHostedStripeSubscriptionBillingEvent(type: string): boolean {
  return type === "customer.subscription.created"
    || type === "customer.subscription.updated"
    || type === "customer.subscription.deleted"
    || type === "customer.subscription.paused"
    || type === "customer.subscription.resumed"
    || type === "customer.subscription.pending_update_applied"
    || type === "customer.subscription.pending_update_expired";
}

async function resolveHostedStripeEventCanonicalSubscription(
  event: Stripe.Event,
  financialSubscriptionId: string | null = null,
): Promise<Stripe.Subscription | null> {
  if (event.type === "customer.subscription.trial_will_end") {
    return null;
  }

  if (event.type.startsWith("customer.subscription.")) {
    const subscription = event.data.object as Stripe.Subscription;
    return withHostedStripeFailureLog(
      "subscription.retrieve.event-canonical",
      () => requireHostedStripeApi().subscriptions.retrieve(subscription.id, {
        expand: [...HOSTED_STRIPE_BILLING_SUBSCRIPTION_EXPANSIONS],
      }),
    );
  }

  if (isHostedStripeInvoiceBillingEvent(event.type)) {
    const subscriptionId = coerceStripeInvoiceSubscriptionId(event.data.object as Stripe.Invoice);

    if (!subscriptionId) {
      return null;
    }

    return withHostedStripeFailureLog(
      "subscription.retrieve.event-invoice",
      () => requireHostedStripeApi().subscriptions.retrieve(subscriptionId, {
        expand: [...HOSTED_STRIPE_BILLING_SUBSCRIPTION_EXPANSIONS],
      }),
    );
  }

  if (financialSubscriptionId) {
    return withHostedStripeFailureLog(
      "subscription.retrieve.event-financial",
      () => requireHostedStripeApi().subscriptions.retrieve(financialSubscriptionId, {
        expand: [...HOSTED_STRIPE_BILLING_SUBSCRIPTION_EXPANSIONS],
      }),
    );
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
  if (type.startsWith("refund.") || type === "charge.refund.updated") {
    return coerceHostedStripeEventObjectId(object.charge);
  }

  if (type === "charge.refunded") {
    return coerceHostedStripeEventObjectId(object.id);
  }

  if (type.startsWith("charge.dispute.")) {
    return coerceHostedStripeEventObjectId(object.charge);
  }

  if (type === "invoice.paid") {
    return coerceHostedStripeEventObjectId(object.charge);
  }

  return null;
}

function readHostedStripeEventPaymentIntentId(type: string, object: Record<string, unknown>): string | null {
  if (
    type.startsWith("refund.") ||
    type === "charge.refund.updated" ||
    type === "charge.refunded"
  ) {
    return coerceHostedStripeEventObjectId(object.payment_intent);
  }

  if (type.startsWith("charge.dispute.")) {
    return coerceHostedStripeEventObjectId(object.payment_intent);
  }

  if (type === "invoice.paid") {
    return coerceHostedStripeEventObjectId(object.payment_intent);
  }

  return null;
}

function coerceHostedStripeEventObjectId(value: unknown): string | null {
  if (typeof value === "string") {
    return coerceStripeObjectId(value);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return coerceStripeObjectId(Object.fromEntries(Object.entries(value)));
}

function isHostedStripeInvoiceBillingEvent(type: string): boolean {
  return type === "invoice.paid" ||
    type === "invoice.payment_failed" ||
    type === "invoice.payment_action_required" ||
    type === "invoice.payment_attempt_required" ||
    type === "invoice.finalization_failed" ||
    type === "invoice.marked_uncollectible" ||
    type === "invoice.voided";
}

function isHostedStripeFinancialReversalEvent(type: string): boolean {
  return type.startsWith("refund.") ||
    type === "charge.refund.updated" ||
    type === "charge.refunded" ||
    type.startsWith("charge.dispute.");
}

function isHostedStripePositiveBillingProjectionEvent(
  type: string,
  canonicalBillingStatus: HostedBillingStatus | null,
): boolean {
  return type === "invoice.paid" ||
    (
      isHostedStripeSubscriptionBillingEvent(type) &&
      canonicalBillingStatus === HostedBillingStatus.active
    );
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
  let usageCreditEventHandled = false;

  try {
    const stripeEvent = await fetchHostedStripeEventForReconciliation(claimed.eventId);
    const usageCreditReconciliation = await reconcileHostedUsageCreditStripeEvent({
      event: stripeEvent,
      prisma,
    });
    usageCreditEventHandled = usageCreditReconciliation.handled;
    const directBillingMemberId = usageCreditReconciliation.handled
      ? null
      : await resolveHostedStripeEventDirectBillingMemberId(
          stripeEvent,
          prisma,
        );
    const legacyFamilySubscriptionId = usageCreditReconciliation.handled ||
        directBillingMemberId
      ? null
      : await prisma.$transaction(
          (tx) => prepareHostedLegacySyntheticFamilyCleanupTx({ event: stripeEvent, tx }),
          HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
        );
    const processing = usageCreditReconciliation.handled
      ? {
          memberId: usageCreditReconciliation.beneficiaryMemberId,
          result: buildEmptyHostedStripeEventProcessingResult(),
        }
      : legacyFamilySubscriptionId
      ? { memberId: null, result: buildEmptyHostedStripeEventProcessingResult() }
      : directBillingMemberId
      ? await processHostedStripeEventWithVerifiedMemberLock({
          memberId: directBillingMemberId,
          observedAt: claimed.receivedAt,
          prisma,
          stripeEvent,
        })
      : await processHostedStripeEventWithDiscoveredMemberLock(
          stripeEvent,
          prisma,
          claimed.receivedAt,
        );
    const { memberId: processingMemberId, result } = processing;
    if (
      usageCreditReconciliation.handled &&
      usageCreditReconciliation.wakeRequired
    ) {
      try {
        await signalHostedUsageCreditRuntimeRecheck({
          prisma,
          userId: usageCreditReconciliation.beneficiaryMemberId,
        });
      } catch (error) {
        if (
          !isHostedOnboardingError(error) ||
          error.code !== "HOSTED_RUNTIME_USER_INACTIVE"
        ) {
          throw error;
        }
      }
    }
    if (legacyFamilySubscriptionId) {
      await executeHostedLegacySyntheticFamilyCleanup({
        invoice: stripeEvent.type === "invoice.paid"
          ? stripeEvent.data.object as Stripe.Invoice
          : null,
        subscriptionId: legacyFamilySubscriptionId,
      });
    }
    if (result.cleanupCheckoutSubscription) {
      await executeHostedCheckoutSubscriptionCleanup({
        candidate: result.cleanupCheckoutSubscription,
        prisma,
      });
    }
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
    const completed = await prisma.hostedStripeEvent.updateMany({
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
    if (completed.count !== 1) {
      throw new Error(
        "Stripe event receipt ownership changed before completion.",
      );
    }
    finishHostedOnboardingTiming(timing, "completed", {
      activatedMember: Boolean(result.activatedMemberId),
      activatedMemberCount: result.activatedMembers?.length ?? 0,
      hostedExecutionEventScheduled: Boolean(result.hostedExecutionEventId),
      subscriptionCancellationEmailCandidate:
        Boolean(result.subscriptionCancellationEmail),
      usageCreditGranted:
        usageCreditReconciliation.handled && usageCreditReconciliation.granted,
      welcomeEmailCandidate: Boolean(result.welcomeEmailMemberId),
    });

    const activatedMembers = result.activatedMembers ?? [];

    return {
      activatedMemberId: result.activatedMemberId,
      ...(activatedMembers.length > 0 ? { activatedMembers } : {}),
      eventId: claimed.eventId,
      hostedExecutionEventId: result.hostedExecutionEventId,
      status: "completed",
      ...(usageCreditReconciliation.handled && usageCreditReconciliation.granted
        ? {
            usageCreditGrantedMemberId:
              usageCreditReconciliation.beneficiaryMemberId,
          }
        : {}),
    };
  } catch (error) {
    const poisoned = claimed.attemptCount >= STRIPE_EVENT_MAX_ATTEMPTS &&
      !(error instanceof HostedLegacyFamilyCleanupPendingError) &&
      !(
        error instanceof HostedStripeEventRetrieveRetryableError &&
        error.providerDirectedRetry
      ) &&
      !usageCreditEventHandled &&
      !isHostedUsageCreditStripeRetryableError(error) &&
      !isHostedStripeRetryableFailure(error);
    logHostedStripeEventReconciliationFailure({
      attemptCount: claimed.attemptCount,
      error,
      eventId: claimed.eventId,
      eventType: claimed.type,
      poisoned,
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
          poisoned
            ? HostedStripeEventStatus.poisoned
            : HostedStripeEventStatus.failed,
      },
    });
    finishHostedOnboardingTiming(timing, "failed", {
      errorName: deriveHostedOnboardingTimingErrorName(error),
      poisoned,
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
  observedAt: Date,
): Promise<{
  memberId: string | null;
  result: Awaited<ReturnType<typeof processHostedStripeEventRecord>>;
}> {
  const processingContext = await prepareHostedStripeEventProcessingContext(stripeEvent, prisma);
  const discoveredMemberId = await resolveHostedStripeEventProcessingMemberId(
    stripeEvent,
    processingContext,
    prisma,
  );
  if (discoveredMemberId) {
    return processHostedStripeEventWithVerifiedMemberLock({
      memberId: discoveredMemberId,
      observedAt,
      prisma,
      stripeEvent,
    });
  }

  if (stripeEvent.type === "checkout.session.completed") {
    const session = stripeEvent.data.object as Stripe.Checkout.Session;
    if (session.metadata?.kind !== HOSTED_FAMILY_STRIPE_METADATA_KIND) {
      const rawMemberId = normalizeNullableString(session.client_reference_id);
      const isExactStandardMemberIdentity =
        session.metadata?.checkoutOffer === HOSTED_STANDARD_CHECKOUT_OFFER &&
        rawMemberId !== null &&
        normalizeNullableString(session.metadata?.memberId) === rawMemberId;
      if (!isExactStandardMemberIdentity) {
        return {
          memberId: null,
          result: buildEmptyHostedStripeEventProcessingResult(),
        };
      }
      const exactMember = await readHostedMemberBillingSnapshot({
          memberId: rawMemberId,
          prisma,
        });
      if (exactMember) {
        return processHostedStripeEventWithVerifiedMemberLock({
          memberId: rawMemberId,
          observedAt,
          prisma,
          stripeEvent,
        });
      }
    }
  }
  if (
    isHostedStripeUnownedTerminalSubscriptionDeletion({
      processingContext,
      stripeEvent,
    })
  ) {
    return {
      memberId: null,
      result: buildEmptyHostedStripeEventProcessingResult(),
    };
  }
  if (
    (
      isHostedStripeSubscriptionBillingEvent(stripeEvent.type) ||
      isHostedStripeInvoiceBillingEvent(stripeEvent.type)
    ) &&
    processingContext.canonicalSubscription?.metadata.kind !==
      HOSTED_FAMILY_STRIPE_METADATA_KIND
  ) {
    throw new Error("Canonical Stripe billing owner was unavailable for locked processing.");
  }
  if (
    isHostedStripeFinancialReversalEvent(stripeEvent.type) &&
    processingContext.canonicalSubscription &&
    !processingContext.billingOwner &&
    processingContext.canonicalSubscription.status !== "canceled" &&
    processingContext.canonicalSubscription.status !== "incomplete_expired"
  ) {
    throw new Error(
      "Canonical recurring financial owner was unavailable for locked processing.",
    );
  }

  return {
    memberId: null,
    result: await prisma.$transaction(
      (transaction) => processHostedStripeEventRecord(
        stripeEvent,
        processingContext,
        transaction,
        observedAt,
      ),
      HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
    ),
  };
}

function isHostedStripeUnownedTerminalSubscriptionDeletion(input: {
  processingContext: HostedStripeEventProcessingContext;
  stripeEvent: Stripe.Event;
}): boolean {
  const subscription = input.processingContext.canonicalSubscription;
  return input.stripeEvent.type === "customer.subscription.deleted"
    && input.processingContext.billingOwner === null
    && subscription !== null
    && (
      subscription.status === "canceled"
      || subscription.status === "incomplete_expired"
    );
}

async function processHostedStripeEventWithVerifiedMemberLock(input: {
  memberId: string;
  observedAt: Date;
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
      let processingContext = await prepareHostedStripeEventProcessingContext(
        input.stripeEvent,
        transaction,
      );
      const processingMemberId = await resolveHostedStripeEventProcessingMemberId(
        input.stripeEvent,
        processingContext,
        transaction,
      );
      if (processingMemberId !== input.memberId) {
        throw new Error("Canonical Stripe billing ownership changed before processing.");
      }
      processingContext =
        await reconcileHostedFamilyTransitionUnderVerifiedOwnerLock({
          eventCreatedAt:
            buildHostedStripeDispatchContext(input.stripeEvent).eventCreatedAt ??
            null,
          memberId: input.memberId,
          processingContext,
          stripeEvent: input.stripeEvent,
          tx: transaction,
        });
      const reconciledMemberId = await resolveHostedStripeEventProcessingMemberId(
        input.stripeEvent,
        processingContext,
        transaction,
      );
      if (reconciledMemberId !== input.memberId) {
        throw new Error(
          "Canonical Stripe billing ownership changed during locked transition reconciliation.",
        );
      }
      return processHostedStripeEventRecord(
        input.stripeEvent,
        processingContext,
        transaction,
        input.observedAt,
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

async function executeHostedLegacySyntheticFamilyCleanup(input: {
  invoice: Stripe.Invoice | null;
  subscriptionId: string;
}): Promise<void> {
  const stripe = requireHostedStripeApi();
  try {
    const subscription = await stripe.subscriptions.retrieve(input.subscriptionId);
    if (subscription.status !== "canceled" && subscription.status !== "incomplete_expired") {
      await stripe.subscriptions.cancel(input.subscriptionId, {}, {
        idempotencyKey: `hosted-family-legacy-cancel:${input.subscriptionId}`,
      });
    }
  } catch (error) {
    logHostedStripeFailure({
      error,
      operationName: "subscription.cancel.legacy-family-cleanup",
    });
    if (!error || typeof error !== "object" || !("code" in error) || error.code !== "resource_missing") {
      throw error;
    }
  }

  if (!input.invoice) {
    return;
  }
  const amountPaid = (input.invoice as Stripe.Invoice & {
    amount_paid?: unknown;
  }).amount_paid;
  if (amountPaid === 0) {
    return;
  }

  const payment = await resolveHostedStripeInvoicePayment(input.invoice, stripe);
  if (!payment) {
    throw new Error("Legacy Family refund requires an exact paid invoice payment.");
  }
  const refunds = await withHostedStripeFailureLog(
    "refunds.list.legacy-family-cleanup",
    () => stripe.refunds.list({ ...payment, limit: 100 }),
  );
  const matchingRefunds = refunds.data.filter((refund) =>
    refund.metadata?.[HOSTED_LEGACY_FAMILY_REFUND_INVOICE_METADATA_KEY] ===
      input.invoice?.id
  );
  if (matchingRefunds.some((refund) => refund.status === "succeeded")) {
    return;
  }
  if (matchingRefunds.some((refund) => refund.status === "pending")) {
    throw new HostedLegacyFamilyCleanupPendingError(
      "Legacy Family refund is pending.",
    );
  }
  if (matchingRefunds.length > 0) {
    throw new Error("Legacy Family refund previously failed.");
  }

  const refundInvoiceId = input.invoice.id;
  const refund = await withHostedStripeFailureLog(
    "refunds.create.legacy-family-cleanup",
    () => stripe.refunds.create({
      ...payment,
      metadata: {
        [HOSTED_LEGACY_FAMILY_REFUND_INVOICE_METADATA_KEY]: refundInvoiceId,
      },
    }, {
      idempotencyKey: `hosted-family-legacy-refund:${refundInvoiceId}`,
    }),
  );
  if (refund.status === "pending") {
    throw new HostedLegacyFamilyCleanupPendingError(
      "Legacy Family refund is pending.",
    );
  }
  if (refund.status !== "succeeded") {
    throw new Error("Legacy Family refund failed.");
  }
}

async function resolveHostedStripeInvoicePayment(
  invoice: Stripe.Invoice,
  stripe: Stripe,
): Promise<{ charge: string } | { payment_intent: string } | null> {
  const payment = (await withHostedStripeFailureLog(
    "invoicePayments.list.legacy-family-cleanup",
    () => stripe.invoicePayments.list({
      invoice: invoice.id,
      limit: 100,
      status: "paid",
      expand: ["data.payment.charge", "data.payment.payment_intent"],
    }),
  )).data[0];
  const paymentIntentId = coerceStripeObjectId(
    payment?.payment.payment_intent ??
      (invoice as Stripe.Invoice & { payment_intent?: string | null }).payment_intent,
  );
  if (paymentIntentId) {
    return { payment_intent: paymentIntentId };
  }
  const chargeId = coerceStripeObjectId(
    payment?.payment.charge ??
      (invoice as Stripe.Invoice & { charge?: string | null }).charge,
  );
  return chargeId ? { charge: chargeId } : null;
}

async function fetchHostedStripeEventForReconciliation(eventId: string): Promise<Stripe.Event> {
  const stripe = requireHostedStripeApi();
  try {
    return await stripe.events.retrieve(eventId);
  } catch (error) {
    logHostedStripeFailure({ error, operationName: "events.retrieve.reconciliation" });
    if (isHostedStripeDefinitiveRequestRejection(error)) {
      throw error;
    }
    throw new HostedStripeEventRetrieveRetryableError(error);
  }
}

async function signalHostedUsageCreditRuntimeRecheck(input: {
  prisma: PrismaClient;
  userId: string;
}): Promise<void> {
  await waitForHostedPostCommitOperation({
    deadlineMs: createHostedPostCommitDeadline(
      HOSTED_USAGE_CREDIT_RUNTIME_RECHECK_TIMEOUT_MS,
    ),
    operation: (abortSignal) => signalHostedRuntimeRecheckRuntime({
      abortSignal,
      prisma: input.prisma,
      userId: input.userId,
    }),
  });
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
    cleanupCheckoutSubscription?: HostedCheckoutSubscriptionCleanupCandidate | null;
    cleanupPulseTrialStripeSubscriptionId?: string | null;
    hostedExecutionEventId: string | null;
    welcomeEmailMemberId?: string | null;
  },
): {
  activatedMemberId: string | null;
  activatedMembers: HostedStripeActivatedMemberOutcome[];
  cleanupCheckoutSubscription: HostedCheckoutSubscriptionCleanupCandidate | null;
  cleanupPulseTrialStripeSubscriptionId: string | null;
  hostedExecutionEventId: string | null;
  subscriptionCancellationEmail: HostedSubscriptionCancellationEmailCandidate | null;
  welcomeEmailMemberId: string | null;
} {
  return {
    activatedMemberId: outcome.activatedMemberId,
    activatedMembers: outcome.activatedMembers ?? [],
    cleanupCheckoutSubscription: outcome.cleanupCheckoutSubscription ?? null,
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
    cleanupCheckoutSubscription?: HostedCheckoutSubscriptionCleanupCandidate | null;
    cleanupPulseTrialStripeSubscriptionId?: string | null;
    hostedExecutionEventId?: string | null;
    subscriptionCancellationEmail?: HostedSubscriptionCancellationEmailCandidate | null;
    welcomeEmailMemberId?: string | null;
  } | null | undefined,
): {
  activatedMemberId: string | null;
  activatedMembers: HostedStripeActivatedMemberOutcome[];
  cleanupCheckoutSubscription: HostedCheckoutSubscriptionCleanupCandidate | null;
  cleanupPulseTrialStripeSubscriptionId: string | null;
  hostedExecutionEventId: string | null;
  subscriptionCancellationEmail: HostedSubscriptionCancellationEmailCandidate | null;
  welcomeEmailMemberId: string | null;
} {
  return {
    activatedMemberId: outcome?.activatedMemberId ?? null,
    activatedMembers: outcome?.activatedMembers ?? [],
    cleanupCheckoutSubscription: outcome?.cleanupCheckoutSubscription ?? null,
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
  cleanupCheckoutSubscription: HostedCheckoutSubscriptionCleanupCandidate | null;
  cleanupPulseTrialStripeSubscriptionId: string | null;
  hostedExecutionEventId: string | null;
  subscriptionCancellationEmail: HostedSubscriptionCancellationEmailCandidate | null;
  welcomeEmailMemberId: string | null;
} {
  return {
    activatedMemberId: null,
    activatedMembers: [],
    cleanupCheckoutSubscription: null,
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
