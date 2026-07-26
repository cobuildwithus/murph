import { createHash, randomUUID } from "node:crypto";

import {
  HostedBillingStatus,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";
import type Stripe from "stripe";

import { getPrisma } from "../prisma";
import { buildStripeCancelUrl, buildStripeSuccessUrl } from "./billing";
import {
  HOSTED_PULSE_TRIAL_DAYS,
  HOSTED_PULSE_TRIAL_OFFER,
  HOSTED_STANDARD_CHECKOUT_OFFER,
  getHostedDefaultBillingPlanCode,
  isHostedPulseTrialCheckoutEnabled,
  type HostedBillingCheckoutOffer,
  type HostedBillingPlanCode,
  type HostedPublicBillingCheckoutOffer,
} from "./billing-plans";
import { buildHostedBillingOfferMetadata } from "./billing-offer-metadata";
import { createHostedEmailLookupKey } from "./contact-privacy";
import { isHostedMemberSuspended } from "./entitlement";
import { hostedOnboardingError } from "./errors";
import {
  readHostedMemberFamilyBillingClaim,
  type HostedMemberFamilyBillingClaim,
} from "./family-plan";
import {
  bindHostedMemberStripeCheckoutSessionTx,
  clearHostedMemberStripeCustomerReservationAfterDefinitiveFailureTx,
  finalizeHostedMemberStripeCustomerReservationTx,
  clearHostedMemberStripeCheckoutAttemptTx,
  HostedMemberStripeMutationLockBusyError,
  type HostedMemberStripeCheckoutAttemptReservation,
  readHostedMemberStripeBillingRef,
  reserveHostedMemberStripeCustomerReservationTx,
  reserveHostedMemberStripeCheckoutAttemptTx,
  withHostedMemberStripeMutationLock,
  withHostedMemberStripeMutationLockForOps,
} from "./hosted-member-billing-store";
import {
  signalHostedMemberActivationRuntimeWakeBestEffortResult,
} from "./member-activation-runtime-wake";
import { assertHostedMemberBillingStartMessagingReady } from "./billing-start-preconditions";
import { requireHostedInviteForBillingCheckout } from "./invite-service";
import { requiresHostedBillingCheckout } from "./lifecycle";
import { readActiveHostedFamilySponsorship } from "./member-access";
import {
  deriveHostedOnboardingTimingErrorName,
  finishHostedOnboardingTiming,
  startHostedOnboardingTiming,
} from "./logging";
import {
  extractHostedPrivyVerifiedEmailAccount,
  type PrivyLinkedAccountLike,
} from "./privy-shared";
import {
  requireHostedOnboardingPublicBaseUrl,
  requireHostedStripeCheckoutConfig,
} from "./runtime";
import {
  withHostedStripeFailureLog,
} from "./stripe-error-log";
import {
  applyStripeCheckoutCompleted,
  cancelHostedPulseTrialCheckoutLoserSubscription,
} from "./stripe-billing-events";
import {
  executeHostedCheckoutSubscriptionCleanup,
  type HostedCheckoutSubscriptionCleanupCandidate,
} from "./stripe-checkout-subscription-cleanup";
import {
  sendHostedSignupWelcomeEmailForMemberBestEffort,
} from "./signup-welcome-email";
import { createHostedPulseTrialStripeCustomer } from "./pulse-trial-customer";
import {
  HOSTED_STRIPE_IDEMPOTENCY_SAFE_REPLAY_WINDOW_MS,
  isHostedStripeDefinitiveRequestRejection,
  isHostedStripeIdempotencyConflict,
  isHostedStripeRetryableFailure,
} from "./stripe-billing-state";

const HOSTED_BILLING_CHECKOUT_MEMBER_LOCK_ACQUISITION_TIMEOUT_MS = 2_000;
const HOSTED_BILLING_CHECKOUT_TRANSACTION_TIMEOUT_MS = 120_000;
const HOSTED_BILLING_CHECKOUT_STRIPE_AUTHORITY_REQUEST_OPTIONS = {
  maxNetworkRetries: 0,
  timeout: 5_000,
} as const satisfies Stripe.RequestOptions;

export interface HostedBillingCheckoutInput {
  billingPlanCode?: HostedBillingPlanCode;
  checkoutOffer?: HostedPublicBillingCheckoutOffer | null;
  inviteCode: string;
  linkedAccounts?: readonly PrivyLinkedAccountLike[];
  member?: HostedBillingCheckoutAuthenticatedMember;
  now?: Date;
  prisma?: PrismaClient;
}

export interface HostedBillingCheckoutAuthenticatedMember {
  id: string;
  suspendedAt: Date | null;
}

export interface HostedBillingCheckoutLineItem {
  price: string;
  quantity?: number;
}

export function buildHostedBillingCheckoutLineItems(priceId: string): HostedBillingCheckoutLineItem[] {
  return [
    {
      price: priceId,
      quantity: 1,
    },
  ];
}

export async function createHostedBillingCheckout(
  input: HostedBillingCheckoutInput,
): Promise<{ alreadyActive: boolean; url: string | null }> {
  const prisma = input.prisma ?? getPrisma();
  const billingPlanCode = input.billingPlanCode ?? getHostedDefaultBillingPlanCode();
  const checkoutOffer = input.checkoutOffer ?? HOSTED_STANDARD_CHECKOUT_OFFER;
  const now = input.now ?? new Date();
  const timing = startHostedOnboardingTiming("hosted-onboarding.billing.create-checkout", {
    billingPlanCode,
    checkoutOffer,
  });

  try {
    const auth = await resolveHostedBillingCheckoutAuth(input);
    const invite = await requireHostedInviteForBillingCheckout(input.inviteCode, prisma, now);

    if (auth.member.id !== invite.memberId) {
      throw hostedOnboardingError({
        code: "AUTH_INVITE_MISMATCH",
        message: "That invite belongs to a different hosted member.",
        httpStatus: 403,
      });
    }

    if (
      isHostedMemberSuspended(auth.member.suspendedAt) ||
      isHostedMemberSuspended(invite.member.suspendedAt)
    ) {
      throw hostedOnboardingError({
        code: "HOSTED_MEMBER_SUSPENDED",
        message: "This hosted account is suspended. Contact support to restore access.",
        httpStatus: 403,
      });
    }

    if (invite.member.billingStatus === HostedBillingStatus.active) {
      finishHostedOnboardingTiming(timing, "completed", {
        alreadyActive: true,
      });
      return {
        alreadyActive: true,
        url: null,
      };
    }

    if (await readActiveHostedFamilySponsorship({
      memberId: invite.member.id,
      prisma,
    })) {
      throw buildHostedFamilyMemberAlreadySponsoredCheckoutError();
    }

    if (!requiresHostedBillingCheckout(invite.member.billingStatus)) {
      throw hostedOnboardingError({
        code: "HOSTED_BILLING_CHECKOUT_BLOCKED",
        message: "This hosted account cannot start a new checkout right now. Contact support to restore access.",
        httpStatus: 403,
      });
    }

    // Checkout mints a new subscription, and binding it would orphan an existing
    // one on the same customer rather than replace it. `incomplete` does not by
    // itself mean first-time: the Stripe status mapper also writes it while an
    // established subscription is settling. The bound subscription is the single
    // owner of that irreversible decision, so fail closed when one already exists.
    if (invite.member.billingRef?.stripeSubscriptionLookupKey) {
      throw hostedOnboardingError({
        code: "HOSTED_BILLING_SUBSCRIPTION_ALREADY_EXISTS",
        message: "This hosted account already has a subscription. Manage it from Settings instead of starting a new one.",
        httpStatus: 409,
      });
    }

    await assertHostedMemberBillingStartMessagingReady({
      identity: invite.member.identity,
      prisma,
      routing: invite.member.routing,
    });

    const preliminaryBillingRef = await readHostedMemberStripeBillingRef({
      memberId: invite.member.id,
      prisma,
    });
    const preliminaryOffer = resolveHostedBillingCheckoutOffer({
      billingPlanCode,
      checkoutOffer,
      currentBillingRef: preliminaryBillingRef,
    });
    const { priceId, stripe } = requireHostedStripeCheckoutConfig({
      billingPlanCode,
    });
    const publicBaseUrl = requireHostedOnboardingPublicBaseUrl();
    const verifiedEmailAddress =
      extractHostedPrivyVerifiedEmailAccount(input.linkedAccounts ?? [])?.address ?? null;
    if (
      preliminaryOffer === HOSTED_PULSE_TRIAL_OFFER
      && !preliminaryBillingRef?.stripeCustomerId
    ) {
      await reserveHostedPulseTrialCheckoutCustomer({
        memberId: invite.member.id,
        now,
        prisma,
        stripe,
      });
    }

    const checkoutInput = {
      billingPlanCode,
      checkoutOffer,
      inviteCode: invite.inviteCode,
      memberId: invite.member.id,
      now,
      priceId,
      publicBaseUrl,
      stripe,
      verifiedEmailAddress,
    };
    let preparation = await withHostedBillingCheckoutMemberLock({
      memberId: invite.member.id,
      prisma,
      run: (tx) => prepareHostedBillingCheckoutAttemptLocked({
        ...checkoutInput,
        replaceAttempt: null,
        tx,
      }),
    });
    if (preparation.kind === "already_active") {
      finishHostedOnboardingTiming(timing, "completed", {
        alreadyActive: true,
      });
      return {
        alreadyActive: true,
        url: null,
      };
    }
    let preparedAttempt = preparation;
    let checkoutOutcome: HostedBillingCheckoutLockedOutcome = {
      error: buildHostedBillingCheckoutAttemptStaleError(),
      kind: "failed",
    };
    for (let attemptIndex = 0; attemptIndex < 2; attemptIndex += 1) {
      checkoutOutcome = await withHostedBillingCheckoutMemberLock({
        memberId: invite.member.id,
        prisma,
        run: (tx) => runHostedBillingCheckoutAttemptLocked({
          ...checkoutInput,
          preparedAttempt,
          tx,
        }),
      });
      if (checkoutOutcome.kind !== "replace_attempt") {
        break;
      }
      preparation = await withHostedBillingCheckoutMemberLock({
        memberId: invite.member.id,
        prisma,
        run: (tx) => prepareHostedBillingCheckoutAttemptLocked({
          ...checkoutInput,
          replaceAttempt: preparedAttempt.attempt,
          tx,
        }),
      });
      if (preparation.kind === "already_active") {
        checkoutOutcome = { kind: "already_active" };
        break;
      }
      preparedAttempt = preparation;
    }
    if (checkoutOutcome.kind === "replace_attempt") {
      throw buildHostedBillingCheckoutAttemptStaleError();
    }
    if (checkoutOutcome.kind === "completed_session") {
      checkoutOutcome = await reconcileHostedBillingCompletedCheckoutSession({
        memberId: invite.member.id,
        observedAt: now,
        prisma,
        session: checkoutOutcome.session,
      });
    }
    if (checkoutOutcome.kind === "already_active") {
      finishHostedOnboardingTiming(timing, "completed", {
        alreadyActive: true,
      });
      return {
        alreadyActive: true,
        url: null,
      };
    }
    if (checkoutOutcome.kind === "failed") {
      throw checkoutOutcome.error;
    }
    if (checkoutOutcome.kind === "reconciled") {
      if (checkoutOutcome.cleanupCheckoutSubscription) {
        await executeHostedCheckoutSubscriptionCleanup({
          candidate: checkoutOutcome.cleanupCheckoutSubscription,
          prisma,
          stripe,
        });
      }
      if (checkoutOutcome.cleanupPulseTrialStripeSubscriptionId) {
        await cancelHostedPulseTrialCheckoutLoserSubscription({
          memberId: invite.member.id,
          prisma,
          subscriptionId:
            checkoutOutcome.cleanupPulseTrialStripeSubscriptionId,
        });
      }
      if (
        checkoutOutcome.activatedMemberId
        && checkoutOutcome.hostedExecutionEventId
      ) {
        await signalHostedMemberActivationRuntimeWakeBestEffortResult({
          hostedExecutionEventId: checkoutOutcome.hostedExecutionEventId,
          memberId: checkoutOutcome.activatedMemberId,
          prisma,
          source: "checkout-retry.activation",
        });
      }
      if (checkoutOutcome.welcomeEmailMemberId) {
        await sendHostedSignupWelcomeEmailForMemberBestEffort({
          memberId: checkoutOutcome.welcomeEmailMemberId,
          prisma,
        });
      }
      if (!checkoutOutcome.billingActive) {
        throw hostedOnboardingError({
          code: "HOSTED_BILLING_CHECKOUT_PAYMENT_INCOMPLETE",
          httpStatus: 409,
          message:
            "Checkout finished, but payment still needs attention. Open Billing settings to finish payment.",
        });
      }
      finishHostedOnboardingTiming(timing, "completed", {
        alreadyActive: true,
      });
      return {
        alreadyActive: true,
        url: null,
      };
    }

    finishHostedOnboardingTiming(timing, "completed", {
      alreadyActive: false,
    });

    return {
      alreadyActive: false,
      url: checkoutOutcome.url,
    };
  } catch (error) {
    finishHostedOnboardingTiming(timing, "failed", {
      errorName: deriveHostedOnboardingTimingErrorName(error),
    });
    throw error;
  }
}

type HostedBillingCheckoutLockedOutcome =
  | {
      kind: "already_active";
    }
  | {
      kind: "completed";
      url: string;
    }
  | {
      kind: "completed_session";
      session: Stripe.Checkout.Session;
    }
  | {
      error: Error;
      kind: "failed";
    }
  | {
      activatedMemberId: string | null;
      billingActive: boolean;
      cleanupCheckoutSubscription?:
        HostedCheckoutSubscriptionCleanupCandidate | null;
      cleanupPulseTrialStripeSubscriptionId?: string | null;
      hostedExecutionEventId: string | null;
      kind: "reconciled";
      welcomeEmailMemberId: string | null;
    }
  | {
      kind: "replace_attempt";
    };

interface HostedBillingCheckoutPreparedAttempt {
  kind: "attempt";
  attempt: HostedMemberStripeCheckoutAttemptReservation;
  desiredIntentHash: string;
  resolvedOffer: HostedBillingCheckoutOffer;
  stripeCustomerId: string | null;
  verifiedEmailAddress: string | null;
}

async function withHostedBillingCheckoutMemberLock<TResult>(input: {
  memberId: string;
  prisma: PrismaClient;
  run: (tx: Prisma.TransactionClient) => Promise<TResult>;
}): Promise<TResult> {
  try {
    return await withHostedMemberStripeMutationLockForOps({
      acquisitionTimeoutMs: HOSTED_BILLING_CHECKOUT_MEMBER_LOCK_ACQUISITION_TIMEOUT_MS,
      memberId: input.memberId,
      prisma: input.prisma,
      run: input.run,
      transactionTimeoutMs: HOSTED_BILLING_CHECKOUT_TRANSACTION_TIMEOUT_MS,
    });
  } catch (error) {
    if (error instanceof HostedMemberStripeMutationLockBusyError) {
      throw hostedOnboardingError({
        cause: error,
        code: "HOSTED_BILLING_CHECKOUT_BUSY",
        httpStatus: 409,
        message: "Billing checkout is already being updated. Try again shortly.",
        retryable: true,
      });
    }
    throw error;
  }
}

async function prepareHostedBillingCheckoutAttemptLocked(input: {
  billingPlanCode: HostedBillingPlanCode;
  checkoutOffer: HostedBillingCheckoutOffer;
  inviteCode: string;
  memberId: string;
  now: Date;
  priceId: string;
  publicBaseUrl: string;
  replaceAttempt: HostedMemberStripeCheckoutAttemptReservation | null;
  tx: Prisma.TransactionClient;
  verifiedEmailAddress: string | null;
}): Promise<
  HostedBillingCheckoutPreparedAttempt | { kind: "already_active" }
> {
  const member = await input.tx.hostedMember.findUnique({
    select: {
      billingStatus: true,
      suspendedAt: true,
    },
    where: {
      id: input.memberId,
    },
  });
  if (!member) {
    throw hostedOnboardingError({
      code: "HOSTED_MEMBER_NOT_FOUND",
      httpStatus: 404,
      message: "Your hosted member record was not found.",
    });
  }
  if (member.suspendedAt instanceof Date) {
    throw hostedOnboardingError({
      code: "HOSTED_MEMBER_SUSPENDED",
      httpStatus: 403,
      message: "This hosted account is suspended. Contact support to restore access.",
    });
  }
  if (member.billingStatus === HostedBillingStatus.active) {
    return { kind: "already_active" };
  }
  const familyBillingClaim = await readHostedMemberFamilyBillingClaim({
    memberId: input.memberId,
    prisma: input.tx,
  });
  if (familyBillingClaim) {
    throw buildHostedFamilyBillingClaimCheckoutError(familyBillingClaim);
  }

  const currentBillingRef = await readHostedMemberStripeBillingRef({
    memberId: input.memberId,
    prisma: input.tx,
  });
  const resolvedOffer = resolveHostedBillingCheckoutOffer({
    billingPlanCode: input.billingPlanCode,
    checkoutOffer: input.checkoutOffer,
    currentBillingRef,
  });
  const stripeCustomerId = currentBillingRef?.stripeCustomerId ?? null;
  const verifiedEmailAddress = stripeCustomerId ? null : input.verifiedEmailAddress;
  const intentHash = buildHostedBillingCheckoutIntentHash({
    billingPlanCode: input.billingPlanCode,
    checkoutOffer: resolvedOffer,
    inviteCode: input.inviteCode,
    memberId: input.memberId,
    priceId: input.priceId,
    publicBaseUrl: input.publicBaseUrl,
    stripeCustomerId,
    verifiedEmailAddress,
  });
  if (input.replaceAttempt) {
    const cleared = await clearHostedMemberStripeCheckoutAttemptTx({
      attemptId: input.replaceAttempt.attemptId,
      expectedSessionId: input.replaceAttempt.stripeCheckoutSessionId,
      intentHash: input.replaceAttempt.intentHash,
      memberId: input.memberId,
      tx: input.tx,
    });
    if (!cleared) {
      throw buildHostedBillingCheckoutAttemptStaleError();
    }
  }
  const attempt = await reserveHostedMemberStripeCheckoutAttemptTx({
    attemptId: randomUUID(),
    createdAt: input.now,
    intentHash,
    memberId: input.memberId,
    tx: input.tx,
  });

  return {
    attempt,
    desiredIntentHash: intentHash,
    kind: "attempt",
    resolvedOffer,
    stripeCustomerId,
    verifiedEmailAddress,
  };
}

async function runHostedBillingCheckoutAttemptLocked(input: {
  billingPlanCode: HostedBillingPlanCode;
  inviteCode: string;
  memberId: string;
  now: Date;
  preparedAttempt: HostedBillingCheckoutPreparedAttempt;
  priceId: string;
  publicBaseUrl: string;
  stripe: Stripe;
  tx: Prisma.TransactionClient;
}): Promise<HostedBillingCheckoutLockedOutcome> {
  const member = await input.tx.hostedMember.findUnique({
    select: {
      billingStatus: true,
      suspendedAt: true,
    },
    where: {
      id: input.memberId,
    },
  });
  if (!member) {
    return {
      error: hostedOnboardingError({
        code: "HOSTED_MEMBER_NOT_FOUND",
        httpStatus: 404,
        message: "Your hosted member record was not found.",
      }),
      kind: "failed",
    };
  }
  if (member.suspendedAt instanceof Date) {
    return {
      error: hostedOnboardingError({
        code: "HOSTED_MEMBER_SUSPENDED",
        httpStatus: 403,
        message:
          "This hosted account is suspended. Contact support to restore access.",
      }),
      kind: "failed",
    };
  }
  if (member.billingStatus === HostedBillingStatus.active) {
    await clearHostedMemberStripeCheckoutAttemptTx({
      attemptId: input.preparedAttempt.attempt.attemptId,
      expectedSessionId:
        input.preparedAttempt.attempt.stripeCheckoutSessionId,
      intentHash: input.preparedAttempt.attempt.intentHash,
      memberId: input.memberId,
      tx: input.tx,
    });
    return { kind: "already_active" };
  }
  const familyBillingClaim = await readHostedMemberFamilyBillingClaim({
    memberId: input.memberId,
    prisma: input.tx,
  });
  if (familyBillingClaim) {
    return {
      error: buildHostedFamilyBillingClaimCheckoutError(familyBillingClaim),
      kind: "failed",
    };
  }
  const exactAttempt = await reserveHostedMemberStripeCheckoutAttemptTx({
    attemptId: input.preparedAttempt.attempt.attemptId,
    createdAt: input.preparedAttempt.attempt.createdAt,
    intentHash: input.preparedAttempt.attempt.intentHash,
    memberId: input.memberId,
    tx: input.tx,
  });
  if (
    exactAttempt.attemptId !== input.preparedAttempt.attempt.attemptId
    || exactAttempt.intentHash !== input.preparedAttempt.attempt.intentHash
  ) {
    return {
      error: buildHostedBillingCheckoutAttemptStaleError(),
      kind: "failed",
    };
  }
  const attempt = exactAttempt;

  if (attempt.stripeCheckoutSessionId) {
    const existingSessionOutcome = await readExistingHostedBillingCheckoutAttempt({
      attempt,
      desiredIntentHash: input.preparedAttempt.desiredIntentHash,
      memberId: input.memberId,
      stripe: input.stripe,
    });
    if (existingSessionOutcome.kind === "failed") {
      return existingSessionOutcome;
    }
    if (existingSessionOutcome.kind === "reuse") {
      return {
        kind: "completed",
        url: existingSessionOutcome.url,
      };
    }
    if (existingSessionOutcome.kind === "complete") {
      return {
        kind: "completed_session",
        session: existingSessionOutcome.session,
      };
    }
    if (existingSessionOutcome.kind === "unusable") {
      const cleared = await clearHostedMemberStripeCheckoutAttemptTx({
        attemptId: attempt.attemptId,
        expectedSessionId: attempt.stripeCheckoutSessionId,
        intentHash: attempt.intentHash,
        memberId: input.memberId,
        tx: input.tx,
      });
      return cleared
        ? {
            error: buildHostedBillingCheckoutSessionUnavailableError(),
            kind: "failed",
          }
        : {
            error: buildHostedBillingCheckoutAttemptStaleError(),
            kind: "failed",
          };
    }
    return { kind: "replace_attempt" };
  } else if (
    attempt.intentHash !== input.preparedAttempt.desiredIntentHash
  ) {
    return {
      error: buildHostedBillingCheckoutConflictError(),
      kind: "failed",
    };
  }
  if (!isHostedBillingCheckoutAttemptInsideRecoveryWindow({
    attempt,
    now: input.now,
  })) {
    return {
      error: buildHostedBillingCheckoutAttemptRecoveryRequiredError(),
      kind: "failed",
    };
  }

  const checkoutMetadata = buildHostedBillingOfferMetadata({
    billingPlanCode: input.billingPlanCode,
    checkoutAttemptId: attempt.attemptId,
    checkoutIntentHash: attempt.intentHash,
    checkoutOffer: input.preparedAttempt.resolvedOffer,
    memberId: input.memberId,
  });
  let checkoutSession: Stripe.Checkout.Session;
  try {
    checkoutSession = await withHostedStripeFailureLog(
      "checkout.sessions.create.billing-start",
      () => input.stripe.checkout.sessions.create({
        cancel_url: buildStripeCancelUrl(input.publicBaseUrl, input.inviteCode),
        client_reference_id: input.memberId,
        ...(input.preparedAttempt.stripeCustomerId
          ? { customer: input.preparedAttempt.stripeCustomerId }
          : {}),
        ...(input.preparedAttempt.verifiedEmailAddress
          ? { customer_email: input.preparedAttempt.verifiedEmailAddress }
          : {}),
        line_items: buildHostedBillingCheckoutLineItems(input.priceId),
        metadata: checkoutMetadata,
        mode: "subscription",
        payment_method_types: ["card"],
        subscription_data: {
          metadata: checkoutMetadata,
          ...(input.preparedAttempt.resolvedOffer === HOSTED_PULSE_TRIAL_OFFER
            ? { trial_period_days: HOSTED_PULSE_TRIAL_DAYS }
            : {}),
        },
        success_url: buildStripeSuccessUrl(input.publicBaseUrl, input.inviteCode),
      }, {
        ...HOSTED_BILLING_CHECKOUT_STRIPE_AUTHORITY_REQUEST_OPTIONS,
        idempotencyKey: buildHostedBillingCheckoutIdempotencyKey({
          attemptId: attempt.attemptId,
          intentHash: attempt.intentHash,
        }),
      }),
    );
  } catch (error) {
    if (
      !isHostedStripeRetryableFailure(error)
      && !isHostedStripeIdempotencyConflict(error)
    ) {
      await clearHostedMemberStripeCheckoutAttemptTx({
        attemptId: attempt.attemptId,
        expectedSessionId: null,
        intentHash: attempt.intentHash,
        memberId: input.memberId,
        tx: input.tx,
      });
    }
    return {
      error: buildHostedBillingCheckoutStripeError(error),
      kind: "failed",
    };
  }

  try {
    assertHostedBillingCheckoutSessionMatchesAttempt({
      attempt,
      memberId: input.memberId,
      session: checkoutSession,
    });
    await bindHostedMemberStripeCheckoutSessionTx({
      attemptId: attempt.attemptId,
      intentHash: attempt.intentHash,
      memberId: input.memberId,
      sessionId: checkoutSession.id,
      tx: input.tx,
    });
  } catch (error) {
    return {
      error: error instanceof Error
        ? error
        : buildHostedBillingCheckoutAttemptStaleError(),
      kind: "failed",
    };
  }

  if (!checkoutSession.url) {
    if (checkoutSession.status === "open") {
      const expireError = await expireHostedBillingCheckoutSession({
        operationName: "checkout.sessions.expire.missing-url",
        session: checkoutSession,
        stripe: input.stripe,
      });
      if (expireError) {
        return {
          error: expireError,
          kind: "failed",
        };
      }
      const cleared = await clearHostedMemberStripeCheckoutAttemptTx({
        attemptId: attempt.attemptId,
        expectedSessionId: checkoutSession.id,
        intentHash: attempt.intentHash,
        memberId: input.memberId,
        tx: input.tx,
      });
      if (!cleared) {
        return {
          error: buildHostedBillingCheckoutAttemptStaleError(),
          kind: "failed",
        };
      }
    }
    return {
      error: buildHostedBillingCheckoutSessionUnavailableError(),
      kind: "failed",
    };
  }

  return {
    kind: "completed",
    url: checkoutSession.url,
  };
}

async function reconcileHostedBillingCompletedCheckoutSession(input: {
  memberId: string;
  observedAt: Date;
  prisma: PrismaClient;
  session: Stripe.Checkout.Session;
}): Promise<Extract<
  HostedBillingCheckoutLockedOutcome,
  { kind: "reconciled" }
>> {
  return withHostedMemberStripeMutationLock({
    memberId: input.memberId,
    prisma: input.prisma,
    run: async (tx) => {
      const activationOutcome = await applyStripeCheckoutCompleted(
        input.session,
        tx,
        undefined,
        input.observedAt,
      );
      const member = await tx.hostedMember.findUnique({
        select: {
          billingStatus: true,
        },
        where: {
          id: input.memberId,
        },
      });
      return {
        ...activationOutcome,
        billingActive: member?.billingStatus === HostedBillingStatus.active,
        kind: "reconciled",
      };
    },
  });
}

type HostedBillingExistingCheckoutOutcome =
  | {
      kind: "complete";
      session: Stripe.Checkout.Session;
    }
  | {
      kind: "expired";
    }
  | {
      error: Error;
      kind: "failed";
    }
  | {
      kind: "reuse";
      url: string;
    }
  | {
      kind: "unusable";
    };

async function readExistingHostedBillingCheckoutAttempt(input: {
  attempt: HostedMemberStripeCheckoutAttemptReservation;
  desiredIntentHash: string;
  memberId: string;
  stripe: Stripe;
}): Promise<HostedBillingExistingCheckoutOutcome> {
  const sessionId = input.attempt.stripeCheckoutSessionId;
  if (!sessionId) {
    return {
      error: buildHostedBillingCheckoutAttemptStaleError(),
      kind: "failed",
    };
  }

  let session: Stripe.Checkout.Session;
  try {
    session = await withHostedStripeFailureLog(
      "checkout.sessions.retrieve.billing-start",
      () => input.stripe.checkout.sessions.retrieve(
        sessionId,
        {},
        HOSTED_BILLING_CHECKOUT_STRIPE_AUTHORITY_REQUEST_OPTIONS,
      ),
    );
  } catch (error) {
    return {
      error: buildHostedBillingCheckoutStripeError(error),
      kind: "failed",
    };
  }

  try {
    assertHostedBillingCheckoutSessionMatchesAttempt({
      attempt: input.attempt,
      memberId: input.memberId,
      session,
    });
  } catch (error) {
    return {
      error: error instanceof Error
        ? error
        : buildHostedBillingCheckoutAttemptStaleError(),
      kind: "failed",
    };
  }

  if (session.status === "complete") {
    return {
      kind: "complete",
      session,
    };
  }
  if (session.status === "expired") {
    return { kind: "expired" };
  }
  if (session.status !== "open") {
    return {
      error: buildHostedBillingCheckoutAttemptStaleError(),
      kind: "failed",
    };
  }

  const sameIntent = input.attempt.intentHash === input.desiredIntentHash;
  if (sameIntent && session.url) {
    return {
      kind: "reuse",
      url: session.url,
    };
  }

  const expireError = await expireHostedBillingCheckoutSession({
    operationName: sameIntent
      ? "checkout.sessions.expire.missing-url"
      : "checkout.sessions.expire.billing-restart",
    session,
    stripe: input.stripe,
  });
  if (expireError) {
    return {
      error: expireError,
      kind: "failed",
    };
  }
  return sameIntent ? { kind: "unusable" } : { kind: "expired" };
}

async function expireHostedBillingCheckoutSession(input: {
  operationName: string;
  session: Stripe.Checkout.Session;
  stripe: Stripe;
}): Promise<Error | null> {
  try {
    const expiredSession = await withHostedStripeFailureLog(
      input.operationName,
      () => input.stripe.checkout.sessions.expire(
        input.session.id,
        {},
        HOSTED_BILLING_CHECKOUT_STRIPE_AUTHORITY_REQUEST_OPTIONS,
      ),
    );
    return expiredSession.id === input.session.id
        && expiredSession.status === "expired"
      ? null
      : buildHostedBillingCheckoutAttemptStaleError();
  } catch (error) {
    return buildHostedBillingCheckoutStripeError(error);
  }
}

function assertHostedBillingCheckoutSessionMatchesAttempt(input: {
  attempt: HostedMemberStripeCheckoutAttemptReservation;
  memberId: string;
  session: Stripe.Checkout.Session;
}): void {
  if (
    input.session.id !== (input.attempt.stripeCheckoutSessionId ?? input.session.id)
    || input.session.client_reference_id !== input.memberId
    || input.session.mode !== "subscription"
    || input.session.metadata?.memberId !== input.memberId
    || input.session.metadata?.checkoutAttemptId !== input.attempt.attemptId
    || input.session.metadata?.checkoutIntentHash !== input.attempt.intentHash
  ) {
    throw hostedOnboardingError({
      code: "HOSTED_BILLING_CHECKOUT_SESSION_MISMATCH",
      httpStatus: 500,
      message:
        "Stripe returned a checkout session that does not match the reserved billing attempt.",
    });
  }
}

export function buildHostedBillingCheckoutIntentHash(input: {
  billingPlanCode: HostedBillingPlanCode;
  checkoutOffer: HostedBillingCheckoutOffer;
  inviteCode: string;
  memberId: string;
  priceId: string;
  publicBaseUrl: string;
  stripeCustomerId: string | null;
  verifiedEmailAddress: string | null;
}): string {
  const baseMetadata = buildHostedBillingOfferMetadata({
    billingPlanCode: input.billingPlanCode,
    checkoutOffer: input.checkoutOffer,
    memberId: input.memberId,
  });
  const canonicalIntent = {
    cancelUrl: buildStripeCancelUrl(input.publicBaseUrl, input.inviteCode),
    customerEmailLookupKey: createHostedEmailLookupKey(input.verifiedEmailAddress),
    inviteCode: input.inviteCode,
    lineItems: buildHostedBillingCheckoutLineItems(input.priceId),
    metadata: Object.entries(baseMetadata).sort(([left], [right]) =>
      left.localeCompare(right)
    ),
    mode: "subscription",
    stripeCustomerId: input.stripeCustomerId,
    successUrl: buildStripeSuccessUrl(input.publicBaseUrl, input.inviteCode),
  };
  return createHash("sha256")
    .update(JSON.stringify(canonicalIntent))
    .digest("hex")
    .slice(0, 32);
}

function buildHostedBillingCheckoutIdempotencyKey(input: {
  attemptId: string;
  intentHash: string;
}): string {
  return [
    "hosted-billing-checkout",
    input.attemptId,
    input.intentHash,
  ].join(":");
}

function buildHostedBillingCheckoutConflictError() {
  return hostedOnboardingError({
    code: "HOSTED_BILLING_CHECKOUT_ALREADY_OPEN",
    httpStatus: 409,
    message:
      "A billing checkout is already being created. Retry before changing plans or offers.",
    retryable: true,
  });
}

function buildHostedFamilyMemberAlreadySponsoredCheckoutError() {
  return hostedOnboardingError({
    code: "HOSTED_FAMILY_MEMBER_ALREADY_SPONSORED",
    httpStatus: 409,
    message: "Your Murph access is already covered by a Family plan.",
  });
}

function buildHostedFamilyBillingClaimCheckoutError(
  claim: HostedMemberFamilyBillingClaim,
) {
  if (claim.kind === "active_sponsorship") {
    return buildHostedFamilyMemberAlreadySponsoredCheckoutError();
  }
  return hostedOnboardingError({
    code: "HOSTED_FAMILY_BILLING_IN_PROGRESS",
    httpStatus: 409,
    message:
      "Family billing is already in progress for this account. Finish or cancel that checkout before starting individual billing.",
  });
}

function buildHostedBillingCheckoutAttemptStaleError() {
  return hostedOnboardingError({
    code: "HOSTED_BILLING_CHECKOUT_ATTEMPT_STALE",
    httpStatus: 409,
    message: "Billing checkout changed while Stripe was responding. Try again.",
    retryable: true,
  });
}

function buildHostedBillingCheckoutAttemptRecoveryRequiredError() {
  return hostedOnboardingError({
    code: "HOSTED_BILLING_CHECKOUT_ATTEMPT_RECOVERY_REQUIRED",
    httpStatus: 409,
    message:
      "This billing checkout is too old to retry safely. Contact support to reconcile it before starting another checkout.",
  });
}

function buildHostedBillingCheckoutSessionUnavailableError() {
  return hostedOnboardingError({
    code: "HOSTED_BILLING_CHECKOUT_SESSION_UNAVAILABLE",
    httpStatus: 409,
    message:
      "Stripe did not provide a usable billing checkout. Try again to start a fresh checkout.",
    retryable: true,
  });
}

function isHostedBillingCheckoutAttemptInsideRecoveryWindow(input: {
  attempt: HostedMemberStripeCheckoutAttemptReservation;
  now: Date;
}): boolean {
  const ageMs = input.now.getTime() - input.attempt.createdAt.getTime();
  return ageMs >= 0
    && ageMs < HOSTED_STRIPE_IDEMPOTENCY_SAFE_REPLAY_WINDOW_MS;
}

function buildHostedBillingCheckoutStripeError(error: unknown) {
  if (isHostedStripeIdempotencyConflict(error)) {
    return buildHostedBillingCheckoutConflictError();
  }
  const retryable = isHostedStripeRetryableFailure(error);
  return hostedOnboardingError({
    cause: error,
    code: retryable
      ? "HOSTED_BILLING_CHECKOUT_PROVIDER_UNAVAILABLE"
      : "HOSTED_BILLING_CHECKOUT_PROVIDER_REJECTED",
    httpStatus: retryable ? 502 : 500,
    message: retryable
      ? "Stripe could not confirm billing checkout. Retry to recover the same attempt."
      : "Stripe rejected the billing checkout request. Contact support before retrying.",
    retryable,
  });
}

async function reserveHostedPulseTrialCheckoutCustomer(input: {
  memberId: string;
  now: Date;
  prisma: PrismaClient;
  stripe: ReturnType<typeof requireHostedStripeCheckoutConfig>["stripe"];
}): Promise<string> {
  const reservation = await withHostedBillingCheckoutMemberLock({
    memberId: input.memberId,
    prisma: input.prisma,
    run: async (tx) => {
      const member = await tx.hostedMember.findUnique({
        select: {
          suspendedAt: true,
        },
        where: {
          id: input.memberId,
        },
      });
      if (!member || member.suspendedAt instanceof Date) {
        throw hostedOnboardingError({
          code: member ? "HOSTED_MEMBER_SUSPENDED" : "HOSTED_MEMBER_NOT_FOUND",
          httpStatus: member ? 403 : 404,
          message: member
            ? "This hosted account is suspended. Contact support to restore access."
            : "Your hosted member record was not found.",
        });
      }
      return reserveHostedMemberStripeCustomerReservationTx({
        memberId: input.memberId,
        now: input.now,
        tx,
      });
    },
  });

  if (reservation.kind === "bound") {
    return reservation.stripeCustomerId;
  }

  let candidateStripeCustomerId: string;
  try {
    candidateStripeCustomerId = await createHostedPulseTrialStripeCustomer({
      memberId: input.memberId,
      requestOptions: HOSTED_BILLING_CHECKOUT_STRIPE_AUTHORITY_REQUEST_OPTIONS,
      reservationId: reservation.reservationId,
      stripe: input.stripe,
    });
  } catch (error) {
    if (isHostedStripeDefinitiveRequestRejection(error)) {
      await withHostedBillingCheckoutMemberLock({
        memberId: input.memberId,
        prisma: input.prisma,
        run: (tx) =>
          clearHostedMemberStripeCustomerReservationAfterDefinitiveFailureTx({
            memberId: input.memberId,
            reservationId: reservation.reservationId,
            tx,
          }),
      });
    }
    throw error;
  }

  const finalization = await withHostedBillingCheckoutMemberLock({
    memberId: input.memberId,
    prisma: input.prisma,
    run: async (tx) => {
      const member = await tx.hostedMember.findUnique({
        select: {
          suspendedAt: true,
        },
        where: {
          id: input.memberId,
        },
      });
      const finalized =
        await finalizeHostedMemberStripeCustomerReservationTx({
          bindAllowed: Boolean(member && !(member.suspendedAt instanceof Date)),
          candidateStripeCustomerId,
          memberId: input.memberId,
          now: input.now,
          reservationId: reservation.reservationId,
          tx,
        });
      return {
        finalized,
        memberExists: Boolean(member),
      };
    },
  });
  if (finalization.finalized.kind === "bound") {
    return finalization.finalized.stripeCustomerId;
  }
  throw hostedOnboardingError({
    code: finalization.memberExists
      ? "HOSTED_MEMBER_SUSPENDED"
      : "HOSTED_MEMBER_NOT_FOUND",
    httpStatus: finalization.memberExists ? 403 : 404,
    message: finalization.memberExists
      ? "This hosted account is suspended. Contact support to restore access."
      : "Your hosted member record was not found.",
  });
}

async function resolveHostedBillingCheckoutAuth(
  input: HostedBillingCheckoutInput,
): Promise<{ member: HostedBillingCheckoutAuthenticatedMember }> {
  if (input.member) {
    return { member: input.member };
  }

  throw new TypeError("Hosted billing checkout requires the authenticated hosted member.");
}

function resolveHostedBillingCheckoutOffer(input: {
  billingPlanCode: HostedBillingPlanCode;
  checkoutOffer: HostedBillingCheckoutOffer;
  currentBillingRef: Awaited<ReturnType<typeof readHostedMemberStripeBillingRef>>;
}): HostedBillingCheckoutOffer {
  if (input.checkoutOffer === HOSTED_STANDARD_CHECKOUT_OFFER) {
    return input.checkoutOffer;
  }

  if (input.checkoutOffer !== HOSTED_PULSE_TRIAL_OFFER) {
    throw hostedOnboardingError({
      code: "HOSTED_BILLING_CHECKOUT_OFFER_UNSUPPORTED",
      message: "That hosted checkout offer is not supported.",
      httpStatus: 400,
    });
  }

  if (input.billingPlanCode !== "launch_monthly") {
    throw hostedOnboardingError({
      code: "HOSTED_BILLING_CHECKOUT_OFFER_PLAN_MISMATCH",
      message: "Pulse Trial is only available for the Pulse plan.",
      httpStatus: 400,
    });
  }

  if (!isHostedPulseTrialCheckoutEnabled()) {
    throw hostedOnboardingError({
      code: "HOSTED_PULSE_TRIAL_CHECKOUT_DISABLED",
      message: "Pulse Trial checkout is not available yet.",
      httpStatus: 404,
    });
  }

  if (input.currentBillingRef?.pulseTrialRedeemedAt) {
    throw hostedOnboardingError({
      code: "HOSTED_PULSE_TRIAL_ALREADY_REDEEMED",
      message: "This hosted account has already used its Pulse Trial. Continue with Pulse instead.",
      httpStatus: 409,
    });
  }

  return input.checkoutOffer;
}
