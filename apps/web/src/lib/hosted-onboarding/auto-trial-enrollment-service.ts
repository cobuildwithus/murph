import { HostedBillingStatus, type Prisma, type PrismaClient } from "@prisma/client";
import type Stripe from "stripe";

import { getPrisma } from "../prisma";
import {
  prepareHostedCryptoDomainRootCandidates,
  type PreparedHostedCryptoDomainRootCandidates,
} from "../hosted-crypto/domain-root-store";
import { runWithHostedDomainRootUnwrapCache } from "../hosted-crypto/domain-root-unwrap-cache";
import { assertHostedLaunchRequiredConsentGranted } from "../legal/consent";
import { HOSTED_APP_HOME_PATH } from "./app-routes";
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
  withHostedMemberStripeMutationLockForOps,
} from "./hosted-member-billing-store";
import { assertHostedMemberBillingStartMessagingReady } from "./billing-start-preconditions";
import { requireHostedInviteForBillingCheckout } from "./invite-service";
import { requiresHostedBillingCheckout } from "./lifecycle";
import {
  classifyHostedPulseTrialCandidateDisposition,
  cancelHostedPulseTrialLoserSubscription,
  cancelHostedPulseTrialLoserSubscriptionsForMember,
  isHostedPulseTrialSubscriptionForKnownPolicy,
} from "./pulse-trial-subscription-cleanup";
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
  parseHostedPulseTrialStartSource,
  type HostedPulseTrialStartSource,
} from "./pulse-trial-start-source";
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
// member row lock across one authoritative Stripe read plus its database work.
// The read is deliberately inside the lock: loser cleanup uses that same lock
// through cancellation, so a finalizer can never adopt a snapshot retrieved
// before cleanup cancelled it. The provider call has the tighter five-second
// request timeout below; 30 seconds leaves the remaining budget for bounded lock
// acquisition, one member snapshot read, at most one customer bind, the billing
// write, and the activation write. Rare serialized cleanup uses the same ceiling.
const HOSTED_AUTO_PULSE_TRIAL_FINALIZATION_TRANSACTION_TIMEOUT_MS = 30_000;
// Loser cleanup still retrieves and cancels Stripe subscriptions while it holds
// the member lock, so it keeps the provider-sized budget until it is converted
// to the same prepare/commit/cleanup shape.
const HOSTED_AUTO_PULSE_TRIAL_LOSER_CLEANUP_TRANSACTION_TIMEOUT_MS = 120_000;
const HOSTED_AUTO_PULSE_TRIAL_FINALIZATION_MAX_ATTEMPTS = 3;
const HOSTED_AUTO_PULSE_TRIAL_FINALIZATION_RETRY_BASE_DELAY_MS = 25;
const HOSTED_AUTO_PULSE_TRIAL_STRIPE_AUTHORITY_REQUEST_OPTIONS: Stripe.RequestOptions = {
  maxNetworkRetries: 0,
  timeout: HOSTED_AUTO_PULSE_TRIAL_STRIPE_AUTHORITY_TIMEOUT_MS,
};
type HostedAutoPulseTrialMutationRequestOptions = Pick<
  Stripe.RequestOptions,
  "maxNetworkRetries" | "timeout"
>;

export type HostedAutoPulseTrialEnrollmentStatus =
  | "already_active"
  | "already_enrolled"
  | "enrolled";

export interface HostedAutoPulseTrialEnrollmentInput {
  inviteCode: string;
  member: HostedAutoPulseTrialAuthenticatedMember;
  now?: Date;
  prisma?: PrismaClient;
  pulseTrialStartSource: Exclude<
    HostedPulseTrialStartSource,
    "linq_instant_start"
  >;
  suppressSignupWelcome?: boolean;
}

export interface HostedLinqInstantStartPulseTrialEnrollmentInput {
  admissionEventId: string;
  inviteCode: string;
  memberId: string;
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

export interface HostedLinqInstantStartDeferredActivationWake {
  hostedExecutionEventId: string;
  memberId: string;
}

export interface HostedLinqInstantStartPulseTrialEnrollmentResult
  extends HostedAutoPulseTrialEnrollmentResult {
  deferredActivationWake: HostedLinqInstantStartDeferredActivationWake | null;
}

type HostedAutoPulseTrialEnrollmentPolicy = {
  instantStartAdmission?: {
    eventId: string;
    inviteCode: string;
  };
  provisionUnderMemberLock: boolean;
  pulseTrialStartSource: HostedPulseTrialStartSource;
  requireLaunchConsent: boolean;
  requireUnboundStripeCustomer: boolean;
  suppressSignupWelcome: boolean;
};

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

type HostedAutoPulseTrialEnrollmentWithPolicyResult = {
  deferredActivationWake: HostedLinqInstantStartDeferredActivationWake | null;
  result: HostedAutoPulseTrialEnrollmentResult;
};

type HostedAutoPulseTrialEnrollmentWithPolicyInput = Pick<
  HostedAutoPulseTrialEnrollmentInput,
  "inviteCode" | "member" | "now" | "prisma"
>;

const EMPTY_AUTO_TRIAL_POST_COMMIT_EFFECTS: HostedAutoPulseTrialPostCommitEffects = {
  activatedMemberId: null,
  hostedExecutionEventId: null,
  welcomeEmailMemberId: null,
};

export async function ensureHostedAutoPulseTrialEnrollment(
  input: HostedAutoPulseTrialEnrollmentInput,
): Promise<HostedAutoPulseTrialEnrollmentResult> {
  const enrollment = await ensureHostedAutoPulseTrialEnrollmentWithPolicy(input, {
    provisionUnderMemberLock: false,
    pulseTrialStartSource: input.pulseTrialStartSource,
    requireLaunchConsent: true,
    requireUnboundStripeCustomer: false,
    suppressSignupWelcome: input.suppressSignupWelcome ?? false,
  });
  return enrollment.result;
}

/**
 * Trusted inbound iMessage already proves a reachable direct channel. Reuse
 * the ordinary no-card Pulse trial without routing through browser onboarding;
 * the current inbound privacy boundary stays unchanged and the original
 * message becomes the welcome turn. A newly committed activation is returned
 * as an explicit wake continuation so the webhook can stage and signal that
 * conversation first, then run the existing activation post-commit work.
 */
export async function ensureHostedLinqInstantStartPulseTrialEnrollment(
  input: HostedLinqInstantStartPulseTrialEnrollmentInput,
): Promise<HostedLinqInstantStartPulseTrialEnrollmentResult> {
  const enrollment = await ensureHostedAutoPulseTrialEnrollmentWithPolicy({
    inviteCode: input.inviteCode,
    member: {
      id: input.memberId,
      // The invite snapshot below remains the authoritative suspension check.
      suspendedAt: null,
    },
    ...(input.now ? { now: input.now } : {}),
    ...(input.prisma ? { prisma: input.prisma } : {}),
  }, {
    instantStartAdmission: {
      eventId: input.admissionEventId,
      inviteCode: input.inviteCode,
    },
    // The pending Linq route and the active member are one admission state
    // transition. Keep provider provisioning inside the existing member owner
    // so another inbound cannot observe a customer-bound inactive midpoint.
    provisionUnderMemberLock: true,
    pulseTrialStartSource: "linq_instant_start",
    requireLaunchConsent: false,
    // Instant start is only for a genuinely new billing identity. Reusing an
    // existing customer could silently inherit a saved payment method and
    // auto-convert a trial the person started only by texting Murph.
    requireUnboundStripeCustomer: true,
    suppressSignupWelcome: true,
  });
  return {
    ...enrollment.result,
    deferredActivationWake: enrollment.deferredActivationWake,
  };
}

export async function runHostedLinqInstantStartDeferredActivationWakeBestEffort(
  input: {
    continuation: HostedLinqInstantStartDeferredActivationWake;
    prisma?: PrismaClient;
  },
): Promise<void> {
  await signalHostedMemberActivationRuntimeWakeBestEffortResult({
    hostedExecutionEventId: input.continuation.hostedExecutionEventId,
    memberId: input.continuation.memberId,
    ...(input.prisma ? { prisma: input.prisma } : {}),
    source: "auto-pulse-trial.activation",
  });
}

async function ensureHostedAutoPulseTrialEnrollmentWithPolicy(
  input: HostedAutoPulseTrialEnrollmentWithPolicyInput,
  policy: HostedAutoPulseTrialEnrollmentPolicy,
): Promise<HostedAutoPulseTrialEnrollmentWithPolicyResult> {
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

  if (policy.requireLaunchConsent) {
    await assertHostedLaunchRequiredConsentGranted({
      memberId: invite.member.id,
      prisma,
    });
  }

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
    return {
      deferredActivationWake: null,
      result: buildHostedAutoPulseTrialEnrollmentResult(initialStatus),
    };
  }

  assertHostedAutoPulseTrialEligible(initialMember);
  assertHostedAutoPulseTrialCustomerPolicy(initialMember, policy);

  const metadata = buildHostedAutoPulseTrialMetadata(
    invite.member.id,
    policy.pulseTrialStartSource,
  );

  if (policy.provisionUnderMemberLock) {
    return ensureHostedAutoPulseTrialEnrollmentUnderMemberLock({
      memberId: invite.member.id,
      metadata,
      now,
      policy,
      priceId,
      prisma,
      stripe,
    });
  }

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
          assertHostedAutoPulseTrialCustomerPolicy(currentMember, policy);
          const candidateStripeCustomerId = currentMember.billingRef?.stripeCustomerId
            ?? await createHostedPulseTrialStripeCustomer({
              memberId: invite.member.id,
              requestOptions: HOSTED_AUTO_PULSE_TRIAL_STRIPE_AUTHORITY_REQUEST_OPTIONS,
              stripe,
            });
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
    return {
      deferredActivationWake: null,
      result: reservation.result,
    };
  }

  const subscription = await resolveHostedAutoPulseTrialStripeSubscription({
    memberId: invite.member.id,
    metadata,
    priceId,
    stripe,
    stripeCustomerId: reservation.stripeCustomerId,
  });
  return {
    deferredActivationWake: null,
    result: await finalizeHostedAutoPulseTrialEnrollment({
      memberId: invite.member.id,
      now,
      priceId,
      prisma,
      suppressSignupWelcome: policy.suppressSignupWelcome,
      stripe,
      stripeCustomerId: reservation.stripeCustomerId,
      subscriptionId: subscription.id,
    }),
  };
}

async function ensureHostedAutoPulseTrialEnrollmentUnderMemberLock(input: {
  memberId: string;
  metadata: Record<string, string>;
  now: Date;
  policy: HostedAutoPulseTrialEnrollmentPolicy;
  priceId: string;
  prisma: PrismaClient;
  stripe: Stripe;
}): Promise<HostedAutoPulseTrialEnrollmentWithPolicyResult> {
  const preparedCryptoDomainRoots =
    await prepareHostedCryptoDomainRootCandidates({
      prisma: input.prisma,
      userId: input.memberId,
    });

  let outcome: HostedAutoPulseTrialFinalizationOutcome;
  try {
    outcome = await runHostedAutoPulseTrialProvisioningWithMemberLockRetry({
      ...input,
      preparedCryptoDomainRoots,
    });
  } catch (error) {
    if (error instanceof HostedMemberStripeMutationLockBusyError) {
      throw buildHostedAutoPulseTrialFinalizationBusyError();
    }
    throw error;
  }

  if (outcome.kind === "failed") {
    throw outcome.error;
  }

  const deferredActivationWake = input.policy.instantStartAdmission
    ? buildHostedLinqInstantStartDeferredActivationWake(
        outcome.postCommitEffects,
      )
    : null;
  await runHostedAutoPulseTrialPostCommitEffects({
    ...outcome.postCommitEffects,
    ...(deferredActivationWake
      ? {
          activatedMemberId: null,
          hostedExecutionEventId: null,
        }
      : {}),
    prisma: input.prisma,
  });
  return {
    deferredActivationWake,
    result: outcome.result,
  };
}

async function runHostedAutoPulseTrialProvisioningWithMemberLockRetry(input: {
  memberId: string;
  metadata: Record<string, string>;
  now: Date;
  policy: HostedAutoPulseTrialEnrollmentPolicy;
  preparedCryptoDomainRoots: PreparedHostedCryptoDomainRootCandidates;
  priceId: string;
  prisma: PrismaClient;
  stripe: Stripe;
}): Promise<HostedAutoPulseTrialFinalizationOutcome> {
  return runHostedAutoPulseTrialWithMemberLockRetry({
    memberId: input.memberId,
    prisma: input.prisma,
    run: (tx): Promise<HostedAutoPulseTrialFinalizationOutcome> =>
      runWithHostedDomainRootUnwrapCache(async () => {
        const currentMember = await readHostedAutoPulseTrialEnrollmentMember({
          memberId: input.memberId,
          prisma: tx,
        });
        const currentStatus =
          resolveHostedAutoPulseTrialExistingStatus(currentMember);
        if (currentStatus) {
          if (input.policy.instantStartAdmission) {
            await clearHostedLinqInstantStartAdmissionTx({
              eventId: input.policy.instantStartAdmission.eventId,
              required: false,
              tx,
            });
          }
          return {
            kind: "completed",
            cleanupStripeSubscriptionId: null,
            postCommitEffects: EMPTY_AUTO_TRIAL_POST_COMMIT_EFFECTS,
            result: buildHostedAutoPulseTrialEnrollmentResult(currentStatus),
          };
        }

        assertHostedAutoPulseTrialEligible(currentMember);
        assertHostedAutoPulseTrialCustomerPolicy(currentMember, input.policy);
        const instantStartInviteId = input.policy.instantStartAdmission
          ? await requireHostedLinqInstantStartAdmissionTx({
              eventId: input.policy.instantStartAdmission.eventId,
              inviteCode: input.policy.instantStartAdmission.inviteCode,
              memberId: input.memberId,
              now: input.now,
              tx,
            })
          : null;
        const candidateStripeCustomerId =
          currentMember.billingRef?.stripeCustomerId
          ?? await createHostedPulseTrialStripeCustomer({
            memberId: input.memberId,
            requestOptions:
              HOSTED_AUTO_PULSE_TRIAL_STRIPE_AUTHORITY_REQUEST_OPTIONS,
            stripe: input.stripe,
          });
        const reservedBillingRef =
          currentMember.billingRef?.stripeCustomerId
            ? currentMember.billingRef
            : await bindHostedMemberStripeCustomerIdIfMissingTx({
                memberId: input.memberId,
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

        const subscription =
          await resolveHostedAutoPulseTrialStripeSubscription({
            memberId: input.memberId,
            metadata: input.metadata,
            priceId: input.priceId,
            requestOptions:
              HOSTED_AUTO_PULSE_TRIAL_STRIPE_AUTHORITY_REQUEST_OPTIONS,
            stripe: input.stripe,
            stripeCustomerId,
          });
        const decisionNow = new Date();
        assertHostedAutoPulseTrialFinalizationSubscriptionEligible({
          memberId: input.memberId,
          priceId: input.priceId,
          stripeCustomerId,
          subscription,
        });
        const outcome = await finalizeHostedAutoPulseTrialEnrollmentTx({
          currentMember: {
            ...currentMember,
            billingRef: reservedBillingRef,
          },
          lockedNow: new Date(),
          memberId: input.memberId,
          now: input.now,
          preparedCryptoDomainRoots: input.preparedCryptoDomainRoots,
          stripeCustomerId,
          subscription,
          suppressSignupWelcome: input.policy.suppressSignupWelcome,
          trialSnapshot: readHostedAutoPulseTrialSubscriptionSnapshot(
            subscription,
            decisionNow,
          ),
          tx,
        });
        await cancelHostedAutoPulseTrialStripeSubscriptionIfNeeded({
          requestOptions:
            HOSTED_AUTO_PULSE_TRIAL_STRIPE_AUTHORITY_REQUEST_OPTIONS,
          stripe: input.stripe,
          subscriptionId: outcome.cleanupStripeSubscriptionId,
        });
        if (outcome.kind === "failed") {
          throw outcome.error;
        }
        if (instantStartInviteId && input.policy.instantStartAdmission) {
          await clearHostedLinqInstantStartAdmissionTx({
            eventId: input.policy.instantStartAdmission.eventId,
            inviteId: instantStartInviteId,
            required: true,
            tx,
          });
        }
        return outcome;
      }),
    transactionTimeoutMs:
      HOSTED_AUTO_PULSE_TRIAL_FINALIZATION_TRANSACTION_TIMEOUT_MS,
  });
}

async function requireHostedLinqInstantStartAdmissionTx(input: {
  eventId: string;
  inviteCode: string;
  memberId: string;
  now: Date;
  tx: Prisma.TransactionClient;
}): Promise<string> {
  const invite = await input.tx.hostedInvite.findUnique({
    select: { id: true },
    where: {
      expiresAt: {
        gt: input.now,
      },
      instantStartAdmissionEventId: input.eventId,
      inviteCode: input.inviteCode,
      memberId: input.memberId,
      sentAt: null,
    },
  });
  if (invite) {
    return invite.id;
  }

  throw hostedOnboardingError({
    code: "HOSTED_LINQ_INSTANT_START_ADMISSION_REVOKED",
    httpStatus: 409,
    message: "This instant-start admission is no longer active.",
    retryable: false,
  });
}

async function clearHostedLinqInstantStartAdmissionTx(input: {
  eventId: string;
  inviteId?: string;
  required: boolean;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  const cleared = await input.tx.hostedInvite.updateMany({
    data: {
      instantStartAdmissionEventId: null,
    },
    where: {
      ...(input.inviteId ? { id: input.inviteId } : {}),
      instantStartAdmissionEventId: input.eventId,
    },
  });
  if (input.required && cleared.count !== 1) {
    throw hostedOnboardingError({
      code: "HOSTED_LINQ_INSTANT_START_ADMISSION_CHANGED",
      httpStatus: 503,
      message: "Murph is still resolving this instant-start admission. Try again.",
      retryable: true,
    });
  }
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
  preparedCryptoDomainRoots?: PreparedHostedCryptoDomainRootCandidates;
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
    preparedCryptoDomainRoots: input.preparedCryptoDomainRoots ?? new Map(),
    stripeCustomerId: input.stripeCustomerId,
    subscription: input.disposition.subscription,
    suppressSignupWelcome: false,
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
 * Finalizes an auto Pulse Trial under one serialization boundary:
 *
 * Take the member lock, read authoritative Stripe state with a bounded
 * request, re-read the member, and either write enrollment or cancel the
 * unowned loser before releasing the lock. Every cleanup outcome is decided
 * before any enrollment write, so cancellation failure can safely roll back
 * that no-write transaction. A waiting finalizer then performs its provider
 * read only after cleanup settles and cannot adopt stale pre-cancellation
 * state.
 */
async function finalizeHostedAutoPulseTrialEnrollment(input: {
  memberId: string;
  now: Date;
  priceId: string;
  prisma: PrismaClient;
  suppressSignupWelcome: boolean;
  stripe: Stripe;
  stripeCustomerId: string;
  subscriptionId: string;
}): Promise<HostedAutoPulseTrialEnrollmentResult> {
  const preparedCryptoDomainRoots =
    await prepareHostedCryptoDomainRootCandidates({
      prisma: input.prisma,
      userId: input.memberId,
    });
  let outcome: HostedAutoPulseTrialFinalizationOutcome;
  try {
    outcome = await runHostedAutoPulseTrialFinalizationWithMemberLockRetry({
      ...input,
      preparedCryptoDomainRoots,
    });
  } catch (error) {
    if (error instanceof HostedMemberStripeMutationLockBusyError) {
      throw buildHostedAutoPulseTrialFinalizationBusyError();
    }
    throw error;
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

async function runHostedAutoPulseTrialFinalizationWithMemberLockRetry(input: {
  memberId: string;
  now: Date;
  preparedCryptoDomainRoots: PreparedHostedCryptoDomainRootCandidates;
  priceId: string;
  prisma: PrismaClient;
  suppressSignupWelcome: boolean;
  stripe: Stripe;
  stripeCustomerId: string;
  subscriptionId: string;
}): Promise<HostedAutoPulseTrialFinalizationOutcome> {
  return runHostedAutoPulseTrialWithMemberLockRetry({
    memberId: input.memberId,
    prisma: input.prisma,
    run: (tx): Promise<HostedAutoPulseTrialFinalizationOutcome> =>
      runWithHostedDomainRootUnwrapCache(async () => {
        const subscription =
          await retrieveHostedAutoPulseTrialFinalizationSubscription({
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
        const trialSnapshot =
          readHostedAutoPulseTrialSubscriptionSnapshot(
            subscription,
            decisionNow,
          );
        const currentMember = await readHostedAutoPulseTrialEnrollmentMember({
          memberId: input.memberId,
          prisma: tx,
        });
        const outcome = await finalizeHostedAutoPulseTrialEnrollmentTx({
          currentMember,
          lockedNow: new Date(),
          memberId: input.memberId,
          now: input.now,
          preparedCryptoDomainRoots: input.preparedCryptoDomainRoots,
          stripeCustomerId: input.stripeCustomerId,
          subscription,
          suppressSignupWelcome: input.suppressSignupWelcome,
          trialSnapshot,
          tx,
        });
        await cancelHostedAutoPulseTrialStripeSubscriptionIfNeeded({
          requestOptions:
            HOSTED_AUTO_PULSE_TRIAL_STRIPE_AUTHORITY_REQUEST_OPTIONS,
          stripe: input.stripe,
          subscriptionId: outcome.cleanupStripeSubscriptionId,
        });
        return outcome;
      }),
    transactionTimeoutMs:
      HOSTED_AUTO_PULSE_TRIAL_FINALIZATION_TRANSACTION_TIMEOUT_MS,
  });
}

async function runHostedAutoPulseTrialWithMemberLockRetry<TResult>(input: {
  memberId: string;
  prisma: PrismaClient;
  run: (tx: Prisma.TransactionClient) => Promise<TResult>;
  transactionTimeoutMs: number;
}): Promise<TResult> {
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
        run: input.run,
        transactionTimeoutMs: input.transactionTimeoutMs,
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

  throw new Error("Hosted auto Pulse Trial member-lock attempts exhausted.");
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
  preparedCryptoDomainRoots: PreparedHostedCryptoDomainRootCandidates;
  stripeCustomerId: string;
  subscription: HostedAutoPulseTrialCampaignSubscription;
  suppressSignupWelcome: boolean;
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
    pulseTrialStartSource: parseHostedPulseTrialStartSource(
      input.subscription.metadata.pulseTrialStartSource,
    ),
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
    preparedCryptoDomainRoots: input.preparedCryptoDomainRoots,
    prisma: input.tx,
    skipIfBillingAlreadyActive: false,
    skipIfPreviouslyActivated: true,
    suppressSignupWelcome: input.suppressSignupWelcome,
  });
  return {
    kind: "completed",
    cleanupStripeSubscriptionId: null,
    postCommitEffects: {
      activatedMemberId: activation.activated ? updatedMember.core.id : null,
      hostedExecutionEventId: activation.hostedExecutionEventId,
      welcomeEmailMemberId: !input.suppressSignupWelcome
        && (activation.activated || activation.hostedExecutionEventId)
          ? updatedMember.core.id
          : null,
    },
    result: buildHostedAutoPulseTrialEnrollmentResult("enrolled"),
  };
}

/**
 * Rejects a provider judgement that has aged out before the locked write.
 *
 * The subscription is retrieved and judged eligible while the member lock is
 * held, but an almost-expired trial can still pass that judgement and then
 * expire while the member snapshot and activation writes run. Every other
 * field of the retrieved subscription stays protected from competing cleanup
 * by the shared lock; the trial's own expiry advances with the clock, so it is
 * recomputed immediately before the write. Persisting past it would mark the
 * member active on a trial that has already ended.
 *
 * The retryable failure makes the caller perform a fresh authoritative read
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

function assertHostedAutoPulseTrialCustomerPolicy(
  member: HostedMemberBillingSnapshot,
  policy: HostedAutoPulseTrialEnrollmentPolicy,
): void {
  if (
    !policy.requireUnboundStripeCustomer
    || !member.billingRef?.stripeCustomerId
  ) {
    return;
  }

  throw hostedOnboardingError({
    code: "HOSTED_LINQ_INSTANT_START_EXISTING_STRIPE_CUSTOMER",
    httpStatus: 409,
    message: "This account must finish trial setup through the existing signup link.",
  });
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

function buildHostedAutoPulseTrialMetadata(
  memberId: string,
  pulseTrialStartSource: HostedPulseTrialStartSource,
): Record<string, string> {
  return buildHostedBillingOfferMetadata({
    billingPlanCode: "launch_monthly",
    checkoutOffer: HOSTED_PULSE_TRIAL_OFFER,
    memberId,
    pulseTrialStartSource,
  });
}

async function createHostedAutoPulseTrialStripeSubscription(input: {
  idempotencyKeyScope: string;
  metadata: Record<string, string>;
  memberId: string;
  priceId: string;
  requestOptions?: HostedAutoPulseTrialMutationRequestOptions;
  stripe: Stripe;
  stripeCustomerId: string;
}): Promise<Stripe.Subscription> {
  const requestOptions: Stripe.RequestOptions = {
    idempotencyKey: buildHostedAutoPulseTrialSubscriptionIdempotencyKey({
      memberId: input.memberId,
      policyVersion: HOSTED_PULSE_TRIAL_POLICY_VERSION,
      priceId: input.priceId,
      recoveryScope: input.idempotencyKeyScope,
      stripeCustomerId: input.stripeCustomerId,
    }),
  };
  if (input.requestOptions?.maxNetworkRetries !== undefined) {
    requestOptions.maxNetworkRetries = input.requestOptions.maxNetworkRetries;
  }
  if (input.requestOptions?.timeout !== undefined) {
    requestOptions.timeout = input.requestOptions.timeout;
  }

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
    }, requestOptions),
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
  requestOptions?: Stripe.RequestOptions;
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
      const params: Stripe.SubscriptionListParams = {
        customer: input.stripeCustomerId,
        limit: 100,
        status: "all",
      };
      if (startingAfter) {
        params.starting_after = startingAfter;
      }
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

function buildHostedLinqInstantStartDeferredActivationWake(
  effects: HostedAutoPulseTrialPostCommitEffects,
): HostedLinqInstantStartDeferredActivationWake | null {
  if (!effects.activatedMemberId || !effects.hostedExecutionEventId) {
    return null;
  }
  return {
    hostedExecutionEventId: effects.hostedExecutionEventId,
    memberId: effects.activatedMemberId,
  };
}

function buildHostedAutoPulseTrialEnrollmentResult(
  status: HostedAutoPulseTrialEnrollmentStatus,
): HostedAutoPulseTrialEnrollmentResult {
  return {
    redirectPath: HOSTED_APP_HOME_PATH,
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
