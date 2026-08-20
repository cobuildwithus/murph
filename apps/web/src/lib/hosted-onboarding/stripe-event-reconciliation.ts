import {
  type HostedBillingStatus,
  HostedStripeEventStatus,
  Prisma,
  type PrismaClient,
} from "@prisma/client";
import type Stripe from "stripe";

import {
  prepareHostedCryptoDomainRootCandidates,
  type PreparedHostedCryptoDomainRootCandidates,
} from "../hosted-crypto/domain-root-store";
import {
  runWithHostedDomainRootUnwrapCache,
} from "../hosted-crypto/domain-root-unwrap-cache";
import {
  clearHostedBillingPlanSwitchToPulsePendingFieldsForScheduleTx,
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
  cleanupHostedFamilySponsoredDirectSubscription,
  cleanupHostedStandardCheckoutAndRetireAttempt,
  cancelHostedPulseTrialCheckoutLoserSubscription,
  HostedStripeFamilySponsoredCleanupPendingError,
  type HostedStripeCheckoutCleanup,
  type HostedStripeActivatedMemberOutcome,
  type HostedSubscriptionCancellationEmailCandidate,
  prepareHostedStripeCheckoutCompletion,
  prepareHostedStripeDirectMemberActivationCrypto,
  prepareHostedStripeReversalProviderState,
  isHostedStripeRefundEventType,
  type PreparedHostedStripeCheckoutCompletion,
  type PreparedHostedStripeReversalProviderState,
} from "./stripe-billing-events";
import {
  HOSTED_FAMILY_STRIPE_METADATA_KIND,
  prepareHostedFamilyStripeActivationCryptoDomainRoots,
  prepareHostedLegacySyntheticFamilyCleanupTx,
  type PreparedHostedFamilyCryptoDomainRoots,
} from "./family-plan";
import {
  findMemberForStripeInvoice,
  findMemberForStripeCheckoutSession,
  findMemberForStripeReversal,
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
  readStripeShouldRetryDirective,
} from "./billing";
import {
  HOSTED_FAMILY_MAX_SEATS,
  HOSTED_PULSE_TRIAL_OFFER,
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
import {
  requireHostedStripeApi,
  requireHostedStripeApiMode,
} from "./runtime";
import {
  logHostedStripeFailure,
  withHostedStripeFailureLog,
} from "./stripe-error-log";
import { scheduleHostedStripeReconciliationFailureAlert } from "./stripe-alert-email";
import {
  HostedStripeCheckoutLoserCleanupPendingError,
  refundHostedExactOrdinaryInvoicePayment,
} from "./stripe-checkout-loser-cleanup";
import {
  isHostedLegacyPulseTrialRetirableStatus,
} from "./pulse-trial-subscription-cleanup";
import { readActiveHostedFamilySponsorship } from "./member-access";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  normalizeNullableString,
} from "./shared";
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
import {
  isHostedOnboardingError,
  isHostedStripeEffectPendingError,
} from "./errors";
import {
  HOSTED_USAGE_CREDIT_STRIPE_PREPARATION_BUDGET,
  isHostedUsageCreditStripeRetryableError,
  reconcileHostedUsageCreditStripeEvent,
} from "./usage-credit-stripe-reconciliation";
import { signalHostedRuntimeRecheckRuntime } from "../hosted-orchestration/signal-runtime";
import {
  materializeHostedGroupSponsorshipIfApplicable,
} from "../hosted-groups/group-sponsorship-notification";

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
const HOSTED_STRIPE_RUNTIME_RECHECK_PENDING_CODE =
  "HOSTED_STRIPE_RUNTIME_RECHECK_PENDING";
const STRIPE_EVENT_LOG_STRING_MAX_LENGTH = 500;
const STRIPE_EVENT_SAFE_PRISMA_META_KEYS = new Set([
  "column",
  "constraint",
  "field_name",
  "modelName",
  "table",
  "target",
]);
const STRIPE_EVENT_RETRYABLE_PRISMA_CODES = new Set([
  "P1001",
  "P1002",
  "P1008",
  "P1017",
  "P2024",
  "P2034",
  "P2037",
]);
const HOSTED_LEGACY_FAMILY_REFUND_INVOICE_METADATA_KEY = "hosted_family_legacy_invoice_id";

class HostedLegacyFamilyCleanupPendingError extends Error {
  readonly code = "HOSTED_LEGACY_FAMILY_CLEANUP_PENDING";
}

class HostedStripeSubscriptionIdentityPendingError extends Error {
  readonly code = "HOSTED_STRIPE_SUBSCRIPTION_IDENTITY_PENDING";
}

class HostedStripeEventRetrieveRetryableError extends Error {
  readonly code = "HOSTED_STRIPE_EVENT_RETRIEVE_RETRYABLE";

  constructor(cause: unknown) {
    super(
      cause instanceof Error
        ? cause.message
        : "Stripe event retrieval must be retried.",
      { cause },
    );
    this.name = "HostedStripeEventRetrieveRetryableError";
  }
}

class HostedStripeRuntimeRecheckPendingError extends Error {
  readonly code = HOSTED_STRIPE_RUNTIME_RECHECK_PENDING_CODE;

  constructor(cause: unknown) {
    super("Hosted runtime recheck remains pending.", { cause });
    this.name = "HostedStripeRuntimeRecheckPendingError";
  }
}

export type HostedStripeEventReconcileResult = {
  activatedMemberId: string | null;
  activatedMembers?: HostedStripeActivatedMemberOutcome[];
  eventId: string;
  hostedExecutionEventId: string | null;
  hostedExecutionMailboxItemId?: string | null;
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
  if (candidates.length === 0) {
    return reconciledEventIds;
  }
  const { stripeLiveMode } = requireHostedStripeApiMode();

  for (const candidate of candidates) {
    const claimed = await claimHostedStripeEvent({
      eventId: candidate.eventId,
      lastErrorCode: candidate.lastErrorCode,
      now,
      prisma: input.prisma,
      status: candidate.status,
      updatedAt: candidate.updatedAt,
    });

    if (!claimed) {
      continue;
    }

    const result = await processClaimedHostedStripeEvent(
      claimed,
      input.prisma,
      stripeLiveMode,
    );
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
  const { stripeLiveMode } = requireHostedStripeApiMode();

  const claimed = await claimHostedStripeEvent({
    eventId: candidate.eventId,
    lastErrorCode: candidate.lastErrorCode,
    now,
    prisma: input.prisma,
    status: candidate.status,
    updatedAt: candidate.updatedAt,
  });

  if (!claimed) {
    return null;
  }

  return processClaimedHostedStripeEvent(
    claimed,
    input.prisma,
    stripeLiveMode,
  );
}

async function claimHostedStripeEvent(input: {
  eventId: string;
  lastErrorCode: string | null;
  now: Date;
  prisma: PrismaClient;
  status: HostedStripeEventStatus;
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

  const claimed = await input.prisma.hostedStripeEvent.findUnique({
    where: {
      eventId: input.eventId,
    },
  });
  return claimed
    ? {
        ...claimed,
        retryDirectPaidRuntimeRecheck:
          input.lastErrorCode === HOSTED_STRIPE_RUNTIME_RECHECK_PENDING_CODE
          || input.status === HostedStripeEventStatus.processing,
      }
    : null;
}

async function processHostedStripeEventRecord(
  event: Stripe.Event,
  processingContext: HostedStripeEventProcessingContext,
  prisma: Prisma.TransactionClient,
): Promise<{
  activatedMemberId: string | null;
  activatedMembers: HostedStripeActivatedMemberOutcome[];
  cleanupFamilySponsoredCheckout: HostedStripeCheckoutCleanup | null;
  cleanupFamilySponsoredStripeSubscriptionId: string | null;
  cleanupPulseTrialStripeSubscriptionId: string | null;
  cleanupStandardCheckout: HostedStripeCheckoutCleanup | null;
  hostedExecutionEventId: string | null;
  hostedExecutionMailboxItemId: string | null;
  runtimeRecheckMemberIds: string[];
  subscriptionCancellationEmail: HostedSubscriptionCancellationEmailCandidate | null;
  welcomeEmailMemberId: string | null;
}> {
  const payload = event.data.object;
  const dispatchContext: HostedStripeDispatchContext = buildHostedStripeDispatchContext(event);

  switch (event.type) {
    case "checkout.session.completed":
      if (processingContext.preparedCheckoutCompletion) {
        return mapHostedStripeActivationOutcome(
          await applyStripeCheckoutCompleted(
            payload as Stripe.Checkout.Session,
            prisma,
            dispatchContext,
            processingContext.preparedCryptoDomainRoots.size > 0
              ? processingContext.preparedCryptoDomainRoots
              : undefined,
            processingContext.preparedCheckoutCompletion,
          ),
        );
      }
      return mapHostedStripeActivationOutcome(
        processingContext.preparedCryptoDomainRoots.size > 0
          ? await applyStripeCheckoutCompleted(
              payload as Stripe.Checkout.Session,
              prisma,
              dispatchContext,
              processingContext.preparedCryptoDomainRoots,
            )
          : await applyStripeCheckoutCompleted(
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
    case "customer.subscription.trial_will_end":
      return mapHostedStripeSubscriptionUpdateOutcome(
        await applyStripeSubscriptionUpdated(
          requireHostedStripeCanonicalSubscription(processingContext, event.type),
          dispatchContext,
          prisma,
          processingContext.preparedFamilyCryptoDomainRoots,
          processingContext.preparedCryptoDomainRoots.size > 0
            ? processingContext.preparedCryptoDomainRoots
            : undefined,
        ),
      );
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
        await (
          processingContext.preparedCryptoDomainRoots.size > 0
            ? applyStripeInvoicePaid(
              payload as Stripe.Invoice,
              dispatchContext,
              prisma,
              processingContext.canonicalBillingStatus,
              processingContext.canonicalSubscription,
              processingContext.preparedCryptoDomainRoots,
              processingContext.preparedFamilyCryptoDomainRoots,
            )
            : applyStripeInvoicePaid(
              payload as Stripe.Invoice,
              dispatchContext,
              prisma,
              processingContext.canonicalBillingStatus,
              processingContext.canonicalSubscription,
              undefined,
              processingContext.preparedFamilyCryptoDomainRoots,
            )
        ),
      );
    case "invoice.payment_failed":
      await applyStripeInvoicePaymentFailed(
        payload as Stripe.Invoice,
        dispatchContext,
        prisma,
        processingContext.canonicalBillingStatus,
        processingContext.canonicalSubscription,
        processingContext.preparedFamilyCryptoDomainRoots,
      );
      return buildEmptyHostedStripeEventProcessingResult();
    case "refund.created":
    case "refund.updated":
      await applyStripeRefundCreated(
        payload as Stripe.Refund,
        dispatchContext,
        prisma,
        processingContext.customerId,
        processingContext.preparedReversalProviderState,
      );
      return buildEmptyHostedStripeEventProcessingResult();
    case "charge.dispute.created":
    case "charge.dispute.closed":
    case "charge.dispute.funds_reinstated":
    case "charge.dispute.funds_withdrawn":
      if (await applyStripeDisputeUpdated(
        payload as Stripe.Dispute,
        dispatchContext,
        prisma,
        processingContext.customerId,
        processingContext.preparedReversalProviderState,
      ) === "subscription_identity_pending") {
        throw new HostedStripeSubscriptionIdentityPendingError(
          "Stripe subscription identity is pending.",
        );
      }
      return buildEmptyHostedStripeEventProcessingResult();
    default:
      return buildEmptyHostedStripeEventProcessingResult();
  }
}

type HostedStripeEventProcessingContext = {
  canonicalBillingStatus: HostedBillingStatus | null;
  canonicalSubscription: Stripe.Subscription | null;
  customerId: string | null;
  preparedCryptoDomainRoots: PreparedHostedCryptoDomainRootCandidates;
  preparedFamilyCryptoDomainRoots: PreparedHostedFamilyCryptoDomainRoots;
  preparedCheckoutCompletion:
    PreparedHostedStripeCheckoutCompletion | null;
  preparedReversalProviderState:
    PreparedHostedStripeReversalProviderState | null;
};

async function prepareHostedStripeEventProcessingContext(
  event: Stripe.Event,
): Promise<HostedStripeEventProcessingContext> {
  const canonicalSubscription = await resolveHostedStripeEventCanonicalSubscription(event);
  const canonicalBillingStatus = canonicalSubscription
    ? mapStripeSubscriptionStatusToHostedBillingStatus(canonicalSubscription.status)
    : null;

  if (!isHostedStripeRefundEventType(event.type) && !event.type.startsWith("charge.dispute.")) {
    return {
      canonicalBillingStatus,
      canonicalSubscription,
      customerId: null,
      preparedCryptoDomainRoots: new Map(),
      preparedFamilyCryptoDomainRoots: new Map(),
      preparedCheckoutCompletion: null,
      preparedReversalProviderState: null,
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
    preparedCryptoDomainRoots: new Map(),
    preparedFamilyCryptoDomainRoots: new Map(),
    preparedCheckoutCompletion: null,
    preparedReversalProviderState: null,
  };
}

async function resolveHostedStripeEventDirectBillingMemberId(
  event: Stripe.Event,
  prisma: PrismaClient,
  preflightProcessingContext?: HostedStripeEventProcessingContext,
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
    const subscription =
      preflightProcessingContext?.canonicalSubscription
      ?? (event.data.object as Stripe.Subscription);
    const member = await findMemberForStripeSubscription({
      prisma,
      subscription,
    });
    return member?.core.id ?? await resolveFamilySponsoredDirectSubscriptionMemberId({
      prisma,
      subscription,
    });
  }

  if (
    isHostedStripeRefundEventType(event.type)
    || event.type.startsWith("charge.dispute.")
  ) {
    const object = readHostedStripeEventObject(event.data.object);
    const member = await findMemberForStripeReversal({
      chargeId: readHostedStripeEventChargeId(event.type, object),
      customerId: preflightProcessingContext?.customerId ?? null,
      paymentIntentId: readHostedStripeEventPaymentIntentId(event.type, object),
      prisma,
      subscriptionId: null,
    });
    return member?.core.id ?? null;
  }

  if (event.type !== "invoice.paid" && event.type !== "invoice.payment_failed") {
    return null;
  }

  const member = await findMemberForStripeInvoice({
    invoice: event.data.object as Stripe.Invoice,
    prisma,
    subscription: preflightProcessingContext?.canonicalSubscription,
  });
  if (member) {
    return member.core.id;
  }
  const canonicalSubscription =
    preflightProcessingContext?.canonicalSubscription
    ?? await resolveHostedStripeEventCanonicalSubscription(event);
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
    const memberIds = await listHostedStripeCheckoutSessionMemberIds({
      prisma,
      session,
    });
    return memberIds.length === 1 ? memberIds[0] ?? null : null;
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

  if (
    isHostedStripeRefundEventType(event.type)
    || event.type.startsWith("charge.dispute.")
  ) {
    const object = readHostedStripeEventObject(event.data.object);
    const member = await findMemberForStripeReversal({
      chargeId: readHostedStripeEventChargeId(event.type, object),
      customerId: processingContext.customerId,
      paymentIntentId: readHostedStripeEventPaymentIntentId(event.type, object),
      prisma,
      subscriptionId: null,
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
    || type === "customer.subscription.trial_will_end";
}

async function resolveHostedStripeEventCanonicalSubscription(
  event: Stripe.Event,
): Promise<Stripe.Subscription | null> {
  if (event.type.startsWith("customer.subscription.")) {
    const subscription = event.data.object as Stripe.Subscription;
    return withHostedStripeFailureLog(
      "subscription.retrieve.event-canonical",
      () => requireHostedStripeApi().subscriptions.retrieve(subscription.id),
    );
  }

  if (event.type === "invoice.paid" || event.type === "invoice.payment_failed") {
    const subscriptionId = coerceStripeInvoiceSubscriptionId(event.data.object as Stripe.Invoice);

    if (!subscriptionId) {
      return null;
    }

    return withHostedStripeFailureLog(
      "subscription.retrieve.event-invoice",
      () => requireHostedStripeApi().subscriptions.retrieve(subscriptionId),
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
  if (isHostedStripeRefundEventType(type)) {
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
  if (isHostedStripeRefundEventType(type)) {
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
  stripeLiveMode: boolean,
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
    const preflightProcessingContext =
      !usageCreditReconciliation.handled
      && hostedStripeEventNeedsPreflightProcessingContext(stripeEvent)
        ? await prepareHostedStripeEventProcessingContext(stripeEvent)
        : undefined;
    const directBillingMemberId = usageCreditReconciliation.handled
      ? null
      : await resolveHostedStripeEventDirectBillingMemberId(
          stripeEvent,
          prisma,
          preflightProcessingContext,
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
          preflightProcessingContext,
          prisma,
          stripeEvent,
        })
      : await processHostedStripeEventWithDiscoveredMemberLock(
          stripeEvent,
          prisma,
          preflightProcessingContext,
        );
    const { memberId: processingMemberId, result } = processing;
    if (result.cleanupPulseTrialStripeSubscriptionId && !processingMemberId) {
      throw new Error("Pulse Trial cleanup requires a direct billing member.");
    }
    if (result.cleanupFamilySponsoredStripeSubscriptionId && !processingMemberId) {
      throw new Error("Family-sponsored cleanup requires a direct billing member.");
    }
    if (result.cleanupFamilySponsoredCheckout && !processingMemberId) {
      throw new Error("Family-sponsored Checkout cleanup requires a direct billing member.");
    }
    if (result.cleanupStandardCheckout && !processingMemberId) {
      throw new Error("Standard Checkout cleanup requires a direct billing member.");
    }
    if (legacyFamilySubscriptionId) {
      await executeHostedLegacySyntheticFamilyCleanup({
        invoice: stripeEvent.type === "invoice.paid"
          ? stripeEvent.data.object as Stripe.Invoice
          : null,
        subscriptionId: legacyFamilySubscriptionId,
      });
    }
    const runtimeRecheckMemberIds = new Set(result.runtimeRecheckMemberIds);
    if (usageCreditReconciliation.handled && usageCreditReconciliation.wakeRequired) {
      runtimeRecheckMemberIds.add(usageCreditReconciliation.beneficiaryMemberId);
    }
    if (
      claimed.retryDirectPaidRuntimeRecheck
      && !usageCreditReconciliation.handled
      && processingMemberId
      && isHostedDirectPaidRuntimeRecheckEvent(stripeEvent.type)
      && await hasHostedMemberAcceptedDirectPaidPhase({
        memberId: processingMemberId,
        prisma,
      })
    ) {
      runtimeRecheckMemberIds.add(processingMemberId);
    }
    for (const memberId of runtimeRecheckMemberIds) {
      await signalHostedBillingRuntimeRecheckIgnoringInactive({
        prisma,
        userId: memberId,
      });
    }
    if (
      usageCreditReconciliation.handled &&
      usageCreditReconciliation.purchaseId
    ) {
      await materializeHostedGroupSponsorshipIfApplicable({
        prisma,
        purchaseId: usageCreditReconciliation.purchaseId,
      });
    }
    if (result.cleanupFamilySponsoredStripeSubscriptionId && processingMemberId) {
      await cleanupHostedFamilySponsoredDirectSubscription({
        memberId: processingMemberId,
        prisma,
        sourceEventId: `${claimed.eventId}:family-sponsored-cleanup`,
        subscriptionId: result.cleanupFamilySponsoredStripeSubscriptionId,
      });
    }
    if (result.cleanupFamilySponsoredCheckout && processingMemberId) {
      await cleanupHostedFamilySponsoredDirectSubscription({
        checkoutSessionId: result.cleanupFamilySponsoredCheckout.checkoutSessionId,
        memberId: processingMemberId,
        prisma,
        sourceEventId: `${claimed.eventId}:family-sponsored-checkout-cleanup`,
        subscriptionId: result.cleanupFamilySponsoredCheckout.subscriptionId,
      });
    }
    if (result.cleanupPulseTrialStripeSubscriptionId && processingMemberId) {
      await cancelHostedPulseTrialCheckoutLoserSubscription({
        memberId: processingMemberId,
        prisma,
        subscriptionId: result.cleanupPulseTrialStripeSubscriptionId,
      });
    }
    if (result.cleanupStandardCheckout && processingMemberId) {
      await cleanupHostedStandardCheckoutAndRetireAttempt({
        checkoutSessionId: result.cleanupStandardCheckout.checkoutSessionId,
        memberId: processingMemberId,
        prisma,
        subscriptionId: result.cleanupStandardCheckout.subscriptionId,
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
        activationResultJson: buildHostedStripeActivationResultJson(result),
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
    const hostedExecutionMailboxItemId =
      result.activatedMembers[0]?.hostedExecutionMailboxItemId
      ?? result.hostedExecutionMailboxItemId;

    return {
      activatedMemberId: result.activatedMemberId,
      ...(activatedMembers.length > 0 ? { activatedMembers } : {}),
      eventId: claimed.eventId,
      hostedExecutionEventId: result.hostedExecutionEventId,
      ...(hostedExecutionMailboxItemId
        ? { hostedExecutionMailboxItemId }
        : {}),
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
      !(error instanceof HostedStripeCheckoutLoserCleanupPendingError) &&
      !(error instanceof HostedStripeFamilySponsoredCleanupPendingError) &&
      !(error instanceof HostedStripeSubscriptionIdentityPendingError) &&
      !(error instanceof HostedStripeEventRetrieveRetryableError) &&
      !(error instanceof HostedStripeRuntimeRecheckPendingError) &&
      !isHostedStripeEffectPendingError(error) &&
      !usageCreditEventHandled &&
      !isHostedUsageCreditStripeRetryableError(error) &&
      !isHostedStripeEventOperationallyRetryableError(error);
    const reconciliationErrorCode = deriveHostedStripeEventErrorCode(error);
    logHostedStripeEventReconciliationFailure({
      attemptCount: claimed.attemptCount,
      error,
      eventId: claimed.eventId,
      eventType: claimed.type,
      poisoned,
    });
    if (claimed.attemptCount === 1) {
      scheduleHostedStripeReconciliationFailureAlert({
        errorCode: reconciliationErrorCode,
        eventId: claimed.eventId,
        eventType: claimed.type,
        livemode: stripeLiveMode,
      });
    }
    await prisma.hostedStripeEvent.updateMany({
      where: {
        attemptCount: claimed.attemptCount,
        eventId: claimed.eventId,
        status: HostedStripeEventStatus.processing,
      },
      data: {
        claimExpiresAt: null,
        lastErrorCode: sanitizeHostedOnboardingPersistedErrorCode(
          reconciliationErrorCode,
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

function isHostedDirectPaidRuntimeRecheckEvent(type: Stripe.Event.Type): boolean {
  return type === "invoice.paid"
    || type === "customer.subscription.created"
    || type === "customer.subscription.updated"
    || type === "customer.subscription.resumed";
}

async function hasHostedMemberAcceptedDirectPaidPhase(input: {
  memberId: string;
  prisma: PrismaClient;
}): Promise<boolean> {
  const member = await input.prisma.hostedMember.findUnique({
    where: {
      id: input.memberId,
    },
    select: {
      billingRef: {
        select: {
          currentBillingPhase: true,
        },
      },
    },
  });
  return member?.billingRef?.currentBillingPhase === "paid";
}

function isHostedStripeEventOperationallyRetryableError(
  error: unknown,
): boolean {
  const operationalError = unwrapHostedStripeOperationalError(error);
  if (operationalError !== error) {
    return isHostedStripeEventOperationallyRetryableError(operationalError);
  }
  if (error instanceof Prisma.PrismaClientInitializationError) {
    return typeof error.errorCode === "string" &&
      STRIPE_EVENT_RETRYABLE_PRISMA_CODES.has(error.errorCode);
  }
  if (
    error instanceof Prisma.PrismaClientKnownRequestError
    && STRIPE_EVENT_RETRYABLE_PRISMA_CODES.has(error.code)
  ) {
    return true;
  }
  if (
    error instanceof Error
    && (
      error.name === "AbortError"
      || error.name === "TimeoutError"
      || error.name === "PrismaClientRustPanicError"
    )
  ) {
    return true;
  }
  if (!error || typeof error !== "object") {
    return false;
  }

  const shouldRetry = readStripeShouldRetryDirective(error);
  if (shouldRetry !== null) {
    return shouldRetry;
  }
  const statusCode = "statusCode" in error && typeof error.statusCode === "number"
    ? error.statusCode
    : null;
  if (statusCode === 409 || statusCode === 429 || (statusCode !== null && statusCode >= 500)) {
    return true;
  }
  const type = "type" in error && typeof error.type === "string"
    ? error.type
    : null;
  const rawType = "rawType" in error && typeof error.rawType === "string"
    ? error.rawType
    : null;
  const code = "code" in error && typeof error.code === "string"
    ? error.code
    : null;
  return type === "StripeAPIError"
    || type === "StripeConnectionError"
    || type === "StripeRateLimitError"
    || rawType === "api_error"
    || rawType === "api_connection_error"
    || rawType === "rate_limit_error"
    || code === "ECONNRESET"
    || code === "ECONNREFUSED"
    || code === "ETIMEDOUT";
}

function unwrapHostedStripeOperationalError(error: unknown): unknown {
  let current = error;
  const seen = new Set<unknown>();

  while (
    isHostedOnboardingError(current)
    && current.cause !== undefined
    && current.cause !== current
    && !seen.has(current)
  ) {
    seen.add(current);
    current = current.cause;
  }

  return current;
}

async function processHostedStripeEventWithDiscoveredMemberLock(
  stripeEvent: Stripe.Event,
  prisma: PrismaClient,
  preflightProcessingContext?: HostedStripeEventProcessingContext,
): Promise<{
  memberId: string | null;
  result: Awaited<ReturnType<typeof processHostedStripeEventRecord>>;
}> {
  const processingContext = preflightProcessingContext
    ?? await prepareHostedStripeEventProcessingContext(stripeEvent);
  const discoveredMemberId = await resolveHostedStripeEventProcessingMemberId(
    stripeEvent,
    processingContext,
    prisma,
  );
  if (discoveredMemberId) {
    return processHostedStripeEventWithVerifiedMemberLock({
      memberId: discoveredMemberId,
      preflightProcessingContext: processingContext,
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

  const preparedFamilyCryptoDomainRoots = processingContext.canonicalSubscription
    ? await prepareHostedFamilyStripeActivationCryptoDomainRoots({
        prisma,
        subscription: processingContext.canonicalSubscription,
      })
    : new Map();
  return {
    memberId: null,
    result: await prisma.$transaction(
      (transaction) => processHostedStripeEventRecord(
        stripeEvent,
        {
          ...processingContext,
          preparedFamilyCryptoDomainRoots,
        },
        transaction,
      ),
      HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
    ),
  };
}

type HostedStripeEventWithVerifiedMemberLockInput = {
  memberId: string;
  preflightProcessingContext?: HostedStripeEventProcessingContext;
  prisma: PrismaClient;
  stripeEvent: Stripe.Event;
};

type HostedStripeEventWithVerifiedMemberLockResult = {
  memberId: string;
  result: Awaited<ReturnType<typeof processHostedStripeEventRecord>>;
};

async function processHostedStripeEventWithVerifiedMemberLock(
  input: HostedStripeEventWithVerifiedMemberLockInput,
): Promise<HostedStripeEventWithVerifiedMemberLockResult> {
  if (input.stripeEvent.type !== "checkout.session.completed") {
    return processHostedStripeEventWithVerifiedMemberLockCore(input);
  }
  return runWithHostedDomainRootUnwrapCache(
    () => processHostedStripeEventWithVerifiedMemberLockCore(input),
  );
}

async function processHostedStripeEventWithVerifiedMemberLockCore(
  input: HostedStripeEventWithVerifiedMemberLockInput,
): Promise<HostedStripeEventWithVerifiedMemberLockResult> {
  const preflightProcessingContext =
    input.preflightProcessingContext
    ?? await prepareHostedStripeEventProcessingContext(input.stripeEvent);
  const preparedCheckoutCompletion =
    input.stripeEvent.type === "checkout.session.completed"
      ? await prepareHostedStripeCheckoutCompletion({
          canonicalSubscription:
            preflightProcessingContext.canonicalSubscription,
          memberId: input.memberId,
          prisma: input.prisma,
          session: input.stripeEvent.data.object as Stripe.Checkout.Session,
        })
      : null;
  const preparedReversalProviderState =
    await prepareHostedStripeReversalProviderState({
      event: input.stripeEvent,
      memberId: input.memberId,
      prisma: input.prisma,
    });
  const preparedProcessingContext = {
    ...preflightProcessingContext,
    canonicalSubscription:
      preparedCheckoutCompletion?.canonicalSubscription
      ?? preflightProcessingContext.canonicalSubscription,
    preparedCheckoutCompletion,
    preparedReversalProviderState,
  };
  const preparedFamilyCryptoDomainRoots =
    preparedProcessingContext.canonicalSubscription
      ? await prepareHostedFamilyStripeActivationCryptoDomainRoots({
          prisma: input.prisma,
          subscription: preparedProcessingContext.canonicalSubscription,
        })
      : new Map();
  const preparedCryptoDomainRoots =
    await prepareHostedStripeEventCryptoDomainRoots({
      canonicalSubscription:
        preparedProcessingContext.canonicalSubscription,
      memberId: input.memberId,
      prisma: input.prisma,
      stripeEvent: input.stripeEvent,
    });
  const result = await withHostedMemberStripeMutationLock({
    memberId: input.memberId,
    prisma: input.prisma,
    run: async (transaction) => {
      const processingContext = {
        ...preparedProcessingContext,
        preparedCryptoDomainRoots,
        preparedFamilyCryptoDomainRoots,
      };
      const processingMemberId =
        await resolveHostedStripeEventProcessingMemberId(
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

function hostedStripeEventMayActivateDirectMember(
  stripeEvent: Stripe.Event,
  canonicalSubscription: Stripe.Subscription | null,
): boolean {
  if (stripeEvent.type === "invoice.paid") {
    return true;
  }
  if (stripeEvent.type === "checkout.session.completed") {
    const session = stripeEvent.data.object as Stripe.Checkout.Session;
    return parseHostedBillingCheckoutOffer(session.metadata?.checkoutOffer)
      === HOSTED_PULSE_TRIAL_OFFER;
  }
  if (stripeEvent.type.startsWith("customer.subscription.")) {
    const subscription = canonicalSubscription
      ?? (stripeEvent.data.object as Stripe.Subscription);
    return parseHostedBillingCheckoutOffer(
      subscription.metadata?.checkoutOffer,
    ) === HOSTED_PULSE_TRIAL_OFFER
      && isHostedLegacyPulseTrialRetirableStatus(subscription.status);
  }
  return false;
}

function hostedStripeEventNeedsPreflightProcessingContext(
  stripeEvent: Stripe.Event,
): boolean {
  return (
    isHostedStripeSubscriptionBillingEvent(stripeEvent.type)
    || stripeEvent.type === "invoice.paid"
    || stripeEvent.type === "invoice.payment_failed"
    || isHostedStripeRefundEventType(stripeEvent.type)
    || stripeEvent.type.startsWith("charge.dispute.")
  );
}

async function prepareHostedStripeEventCryptoDomainRoots(input: {
  canonicalSubscription: Stripe.Subscription | null;
  memberId: string;
  prisma: PrismaClient;
  stripeEvent: Stripe.Event;
}): Promise<PreparedHostedCryptoDomainRootCandidates> {
  if (
    input.canonicalSubscription?.metadata.kind === HOSTED_FAMILY_STRIPE_METADATA_KIND
    || !hostedStripeEventMayActivateDirectMember(
      input.stripeEvent,
      input.canonicalSubscription,
    )
  ) {
    return new Map();
  }
  if (input.stripeEvent.type === "checkout.session.completed") {
    return prepareHostedStripeDirectMemberActivationCrypto({
      memberId: input.memberId,
      prisma: input.prisma,
    });
  }
  return prepareHostedCryptoDomainRootCandidates({
    prisma: input.prisma,
    userId: input.memberId,
  });
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
  const amountPaid = (input.invoice as Stripe.Invoice & { amount_paid?: unknown }).amount_paid;
  if (amountPaid === 0) {
    return;
  }

  const refundInvoiceId = input.invoice.id;
  try {
    await refundHostedExactOrdinaryInvoicePayment({
      idempotencyKey: `hosted-family-legacy-refund:${refundInvoiceId}`,
      invoice: input.invoice,
      metadata: {
        [HOSTED_LEGACY_FAMILY_REFUND_INVOICE_METADATA_KEY]: refundInvoiceId,
      },
      reason: "duplicate",
      stripe,
    });
  } catch (error) {
    if (error instanceof HostedStripeCheckoutLoserCleanupPendingError) {
      throw new HostedLegacyFamilyCleanupPendingError(
        "Legacy Family refund is pending.",
      );
    }
    throw error;
  }
}

async function fetchHostedStripeEventForReconciliation(eventId: string): Promise<Stripe.Event> {
  const stripe = requireHostedStripeApi();
  try {
    return await stripe.events.retrieve(eventId);
  } catch (error) {
    logHostedStripeFailure({ error, operationName: "events.retrieve.reconciliation" });
    if (isDefinitiveHostedStripeEventRetrieveRejection(error)) {
      throw error;
    }
    throw new HostedStripeEventRetrieveRetryableError(error);
  }
}

function isDefinitiveHostedStripeEventRetrieveRejection(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const shouldRetry = readStripeShouldRetryDirective(error);
  if (shouldRetry !== null) {
    return !shouldRetry;
  }
  const statusCode = "statusCode" in error &&
      typeof error.statusCode === "number"
    ? error.statusCode
    : null;
  if (statusCode !== null) {
    return statusCode >= 400 &&
      statusCode < 500 &&
      statusCode !== 409 &&
      statusCode !== 429;
  }
  const type = "type" in error && typeof error.type === "string"
    ? error.type
    : null;
  const rawType = "rawType" in error && typeof error.rawType === "string"
    ? error.rawType
    : null;
  return type === "StripeInvalidRequestError" ||
    type === "StripeAuthenticationError" ||
    type === "StripePermissionError" ||
    rawType === "invalid_request_error" ||
    rawType === "authentication_error" ||
    rawType === "permission_error";
}

async function signalHostedBillingRuntimeRecheckIgnoringInactive(input: {
  prisma: PrismaClient;
  userId: string;
}): Promise<void> {
  try {
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
  } catch (error) {
    if (
      isHostedOnboardingError(error)
      && error.code === "HOSTED_RUNTIME_USER_INACTIVE"
    ) {
      return;
    }
    throw new HostedStripeRuntimeRecheckPendingError(error);
  }
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
    cleanupFamilySponsoredCheckout?: HostedStripeCheckoutCleanup | null;
    cleanupFamilySponsoredStripeSubscriptionId?: string | null;
    cleanupPulseTrialStripeSubscriptionId?: string | null;
    cleanupStandardCheckout?: HostedStripeCheckoutCleanup | null;
    hostedExecutionEventId: string | null;
    hostedExecutionMailboxItemId?: string | null;
    runtimeRecheckMemberIds?: string[];
    welcomeEmailMemberId?: string | null;
  },
): {
  activatedMemberId: string | null;
  activatedMembers: HostedStripeActivatedMemberOutcome[];
  cleanupFamilySponsoredCheckout: HostedStripeCheckoutCleanup | null;
  cleanupFamilySponsoredStripeSubscriptionId: string | null;
  cleanupPulseTrialStripeSubscriptionId: string | null;
  cleanupStandardCheckout: HostedStripeCheckoutCleanup | null;
  hostedExecutionEventId: string | null;
  hostedExecutionMailboxItemId: string | null;
  runtimeRecheckMemberIds: string[];
  subscriptionCancellationEmail: HostedSubscriptionCancellationEmailCandidate | null;
  welcomeEmailMemberId: string | null;
} {
  return {
    activatedMemberId: outcome.activatedMemberId,
    activatedMembers: outcome.activatedMembers ?? [],
    cleanupFamilySponsoredCheckout:
      outcome.cleanupFamilySponsoredCheckout ?? null,
    cleanupFamilySponsoredStripeSubscriptionId:
      outcome.cleanupFamilySponsoredStripeSubscriptionId ?? null,
    cleanupPulseTrialStripeSubscriptionId:
      outcome.cleanupPulseTrialStripeSubscriptionId ?? null,
    cleanupStandardCheckout: outcome.cleanupStandardCheckout ?? null,
    hostedExecutionEventId: outcome.hostedExecutionEventId,
    hostedExecutionMailboxItemId:
      outcome.hostedExecutionMailboxItemId ?? null,
    runtimeRecheckMemberIds: outcome.runtimeRecheckMemberIds ?? [],
    subscriptionCancellationEmail: null,
    welcomeEmailMemberId: outcome.welcomeEmailMemberId ?? null,
  };
}

function buildHostedStripeActivationResultJson(result: {
  activatedMemberId: string | null;
  activatedMembers: HostedStripeActivatedMemberOutcome[];
  hostedExecutionEventId: string | null;
  hostedExecutionMailboxItemId: string | null;
}): Prisma.InputJsonValue {
  const explicitActivations = result.activatedMembers.filter(
    (activation): activation is HostedStripeActivatedMemberOutcome & {
      activatedMemberId: string;
      hostedExecutionEventId: string;
    } => Boolean(activation.activatedMemberId && activation.hostedExecutionEventId),
  );
  const activations = explicitActivations.length > 0
    ? explicitActivations
    : result.activatedMemberId && result.hostedExecutionEventId
    ? [{
        activatedMemberId: result.activatedMemberId,
        hostedExecutionEventId: result.hostedExecutionEventId,
        hostedExecutionMailboxItemId:
          result.hostedExecutionMailboxItemId,
      }]
    : [];

  const activationMailboxItemIds = activations.map((activation) => {
    const mailboxItemId = activation.hostedExecutionMailboxItemId;
    if (!mailboxItemId) {
      throw new Error(
        "Stripe activation completion requires an exact mailbox pointer.",
      );
    }
    return mailboxItemId;
  });
  if (activationMailboxItemIds.length > HOSTED_FAMILY_MAX_SEATS) {
    throw new Error("Stripe activation completion exceeds the Family seat limit.");
  }

  return {
    activationMailboxItemIds,
    schema: "hosted.stripe.activation-result.v1",
  };
}

function mapHostedStripeSubscriptionUpdateOutcome(
  outcome: {
    activatedMemberId?: string | null;
    activatedMembers?: HostedStripeActivatedMemberOutcome[];
    cleanupFamilySponsoredCheckout?: HostedStripeCheckoutCleanup | null;
    cleanupFamilySponsoredStripeSubscriptionId?: string | null;
    cleanupPulseTrialStripeSubscriptionId?: string | null;
    cleanupStandardCheckout?: HostedStripeCheckoutCleanup | null;
    hostedExecutionEventId?: string | null;
    hostedExecutionMailboxItemId?: string | null;
    runtimeRecheckMemberIds?: string[];
    subscriptionCancellationEmail?: HostedSubscriptionCancellationEmailCandidate | null;
    welcomeEmailMemberId?: string | null;
  } | null | undefined,
): {
  activatedMemberId: string | null;
  activatedMembers: HostedStripeActivatedMemberOutcome[];
  cleanupFamilySponsoredCheckout: HostedStripeCheckoutCleanup | null;
  cleanupFamilySponsoredStripeSubscriptionId: string | null;
  cleanupPulseTrialStripeSubscriptionId: string | null;
  cleanupStandardCheckout: HostedStripeCheckoutCleanup | null;
  hostedExecutionEventId: string | null;
  hostedExecutionMailboxItemId: string | null;
  runtimeRecheckMemberIds: string[];
  subscriptionCancellationEmail: HostedSubscriptionCancellationEmailCandidate | null;
  welcomeEmailMemberId: string | null;
} {
  return {
    activatedMemberId: outcome?.activatedMemberId ?? null,
    activatedMembers: outcome?.activatedMembers ?? [],
    cleanupFamilySponsoredCheckout:
      outcome?.cleanupFamilySponsoredCheckout ?? null,
    cleanupFamilySponsoredStripeSubscriptionId:
      outcome?.cleanupFamilySponsoredStripeSubscriptionId ?? null,
    cleanupPulseTrialStripeSubscriptionId:
      outcome?.cleanupPulseTrialStripeSubscriptionId ?? null,
    cleanupStandardCheckout: outcome?.cleanupStandardCheckout ?? null,
    hostedExecutionEventId: outcome?.hostedExecutionEventId ?? null,
    hostedExecutionMailboxItemId:
      outcome?.hostedExecutionMailboxItemId ?? null,
    runtimeRecheckMemberIds: outcome?.runtimeRecheckMemberIds ?? [],
    subscriptionCancellationEmail:
      outcome?.subscriptionCancellationEmail ?? null,
    welcomeEmailMemberId: outcome?.welcomeEmailMemberId ?? null,
  };
}

function buildEmptyHostedStripeEventProcessingResult(): {
  activatedMemberId: string | null;
  activatedMembers: HostedStripeActivatedMemberOutcome[];
  cleanupFamilySponsoredCheckout: HostedStripeCheckoutCleanup | null;
  cleanupFamilySponsoredStripeSubscriptionId: string | null;
  cleanupPulseTrialStripeSubscriptionId: string | null;
  cleanupStandardCheckout: HostedStripeCheckoutCleanup | null;
  hostedExecutionEventId: string | null;
  hostedExecutionMailboxItemId: string | null;
  runtimeRecheckMemberIds: string[];
  subscriptionCancellationEmail: HostedSubscriptionCancellationEmailCandidate | null;
  welcomeEmailMemberId: string | null;
} {
  return {
    activatedMemberId: null,
    activatedMembers: [],
    cleanupFamilySponsoredCheckout: null,
    cleanupFamilySponsoredStripeSubscriptionId: null,
    cleanupPulseTrialStripeSubscriptionId: null,
    cleanupStandardCheckout: null,
    hostedExecutionEventId: null,
    hostedExecutionMailboxItemId: null,
    runtimeRecheckMemberIds: [],
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
