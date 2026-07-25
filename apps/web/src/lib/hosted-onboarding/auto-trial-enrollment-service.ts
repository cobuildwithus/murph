import { HostedBillingStatus, type Prisma, type PrismaClient } from "@prisma/client";
import type Stripe from "stripe";

import { getPrisma } from "../prisma";
import { runWithHostedDomainRootUnwrapCache } from "../hosted-crypto/domain-root-unwrap-cache";
import { assertHostedLaunchRequiredConsentGranted } from "../legal/consent";
import { HOSTED_APP_INITIAL_VISIT_HOME_PATH } from "./app-routes";
import { buildHostedBillingOfferMetadata } from "./billing-offer-metadata";
import {
  HOSTED_PULSE_TRIAL_DAYS,
  HOSTED_PULSE_TRIAL_OFFER,
  HOSTED_PULSE_TRIAL_POLICY_VERSION,
  isHostedAutoPulseTrialEnabled,
  parseHostedPulseTrialPolicyVersion,
} from "./billing-plans";
import { readStripeShouldRetryDirective } from "./billing";
import { isHostedMemberSuspended } from "./entitlement";
import { hostedOnboardingError, isHostedOnboardingError } from "./errors";
import {
  readHostedMemberBillingSnapshot,
  type HostedMemberBillingSnapshot,
} from "./hosted-member-store";
import {
  bindHostedMemberStripeCustomerIdIfMissingTx,
  HostedMemberStripeMutationLockBusyError,
  readHostedMemberPulseTrialCleanupOwnershipState,
  withHostedMemberStripeMutationLockForOps,
} from "./hosted-member-billing-store";
import { assertHostedMemberBillingStartMessagingReady } from "./billing-start-preconditions";
import { requireHostedInviteForBillingCheckout } from "./invite-service";
import { requiresHostedBillingCheckout } from "./lifecycle";
import {
  classifyHostedPulseTrialCandidateDisposition,
  classifyHostedPulseTrialCandidateLookupDisposition,
  cancelHostedPulseTrialLoserSubscription,
  cancelHostedPulseTrialLoserSubscriptionsForMember,
  isHostedPulseTrialSubscriptionForKnownPolicy,
  type HostedPulseTrialCandidateDisposition,
} from "./pulse-trial-subscription-cleanup";
import { createHostedStripeSubscriptionLookupKey } from "./contact-privacy";
import {
  activateHostedMemberForPositiveSourceTx,
} from "./member-activation";
import {
  signalHostedMemberActivationRuntimeWakeBestEffortResult,
} from "./member-activation-runtime-wake";
import { requireHostedStripeBillingPlanConfig } from "./runtime";
import {
  sendHostedSignupWelcomeEmailForMemberBestEffort,
} from "./signup-welcome-email";
import {
  buildHostedPulseTrialCustomerIdempotencyKey,
  createHostedPulseTrialStripeCustomer,
} from "./pulse-trial-customer";
import {
  writeHostedMemberStripeBillingTx,
} from "./stripe-billing-policy";
import type { HostedStripeDispatchContext } from "./stripe-dispatch";
import {
  logHostedStripeFailure,
  withHostedStripeFailureLog,
} from "./stripe-error-log";

const HOSTED_AUTO_PULSE_TRIAL_MEMBER_LOCK_ACQUISITION_TIMEOUT_MS = 2_000;
const HOSTED_AUTO_PULSE_TRIAL_RESERVATION_TRANSACTION_TIMEOUT_MS = 15_000;
const HOSTED_AUTO_PULSE_TRIAL_STRIPE_AUTHORITY_TIMEOUT_MS = 5_000;
// The common-path finalization transaction holds a pooled connection and the
// member row lock, and contains database work only: the bounded lock
// acquisition, one member snapshot read, at most one customer bind, the billing
// write, and the activation write. The sibling reservation transaction budgets
// 15 seconds for the lock plus read plus bind subset, so 30 seconds is double
// that budget for roughly double the statements. The rare serialized cleanup
// also uses this ceiling, while its Stripe call has the tighter five-second
// request timeout below.
const HOSTED_AUTO_PULSE_TRIAL_FINALIZATION_TRANSACTION_TIMEOUT_MS = 30_000;
// Loser cleanup still retrieves and cancels Stripe subscriptions while it holds
// the member lock, so it keeps the provider-sized budget until it is converted
// to the same prepare/commit/cleanup shape.
const HOSTED_AUTO_PULSE_TRIAL_LOSER_CLEANUP_TRANSACTION_TIMEOUT_MS = 120_000;
const HOSTED_AUTO_PULSE_TRIAL_FINALIZATION_MAX_ATTEMPTS = 3;
const HOSTED_AUTO_PULSE_TRIAL_FINALIZATION_RETRY_BASE_DELAY_MS = 25;
const HOSTED_AUTO_PULSE_TRIAL_STRIPE_AUTHORITY_REQUEST_OPTIONS = {
  maxNetworkRetries: 0,
  timeout: HOSTED_AUTO_PULSE_TRIAL_STRIPE_AUTHORITY_TIMEOUT_MS,
} as const satisfies Stripe.RequestOptions;

export type HostedAutoPulseTrialEnrollmentStatus =
  | "already_active"
  | "already_enrolled"
  | "enrolled";

export interface HostedAutoPulseTrialEnrollmentInput {
  inviteCode: string;
  member: HostedAutoPulseTrialAuthenticatedMember;
  now?: Date;
  prisma?: PrismaClient;
}

export interface HostedAutoPulseTrialAuthenticatedMember {
  id: string;
  suspendedAt: Date | null;
}

export interface HostedAutoPulseTrialEnrollmentResult {
  redirectPath: string;
  status: HostedAutoPulseTrialEnrollmentStatus;
}

export type HostedAutoPulseTrialCampaignSubscription = Pick<
  Stripe.Subscription,
  | "cancel_at"
  | "cancel_at_period_end"
  | "customer"
  | "id"
  | "metadata"
  | "status"
  | "trial_end"
  | "trial_start"
> & {
  created?: number;
  items?: {
    data: ReadonlyArray<{
      id: string;
      price?: {
        id?: string;
        metadata?: Record<string, string> | null;
        recurring?: {
          interval?: string;
          interval_count?: number;
          usage_type?: string;
        } | null;
      } | null;
      quantity?: number | null;
    }>;
    has_more?: boolean;
  };
};

export type HostedAutoPulseTrialCampaignDisposition =
  | {
      kind: "cleanup-obsolete";
      subscription: HostedAutoPulseTrialCampaignSubscription;
    }
  | {
      kind: "not-applicable";
      reason: "provider-trial-ended" | "provider-trial-not-found";
      subscription: HostedAutoPulseTrialCampaignSubscription | null;
    }
  | {
      kind: "recoverable";
      subscription: HostedAutoPulseTrialCampaignSubscription;
    };

export type HostedAutoPulseTrialCampaignApplyTxResult =
  | {
      kind: "cleaned-up";
      postCommitEffects: HostedAutoPulseTrialPostCommitEffects;
    }
  | {
      kind: "recovered";
      postCommitEffects: HostedAutoPulseTrialPostCommitEffects;
    };

export interface HostedAutoPulseTrialCampaignCandidateState {
  billingStatus: HostedBillingStatus;
  currentBillingPhase: string | null;
  currentStripeSubscriptionId: string | null;
  memberId: string;
  pulseTrialRedeemedAt: Date | null;
}

type HostedAutoPulseTrialPostCommitEffects = {
  activatedMemberId: string | null;
  hostedExecutionEventId: string | null;
  welcomeEmailMemberId: string | null;
};

type HostedAutoPulseTrialReservationOutcome =
  | {
      kind: "existing";
      result: HostedAutoPulseTrialEnrollmentResult;
    }
  | {
      kind: "reserved";
      stripeCustomerId: string;
    };

type HostedAutoPulseTrialFinalizationOutcome =
  | {
      kind: "completed";
      cleanupStripeSubscriptionId: string | null;
      postCommitEffects: HostedAutoPulseTrialPostCommitEffects;
      result: HostedAutoPulseTrialEnrollmentResult;
    }
  | {
      kind: "failed";
      cleanupStripeSubscriptionId: string;
      error: Error;
    };

const EMPTY_AUTO_TRIAL_POST_COMMIT_EFFECTS: HostedAutoPulseTrialPostCommitEffects = {
  activatedMemberId: null,
  hostedExecutionEventId: null,
  welcomeEmailMemberId: null,
};

export async function ensureHostedAutoPulseTrialEnrollment(
  input: HostedAutoPulseTrialEnrollmentInput,
): Promise<HostedAutoPulseTrialEnrollmentResult> {
  const prisma = input.prisma ?? getPrisma();
  const now = input.now ?? new Date();

  if (!isHostedAutoPulseTrialEnabled()) {
    throw hostedOnboardingError({
      code: "HOSTED_AUTO_PULSE_TRIAL_DISABLED",
      message: "Auto Pulse Trial enrollment is not available yet.",
      httpStatus: 404,
    });
  }

  const invite = await requireHostedInviteForBillingCheckout(
    input.inviteCode,
    prisma,
    now,
  );

  if (invite.member.id !== input.member.id) {
    throw hostedOnboardingError({
      code: "AUTH_INVITE_MISMATCH",
      message: "That invite belongs to a different hosted member.",
      httpStatus: 403,
    });
  }

  if (
    isHostedMemberSuspended(input.member.suspendedAt) ||
    isHostedMemberSuspended(invite.member.suspendedAt)
  ) {
    throw hostedOnboardingError({
      code: "HOSTED_MEMBER_SUSPENDED",
      message: "This hosted account is suspended. Contact support to restore access.",
      httpStatus: 403,
    });
  }

  await assertHostedLaunchRequiredConsentGranted({
    memberId: invite.member.id,
    prisma,
  });

  await assertHostedMemberBillingStartMessagingReady({
    identity: invite.member.identity,
    prisma,
    routing: invite.member.routing,
  });

  const initialMember = await readHostedAutoPulseTrialEnrollmentMember({
    memberId: invite.member.id,
    prisma,
  });
  const { priceId, stripe } = requireHostedStripeBillingPlanConfig({
    billingPlanCode: "launch_monthly",
  });
  const initialStatus = resolveHostedAutoPulseTrialExistingStatus(initialMember);
  if (initialStatus) {
    await cleanupHostedAutoPulseTrialLosersForExistingEnrollment({
      currentMember: initialMember,
      memberId: invite.member.id,
      priceId,
      prisma,
      stripe,
    });
    return buildHostedAutoPulseTrialEnrollmentResult(initialStatus);
  }

  assertHostedAutoPulseTrialEligible(initialMember);

  const metadata = buildHostedAutoPulseTrialMetadata(invite.member.id);
  const candidateStripeCustomerId = initialMember.billingRef?.stripeCustomerId ??
    await createHostedPulseTrialStripeCustomer({
      memberId: invite.member.id,
      stripe,
    });

  let reservation: HostedAutoPulseTrialReservationOutcome;
  try {
    reservation = await withHostedMemberStripeMutationLockForOps({
      acquisitionTimeoutMs:
        HOSTED_AUTO_PULSE_TRIAL_MEMBER_LOCK_ACQUISITION_TIMEOUT_MS,
      memberId: invite.member.id,
      prisma,
      run: (tx): Promise<HostedAutoPulseTrialReservationOutcome> =>
        runWithHostedDomainRootUnwrapCache(async () => {
          const currentMember = await readHostedAutoPulseTrialEnrollmentMember({
            memberId: invite.member.id,
            prisma: tx,
          });
          const currentStatus =
            resolveHostedAutoPulseTrialExistingStatus(currentMember);
          if (currentStatus) {
            return {
              kind: "existing",
              result: buildHostedAutoPulseTrialEnrollmentResult(currentStatus),
            };
          }

          assertHostedAutoPulseTrialEligible(currentMember);
          const reservedBillingRef = currentMember.billingRef?.stripeCustomerId
            ? currentMember.billingRef
            : await bindHostedMemberStripeCustomerIdIfMissingTx({
                memberId: invite.member.id,
                stripeCustomerId: candidateStripeCustomerId,
                tx,
              });
          const stripeCustomerId = reservedBillingRef?.stripeCustomerId;
          if (!stripeCustomerId) {
            throw hostedOnboardingError({
              code: "HOSTED_AUTO_PULSE_TRIAL_CUSTOMER_BIND_FAILED",
              httpStatus: 409,
              message:
                "Murph could not reserve Stripe billing for trial activation. Try again.",
              retryable: true,
            });
          }

          return {
            kind: "reserved",
            stripeCustomerId,
          };
        }),
      transactionTimeoutMs:
        HOSTED_AUTO_PULSE_TRIAL_RESERVATION_TRANSACTION_TIMEOUT_MS,
    });
  } catch (error) {
    if (error instanceof HostedMemberStripeMutationLockBusyError) {
      throw buildHostedAutoPulseTrialFinalizationBusyError();
    }
    throw error;
  }

  if (reservation.kind === "existing") {
    const currentMember = await readHostedAutoPulseTrialEnrollmentMember({
      memberId: invite.member.id,
      prisma,
    });
    await cleanupHostedAutoPulseTrialLosersForExistingEnrollment({
      currentMember,
      memberId: invite.member.id,
      priceId,
      prisma,
      stripe,
    });
    return reservation.result;
  }

  const subscription = await resolveHostedAutoPulseTrialStripeSubscription({
    memberId: invite.member.id,
    metadata,
    priceId,
    stripe,
    stripeCustomerId: reservation.stripeCustomerId,
  });
  return finalizeHostedAutoPulseTrialEnrollment({
    memberId: invite.member.id,
    now,
    priceId,
    prisma,
    stripe,
    stripeCustomerId: reservation.stripeCustomerId,
    subscriptionId: subscription.id,
  });
}

export async function inspectHostedAutoPulseTrialCampaignDisposition(input: {
  candidate: HostedAutoPulseTrialCampaignCandidateState;
  priceId: string;
  requestOptions: Stripe.RequestOptions;
  stripe: Stripe;
  stripeCustomerId: string;
  targetStripeSubscriptionId?: string;
  trialStartedBefore: Date;
}): Promise<HostedAutoPulseTrialCampaignDisposition> {
  const subscriptions = await listHostedAutoPulseTrialStripeSubscriptionsForRecovery({
    pageLimit: 1,
    requestOptions: input.requestOptions,
    stripe: input.stripe,
    stripeCustomerId: input.stripeCustomerId,
  });
  const matchingSubscriptions = subscriptions.data
    .filter((subscription) => isHostedAutoPulseTrialStripeSubscriptionForMember({
      memberId: input.candidate.memberId,
      priceId: input.priceId,
      stripeCustomerId: input.stripeCustomerId,
      subscription,
      trialStartedBefore: input.trialStartedBefore,
    }))
    .filter((subscription) =>
      !isTerminalHostedAutoPulseTrialStripeSubscription(subscription)
    )
    .sort(compareHostedStripeSubscriptionsNewestFirst);
  if (!input.targetStripeSubscriptionId && matchingSubscriptions.length > 1) {
    throw hostedOnboardingError({
      code: "HOSTED_AUTO_PULSE_TRIAL_RECOVERY_REQUIRED",
      httpStatus: 409,
      message: "Murph found an unfinished trial setup. Contact support to restore access.",
    });
  }
  const subscription = input.targetStripeSubscriptionId
    ? matchingSubscriptions.find(
        (candidate) => candidate.id === input.targetStripeSubscriptionId,
      ) ?? null
    : matchingSubscriptions[0] ?? null;
  if (!subscription) {
    return {
      kind: "not-applicable",
      reason: "provider-trial-not-found",
      subscription: null,
    };
  }

  if (classifyHostedPulseTrialCandidateDisposition({
    billingStatus: input.candidate.billingStatus,
    currentBillingPhase: input.candidate.currentBillingPhase,
    currentStripeSubscriptionId: input.candidate.currentStripeSubscriptionId,
    pulseTrialRedeemedAt: input.candidate.pulseTrialRedeemedAt,
    subscriptionId: subscription.id,
  }) === "loser") {
    return {
      kind: "cleanup-obsolete",
      subscription,
    };
  }

  if (subscription.status === "active" || subscription.status === "paused") {
    return {
      kind: "not-applicable",
      reason: "provider-trial-ended",
      subscription,
    };
  }

  if (subscription.status !== "trialing") {
    throw hostedOnboardingError({
      code: "HOSTED_AUTO_PULSE_TRIAL_RECOVERY_REQUIRED",
      httpStatus: 409,
      message: "Murph found an unfinished trial setup. Contact support to restore access.",
    });
  }

  return {
    kind: "recoverable",
    subscription,
  };
}

export async function applyHostedAutoPulseTrialCampaignDispositionTx(input: {
  campaignPolicy: {
    minimumTrialRunwaySeconds: number;
    priceId: string;
    trialStartedBefore: Date;
  };
  currentMember: HostedMemberBillingSnapshot;
  disposition: Exclude<HostedAutoPulseTrialCampaignDisposition, { kind: "not-applicable" }>;
  now: Date;
  requestOptions: Stripe.RequestOptions;
  stripe: Stripe;
  stripeCustomerId: string;
  tx: Prisma.TransactionClient;
}): Promise<HostedAutoPulseTrialCampaignApplyTxResult> {
  if (input.disposition.kind === "cleanup-obsolete") {
    const cleanupSubscriptionId = readHostedAutoPulseTrialCleanupSubscriptionId({
      currentMember: input.currentMember,
      subscription: input.disposition.subscription,
    });
    if (!cleanupSubscriptionId) {
      throw hostedOnboardingError({
        code: "HOSTED_AUTO_PULSE_TRIAL_RECOVERY_REQUIRED",
        httpStatus: 409,
        message: "Murph found an unfinished trial setup. Contact support to restore access.",
      });
    }
    await cancelHostedAutoPulseTrialStripeSubscriptionIfNeeded({
      requestOptions: input.requestOptions,
      stripe: input.stripe,
      subscriptionId: cleanupSubscriptionId,
    });
    return {
      kind: "cleaned-up",
      postCommitEffects: EMPTY_AUTO_TRIAL_POST_COMMIT_EFFECTS,
    };
  }

  assertHostedAutoPulseTrialCampaignSubscriptionEligible({
    memberId: input.currentMember.core.id,
    minimumTrialRunwaySeconds: input.campaignPolicy.minimumTrialRunwaySeconds,
    now: input.now,
    priceId: input.campaignPolicy.priceId,
    stripeCustomerId: input.stripeCustomerId,
    subscription: input.disposition.subscription,
    trialStartedBefore: input.campaignPolicy.trialStartedBefore,
  });

  const outcome = await finalizeHostedAutoPulseTrialEnrollmentTx({
    currentMember: input.currentMember,
    // The campaign owner already holds the member lock for this transaction and
    // asserts the trial runway against this same clock just above, so it is the
    // locked freshness clock for this caller.
    lockedNow: input.now,
    memberId: input.currentMember.core.id,
    now: input.now,
    stripeCustomerId: input.stripeCustomerId,
    subscription: input.disposition.subscription,
    trialSnapshot: readHostedAutoPulseTrialSubscriptionSnapshot(
      input.disposition.subscription,
    ),
    tx: input.tx,
  });
  if (outcome.kind === "failed") {
    throw outcome.error;
  }
  await cancelHostedAutoPulseTrialStripeSubscriptionIfNeeded({
    requestOptions: input.requestOptions,
    stripe: input.stripe,
    subscriptionId: outcome.cleanupStripeSubscriptionId,
  });
  return {
    kind: outcome.result.status === "enrolled" ? "recovered" : "cleaned-up",
    postCommitEffects: outcome.postCommitEffects,
  };
}

function assertHostedAutoPulseTrialCampaignSubscriptionEligible(input: {
  memberId: string;
  minimumTrialRunwaySeconds: number;
  now: Date;
  priceId: string;
  stripeCustomerId: string;
  subscription: HostedAutoPulseTrialCampaignSubscription;
  trialStartedBefore: Date;
}): void {
  const subscription = input.subscription;
  const trialStart = readHostedStripeObjectDate(subscription, "trial_start");
  const trialEnd = readHostedStripeObjectDate(subscription, "trial_end");
  const customerId = typeof subscription.customer === "string"
    ? subscription.customer
    : subscription.customer && typeof subscription.customer === "object"
      ? Reflect.get(subscription.customer, "id")
      : null;
  if (
    subscription.status !== "trialing" ||
    subscription.cancel_at_period_end ||
    subscription.cancel_at !== null ||
    customerId !== input.stripeCustomerId ||
    !isHostedPulseTrialSubscriptionForKnownPolicy({
      memberId: input.memberId,
      priceId: input.priceId,
      subscription,
    }) ||
    !trialStart ||
    !trialEnd ||
    trialStart >= input.trialStartedBefore ||
    trialStart >= trialEnd ||
    trialEnd.getTime() <= input.now.getTime() +
      input.minimumTrialRunwaySeconds * 1000
  ) {
    throw hostedOnboardingError({
      code: "HOSTED_AUTO_PULSE_TRIAL_RECOVERY_REQUIRED",
      httpStatus: 409,
      message: "Murph found an unfinished trial setup. Contact support to restore access.",
    });
  }
}

export async function runHostedAutoPulseTrialCampaignPostCommitEffects(input: {
  effects: HostedAutoPulseTrialPostCommitEffects;
  prisma: PrismaClient;
  timeoutMs: number;
}): Promise<void> {
  try {
    if (input.effects.activatedMemberId && input.effects.hostedExecutionEventId) {
      await signalHostedMemberActivationRuntimeWakeBestEffortResult({
        hostedExecutionEventId: input.effects.hostedExecutionEventId,
        memberId: input.effects.activatedMemberId,
        prisma: input.prisma,
        source: "auto-pulse-trial.campaign-activation",
        timeoutMs: input.timeoutMs,
      });
    }

    if (input.effects.welcomeEmailMemberId && input.timeoutMs >= 31_000) {
      await sendHostedSignupWelcomeEmailForMemberBestEffort({
        memberId: input.effects.welcomeEmailMemberId,
        prisma: input.prisma,
      });
    }
  } catch {
    // The durable member.activated mailbox item is the continuation. These
    // immediate effects are bounded latency hints and cannot change a commit.
  }
}

/**
 * Finalizes an auto Pulse Trial in three phases so the common enrollment path
 * never holds a pooled connection or member row lock across Stripe. The rare
 * loser-cleanup phase deliberately retains the lock through cancellation to
 * protect the ownership decision from concurrent adoption.
 *
 * 1. Read the authoritative provider state and judge it, outside every
 *    transaction and outside the member lock.
 * 2. Take the member lock in a short database-only transaction, re-read the
 *    member under that lock, and write only from that revalidated state.
 * 3. After the transaction commits, reacquire the member lock for the rare
 *    loser cleanup, recheck only database ownership facts, and keep the lock
 *    until the bounded Stripe cancellation settles.
 *
 * Serialization is preserved because every Stripe mutation of a member's Pulse
 * Trial subscriptions is decided under this same member lock. Phase 2 therefore
 * cannot interleave with another flow's write, and the locked re-read in
 * {@link finalizeHostedAutoPulseTrialEnrollmentTx} still decides the outcome
 * against the member state that exists at write time, not the state that
 * existed when phase 1 read Stripe.
 *
 * Moving the provider read out of the lock makes the phase 1 judgement age
 * while the lock is contended, so both time-sensitive halves are revalidated
 * later: phase 2 rechecks the retrieved trial's own expiry against a clock read
 * under the lock, and phase 3 keeps serialization through the irreversible
 * provider effect so no other billing flow can adopt the loser before cancel.
 */
async function finalizeHostedAutoPulseTrialEnrollment(input: {
  memberId: string;
  now: Date;
  priceId: string;
  prisma: PrismaClient;
  stripe: Stripe;
  stripeCustomerId: string;
  subscriptionId: string;
}): Promise<HostedAutoPulseTrialEnrollmentResult> {
  const subscription = await retrieveHostedAutoPulseTrialFinalizationSubscription({
    stripe: input.stripe,
    subscriptionId: input.subscriptionId,
  });
  const decisionNow = new Date();
  assertHostedAutoPulseTrialFinalizationSubscriptionEligible({
    memberId: input.memberId,
    priceId: input.priceId,
    stripeCustomerId: input.stripeCustomerId,
    subscription,
  });
  const trialSnapshot = readHostedAutoPulseTrialSubscriptionSnapshot(
    subscription,
    decisionNow,
  );

  let outcome: HostedAutoPulseTrialFinalizationOutcome;
  try {
    outcome = await runHostedAutoPulseTrialFinalizationWithMemberLockRetry({
      memberId: input.memberId,
      now: input.now,
      prisma: input.prisma,
      stripeCustomerId: input.stripeCustomerId,
      subscription,
      trialSnapshot,
    });
  } catch (error) {
    if (error instanceof HostedMemberStripeMutationLockBusyError) {
      throw buildHostedAutoPulseTrialFinalizationBusyError();
    }
    throw error;
  }

  // The losing reservation is cancelled after the commit, so a Stripe round
  // trip can no longer abort a decided enrollment or leave a cancelled trial
  // behind a rolled-back write. A cleanup failure still surfaces as a retryable
  // error: that keeps the caller retrying until the subscription is either
  // cancelled here or picked up by the loser sweep on the next enrollment.
  if (outcome.cleanupStripeSubscriptionId) {
    await cancelHostedAutoPulseTrialLoserWhileSerialized({
      memberId: input.memberId,
      prisma: input.prisma,
      stripe: input.stripe,
      subscriptionId: outcome.cleanupStripeSubscriptionId,
    });
  }

  if (outcome.kind === "failed") {
    throw outcome.error;
  }

  await runHostedAutoPulseTrialPostCommitEffects({
    ...outcome.postCommitEffects,
    prisma: input.prisma,
  });

  return outcome.result;
}

function buildHostedAutoPulseTrialFinalizationBusyError() {
  return hostedOnboardingError({
    code: "HOSTED_AUTO_PULSE_TRIAL_FINALIZATION_BUSY",
    httpStatus: 503,
    message: "Murph is still finishing this trial setup. Try again.",
    retryable: true,
  });
}

/**
 * Rechecks that the subscription this attempt is about to cancel is still not
 * current, then keeps the member lock through the bounded Stripe cancellation.
 *
 * The finalization transaction chose the loser and then released the lock, so
 * another serialized billing flow can bind that same subscription as the
 * member's current one before the post-commit cancel runs. Cancelling then
 * would revoke the member's live trial, so ownership is re-read under the same
 * lock every billing write already takes and that serialization is retained
 * until the irreversible effect settles. The read compares the candidate's
 * blind lookup key and never loads or decrypts a Stripe identifier.
 *
 * Only the `current` disposition blocks the cancel. An `eligible` member is one
 * whose enrollment failed on its own state (suspended, blocked billing), and
 * that member still owns an unreferenced live trial that must be cancelled
 * rather than leaked.
 */
async function cancelHostedAutoPulseTrialLoserWhileSerialized(input: {
  memberId: string;
  prisma: PrismaClient;
  stripe: Stripe;
  subscriptionId: string;
}): Promise<void> {
  const candidateStripeSubscriptionLookupKey =
    createHostedStripeSubscriptionLookupKey(input.subscriptionId);
  if (!candidateStripeSubscriptionLookupKey) {
    throw new Error("Hosted auto Pulse Trial cleanup subscription id is invalid.");
  }

  try {
    await withHostedMemberStripeMutationLockForOps({
      acquisitionTimeoutMs:
        HOSTED_AUTO_PULSE_TRIAL_MEMBER_LOCK_ACQUISITION_TIMEOUT_MS,
      memberId: input.memberId,
      prisma: input.prisma,
      run: async (tx): Promise<void> => {
        const ownership =
          await readHostedMemberPulseTrialCleanupOwnershipState({
            memberId: input.memberId,
            prisma: tx,
          });
        const disposition = ownership
          ? classifyHostedPulseTrialCandidateLookupDisposition({
              billingStatus: ownership.billingStatus,
              candidateStripeSubscriptionLookupKey,
              currentBillingPhase: ownership.currentBillingPhase,
              currentStripeSubscriptionLookupKey:
                ownership.stripeSubscriptionLookupKey,
              pulseTrialRedeemedAt: ownership.pulseTrialRedeemedAt,
            })
          : "current";

        if (disposition === "current") {
          // The trial is now owned by another serialized billing flow. Leave it
          // untouched and make this stale attempt retry instead of cancelling
          // live access.
          throw hostedOnboardingError({
            code: "HOSTED_PULSE_TRIAL_CLEANUP_OWNER_CHANGED",
            httpStatus: 409,
            message: "Murph could not confirm the unused Stripe trial. Try again.",
            retryable: true,
          });
        }

        await cancelHostedAutoPulseTrialStripeSubscriptionIfNeeded({
          requestOptions:
            HOSTED_AUTO_PULSE_TRIAL_STRIPE_AUTHORITY_REQUEST_OPTIONS,
          stripe: input.stripe,
          subscriptionId: input.subscriptionId,
        });
      },
      transactionTimeoutMs:
        HOSTED_AUTO_PULSE_TRIAL_FINALIZATION_TRANSACTION_TIMEOUT_MS,
    });
  } catch (error) {
    if (error instanceof HostedMemberStripeMutationLockBusyError) {
      throw buildHostedAutoPulseTrialFinalizationBusyError();
    }
    throw error;
  }
}

async function runHostedAutoPulseTrialFinalizationWithMemberLockRetry(input: {
  memberId: string;
  now: Date;
  prisma: PrismaClient;
  stripeCustomerId: string;
  subscription: HostedAutoPulseTrialCampaignSubscription;
  trialSnapshot: ReturnType<typeof readHostedAutoPulseTrialSubscriptionSnapshot>;
}): Promise<HostedAutoPulseTrialFinalizationOutcome> {
  for (
    let attempt = 1;
    attempt <= HOSTED_AUTO_PULSE_TRIAL_FINALIZATION_MAX_ATTEMPTS;
    attempt += 1
  ) {
    try {
      return await withHostedMemberStripeMutationLockForOps({
        acquisitionTimeoutMs:
          HOSTED_AUTO_PULSE_TRIAL_MEMBER_LOCK_ACQUISITION_TIMEOUT_MS,
        memberId: input.memberId,
        prisma: input.prisma,
        run: (tx): Promise<HostedAutoPulseTrialFinalizationOutcome> =>
          runWithHostedDomainRootUnwrapCache(async () => {
            const currentMember = await readHostedAutoPulseTrialEnrollmentMember({
              memberId: input.memberId,
              prisma: tx,
            });
            return finalizeHostedAutoPulseTrialEnrollmentTx({
              currentMember,
              // Read after the lock and the locked member re-read, so the
              // phase 1 provider judgement is measured against the instant the
              // write can actually happen.
              lockedNow: new Date(),
              memberId: input.memberId,
              now: input.now,
              stripeCustomerId: input.stripeCustomerId,
              subscription: input.subscription,
              trialSnapshot: input.trialSnapshot,
              tx,
            });
          }),
        transactionTimeoutMs:
          HOSTED_AUTO_PULSE_TRIAL_FINALIZATION_TRANSACTION_TIMEOUT_MS,
      });
    } catch (error) {
      if (
        !(error instanceof HostedMemberStripeMutationLockBusyError) ||
        attempt === HOSTED_AUTO_PULSE_TRIAL_FINALIZATION_MAX_ATTEMPTS
      ) {
        throw error;
      }
      await waitForHostedAutoPulseTrialFinalizationRetry(attempt);
    }
  }

  throw new Error("Hosted auto Pulse Trial finalization attempts exhausted.");
}

async function waitForHostedAutoPulseTrialFinalizationRetry(
  completedAttempt: number,
): Promise<void> {
  const delayCeilingMs =
    HOSTED_AUTO_PULSE_TRIAL_FINALIZATION_RETRY_BASE_DELAY_MS *
    (2 ** (completedAttempt - 1));
  const delayMs = Math.floor(Math.random() * (delayCeilingMs + 1));
  if (delayMs === 0) {
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function retrieveHostedAutoPulseTrialFinalizationSubscription(input: {
  stripe: Stripe;
  subscriptionId: string;
}): Promise<HostedAutoPulseTrialCampaignSubscription> {
  try {
    return await input.stripe.subscriptions.retrieve(
      input.subscriptionId,
      {},
      HOSTED_AUTO_PULSE_TRIAL_STRIPE_AUTHORITY_REQUEST_OPTIONS,
    );
  } catch (error) {
    logHostedStripeFailure({
      error,
      operationName: "subscription.retrieve.auto-trial-finalization",
    });
    if (isDefinitiveHostedAutoPulseTrialStripeAuthorityRejection(error)) {
      throw hostedOnboardingError({
        cause: error,
        code: "HOSTED_AUTO_PULSE_TRIAL_STRIPE_REJECTED",
        httpStatus: 502,
        message: "Murph could not confirm this trial. Contact support.",
      });
    }
    throw hostedOnboardingError({
      cause: error,
      code: "HOSTED_AUTO_PULSE_TRIAL_STRIPE_UNAVAILABLE",
      httpStatus: 503,
      message: "Stripe is still confirming this trial. Try again.",
      retryable: true,
    });
  }
}

function isDefinitiveHostedAutoPulseTrialStripeAuthorityRejection(
  error: unknown,
): boolean {
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

function assertHostedAutoPulseTrialFinalizationSubscriptionEligible(input: {
  memberId: string;
  priceId: string;
  stripeCustomerId: string;
  subscription: HostedAutoPulseTrialCampaignSubscription;
}): void {
  const customerId = typeof input.subscription.customer === "string"
    ? input.subscription.customer
    : input.subscription.customer?.id;
  if (
    input.subscription.status !== "trialing" ||
    input.subscription.cancel_at_period_end ||
    input.subscription.cancel_at !== null ||
    customerId !== input.stripeCustomerId ||
    !isHostedPulseTrialSubscriptionForKnownPolicy({
      memberId: input.memberId,
      priceId: input.priceId,
      subscription: input.subscription,
    })
  ) {
    throw hostedOnboardingError({
      code: "HOSTED_AUTO_PULSE_TRIAL_SUBSCRIPTION_CHANGED",
      httpStatus: 409,
      message: "Stripe trial state changed before activation. Try again.",
      retryable: true,
    });
  }
}

async function finalizeHostedAutoPulseTrialEnrollmentTx(input: {
  currentMember: HostedMemberBillingSnapshot;
  lockedNow: Date;
  memberId: string;
  now: Date;
  stripeCustomerId: string;
  subscription: HostedAutoPulseTrialCampaignSubscription;
  trialSnapshot: ReturnType<typeof readHostedAutoPulseTrialSubscriptionSnapshot>;
  tx: Prisma.TransactionClient;
}): Promise<HostedAutoPulseTrialFinalizationOutcome> {
  const trialPolicyVersion = parseHostedPulseTrialPolicyVersion(
    input.subscription.metadata.trialPolicyVersion,
  );
  if (!trialPolicyVersion) {
    throw hostedOnboardingError({
      code: "HOSTED_AUTO_PULSE_TRIAL_SUBSCRIPTION_CHANGED",
      httpStatus: 409,
      message: "Stripe trial state changed before activation. Try again.",
      retryable: true,
    });
  }
  const currentStatus = resolveHostedAutoPulseTrialExistingStatus(input.currentMember);
  const isIncompleteSameTrial = currentStatus === "already_enrolled" &&
    input.currentMember.billingRef?.pulseTrialRedeemedAt === null &&
    input.currentMember.billingRef.stripeSubscriptionId === input.subscription.id;
  if (currentStatus && !isIncompleteSameTrial) {
    return {
      kind: "completed",
      cleanupStripeSubscriptionId: readHostedAutoPulseTrialCleanupSubscriptionId({
        currentMember: input.currentMember,
        subscription: input.subscription,
      }),
      postCommitEffects: EMPTY_AUTO_TRIAL_POST_COMMIT_EFFECTS,
      result: buildHostedAutoPulseTrialEnrollmentResult(currentStatus),
    };
  }

  const eligibilityError = isIncompleteSameTrial
    ? null
    : readHostedAutoPulseTrialEligibilityError(input.currentMember);
  if (eligibilityError) {
    return {
      kind: "failed",
      cleanupStripeSubscriptionId: input.subscription.id,
      error: eligibilityError,
    };
  }

  assertHostedAutoPulseTrialSnapshotStillFresh({
    lockedNow: input.lockedNow,
    trialSnapshot: input.trialSnapshot,
  });

  const finalBillingRef = input.currentMember.billingRef?.stripeCustomerId
    ? input.currentMember.billingRef
    : await bindHostedMemberStripeCustomerIdIfMissingTx({
        memberId: input.memberId,
        stripeCustomerId: input.stripeCustomerId,
        tx: input.tx,
      });
  if (finalBillingRef?.stripeCustomerId !== input.stripeCustomerId) {
    return {
      kind: "failed",
      cleanupStripeSubscriptionId: input.subscription.id,
      error: hostedOnboardingError({
        code: "HOSTED_AUTO_PULSE_TRIAL_CUSTOMER_BIND_FAILED",
        httpStatus: 409,
        message: "Murph could not reserve Stripe billing for trial activation. Try again.",
        retryable: true,
      }),
    };
  }

  const dispatchContext = buildHostedAutoPulseTrialDispatchContext({
    billingRefLastStripeEventCreatedAt:
      input.currentMember.billingRef?.lastStripeEventCreatedAt ?? null,
    now: input.now,
    subscription: input.subscription,
  });
  const updatedMember = await writeHostedMemberStripeBillingTx({
    billingStatus: HostedBillingStatus.active,
    canonicalBillingStatus: HostedBillingStatus.active,
    currentBillingPhase: "trial",
    currentBillingPlanCode: "launch_monthly",
    currentCheckoutOffer: HOSTED_PULSE_TRIAL_OFFER,
    currentPeriodEnd: input.trialSnapshot.currentPeriodEnd,
    currentPeriodStart: input.trialSnapshot.currentPeriodStart,
    currentTrialEndsAt: input.trialSnapshot.trialEndsAt,
    currentTrialStartedAt: input.trialSnapshot.trialStartedAt,
    dispatchContext,
    freshnessPolicy: "auto-pulse-trial-entitlement",
    member: input.currentMember,
    pulseTrialPolicyVersion: trialPolicyVersion,
    pulseTrialRedeemedAt: input.trialSnapshot.trialStartedAt,
    stripeCustomerId: input.stripeCustomerId,
    stripeSubscriptionId: input.subscription.id,
    tx: input.tx,
  });
  if (!updatedMember) {
    throw hostedOnboardingError({
      code: "HOSTED_AUTO_PULSE_TRIAL_WRITE_SKIPPED",
      httpStatus: 409,
      message: "Murph could not finish trial activation. Try again.",
      retryable: true,
    });
  }

  const activation = await activateHostedMemberForPositiveSourceTx({
    dispatchContext,
    memberId: updatedMember.core.id,
    prisma: input.tx,
    skipIfBillingAlreadyActive: false,
    skipIfPreviouslyActivated: true,
  });
  return {
    kind: "completed",
    cleanupStripeSubscriptionId: null,
    postCommitEffects: {
      activatedMemberId: activation.activated ? updatedMember.core.id : null,
      hostedExecutionEventId: activation.hostedExecutionEventId,
      welcomeEmailMemberId:
        activation.activated || activation.hostedExecutionEventId
          ? updatedMember.core.id
          : null,
    },
    result: buildHostedAutoPulseTrialEnrollmentResult("enrolled"),
  };
}

/**
 * Rejects a provider judgement that has aged out before the locked write.
 *
 * The subscription was retrieved and judged eligible outside the lock, so an
 * almost-expired trial can pass that judgement and then expire while this
 * attempt waits for the member row. Every other field of the retrieved
 * subscription is frozen at retrieval time and cannot change without another
 * provider read, which must not happen under the lock; the trial's own expiry
 * is the part of that judgement that decays on its own, so it is recomputed
 * against the locked clock. Persisting past it would mark the member active on
 * a trial that has already ended.
 *
 * The failure is the same retryable disposition the pre-lock eligibility check
 * raises, so the caller's retry reruns phase 1 against fresh provider state
 * rather than skipping the write and reporting success.
 */
function assertHostedAutoPulseTrialSnapshotStillFresh(input: {
  lockedNow: Date;
  trialSnapshot: ReturnType<typeof readHostedAutoPulseTrialSubscriptionSnapshot>;
}): void {
  if (input.trialSnapshot.trialEndsAt.getTime() > input.lockedNow.getTime()) {
    return;
  }

  throw hostedOnboardingError({
    code: "HOSTED_AUTO_PULSE_TRIAL_SUBSCRIPTION_CHANGED",
    httpStatus: 409,
    message: "Stripe trial state changed before activation. Try again.",
    retryable: true,
  });
}

async function readHostedAutoPulseTrialEnrollmentMember(input: {
  memberId: string;
  prisma: PrismaClient | Prisma.TransactionClient;
}): Promise<HostedMemberBillingSnapshot> {
  const member = await readHostedMemberBillingSnapshot({
    memberId: input.memberId,
    prisma: input.prisma,
  });

  if (!member) {
    throw hostedOnboardingError({
      code: "HOSTED_MEMBER_NOT_FOUND",
      httpStatus: 403,
      message: "Finish signup from your latest Murph link before continuing.",
    });
  }

  return member;
}

function resolveHostedAutoPulseTrialExistingStatus(
  member: HostedMemberBillingSnapshot,
): HostedAutoPulseTrialEnrollmentStatus | null {
  if (
    isHostedMemberSuspended(member.core.suspendedAt) ||
    member.core.billingStatus !== HostedBillingStatus.active
  ) {
    return null;
  }

  return member.billingRef?.currentBillingPhase === "trial" &&
    member.billingRef.currentCheckoutOffer === HOSTED_PULSE_TRIAL_OFFER
    ? "already_enrolled"
    : "already_active";
}

function assertHostedAutoPulseTrialEligible(
  member: HostedMemberBillingSnapshot,
): void {
  const error = readHostedAutoPulseTrialEligibilityError(member);
  if (error) {
    throw error;
  }
}

function readHostedAutoPulseTrialEligibilityError(
  member: HostedMemberBillingSnapshot,
): Error | null {
  if (isHostedMemberSuspended(member.core.suspendedAt)) {
    return hostedOnboardingError({
      code: "HOSTED_MEMBER_SUSPENDED",
      message: "This hosted account is suspended. Contact support to restore access.",
      httpStatus: 403,
    });
  }

  if (member.billingRef?.pulseTrialRedeemedAt) {
    return hostedOnboardingError({
      code: "HOSTED_PULSE_TRIAL_ALREADY_REDEEMED",
      message: "This hosted account has already used its Pulse Trial.",
      httpStatus: 409,
    });
  }

  if (!requiresHostedBillingCheckout(member.core.billingStatus)) {
    return hostedOnboardingError({
      code: "HOSTED_AUTO_PULSE_TRIAL_BLOCKED",
      message: "This hosted account cannot start a trial right now. Contact support to restore access.",
      httpStatus: 403,
    });
  }

  return null;
}

function buildHostedAutoPulseTrialMetadata(memberId: string): Record<string, string> {
  return buildHostedBillingOfferMetadata({
    billingPlanCode: "launch_monthly",
    checkoutOffer: HOSTED_PULSE_TRIAL_OFFER,
    memberId,
  });
}

async function createHostedAutoPulseTrialStripeSubscription(input: {
  idempotencyKeyScope: string;
  metadata: Record<string, string>;
  memberId: string;
  priceId: string;
  stripe: Stripe;
  stripeCustomerId: string;
}): Promise<Stripe.Subscription> {
  return withHostedStripeFailureLog(
    "subscription.create.auto-trial",
    () => input.stripe.subscriptions.create({
      customer: input.stripeCustomerId,
      items: [
        {
          price: input.priceId,
          quantity: 1,
        },
      ],
      metadata: input.metadata,
      trial_period_days: HOSTED_PULSE_TRIAL_DAYS,
      trial_settings: {
        end_behavior: {
          missing_payment_method: "pause",
        },
      },
    }, {
      idempotencyKey: buildHostedAutoPulseTrialSubscriptionIdempotencyKey({
        memberId: input.memberId,
        policyVersion: HOSTED_PULSE_TRIAL_POLICY_VERSION,
        priceId: input.priceId,
        recoveryScope: input.idempotencyKeyScope,
        stripeCustomerId: input.stripeCustomerId,
      }),
    }),
  );
}

type HostedAutoPulseTrialStripeSubscriptionRecovery = {
  idempotencyKeyScope: string;
  otherLiveSubscription: Stripe.Subscription | null;
  reusableSubscription: Stripe.Subscription | null;
};

async function resolveHostedAutoPulseTrialStripeSubscription(input: {
  metadata: Record<string, string>;
  memberId: string;
  priceId: string;
  stripe: Stripe;
  stripeCustomerId: string;
}): Promise<Stripe.Subscription> {
  const recovery =
    await findReusableHostedAutoPulseTrialStripeSubscription(input);

  if (recovery.reusableSubscription) {
    return recovery.reusableSubscription;
  }

  return createHostedAutoPulseTrialStripeSubscription({
    ...input,
    idempotencyKeyScope: recovery.idempotencyKeyScope,
  });
}

async function cleanupHostedAutoPulseTrialLosersForExistingEnrollment(input: {
  currentMember: HostedMemberBillingSnapshot;
  memberId: string;
  priceId: string;
  prisma: PrismaClient;
  stripe: Stripe;
}): Promise<void> {
  if (!resolveHostedAutoPulseTrialExistingStatus(input.currentMember)) {
    return;
  }
  const stripeCustomerId = input.currentMember.billingRef?.stripeCustomerId;
  const stripeSubscriptionId = input.currentMember.billingRef?.stripeSubscriptionId ?? null;
  if (!stripeCustomerId) {
    return;
  }

  const subscriptions = await listHostedAutoPulseTrialStripeSubscriptionsForRecovery({
    pageLimit: 1,
    requestOptions: HOSTED_AUTO_PULSE_TRIAL_STRIPE_AUTHORITY_REQUEST_OPTIONS,
    stripe: input.stripe,
    stripeCustomerId,
  });
  const loserSubscriptionIds = subscriptions.data
    .filter((subscription) => isHostedPulseTrialSubscriptionForKnownPolicy({
      memberId: input.memberId,
      priceId: input.priceId,
      subscription,
    }))
    .filter((subscription) =>
      !isTerminalHostedAutoPulseTrialStripeSubscription(subscription) &&
      subscription.id !== stripeSubscriptionId
    )
    .map((subscription) => subscription.id);

  try {
    await cancelHostedPulseTrialLoserSubscriptionsForMember({
      lockBudget: {
        acquisitionTimeoutMs:
          HOSTED_AUTO_PULSE_TRIAL_MEMBER_LOCK_ACQUISITION_TIMEOUT_MS,
        transactionTimeoutMs:
          HOSTED_AUTO_PULSE_TRIAL_LOSER_CLEANUP_TRANSACTION_TIMEOUT_MS,
      },
      memberId: input.memberId,
      priceId: input.priceId,
      prisma: input.prisma,
      requestOptions:
        HOSTED_AUTO_PULSE_TRIAL_STRIPE_AUTHORITY_REQUEST_OPTIONS,
      stripe: input.stripe,
      subscriptionIds: loserSubscriptionIds,
    });
  } catch (error) {
    if (error instanceof HostedMemberStripeMutationLockBusyError) {
      throw buildHostedAutoPulseTrialFinalizationBusyError();
    }
    throw error;
  }
}

async function findReusableHostedAutoPulseTrialStripeSubscription(input: {
  acceptOtherLiveSubscription?: boolean;
  acceptPausedAsEnded?: boolean;
  memberId: string;
  pageLimit?: number;
  priceId: string;
  requestOptions?: Stripe.RequestOptions;
  stripe: Stripe;
  stripeCustomerId: string;
  trialStartedBefore?: Date;
}): Promise<HostedAutoPulseTrialStripeSubscriptionRecovery> {
  const subscriptions = await listHostedAutoPulseTrialStripeSubscriptionsForRecovery(input);

  const matchingSubscriptions = subscriptions.data
    .filter((subscription) => isHostedAutoPulseTrialStripeSubscriptionForMember({
      memberId: input.memberId,
      priceId: input.priceId,
      subscription,
      trialStartedBefore: input.trialStartedBefore,
    }))
    .sort(compareHostedStripeSubscriptionsNewestFirst);
  const liveMatchingSubscriptions = matchingSubscriptions.filter(
    (subscription) => !isTerminalHostedAutoPulseTrialStripeSubscription(subscription),
  );
  const terminalMatchingSubscriptions = matchingSubscriptions.filter(
    isTerminalHostedAutoPulseTrialStripeSubscription,
  );
  if (liveMatchingSubscriptions.length > 1) {
    throw hostedOnboardingError({
      code: "HOSTED_AUTO_PULSE_TRIAL_RECOVERY_REQUIRED",
      httpStatus: 409,
      message: "Murph found an unfinished trial setup. Contact support to restore access.",
    });
  }

  const reusableSubscription = liveMatchingSubscriptions.find(
    (subscription) => isReusableHostedAutoPulseTrialStripeSubscription({
      memberId: input.memberId,
      priceId: input.priceId,
      subscription,
    }),
  );

  if (reusableSubscription) {
    return {
      idempotencyKeyScope: buildHostedAutoPulseTrialSubscriptionIdempotencyKeyScope(
        terminalMatchingSubscriptions,
      ),
      otherLiveSubscription: null,
      reusableSubscription,
    };
  }

  const otherLiveSubscription = input.acceptOtherLiveSubscription
    ? liveMatchingSubscriptions[0] ?? null
    : input.acceptPausedAsEnded
      ? liveMatchingSubscriptions.find((subscription) => subscription.status === "paused") ?? null
      : null;
  if (otherLiveSubscription) {
    return {
      idempotencyKeyScope: buildHostedAutoPulseTrialSubscriptionIdempotencyKeyScope(
        terminalMatchingSubscriptions,
      ),
      otherLiveSubscription,
      reusableSubscription: null,
    };
  }

  if (liveMatchingSubscriptions.length > 0) {
    throw hostedOnboardingError({
      code: "HOSTED_AUTO_PULSE_TRIAL_RECOVERY_REQUIRED",
      httpStatus: 409,
      message: "Murph found an unfinished trial setup. Contact support to restore access.",
    });
  }

  return {
    idempotencyKeyScope: buildHostedAutoPulseTrialSubscriptionIdempotencyKeyScope(
      terminalMatchingSubscriptions,
    ),
    otherLiveSubscription: null,
    reusableSubscription: null,
  };
}

async function listHostedAutoPulseTrialStripeSubscriptionsForRecovery(input: {
  pageLimit?: number;
  requestOptions?: Stripe.RequestOptions;
  stripe: Stripe;
  stripeCustomerId: string;
}): Promise<Stripe.ApiList<Stripe.Subscription>> {
  const data: Stripe.Subscription[] = [];
  let startingAfter: string | undefined;
  let pagesRead = 0;

  try {
    for (;;) {
      const params = {
        customer: input.stripeCustomerId,
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
        status: "all" as const,
      };
      const page = input.requestOptions
        ? await input.stripe.subscriptions.list(params, input.requestOptions)
        : await input.stripe.subscriptions.list(params);
      pagesRead += 1;
      data.push(...page.data);

      if (!page.has_more) {
        return {
          data,
          has_more: false,
          object: "list",
          url: page.url,
        };
      }

      if (input.pageLimit !== undefined && pagesRead >= input.pageLimit) {
        throw hostedOnboardingError({
          code: "HOSTED_AUTO_PULSE_TRIAL_RECOVERY_LOOKUP_INCOMPLETE",
          httpStatus: 409,
          message: "Murph found too many Stripe subscriptions to verify safely.",
          retryable: false,
        });
      }

      const lastSubscription = page.data.at(-1);
      if (!lastSubscription) {
        return {
          data,
          has_more: true,
          object: "list",
          url: page.url,
        };
      }

      startingAfter = lastSubscription.id;
    }
  } catch (error) {
    if (isHostedOnboardingError(error)) {
      throw error;
    }
    logHostedStripeFailure({
      error,
      operationName: "subscriptions.list.auto-trial-recovery",
    });
    throw hostedOnboardingError({
      code: "HOSTED_AUTO_PULSE_TRIAL_RECOVERY_LOOKUP_FAILED",
      httpStatus: 502,
      message: "Murph could not check for an unfinished trial setup. Try again.",
      retryable: true,
    });
  }
}

function isHostedAutoPulseTrialStripeSubscriptionForMember(input: {
  memberId: string;
  priceId: string;
  stripeCustomerId?: string;
  subscription: HostedAutoPulseTrialCampaignSubscription;
  trialStartedBefore?: Date;
}): boolean {
  const trialStart = readHostedStripeObjectDate(input.subscription, "trial_start");
  const subscriptionCustomerId = typeof input.subscription.customer === "string"
    ? input.subscription.customer
    : input.subscription.customer?.id;
  return input.subscription.metadata?.memberId === input.memberId &&
    (
      input.stripeCustomerId === undefined ||
      subscriptionCustomerId === input.stripeCustomerId
    ) &&
    input.subscription.metadata.checkoutOffer === HOSTED_PULSE_TRIAL_OFFER &&
    (
      !input.trialStartedBefore ||
      (
        isHostedPulseTrialSubscriptionForKnownPolicy(input) &&
        trialStart !== null &&
        trialStart < input.trialStartedBefore
      )
    );
}

function isReusableHostedAutoPulseTrialStripeSubscription(input: {
  memberId: string;
  priceId: string;
  subscription: HostedAutoPulseTrialCampaignSubscription;
}): boolean {
  return input.subscription.status === "trialing" &&
    isHostedPulseTrialSubscriptionForKnownPolicy(input);
}

function isTerminalHostedAutoPulseTrialStripeSubscription(
  subscription: HostedAutoPulseTrialCampaignSubscription,
): boolean {
  return subscription.status === "canceled" ||
    subscription.status === "incomplete_expired";
}

function compareHostedStripeSubscriptionsNewestFirst(
  left: Stripe.Subscription,
  right: Stripe.Subscription,
): number {
  return (right.created ?? 0) - (left.created ?? 0);
}

function readHostedAutoPulseTrialSubscriptionSnapshot(
  subscription: HostedAutoPulseTrialCampaignSubscription,
  now?: Date,
): {
  currentPeriodEnd?: Date | null;
  currentPeriodStart?: Date | null;
  trialEndsAt: Date;
  trialStartedAt: Date;
} {
  if (subscription.status !== "trialing") {
    throw hostedOnboardingError({
      code: "HOSTED_AUTO_PULSE_TRIAL_SUBSCRIPTION_NOT_TRIALING",
      httpStatus: 502,
      message: "Stripe did not create a trialing subscription for Murph trial activation.",
      retryable: true,
    });
  }

  const trialStartedAt = readHostedStripeObjectDate(subscription, "trial_start");
  const trialEndsAt = readHostedStripeObjectDate(subscription, "trial_end");
  if (
    !trialStartedAt ||
    !trialEndsAt ||
    trialStartedAt.getTime() >= trialEndsAt.getTime() ||
    (now !== undefined && trialEndsAt.getTime() <= now.getTime())
  ) {
    throw hostedOnboardingError({
      code: "HOSTED_AUTO_PULSE_TRIAL_DATES_MISSING",
      httpStatus: 502,
      message: "Stripe did not return valid trial dates for Murph trial activation.",
      retryable: true,
    });
  }

  return {
    ...readHostedAutoPulseTrialCurrentPeriod(subscription),
    trialEndsAt,
    trialStartedAt,
  };
}

function readHostedAutoPulseTrialCurrentPeriod(
  subscription: HostedAutoPulseTrialCampaignSubscription,
): {
  currentPeriodEnd?: Date | null;
  currentPeriodStart?: Date | null;
} {
  const currentPeriodStart = readHostedStripeObjectDate(subscription, "current_period_start") ??
    readHostedStripeSubscriptionItemDate(subscription, "current_period_start");
  const currentPeriodEnd = readHostedStripeObjectDate(subscription, "current_period_end") ??
    readHostedStripeSubscriptionItemDate(subscription, "current_period_end");

  if (!currentPeriodStart || !currentPeriodEnd || currentPeriodStart.getTime() >= currentPeriodEnd.getTime()) {
    return {};
  }

  return {
    currentPeriodEnd,
    currentPeriodStart,
  };
}

function readHostedStripeSubscriptionItemDate(
  subscription: HostedAutoPulseTrialCampaignSubscription,
  field: string,
): Date | null {
  for (const item of subscription.items?.data ?? []) {
    const value = readHostedStripeObjectDate(item, field);
    if (value) {
      return value;
    }
  }

  return null;
}

function buildHostedAutoPulseTrialDispatchContext(input: {
  billingRefLastStripeEventCreatedAt: Date | null;
  now: Date;
  subscription: HostedAutoPulseTrialCampaignSubscription;
}): HostedStripeDispatchContext {
  const eventCreatedAt = maxHostedAutoPulseTrialDate([
    input.now,
    input.billingRefLastStripeEventCreatedAt,
    readHostedStripeObjectDate(input.subscription, "created"),
  ]);
  return {
    eventCreatedAt,
    occurredAt: eventCreatedAt.toISOString(),
    sourceEventId: buildHostedAutoPulseTrialSourceEventId(input.subscription.id),
    sourceType: "hosted.auto_pulse_trial.enrolled",
  };
}

function readHostedAutoPulseTrialCleanupSubscriptionId(input: {
  currentMember: HostedMemberBillingSnapshot;
  subscription: HostedAutoPulseTrialCampaignSubscription;
}): string | null {
  return input.currentMember.billingRef?.stripeSubscriptionId === input.subscription.id
    ? null
    : input.subscription.id;
}

async function cancelHostedAutoPulseTrialStripeSubscriptionIfNeeded(input: {
  requestOptions?: Stripe.RequestOptions;
  stripe: Stripe;
  subscriptionId: string | null;
}): Promise<void> {
  if (!input.subscriptionId) {
    return;
  }
  await cancelHostedPulseTrialLoserSubscription({
    ...(input.requestOptions ? { requestOptions: input.requestOptions } : {}),
    stripe: input.stripe,
    subscriptionId: input.subscriptionId,
  });
}

function readHostedStripeObjectDate(value: object, field: string): Date | null {
  const raw = Reflect.get(value, field);
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) {
    return null;
  }

  return new Date(raw * 1000);
}

function maxHostedAutoPulseTrialDate(values: Array<Date | null>): Date {
  return values.reduce<Date>((max, value) => {
    if (!value) {
      return max;
    }

    return value.getTime() > max.getTime() ? value : max;
  }, new Date(0));
}

async function runHostedAutoPulseTrialPostCommitEffects(
  input: HostedAutoPulseTrialPostCommitEffects & { prisma: PrismaClient },
): Promise<void> {
  if (input.activatedMemberId && input.hostedExecutionEventId) {
    await signalHostedMemberActivationRuntimeWakeBestEffortResult({
      hostedExecutionEventId: input.hostedExecutionEventId,
      memberId: input.activatedMemberId,
      prisma: input.prisma,
      source: "auto-pulse-trial.activation",
    });
  }

  if (input.welcomeEmailMemberId) {
    await sendHostedSignupWelcomeEmailForMemberBestEffort({
      memberId: input.welcomeEmailMemberId,
      prisma: input.prisma,
    });
  }
}

function buildHostedAutoPulseTrialEnrollmentResult(
  status: HostedAutoPulseTrialEnrollmentStatus,
): HostedAutoPulseTrialEnrollmentResult {
  return {
    redirectPath: HOSTED_APP_INITIAL_VISIT_HOME_PATH,
    status,
  };
}

export function buildHostedAutoPulseTrialCustomerIdempotencyKey(memberId: string): string {
  return buildHostedPulseTrialCustomerIdempotencyKey(memberId);
}

export function buildHostedAutoPulseTrialSubscriptionIdempotencyKey(input: {
  memberId: string;
  policyVersion: string;
  priceId: string;
  recoveryScope: string;
  stripeCustomerId: string;
}): string {
  return [
    "hosted-auto-pulse-trial-subscription",
    input.memberId,
    input.stripeCustomerId,
    input.priceId,
    input.policyVersion,
    input.recoveryScope,
  ].join(":");
}

function buildHostedAutoPulseTrialSubscriptionIdempotencyKeyScope(
  terminalSubscriptions: readonly Stripe.Subscription[],
): string {
  const newestTerminalSubscription = [...terminalSubscriptions]
    .sort(compareHostedStripeSubscriptionsNewestFirst)
    .at(0);

  if (!newestTerminalSubscription) {
    return "initial";
  }

  return [
    "after-terminal",
    newestTerminalSubscription.id,
    newestTerminalSubscription.status,
    String(newestTerminalSubscription.created ?? 0),
  ].join(":");
}

function buildHostedAutoPulseTrialSourceEventId(subscriptionId: string): string {
  return `auto-pulse-trial:${subscriptionId}`;
}
