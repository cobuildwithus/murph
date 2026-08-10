import {
  HostedBillingStatus,
  Prisma,
  type PrismaClient,
} from "@prisma/client";
import type Stripe from "stripe";

import {
  prepareHostedCryptoDomainRootCandidates,
  provisionActiveHostedDomainRootEnvelopeForUserOnly,
  unwrapHostedDomainRootForWeb,
  type PreparedHostedCryptoDomainRootCandidates,
} from "../hosted-crypto/domain-root-store";
import { runWithHostedDomainRootUnwrapCache } from "../hosted-crypto/domain-root-unwrap-cache";
import {
  reconcileHostedAiUsageGateForBillingModeChangeTx,
} from "../hosted-execution/usage-allowance";
import {
  coerceStripeInvoiceSubscriptionId,
  coerceStripeObjectId,
  coerceStripeSubscriptionId,
  mapStripeSubscriptionStatusToHostedBillingStatus,
} from "./billing";
import {
  HOSTED_PULSE_TRIAL_OFFER,
  HOSTED_PULSE_TRIAL_POLICY_VERSION,
  HOSTED_PULSE_TRIAL_STARTED_AT_OVERRIDE_METADATA_KEY,
  HOSTED_STANDARD_CHECKOUT_OFFER,
  getHostedBillingPlanDefinition,
  HOSTED_BILLING_PLAN_CODES,
  parseHostedBillingCheckoutOffer,
  parseHostedBillingPhase,
  parseHostedBillingPlanCode,
  parseHostedPulseTrialPolicyVersion,
  requireHostedPulseTrialPolicy,
} from "./billing-plans";
import {
  assertHostedMemberNotSuspended,
  isHostedAccessBlockedBillingStatus,
} from "./entitlement";
import { HostedOnboardingError, hostedOnboardingError } from "./errors";
import {
  activateHostedMemberForPositiveSourceTx,
} from "./member-activation";
import {
  acceptHostedMemberStripeCheckoutCompletionTx,
  clearHostedMemberStripeCheckoutAttemptForSessionTx,
  prepareHostedMemberStripeCheckoutCompletion,
  readHostedMemberStripeBillingRef,
  withHostedMemberStripeMutationLock,
  writeAcceptedHostedMemberPulseTrialBillingTx,
  type HostedMemberStripeCheckoutAcceptance,
  type PreparedHostedMemberStripeCheckoutCompletion,
} from "./hosted-member-billing-store";
import {
  prepareHostedMemberStripeCheckoutEmail,
  type PreparedHostedMemberStripeCheckoutEmail,
  type HostedMemberBillingSnapshot,
  readHostedMemberBillingSnapshot,
  readHostedMemberCoreState,
  readHostedMemberPulseTrialBillingDecisionSnapshot,
  updateHostedMemberCoreState,
  upsertHostedMemberStripeCheckoutEmailIfFreshTx,
  upsertPreparedHostedMemberStripeCheckoutEmailIfFreshUnderLockTx,
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
  terminalizeHostedFamilySponsoredDirectBillingTx,
  writeHostedMemberStripeBillingTx,
} from "./stripe-billing-policy";
import {
  type HostedStripeDispatchContext,
} from "./stripe-dispatch";
import {
  logHostedStripeFailure,
  withHostedStripeFailureLog,
} from "./stripe-error-log";
import {
  requireHostedStripeApi,
  requireHostedStripeBillingPlanConfig,
} from "./runtime";
import {
  classifyHostedPulseTrialCandidateDisposition,
  classifyHostedPulseTrialCandidateDispositionByLookupKey,
  cancelHostedPulseTrialLoserSubscriptionsForMember,
  isHostedPulseTrialSubscriptionForKnownPolicy,
} from "./pulse-trial-subscription-cleanup";
import { parseHostedPulseTrialStartSource } from "./pulse-trial-start-source";
import {
  applyHostedFamilyStripeCheckoutExpiredTx,
  applyHostedFamilyStripeCheckoutCompletedTx,
  applyHostedFamilyStripeSubscriptionUpdatedTx,
  HOSTED_FAMILY_BILLING_PLAN_CODE,
  HOSTED_FAMILY_STRIPE_METADATA_KIND,
  lookupHostedAccountGroupIdByStripeSubscriptionId,
  readHostedAccountGroupStripeBillingRef,
  readHostedMemberFamilyBillingClaim,
  type PreparedHostedFamilyCryptoDomainRoots,
  type HostedFamilyStripeSubscriptionResult,
} from "./family-plan";
import { lockHostedMemberRow, normalizeNullableString } from "./shared";
import { cleanupHostedStandardCheckoutLoser } from "./stripe-checkout-loser-cleanup";

export type HostedStripeActivatedMemberOutcome = {
  activatedMemberId: string | null;
  hostedExecutionEventId: string | null;
};

export interface HostedStripeCheckoutCleanup {
  checkoutSessionId: string;
  subscriptionId: string;
}

type HostedStripeActivationOutcome = HostedStripeActivatedMemberOutcome & {
  activatedMembers?: HostedStripeActivatedMemberOutcome[];
  cleanupFamilySponsoredCheckout?: HostedStripeCheckoutCleanup | null;
  cleanupFamilySponsoredStripeSubscriptionId?: string | null;
  cleanupPulseTrialStripeSubscriptionId?: string | null;
  cleanupStandardCheckout?: HostedStripeCheckoutCleanup | null;
  runtimeRecheckMemberIds?: string[];
  welcomeEmailMemberId: string | null;
};

export type HostedStripeSubscriptionUpdateOutcome = HostedStripeActivationOutcome & {
  subscriptionCancellationEmail: HostedSubscriptionCancellationEmailCandidate | null;
};

export async function prepareHostedStripeDirectMemberActivationCrypto(input: {
  memberId: string;
  prisma: Prisma.TransactionClient & Pick<PrismaClient, "$transaction">;
}): Promise<PreparedHostedCryptoDomainRootCandidates> {
  for (const domain of ["control", "ingress"] as const) {
    await provisionActiveHostedDomainRootEnvelopeForUserOnly({
      domain,
      prisma: input.prisma,
      reason: "hosted-member.activation-preflight",
      userId: input.memberId,
    });
  }
  await Promise.all(
    (["control", "ingress"] as const).map(async (domain) => {
      const root = await unwrapHostedDomainRootForWeb({
        domain,
        prisma: input.prisma,
        userId: input.memberId,
      });
      root.rootKey.fill(0);
    }),
  );
  return prepareHostedCryptoDomainRootCandidates({
    domains: ["device", "runtime"],
    prisma: input.prisma,
    userId: input.memberId,
  });
}

export type HostedSubscriptionCancellationEmailCandidate = {
  memberId: string;
  stripeSubscriptionId: string;
};

type HostedFamilyBillingClaimDisposition =
  | "conflicting_family_subscription"
  | "none"
  | "same_family_subscription";

export interface PreparedHostedStripeCheckoutCompletion {
  billingCompletion: PreparedHostedMemberStripeCheckoutCompletion | null;
  canonicalSubscription: Stripe.Subscription | null;
  memberId: string;
  stripeCheckoutEmail: PreparedHostedMemberStripeCheckoutEmail | null;
}

export interface PreparedHostedStripeReversalProviderState {
  latestInvoiceId: string | null;
  memberId: string;
  paymentChargeId: string | null;
  paymentIntentId: string | null;
  refundCoversCurrentEntitlement: boolean;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  subscription: Stripe.Subscription | null;
}

async function classifyHostedFamilyBillingClaimTx(input: {
  canonicalSubscription?: Stripe.Subscription | null;
  checkoutSession?: Stripe.Checkout.Session;
  memberId: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  tx: Prisma.TransactionClient;
}): Promise<HostedFamilyBillingClaimDisposition> {
  await lockHostedMemberRow(input.tx, input.memberId);

  if (input.checkoutSession) {
    // A Family handoff can outlive both mutable billing projections. The
    // provider-owned Subscription is prepared before the member lock.
    const canonicalSubscription = readExpandedStripeCheckoutSubscription(
      input.checkoutSession,
    ) ?? input.canonicalSubscription ?? null;
    if (
      canonicalSubscription &&
      await canonicalSubscriptionBelongsToHostedFamilyOwnerTx({
        canonicalSubscription,
        memberId: input.memberId,
        stripeCustomerId: input.stripeCustomerId,
        stripeSubscriptionId: input.stripeSubscriptionId,
        tx: input.tx,
      })
    ) {
      return "same_family_subscription";
    }
  }

  const familyClaim = await readHostedMemberFamilyBillingClaim({
    memberId: input.memberId,
    prisma: input.tx,
  });
  if (!familyClaim) {
    return "none";
  }
  if (input.stripeSubscriptionId) {
    const familyGroupId =
      await lookupHostedAccountGroupIdByStripeSubscriptionId({
        prisma: input.tx,
        stripeSubscriptionId: input.stripeSubscriptionId,
      });
    if (familyGroupId === familyClaim.groupId) {
      return "same_family_subscription";
    }
  }

  return "conflicting_family_subscription";
}

async function canonicalSubscriptionBelongsToHostedFamilyOwnerTx(input: {
  canonicalSubscription: Stripe.Subscription;
  memberId: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  tx: Prisma.TransactionClient;
}): Promise<boolean> {
  const subscription = input.canonicalSubscription;
  const accountGroupId = normalizeNullableString(subscription?.metadata?.accountGroupId);
  const ownerMemberId = normalizeNullableString(subscription?.metadata?.ownerMemberId);
  const canonicalCustomerId = coerceStripeObjectId(subscription?.customer);
  if (
    !accountGroupId ||
    subscription.id !== input.stripeSubscriptionId ||
    subscription.metadata?.billingPlanCode !== HOSTED_FAMILY_BILLING_PLAN_CODE ||
    subscription.metadata?.kind !== HOSTED_FAMILY_STRIPE_METADATA_KIND ||
    ownerMemberId !== input.memberId ||
    (
      input.stripeCustomerId &&
      input.stripeCustomerId !== canonicalCustomerId
    )
  ) {
    return false;
  }

  const group = await input.tx.hostedAccountGroup.findUnique({
    select: { ownerMemberId: true },
    where: { id: accountGroupId },
  });
  return group?.ownerMemberId === input.memberId;
}

export async function applyStripeCheckoutCompleted(
  session: Stripe.Checkout.Session,
  prisma: Prisma.TransactionClient,
  dispatchContext?: HostedStripeDispatchContext,
  preparedCryptoDomainRoots?: PreparedHostedCryptoDomainRootCandidates,
  preparedCheckoutCompletion?: PreparedHostedStripeCheckoutCompletion,
): Promise<HostedStripeActivationOutcome> {
  const familyCheckout = await applyHostedFamilyStripeCheckoutCompletedTx({
    dispatchContext: dispatchContext ?? buildHostedStripeCheckoutSessionDispatchContext(session),
    session,
    tx: prisma,
  });
  if (familyCheckout.groupId) {
    return {
      activatedMemberId: null,
      hostedExecutionEventId: null,
      welcomeEmailMemberId: null,
    };
  }
  const isDirectCheckout =
    session.metadata?.kind !== HOSTED_FAMILY_STRIPE_METADATA_KIND;
  if (isDirectCheckout && !preparedCheckoutCompletion) {
    throw new TypeError(
      "Direct Stripe Checkout must be prepared before the transaction.",
    );
  }

  const isPulseTrialCheckout =
    session.metadata?.checkoutOffer === HOSTED_PULSE_TRIAL_OFFER;
  const member = await (async () => {
    if (isPulseTrialCheckout) {
      return findMemberForStripeCheckoutSession({
        prisma,
        session,
      });
    }
    if (!preparedCheckoutCompletion) {
      return findMemberForStripeCheckoutSession({
        prisma,
        session,
      });
    }
    if (
      preparedCheckoutCompletion.billingCompletion
      && preparedCheckoutCompletion.memberId !==
        preparedCheckoutCompletion.billingCompletion.memberId
    ) {
      return null;
    }
    return readHostedMemberCoreState({
      memberId: preparedCheckoutCompletion.memberId,
      prisma,
    });
  })();

  if (!member) {
    return {
      activatedMemberId: null,
      hostedExecutionEventId: null,
      welcomeEmailMemberId: null,
    };
  }
  const memberSnapshot = "core" in member
    ? member
    : {
        billingRef: null,
        core: member,
      };

  const familyClaimDisposition = await classifyHostedFamilyBillingClaimTx({
    checkoutSession: session,
    canonicalSubscription:
      preparedCheckoutCompletion?.canonicalSubscription ?? null,
    memberId: memberSnapshot.core.id,
    stripeCustomerId: coerceStripeObjectId(session.customer),
    stripeSubscriptionId: coerceStripeSubscriptionId(session.subscription),
    tx: prisma,
  });
  if (familyClaimDisposition !== "none") {
    if (familyClaimDisposition === "same_family_subscription") {
      await clearHostedMemberStripeCheckoutAttemptForSessionTx({
        memberId: memberSnapshot.core.id,
        sessionId: session.id,
        tx: prisma,
      });
    }
    const conflictingSubscriptionId = familyClaimDisposition ===
        "conflicting_family_subscription"
      ? coerceStripeSubscriptionId(session.subscription)
      : null;
    return {
      ...buildEmptyHostedStripeActivationOutcome(),
      ...(conflictingSubscriptionId
        ? {
            cleanupFamilySponsoredCheckout: {
              checkoutSessionId: session.id,
              subscriptionId: conflictingSubscriptionId,
            },
          }
        : {}),
    };
  }

  if (isPulseTrialCheckout) {
    if (!preparedCheckoutCompletion) {
      throw new TypeError(
        "Pulse Trial Stripe Checkout must be prepared before the transaction.",
      );
    }
    const outcome = await applyPulseTrialCheckoutCompletedTx({
      dispatchContext: dispatchContext ?? buildHostedStripeCheckoutSessionDispatchContext(session),
      memberId: memberSnapshot.core.id,
      preparedCheckoutCompletion,
      ...(preparedCryptoDomainRoots
        ? { preparedCryptoDomainRoots }
        : {}),
      session,
      tx: prisma,
    });
    await clearHostedMemberStripeCheckoutAttemptForSessionTx({
      memberId: memberSnapshot.core.id,
      sessionId: session.id,
      tx: prisma,
    });
    return outcome;
  }

  const stripeCustomerId = coerceStripeObjectId(session.customer);
  const stripeSubscriptionId = coerceStripeSubscriptionId(session.subscription);
  const canonicalSubscription =
    preparedCheckoutCompletion?.canonicalSubscription ?? null;
  if (
    stripeCustomerId
    && stripeSubscriptionId
    && (
      !canonicalSubscription
      || canonicalSubscription.id !== stripeSubscriptionId
      || coerceStripeObjectId(canonicalSubscription.customer) !== stripeCustomerId
    )
  ) {
    throw new TypeError(
      "Prepared canonical Stripe subscription does not match the Checkout Session.",
    );
  }
  const billingIdentityDisposition =
    canonicalSubscription?.status === "canceled"
    || canonicalSubscription?.status === "incomplete_expired"
      ? "terminal"
      : "bind";
  const acceptance = await bindHostedStripeBillingRefsFromCheckoutSessionTx({
    billingIdentityDisposition,
    dispatchContext: dispatchContext ?? buildHostedStripeCheckoutSessionDispatchContext(session),
    memberId: memberSnapshot.core.id,
    preparedCompletion:
      preparedCheckoutCompletion?.billingCompletion ?? undefined,
    preparedStripeCheckoutEmail:
      preparedCheckoutCompletion?.stripeCheckoutEmail ?? null,
    session,
    tx: prisma,
  });
  if (
    acceptance.kind === "cleanup_superseded"
    || acceptance.kind === "cleanup_terminal"
  ) {
    if (!stripeSubscriptionId) {
      throw new TypeError(
        "Accepted standard Stripe Checkout is missing its subscription.",
      );
    }
    return {
      ...buildEmptyHostedStripeActivationOutcome(),
      cleanupStandardCheckout: {
        checkoutSessionId: session.id,
        subscriptionId: stripeSubscriptionId,
      },
    };
  }
  if (billingIdentityDisposition === "terminal") {
    return buildEmptyHostedStripeActivationOutcome();
  }

  return {
    activatedMemberId: null,
    hostedExecutionEventId: null,
    welcomeEmailMemberId: memberSnapshot.core.id,
  };
}

export async function cleanupHostedStandardCheckoutAndRetireAttempt(input: {
  checkoutSessionId: string;
  memberId: string;
  prisma: PrismaClient;
  stripe?: Stripe;
  subscriptionId: string;
}): Promise<void> {
  await cleanupHostedStandardCheckoutLoser({
    ...(input.stripe ? { stripe: input.stripe } : {}),
    stripeSubscriptionId: input.subscriptionId,
  });
  // The conditional session-key clear is safe on stale replays and must stay
  // after provider cleanup so a failed refund remains owned by the receipt.
  await input.prisma.$transaction((tx) =>
    clearHostedMemberStripeCheckoutAttemptForSessionTx({
      memberId: input.memberId,
      sessionId: input.checkoutSessionId,
      tx,
    })
  );
}

export async function prepareHostedStripeCheckoutCompletion(input: {
  canonicalSubscription?: Stripe.Subscription | null;
  memberId: string;
  prisma: PrismaClient;
  session: Stripe.Checkout.Session;
}): Promise<PreparedHostedStripeCheckoutCompletion | null> {
  if (input.session.metadata?.kind === HOSTED_FAMILY_STRIPE_METADATA_KIND) {
    return null;
  }
  const stripeCustomerId = coerceStripeObjectId(input.session.customer);
  const stripeSubscriptionId =
    coerceStripeSubscriptionId(input.session.subscription);
  const stripeCheckoutEmail =
    readHostedStripeCheckoutSessionEmailAddress(input.session);
  const isPulseTrialCheckout =
    input.session.metadata?.checkoutOffer === HOSTED_PULSE_TRIAL_OFFER;
  return runWithHostedDomainRootUnwrapCache(async () => {
    const expandedSubscription =
      readExpandedStripeCheckoutSubscription(input.session);
    const [
      billingCompletion,
      canonicalSubscription,
      preparedStripeCheckoutEmail,
    ] = await Promise.all([
      stripeCustomerId && stripeSubscriptionId
        ? prepareHostedMemberStripeCheckoutCompletion({
            memberId: input.memberId,
            prisma: input.prisma,
            stripeCustomerId,
            stripeSubscriptionId,
          })
        : null,
      input.canonicalSubscription
      ?? (
        isPulseTrialCheckout && stripeSubscriptionId
          ? readHostedStripeCheckoutSessionSubscription(input.session)
          : expandedSubscription
            ?? (
              stripeSubscriptionId
                ? readHostedStripeCheckoutSessionSubscription(input.session)
                : null
            )
      ),
      stripeCheckoutEmail
        ? prepareHostedMemberStripeCheckoutEmail({
            address: stripeCheckoutEmail,
            memberId: input.memberId,
            prisma: input.prisma,
          })
        : null,
    ]);
    return {
      billingCompletion,
      canonicalSubscription,
      memberId: input.memberId,
      stripeCheckoutEmail: preparedStripeCheckoutEmail,
    };
  });
}

function readExpandedStripeCheckoutSubscription(
  session: Stripe.Checkout.Session,
): Stripe.Subscription | null {
  const subscription = session.subscription;
  return subscription && typeof subscription === "object" && "metadata" in subscription
    ? (subscription as Stripe.Subscription)
    : null;
}

export async function bindHostedStripeBillingRefsFromCheckoutSessionTx(input: {
  billingIdentityDisposition: "bind" | "terminal";
  dispatchContext?: Pick<HostedStripeDispatchContext, "eventCreatedAt" | "sourceEventId">;
  memberId: string;
  preparedCompletion?: PreparedHostedMemberStripeCheckoutCompletion;
  preparedStripeCheckoutEmail: PreparedHostedMemberStripeCheckoutEmail | null;
  session: Stripe.Checkout.Session;
  tx: Prisma.TransactionClient;
}): Promise<HostedMemberStripeCheckoutAcceptance> {
  const dispatchContext = input.dispatchContext ?? buildHostedStripeCheckoutSessionDispatchContext(input.session);
  const stripeCustomerId = coerceStripeObjectId(input.session.customer);
  const stripeSubscriptionId =
    coerceStripeSubscriptionId(input.session.subscription);
  if (!stripeCustomerId || !stripeSubscriptionId) {
    throw hostedOnboardingError({
      code: "HOSTED_BILLING_CHECKOUT_BINDING_INCOMPLETE",
      httpStatus: 502,
      message:
        "Stripe completed checkout without the customer and subscription references needed to bind billing.",
      retryable: true,
    });
  }
  if (
    !input.preparedCompletion
    || input.preparedCompletion.memberId !== input.memberId
    || input.preparedCompletion.stripeCustomerId !== stripeCustomerId
    || input.preparedCompletion.stripeSubscriptionId !== stripeSubscriptionId
  ) {
    throw new TypeError(
      "Standard Stripe Checkout completion must be prepared before the transaction.",
    );
  }
  const stripeCheckoutEmail =
    readHostedStripeCheckoutSessionEmailAddress(input.session);
  if (
    (input.preparedStripeCheckoutEmail?.address ?? null) !==
    stripeCheckoutEmail
  ) {
    throw new TypeError(
      "Prepared Stripe checkout email does not match the Checkout Session.",
    );
  }
  const checkoutAttemptId = normalizeNullableString(
    input.session.metadata?.checkoutAttemptId,
  );
  const checkoutIntentHash = normalizeNullableString(
    input.session.metadata?.checkoutIntentHash,
  );
  const acceptance = await acceptHostedMemberStripeCheckoutCompletionTx({
    billingIdentityDisposition: input.billingIdentityDisposition,
    checkoutAttemptId,
    checkoutIntentHash,
    checkoutSessionId: input.session.id,
    currentCheckoutOffer: HOSTED_STANDARD_CHECKOUT_OFFER,
    eventCreatedAt: dispatchContext.eventCreatedAt,
    memberId: input.memberId,
    preparedCompletion: input.preparedCompletion,
    tx: input.tx,
  });
  if (
    acceptance.kind === "cleanup_superseded"
    || acceptance.kind === "cleanup_terminal"
  ) {
    return acceptance;
  }

  if (
    input.billingIdentityDisposition === "bind"
    && input.preparedStripeCheckoutEmail
  ) {
    await upsertPreparedHostedMemberStripeCheckoutEmailIfFreshUnderLockTx({
      collectedAt: dispatchContext.eventCreatedAt,
      memberId: input.memberId,
      preparedEmail: input.preparedStripeCheckoutEmail,
      tx: input.tx,
    });
  }

  return acceptance;
}

export async function applyPulseTrialCheckoutCompletedTx(input: {
  dispatchContext: HostedStripeDispatchContext;
  memberId: string;
  preparedCheckoutCompletion: PreparedHostedStripeCheckoutCompletion;
  preparedCryptoDomainRoots?: PreparedHostedCryptoDomainRootCandidates;
  session: Stripe.Checkout.Session;
  tx: Prisma.TransactionClient;
}): Promise<HostedStripeActivationOutcome> {
  if (!isPulseTrialCheckoutSessionEntitlementCandidate(input.session, input.memberId)) {
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
  if (candidateMemberIds.length !== 1 || candidateMemberIds[0] !== input.memberId) {
    return {
      activatedMemberId: null,
      hostedExecutionEventId: null,
      welcomeEmailMemberId: null,
    };
  }

  if (
    input.preparedCheckoutCompletion.memberId !== input.memberId
    || (
      input.preparedCheckoutCompletion.billingCompletion
      && input.preparedCheckoutCompletion.billingCompletion.memberId !==
        input.memberId
    )
  ) {
    throw new TypeError(
      "Prepared Pulse Trial Checkout ownership does not match the member.",
    );
  }
  const subscription =
    input.preparedCheckoutCompletion.canonicalSubscription;
  const decisionTime = new Date();
  if (!subscription || !isValidPulseTrialCheckoutSubscription({
    decisionTime,
    session: input.session,
    subscription,
  })) {
    return {
      activatedMemberId: null,
      hostedExecutionEventId: null,
      welcomeEmailMemberId: null,
    };
  }
  const pulseTrialPriceId = process.env[
    getHostedBillingPlanDefinition("launch_monthly").priceIdEnvKey
  ];
  if (
    !pulseTrialPriceId ||
    !isHostedPulseTrialSubscriptionForKnownPolicy({
      memberId: input.memberId,
      priceId: pulseTrialPriceId,
      subscription,
    })
  ) {
    return {
      activatedMemberId: null,
      hostedExecutionEventId: null,
      welcomeEmailMemberId: null,
    };
  }
  const currentPeriodStart = readHostedStripeSubscriptionDate(subscription, "current_period_start");
  const currentPeriodEnd = readHostedStripeSubscriptionDate(subscription, "current_period_end");
  const currentTrialEndsAt = readHostedStripeSubscriptionDate(subscription, "trial_end");
  const currentTrialStartedAt = readHostedStripePulseTrialStartedAt(
    subscription,
    currentTrialEndsAt,
  );
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

  const preparedCompletion =
    input.preparedCheckoutCompletion.billingCompletion;
  if (!preparedCompletion) {
    throw hostedOnboardingError({
      code: "HOSTED_BILLING_CHECKOUT_BINDING_INCOMPLETE",
      httpStatus: 502,
      message:
        "Stripe completed checkout without the customer and subscription references needed to bind billing.",
      retryable: true,
    });
  }
  await lockHostedMemberRow(input.tx, input.memberId);
  const currentMember =
    await readHostedMemberPulseTrialBillingDecisionSnapshot({
      memberId: input.memberId,
      prisma: input.tx,
    });
  if (!currentMember) {
    return {
      activatedMemberId: null,
      cleanupPulseTrialStripeSubscriptionId: subscription.id,
      hostedExecutionEventId: null,
      welcomeEmailMemberId: null,
    };
  }

  const candidateDisposition =
    classifyHostedPulseTrialCandidateDispositionByLookupKey({
      billingStatus: currentMember.core.billingStatus,
      currentBillingPhase: currentMember.currentBillingPhase,
      currentStripeSubscriptionLookupKey:
        currentMember.stripeSubscriptionLookupKey,
      pulseTrialRedeemedAt: currentMember.pulseTrialRedeemedAt,
      subscriptionId: subscription.id,
    });
  if (
    currentMember.pulseTrialRedeemedAt
    && candidateDisposition === "current"
  ) {
    return {
      activatedMemberId: null,
      hostedExecutionEventId: null,
      welcomeEmailMemberId: currentMember.core.id,
    };
  }
  if (candidateDisposition === "loser") {
    return {
      activatedMemberId: null,
      cleanupPulseTrialStripeSubscriptionId: subscription.id,
      hostedExecutionEventId: null,
      welcomeEmailMemberId: null,
    };
  }

  const checkoutAcceptance =
    await acceptHostedMemberStripeCheckoutCompletionTx({
      allowBillingIdentityReplacement: true,
      billingIdentityDisposition: "bind",
      checkoutAttemptId: normalizeNullableString(
        input.session.metadata?.checkoutAttemptId,
      ),
      checkoutIntentHash: normalizeNullableString(
        input.session.metadata?.checkoutIntentHash,
      ),
      checkoutSessionId: input.session.id,
      currentCheckoutOffer: HOSTED_PULSE_TRIAL_OFFER,
      eventCreatedAt: input.dispatchContext.eventCreatedAt,
      memberId: input.memberId,
      preparedCompletion,
      tx: input.tx,
    });
  if (
    checkoutAcceptance.kind === "cleanup_superseded"
    || checkoutAcceptance.kind === "cleanup_terminal"
  ) {
    return {
      activatedMemberId: null,
      cleanupPulseTrialStripeSubscriptionId: subscription.id,
      hostedExecutionEventId: null,
      welcomeEmailMemberId: null,
    };
  }

  const hadActiveBilling =
    currentMember.core.billingStatus === HostedBillingStatus.active;
  assertHostedMemberNotSuspended(currentMember.core);
  const billingRefUpdated =
    await writeAcceptedHostedMemberPulseTrialBillingTx({
      currentCheckoutOffer: HOSTED_PULSE_TRIAL_OFFER,
      currentPeriodEnd: currentPeriodSnapshot.currentPeriodEnd,
      currentPeriodStart: currentPeriodSnapshot.currentPeriodStart,
      currentTrialEndsAt,
      currentTrialStartedAt,
      memberId: currentMember.core.id,
      preparedCompletion,
      pulseTrialPolicyVersion:
        parseHostedPulseTrialPolicyVersion(
          input.session.metadata?.trialPolicyVersion,
        ) ?? HOSTED_PULSE_TRIAL_POLICY_VERSION,
      pulseTrialStartSource: parseHostedPulseTrialStartSource(
        subscription.metadata.pulseTrialStartSource,
      ),
      tx: input.tx,
    });

  if (!billingRefUpdated) {
    throw hostedOnboardingError({
      code: "HOSTED_BILLING_CHECKOUT_POLICY_CHANGED",
      httpStatus: 409,
      message:
        "Murph could not confirm this Stripe Checkout against the current billing state. Try again.",
      retryable: true,
    });
  }

  const updatedCore = hadActiveBilling
    ? currentMember.core
    : await updateHostedMemberCoreState({
        billingStatus: HostedBillingStatus.active,
        memberId: currentMember.core.id,
        prisma: input.tx,
      });

  if (hadActiveBilling) {
    if (
      input.preparedCheckoutCompletion.stripeCheckoutEmail
    ) {
      await upsertPreparedHostedMemberStripeCheckoutEmailIfFreshUnderLockTx({
        collectedAt: input.dispatchContext.eventCreatedAt,
        memberId: updatedCore.id,
        preparedEmail:
          input.preparedCheckoutCompletion.stripeCheckoutEmail,
        tx: input.tx,
      });
    }

    return {
      activatedMemberId: null,
      hostedExecutionEventId: null,
      welcomeEmailMemberId: null,
    };
  }

  if (input.preparedCheckoutCompletion.stripeCheckoutEmail) {
    await upsertPreparedHostedMemberStripeCheckoutEmailIfFreshUnderLockTx({
      collectedAt: input.dispatchContext.eventCreatedAt,
      memberId: updatedCore.id,
      preparedEmail:
        input.preparedCheckoutCompletion.stripeCheckoutEmail,
      tx: input.tx,
    });
  }

  const activation = await activateHostedMemberForPositiveSourceTx({
    dispatchContext: input.dispatchContext,
    memberId: updatedCore.id,
    preparedCryptoDomainRoots: input.preparedCryptoDomainRoots ?? new Map(),
    prisma: input.tx,
    skipIfBillingAlreadyActive: false,
  });

  return {
    activatedMemberId: activation.activated ? updatedCore.id : null,
    hostedExecutionEventId: activation.hostedExecutionEventId,
    welcomeEmailMemberId: isHostedStripeActivationWelcomeCandidate(activation)
      ? updatedCore.id
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

export function cancelHostedPulseTrialCheckoutLoserSubscription(input: {
  memberId: string;
  prisma: PrismaClient;
  stripe?: Stripe;
  subscriptionId: string;
}): Promise<void> {
  const billingConfig = requireHostedStripeBillingPlanConfig({
    billingPlanCode: "launch_monthly",
  });
  return cancelHostedPulseTrialLoserSubscriptionsForMember({
    memberId: input.memberId,
    priceId: billingConfig.priceId,
    prisma: input.prisma,
    stripe: input.stripe ?? billingConfig.stripe,
    subscriptionIds: [input.subscriptionId],
  });
}

export class HostedStripeFamilySponsoredCleanupPendingError
  extends HostedOnboardingError {
  constructor() {
    super({
      code: "HOSTED_FAMILY_SPONSORED_CLEANUP_PENDING",
      httpStatus: 409,
      message:
        "Family billing changed while Stripe cleanup was waiting. Try again so billing can be reconciled safely.",
      retryable: true,
    });
    this.name = "HostedStripeFamilySponsoredCleanupPendingError";
  }
}

export async function cleanupHostedFamilySponsoredDirectSubscription(input: {
  checkoutSessionId?: string;
  memberId: string;
  prisma: PrismaClient;
  refundCheckoutPayment?: boolean;
  sourceEventId: string;
  stripe?: Stripe;
  subscriptionId: string;
}): Promise<void> {
  const candidateClaim = await readHostedMemberFamilyBillingClaim({
    memberId: input.memberId,
    prisma: input.prisma,
  });
  if (candidateClaim?.kind !== "active_sponsorship") {
    throw new HostedStripeFamilySponsoredCleanupPendingError();
  }

  await withHostedMemberStripeMutationLock({
    memberId: candidateClaim.ownerMemberId,
    prisma: input.prisma,
    run: async (tx) => {
      await lockHostedMemberRow(tx, input.memberId);
      const familyClaim = await readHostedMemberFamilyBillingClaim({
        memberId: input.memberId,
        prisma: tx,
      });
      if (
        familyClaim?.kind !== "active_sponsorship"
        || familyClaim.groupId !== candidateClaim.groupId
        || familyClaim.ownerMemberId !== candidateClaim.ownerMemberId
      ) {
        throw new HostedStripeFamilySponsoredCleanupPendingError();
      }

      const familyBillingRef = await readHostedAccountGroupStripeBillingRef({
        groupId: familyClaim.groupId,
        prisma: tx,
      });
      const familyStripeCustomerId = familyBillingRef?.stripeCustomerId ?? null;
      const familyStripeSubscriptionId =
        familyBillingRef?.stripeSubscriptionId ?? null;
      if (
        familyBillingRef?.currentBillingPhase !== "paid"
        || familyBillingRef.currentBillingPlanCode !== HOSTED_FAMILY_BILLING_PLAN_CODE
        || !familyStripeCustomerId
        || !familyStripeSubscriptionId
      ) {
        throw new HostedStripeFamilySponsoredCleanupPendingError();
      }

      const directBillingRef = await readHostedMemberStripeBillingRef({
        memberId: input.memberId,
        prisma: tx,
      });
      const stripe = input.stripe ?? requireHostedStripeApi();
      let subscription: Stripe.Subscription | null = null;
      try {
        subscription = await withHostedStripeFailureLog(
          "subscription.retrieve.family-sponsored-cleanup",
          () => stripe.subscriptions.retrieve(input.subscriptionId),
        );
      } catch (error) {
        if (
          !error
          || typeof error !== "object"
          || Reflect.get(error, "code") !== "resource_missing"
        ) {
          logHostedStripeFailure({
            error,
            operationName: "subscription.cancel.family-sponsored-checkout",
          });
          throw hostedOnboardingError({
            cause: error,
            code: "HOSTED_FAMILY_SPONSORED_CHECKOUT_CLEANUP_FAILED",
            httpStatus: 502,
            message: "Murph could not inspect a superseded Stripe subscription. Try again.",
            retryable: true,
          });
        }
      }

      if (subscription) {
        const metadataMemberId = normalizeNullableString(
          subscription.metadata?.memberId,
        );
        const matchesDirectOwner = metadataMemberId === input.memberId
          || directBillingRef?.stripeSubscriptionId === input.subscriptionId;
        if (
          subscription.id === familyStripeSubscriptionId
          || subscription.metadata?.kind === HOSTED_FAMILY_STRIPE_METADATA_KIND
          || !matchesDirectOwner
        ) {
          throw new HostedStripeFamilySponsoredCleanupPendingError();
        }

        const requiresLiveFamilyAuthority = input.refundCheckoutPayment
          || (
            subscription.status !== "canceled"
            && subscription.status !== "incomplete_expired"
          );
        if (requiresLiveFamilyAuthority) {
          let currentFamilySubscription: Stripe.Subscription;
          try {
            currentFamilySubscription = await withHostedStripeFailureLog(
              "subscription.retrieve.family-sponsored-authority",
              () => stripe.subscriptions.retrieve(familyStripeSubscriptionId),
            );
          } catch (error) {
            if (
              error
              && typeof error === "object"
              && Reflect.get(error, "code") === "resource_missing"
            ) {
              throw new HostedStripeFamilySponsoredCleanupPendingError();
            }
            throw hostedOnboardingError({
              cause: error,
              code: "HOSTED_FAMILY_SPONSORED_CHECKOUT_CLEANUP_FAILED",
              httpStatus: 502,
              message:
                "Murph could not verify current Family billing authority. Try again.",
              retryable: true,
            });
          }

          if (
            currentFamilySubscription.id !== familyStripeSubscriptionId
            || currentFamilySubscription.status !== "active"
            || coerceStripeObjectId(currentFamilySubscription.customer)
              !== familyStripeCustomerId
            || currentFamilySubscription.metadata?.kind
              !== HOSTED_FAMILY_STRIPE_METADATA_KIND
            || currentFamilySubscription.metadata?.billingPlanCode
              !== HOSTED_FAMILY_BILLING_PLAN_CODE
            || normalizeNullableString(
              currentFamilySubscription.metadata?.accountGroupId,
            ) !== familyClaim.groupId
            || normalizeNullableString(
              currentFamilySubscription.metadata?.ownerMemberId,
            ) !== familyClaim.ownerMemberId
          ) {
            throw new HostedStripeFamilySponsoredCleanupPendingError();
          }
        }

        if (input.refundCheckoutPayment) {
          await cleanupHostedStandardCheckoutLoser({
            stripe,
            stripeSubscriptionId: input.subscriptionId,
            subscription,
          });
        } else if (
          subscription.status !== "canceled"
          && subscription.status !== "incomplete_expired"
        ) {
          try {
            await stripe.subscriptions.cancel(input.subscriptionId);
          } catch (error) {
            if (
              !error
              || typeof error !== "object"
              || Reflect.get(error, "code") !== "resource_missing"
            ) {
              logHostedStripeFailure({
                error,
                operationName: "subscription.cancel.family-sponsored-checkout",
              });
              throw hostedOnboardingError({
                cause: error,
                code: "HOSTED_FAMILY_SPONSORED_CHECKOUT_CLEANUP_FAILED",
                httpStatus: 502,
                message: "Murph could not cancel a superseded Stripe subscription. Try again.",
                retryable: true,
              });
            }
          }
        }
      }

      if (input.checkoutSessionId) {
        await clearHostedMemberStripeCheckoutAttemptForSessionTx({
          memberId: input.memberId,
          sessionId: input.checkoutSessionId,
          tx,
        });
      }

      const eventCreatedAt = new Date();
      await terminalizeHostedFamilySponsoredDirectBillingTx({
        dispatchContext: {
          eventCreatedAt,
          occurredAt: eventCreatedAt.toISOString(),
          sourceEventId: input.sourceEventId,
          sourceType: "stripe.customer.subscription.deleted",
        },
        memberId: input.memberId,
        stripeSubscriptionId: input.subscriptionId,
        tx,
      });
    },
  });
}

export async function applyStripeCheckoutExpired(
  session: Stripe.Checkout.Session,
  prisma: Prisma.TransactionClient,
): Promise<void> {
  if (await applyHostedFamilyStripeCheckoutExpiredTx({
    session,
    tx: prisma,
  })) {
    return;
  }
  const member = await findMemberForStripeCheckoutSession({
    prisma,
    session,
  });
  if (!member) {
    return;
  }
  await clearHostedMemberStripeCheckoutAttemptForSessionTx({
    memberId: member.core.id,
    sessionId: session.id,
    tx: prisma,
  });
}

export async function applyStripeSubscriptionUpdated(
  subscription: Stripe.Subscription,
  dispatchContext: HostedStripeDispatchContext,
  prisma: Prisma.TransactionClient,
  preparedFamilyCryptoDomainRoots?: PreparedHostedFamilyCryptoDomainRoots,
): Promise<HostedStripeSubscriptionUpdateOutcome> {
  const familySubscription = await applyHostedFamilyStripeSubscriptionUpdatedWithUsageTx({
    dispatchContext,
    preparedCryptoDomainRootsByMember:
      preparedFamilyCryptoDomainRoots ?? new Map(),
    subscription,
    tx: prisma,
  });
  if (familySubscription.groupId) {
    return {
      ...buildHostedStripeActivationOutcomeFromFamilySubscription(familySubscription),
      subscriptionCancellationEmail: null,
    };
  }

  const member = await findMemberForStripeSubscription({
    prisma,
    subscription,
  });

  if (!member) {
    return {
      ...buildEmptyHostedStripeActivationOutcome(),
      subscriptionCancellationEmail: null,
    };
  }
  const familyClaimDisposition = await classifyHostedFamilyBillingClaimTx({
    memberId: member.core.id,
    stripeCustomerId: coerceStripeObjectId(subscription.customer),
    stripeSubscriptionId: subscription.id,
    tx: prisma,
  });
  const isTerminalSubscription = subscription.status === "canceled"
    || subscription.status === "incomplete_expired";
  const terminalizesCurrentDirectSubscription =
    familyClaimDisposition === "conflicting_family_subscription"
    && isTerminalSubscription
    && member.billingRef?.stripeSubscriptionId === subscription.id;
  if (
    familyClaimDisposition !== "none"
    && !terminalizesCurrentDirectSubscription
  ) {
    return {
      ...buildEmptyHostedStripeActivationOutcome(),
      ...(familyClaimDisposition === "conflicting_family_subscription"
        ? {
            cleanupFamilySponsoredStripeSubscriptionId:
              isTerminalSubscription
                ? null
                : subscription.id,
          }
        : {}),
      subscriptionCancellationEmail: null,
    };
  }

  const pulseTrialPriceId = process.env[
    getHostedBillingPlanDefinition("launch_monthly").priceIdEnvKey
  ];
  if (
    pulseTrialPriceId &&
    isHostedPulseTrialSubscriptionForKnownPolicy({
      memberId: member.core.id,
      priceId: pulseTrialPriceId,
      subscription,
    }) &&
    classifyHostedPulseTrialCandidateDisposition({
      billingStatus: member.core.billingStatus,
      currentBillingPhase: member.billingRef?.currentBillingPhase ?? null,
      currentStripeSubscriptionId: member.billingRef?.stripeSubscriptionId ?? null,
      pulseTrialRedeemedAt: member.billingRef?.pulseTrialRedeemedAt ?? null,
      subscriptionId: subscription.id,
    }) === "loser"
  ) {
    return {
      ...buildEmptyHostedStripeActivationOutcome(),
      cleanupPulseTrialStripeSubscriptionId:
        subscription.status === "canceled" || subscription.status === "incomplete_expired"
          ? null
          : subscription.id,
      subscriptionCancellationEmail: null,
    };
  }

  const {
    canonicalBillingStatus: resolvedCanonicalBillingStatus,
    member: preparedMember,
  } = await prepareHostedMemberStripeBillingWrite({
    canonicalBillingStatus: mapStripeSubscriptionStatusToHostedBillingStatus(subscription.status),
    dispatchContext,
    member,
  });

  const updatedMember = await writeHostedMemberStripeBillingTx({
    billingStatus: member.core.billingStatus,
    canonicalBillingStatus: resolvedCanonicalBillingStatus,
    ...buildHostedStripeSubscriptionBillingPeriodSnapshot(subscription),
    ...buildHostedStripeSubscriptionBillingPhaseSnapshot(subscription, member),
    dispatchContext,
    member: preparedMember,
    stripeCustomerId: coerceStripeObjectId(subscription.customer) ?? member.billingRef?.stripeCustomerId ?? null,
    stripeSubscriptionId: subscription.id,
    tx: prisma,
  });
  const runtimeRecheckMemberId = await reconcileHostedMemberUsagePlanTransitionTx({
    dispatchContext,
    memberId: member.core.id,
    tx: prisma,
    updatedMember,
  });

  return {
    ...buildEmptyHostedStripeActivationOutcome(),
    runtimeRecheckMemberIds: runtimeRecheckMemberId
      ? [runtimeRecheckMemberId]
      : [],
    subscriptionCancellationEmail:
      resolveHostedSubscriptionCancellationEmail({
        sourceType: dispatchContext.sourceType,
        stripeSubscriptionId: subscription.id,
        subscriptionStatus: subscription.status,
        updatedMember,
      }),
  };
}

export async function applyStripeInvoicePaid(
  invoice: Stripe.Invoice,
  dispatchContext: HostedStripeDispatchContext,
  prisma: Prisma.TransactionClient,
  canonicalBillingStatus?: HostedBillingStatus | null,
  canonicalSubscription?: Stripe.Subscription | null,
  preparedCryptoDomainRoots?: PreparedHostedCryptoDomainRootCandidates,
  preparedFamilyCryptoDomainRoots?: PreparedHostedFamilyCryptoDomainRoots,
): Promise<HostedStripeActivationOutcome> {
  if (canonicalSubscription) {
    const familySubscription = await applyHostedFamilyStripeSubscriptionUpdatedWithUsageTx({
      dispatchContext,
      preparedCryptoDomainRootsByMember:
        preparedFamilyCryptoDomainRoots ?? new Map(),
      subscription: canonicalSubscription,
      tx: prisma,
    });
    if (familySubscription.groupId) {
      return buildHostedStripeActivationOutcomeFromFamilySubscription(familySubscription);
    }
  }

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

  const familyClaimDisposition = await classifyHostedFamilyBillingClaimTx({
    memberId: member.core.id,
    stripeCustomerId:
      coerceStripeObjectId(invoice.customer)
      ?? coerceStripeObjectId(canonicalSubscription?.customer),
    stripeSubscriptionId: subscriptionId,
    tx: prisma,
  });
  if (familyClaimDisposition !== "none") {
    return {
      ...buildEmptyHostedStripeActivationOutcome(),
      ...(familyClaimDisposition === "conflicting_family_subscription"
        ? {
            // A late invoice.paid still owns exact refund inspection after an
            // earlier subscription event has already canceled the loser.
            cleanupFamilySponsoredStripeSubscriptionId: subscriptionId,
          }
        : {}),
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
  const runtimeRecheckMemberId = await reconcileHostedMemberUsagePlanTransitionTx({
    dispatchContext,
    memberId: member.core.id,
    tx: prisma,
    updatedMember,
  });

  if (!updatedMember) {
    return {
      ...buildEmptyHostedStripeActivationOutcome(),
      runtimeRecheckMemberIds: runtimeRecheckMemberId
        ? [runtimeRecheckMemberId]
        : [],
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
      ...buildEmptyHostedStripeActivationOutcome(),
      runtimeRecheckMemberIds: runtimeRecheckMemberId
        ? [runtimeRecheckMemberId]
        : [],
    };
  }

  const activation = await activateHostedMemberForPositiveSourceTx({
    dispatchContext: buildHostedStripeInvoiceActivationDispatchContext(invoice, dispatchContext),
    memberId: updatedMember.core.id,
    ...(preparedCryptoDomainRoots
      ? { preparedCryptoDomainRoots }
      : {}),
    prisma,
    skipIfBillingAlreadyActive: hadActiveBilling,
    skipIfPreviouslyActivated: true,
  });

  return {
    activatedMemberId: activation.activated ? updatedMember.core.id : null,
    hostedExecutionEventId: activation.hostedExecutionEventId,
    runtimeRecheckMemberIds: runtimeRecheckMemberId
      ? [runtimeRecheckMemberId]
      : [],
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
  preparedFamilyCryptoDomainRoots?: PreparedHostedFamilyCryptoDomainRoots,
): Promise<void> {
  if (canonicalSubscription) {
    const familySubscription = await applyHostedFamilyStripeSubscriptionUpdatedWithUsageTx({
      dispatchContext,
      preparedCryptoDomainRootsByMember:
        preparedFamilyCryptoDomainRoots ?? new Map(),
      subscription: canonicalSubscription,
      tx: prisma,
    });
    if (familySubscription.groupId) {
      return;
    }
  }

  const subscriptionId = coerceStripeInvoiceSubscriptionId(invoice);
  const member = await findMemberForStripeInvoice({
    invoice,
    prisma,
    subscription: canonicalSubscription,
  });

  if (!member) {
    return;
  }
  if (await classifyHostedFamilyBillingClaimTx({
    memberId: member.core.id,
    stripeCustomerId:
      coerceStripeObjectId(invoice.customer)
      ?? coerceStripeObjectId(canonicalSubscription?.customer),
    stripeSubscriptionId: subscriptionId,
    tx: prisma,
  }) !== "none") {
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

function buildHostedStripeActivationOutcomeFromFamilySubscription(
  familySubscription: HostedFamilyStripeSubscriptionResult,
): HostedStripeActivationOutcome {
  const activatedMembers = familySubscription.activations
    .filter((activation) => activation.activated && activation.hostedExecutionEventId)
    .map((activation) => ({
      activatedMemberId: activation.memberId,
      hostedExecutionEventId: activation.hostedExecutionEventId,
    }));
  const firstActivation = activatedMembers[0] ?? null;

  return {
    activatedMemberId: firstActivation?.activatedMemberId ?? null,
    activatedMembers,
    hostedExecutionEventId: firstActivation?.hostedExecutionEventId ?? null,
    runtimeRecheckMemberIds: familySubscription.runtimeRecheckMemberIds ?? [],
    welcomeEmailMemberId: null,
  };
}

async function applyHostedFamilyStripeSubscriptionUpdatedWithUsageTx(input: {
  dispatchContext: HostedStripeDispatchContext;
  preparedCryptoDomainRootsByMember: PreparedHostedFamilyCryptoDomainRoots;
  subscription: Stripe.Subscription;
  tx: Prisma.TransactionClient;
}): Promise<HostedFamilyStripeSubscriptionResult> {
  const familySubscription = await applyHostedFamilyStripeSubscriptionUpdatedTx(input);
  const now = input.dispatchContext.eventCreatedAt ?? new Date();
  for (const memberId of familySubscription.runtimeRecheckMemberIds ?? []) {
    await reconcileHostedAiUsageGateForBillingModeChangeTx({
      memberId,
      now,
      tx: input.tx,
    });
  }
  return familySubscription;
}

function buildEmptyHostedStripeActivationOutcome(): HostedStripeActivationOutcome {
  return {
    activatedMemberId: null,
    activatedMembers: [],
    hostedExecutionEventId: null,
    runtimeRecheckMemberIds: [],
    welcomeEmailMemberId: null,
  };
}

async function reconcileHostedMemberUsagePlanTransitionTx(input: {
  dispatchContext: Pick<HostedStripeDispatchContext, "eventCreatedAt">;
  memberId: string;
  tx: Prisma.TransactionClient;
  updatedMember: HostedMemberBillingSnapshot | null;
}): Promise<string | null> {
  const currentMember = input.updatedMember ?? await readHostedMemberBillingSnapshot({
    memberId: input.memberId,
    prisma: input.tx,
  });
  const transitionKind = currentMember?.billingRef?.usagePlanTransitionKind;
  if (
    (transitionKind !== "plan_upgrade" && transitionKind !== "trial_conversion")
    || currentMember?.billingRef?.usagePlanTransitionAt?.getTime()
      !== input.dispatchContext.eventCreatedAt.getTime()
  ) {
    return null;
  }

  await reconcileHostedAiUsageGateForBillingModeChangeTx({
    memberId: input.memberId,
    now: input.dispatchContext.eventCreatedAt,
    tx: input.tx,
  });
  return input.memberId;
}

export async function applyStripeRefundCreated(
  refund: Stripe.Refund,
  dispatchContext: Pick<HostedStripeDispatchContext, "eventCreatedAt" | "sourceEventId" | "sourceType">,
  prisma: Prisma.TransactionClient,
  customerId?: string | null,
  preparedProviderState?: PreparedHostedStripeReversalProviderState | null,
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

  if (!preparedProviderState) {
    throw new TypeError(
      "Stripe refund provider state must be prepared before the transaction.",
    );
  }
  if (
    preparedProviderState.memberId !== member.core.id
    || preparedProviderState.stripeCustomerId !==
      (member.billingRef?.stripeCustomerId ?? null)
    || preparedProviderState.stripeSubscriptionId !==
      (member.billingRef?.stripeSubscriptionId ?? null)
    || !preparedProviderState.latestInvoiceId
    || preparedProviderState.subscription?.id !==
      preparedProviderState.stripeSubscriptionId
    || coerceStripeObjectId(preparedProviderState.subscription.customer) !==
      preparedProviderState.stripeCustomerId
    || coerceStripeObjectId(
      preparedProviderState.subscription.latest_invoice,
    ) !== preparedProviderState.latestInvoiceId
    || !hostedStripeRefundMatchesPaymentIdentity(refund, {
      chargeId: preparedProviderState.paymentChargeId,
      paymentIntentId: preparedProviderState.paymentIntentId,
    })
    || !preparedProviderState.refundCoversCurrentEntitlement
  ) {
    return;
  }

  const { canonicalBillingStatus, member: preparedMember } = await prepareHostedMemberStripeBillingWrite({
    canonicalBillingStatus: mapStripeSubscriptionStatusToHostedBillingStatus(
      preparedProviderState.subscription.status,
    ),
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
    freshnessPolicy: "proven-current-refund",
    member: preparedMember,
    stripeCustomerId: preparedProviderState.stripeCustomerId,
    stripeSubscriptionId: preparedProviderState.stripeSubscriptionId,
    tx: prisma,
  });
}

function isHostedStripeSucceededRefund(refund: Stripe.Refund): boolean {
  return refund.status === "succeeded" && readHostedStripePositiveAmount(refund.amount) !== null;
}

function resolveHostedSubscriptionCancellationEmail(input: {
  sourceType: string;
  stripeSubscriptionId: string;
  subscriptionStatus: Stripe.Subscription.Status;
  updatedMember: HostedMemberBillingSnapshot | null;
}): HostedSubscriptionCancellationEmailCandidate | null {
  if (
    input.sourceType !== "stripe.customer.subscription.deleted" ||
    input.subscriptionStatus !== "canceled" ||
    input.updatedMember?.core.billingStatus !== HostedBillingStatus.canceled
  ) {
    return null;
  }

  return {
    memberId: input.updatedMember.core.id,
    stripeSubscriptionId: input.stripeSubscriptionId,
  };
}

type HostedStripePaymentIdentity = {
  chargeId: string | null;
  paymentIntentId: string | null;
};

type HostedStripeCurrentEntitlementRefundProof = HostedStripePaymentIdentity & {
  latestInvoiceId: string | null;
  refundCoversCurrentEntitlement: boolean;
};

const HOSTED_STRIPE_REFUND_LIST_MAX_PAGES = 10;

async function prepareHostedStripeCurrentEntitlementRefundProof(input: {
  refund: Stripe.Refund;
  subscription: Stripe.Subscription | null;
}): Promise<HostedStripeCurrentEntitlementRefundProof> {
  const emptyProof: HostedStripeCurrentEntitlementRefundProof = {
    chargeId: null,
    latestInvoiceId: null,
    paymentIntentId: null,
    refundCoversCurrentEntitlement: false,
  };
  const subscription = input.subscription;
  if (
    !subscription
    || mapStripeSubscriptionStatusToHostedBillingStatus(subscription.status)
      !== HostedBillingStatus.active
  ) {
    return emptyProof;
  }

  const invoice = await readHostedStripeSubscriptionLatestInvoice(subscription);
  if (!invoice?.id) {
    return emptyProof;
  }
  const paymentIdentity = await resolveHostedStripeInvoicePaymentIdentity({
    invoice,
    refund: input.refund,
  });
  if (!paymentIdentity) {
    return {
      ...emptyProof,
      latestInvoiceId: invoice.id,
    };
  }

  const paidAmount = readHostedStripePositiveAmount(
    (invoice as Stripe.Invoice & { amount_paid?: unknown }).amount_paid,
  );
  if (paidAmount === null) {
    return {
      ...paymentIdentity,
      latestInvoiceId: invoice.id,
      refundCoversCurrentEntitlement: false,
    };
  }

  const refunds = await listHostedStripeRefundsForPaymentIdentity(paymentIdentity);
  const refundsById = new Map(refunds.map((refund) => [refund.id, refund]));
  refundsById.set(input.refund.id, input.refund);
  let succeededExposure = 0;
  for (const refund of refundsById.values()) {
    if (
      !isHostedStripeSucceededRefund(refund)
      || !hostedStripeRefundMatchesPaymentIdentity(refund, paymentIdentity)
    ) {
      continue;
    }
    const amount = readHostedStripePositiveAmount(refund.amount);
    if (amount === null || !Number.isSafeInteger(succeededExposure + amount)) {
      throw new TypeError("Stripe refund exposure exceeded the supported integer range.");
    }
    succeededExposure += amount;
  }

  return {
    ...paymentIdentity,
    latestInvoiceId: invoice.id,
    refundCoversCurrentEntitlement: succeededExposure >= paidAmount,
  };
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

  return withHostedStripeFailureLog(
    "invoices.retrieve.subscription-latest",
    () => requireHostedStripeApi().invoices.retrieve(invoiceId, {
      expand: [
        "payments.data.payment.charge",
        "payments.data.payment.payment_intent",
      ],
    }),
  );
}

async function resolveHostedStripeInvoicePaymentIdentity(input: {
  invoice: Stripe.Invoice;
  refund: Stripe.Refund;
}): Promise<HostedStripePaymentIdentity | null> {
  const expandedMatch = readHostedStripeInvoicePayments(input.invoice)
    .map(readHostedStripeInvoicePaymentIdentity)
    .find((identity) =>
      identity !== null
      && hostedStripeRefundMatchesPaymentIdentity(input.refund, identity)
    );
  if (expandedMatch) {
    return expandedMatch;
  }

  const listedPayments = await withHostedStripeFailureLog(
    "invoicePayments.list.refund-match",
    () => requireHostedStripeApi().invoicePayments.list({
      invoice: input.invoice.id,
      limit: 100,
      status: "paid",
      expand: [
        "data.payment.charge",
        "data.payment.payment_intent",
      ],
    }),
  );
  const listedMatch = listedPayments.data
    .map(readHostedStripeInvoicePaymentIdentity)
    .find((identity) =>
      identity !== null
      && hostedStripeRefundMatchesPaymentIdentity(input.refund, identity)
    );
  if (listedMatch) {
    return listedMatch;
  }

  const legacyIdentity = readHostedStripeLegacyInvoicePaymentIdentity(input.invoice);
  return legacyIdentity
    && hostedStripeRefundMatchesPaymentIdentity(input.refund, legacyIdentity)
    ? legacyIdentity
    : null;
}

async function listHostedStripeRefundsForPaymentIdentity(
  paymentIdentity: HostedStripePaymentIdentity,
): Promise<Stripe.Refund[]> {
  if (!paymentIdentity.chargeId && !paymentIdentity.paymentIntentId) {
    return [];
  }

  const refunds: Stripe.Refund[] = [];
  let startingAfter: string | undefined;
  for (let pageNumber = 0; pageNumber < HOSTED_STRIPE_REFUND_LIST_MAX_PAGES; pageNumber += 1) {
    const params: Stripe.RefundListParams = { limit: 100 };
    if (paymentIdentity.chargeId) {
      params.charge = paymentIdentity.chargeId;
    } else if (paymentIdentity.paymentIntentId) {
      params.payment_intent = paymentIdentity.paymentIntentId;
    }
    if (startingAfter) {
      params.starting_after = startingAfter;
    }
    const page = await withHostedStripeFailureLog(
      "refunds.list.current-entitlement",
      () => requireHostedStripeApi().refunds.list(params),
    );
    refunds.push(...page.data);
    if (!page.has_more) {
      return refunds;
    }
    const lastRefundId = page.data.at(-1)?.id;
    if (!lastRefundId) {
      break;
    }
    startingAfter = lastRefundId;
  }

  throw hostedOnboardingError({
    code: "HOSTED_STRIPE_REFUND_RECONCILIATION_BOUNDED",
    httpStatus: 502,
    message: "Stripe refund reconciliation is temporarily unavailable.",
    retryable: true,
  });
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

function readHostedStripeInvoicePaymentIdentity(
  invoicePayment: Stripe.InvoicePayment,
): HostedStripePaymentIdentity | null {
  if (invoicePayment.status !== "paid") {
    return null;
  }
  const chargeId = coerceUnknownStripeObjectId(invoicePayment.payment.charge);
  const paymentIntentId = coerceUnknownStripeObjectId(
    invoicePayment.payment.payment_intent,
  );
  return chargeId || paymentIntentId
    ? { chargeId, paymentIntentId }
    : null;
}

function readHostedStripeLegacyInvoicePaymentIdentity(
  invoice: Stripe.Invoice,
): HostedStripePaymentIdentity | null {
  const chargeId = coerceUnknownStripeObjectId(
    (invoice as Stripe.Invoice & { charge?: unknown }).charge,
  );
  const paymentIntentId = coerceUnknownStripeObjectId(
    (invoice as Stripe.Invoice & { payment_intent?: unknown }).payment_intent,
  );
  return chargeId || paymentIntentId
    ? { chargeId, paymentIntentId }
    : null;
}

function hostedStripeRefundMatchesPaymentIdentity(
  refund: Stripe.Refund,
  paymentIdentity: HostedStripePaymentIdentity,
): boolean {
  const refundChargeId = coerceStripeObjectId(refund.charge);
  const refundPaymentIntentId = coerceStripeObjectId(refund.payment_intent);
  return Boolean(
    (refundChargeId
      && paymentIdentity.chargeId
      && refundChargeId === paymentIdentity.chargeId)
    || (refundPaymentIntentId
      && paymentIdentity.paymentIntentId
      && refundPaymentIntentId === paymentIdentity.paymentIntentId),
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
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
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
  const currentTrialEndsAt = readHostedStripeSubscriptionDate(subscription, "trial_end");
  const currentTrialStartedAt = readHostedStripePulseTrialStartedAt(
    subscription,
    currentTrialEndsAt,
  );

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

function readHostedStripePulseTrialStartedAt(
  subscription: Stripe.Subscription,
  currentTrialEndsAt: Date | null,
): Date | null {
  const override = readHostedStripeMetadataDate(
    subscription.metadata?.[HOSTED_PULSE_TRIAL_STARTED_AT_OVERRIDE_METADATA_KEY],
  );
  if (
    override &&
    currentTrialEndsAt &&
    override.getTime() < currentTrialEndsAt.getTime()
  ) {
    return override;
  }

  return readHostedStripeSubscriptionDate(subscription, "trial_start");
}

function readHostedStripeMetadataDate(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
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

  return withHostedStripeFailureLog(
    "subscription.retrieve.checkout-session",
    () => requireHostedStripeApi().subscriptions.retrieve(subscriptionId),
  );
}

function isPulseTrialCheckoutSessionEntitlementCandidate(
  session: Stripe.Checkout.Session,
  memberId: string,
): boolean {
  const trialPolicy = requireHostedPulseTrialPolicy(session.metadata?.trialPolicyVersion);

  return session.status === "complete" &&
    session.mode === "subscription" &&
    session.client_reference_id === memberId &&
    session.metadata?.memberId === memberId &&
    session.metadata?.billingPlanCode === "launch_monthly" &&
    session.metadata?.checkoutOffer === HOSTED_PULSE_TRIAL_OFFER &&
    trialPolicy !== null &&
    session.metadata?.trialDurationDays === trialPolicy.durationDays.toString() &&
    session.metadata?.trialUsageLimitUsdMicros === trialPolicy.usageLimitUsdMicros.toString();
}

function isValidPulseTrialCheckoutSubscription(input: {
  decisionTime: Date;
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
    trialEnd.getTime() > input.decisionTime.getTime(),
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
  preparedProviderState?: PreparedHostedStripeReversalProviderState | null,
): Promise<"applied" | "subscription_identity_pending"> {
  const outcome = classifyHostedStripeDisputeOutcome(dispute, dispatchContext.sourceType);
  if (outcome === "ignore") {
    return "applied";
  }

  const member = await findMemberForStripeReversal({
    chargeId: coerceStripeObjectId(dispute.charge),
    customerId: customerId ?? null,
    paymentIntentId: coerceStripeObjectId(dispute.payment_intent),
    prisma,
    subscriptionId: null,
  });

  if (!member) {
    return "applied";
  }

  const billingDispatchContext = {
    eventCreatedAt: dispatchContext.eventCreatedAt,
    occurredAt: dispatchContext.eventCreatedAt.toISOString(),
    sourceEventId: dispatchContext.sourceEventId,
    sourceType: dispatchContext.sourceType,
  };

  if (outcome === "restore") {
    if (!preparedProviderState) {
      throw new TypeError(
        "Stripe dispute provider state must be prepared before the transaction.",
      );
    }
    const subscription = preparedProviderState.subscription;
    if (
      preparedProviderState.memberId !== member.core.id
      || preparedProviderState.stripeSubscriptionId !==
        (member.billingRef?.stripeSubscriptionId ?? null)
      || !subscription
    ) {
      return "subscription_identity_pending";
    }

    const canonicalBillingStatus = mapStripeSubscriptionStatusToHostedBillingStatus(subscription.status);
    if (canonicalBillingStatus !== HostedBillingStatus.active) {
      return "applied";
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
    return "applied";
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
  return "applied";
}

export async function prepareHostedStripeReversalProviderState(input: {
  event: Stripe.Event;
  memberId: string;
  prisma: PrismaClient;
}): Promise<PreparedHostedStripeReversalProviderState | null> {
  const isRefund = isHostedStripeRefundEventType(input.event.type);
  const isDispute = input.event.type.startsWith("charge.dispute.");
  if (!isRefund && !isDispute) {
    return null;
  }

  const member = await readHostedMemberBillingSnapshot({
    memberId: input.memberId,
    prisma: input.prisma,
  });
  if (!member) {
    throw new TypeError(
      "Stripe reversal member must exist while provider state is prepared.",
    );
  }
  const stripeSubscriptionId =
    member.billingRef?.stripeSubscriptionId ?? null;
  const stripeCustomerId = member.billingRef?.stripeCustomerId ?? null;
  const disputeOutcome = isDispute
    ? classifyHostedStripeDisputeOutcome(
        input.event.data.object as Stripe.Dispute,
        input.event.type,
      )
    : "ignore";
  const refund = isRefund
    ? input.event.data.object as Stripe.Refund
    : null;
  const needsSubscription = Boolean(
    disputeOutcome === "restore"
    || (refund && isHostedStripeSucceededRefund(refund)),
  );
  const subscription = needsSubscription
    ? await readHostedMemberStripeSubscription(member)
    : null;
  if (
    subscription
    && (
      subscription.id !== stripeSubscriptionId
      || coerceStripeObjectId(subscription.customer) !== stripeCustomerId
    )
  ) {
    throw new TypeError(
      "Prepared Stripe reversal Subscription does not match the member.",
    );
  }

  const refundProof = refund
    ? await prepareHostedStripeCurrentEntitlementRefundProof({
        refund,
        subscription,
      })
    : {
        chargeId: null,
        latestInvoiceId: null,
        paymentIntentId: null,
        refundCoversCurrentEntitlement: false,
      };

  return {
    latestInvoiceId: refundProof.latestInvoiceId,
    memberId: member.core.id,
    paymentChargeId: refundProof.chargeId,
    paymentIntentId: refundProof.paymentIntentId,
    refundCoversCurrentEntitlement:
      refundProof.refundCoversCurrentEntitlement,
    stripeCustomerId,
    stripeSubscriptionId,
    subscription,
  };
}

export function isHostedStripeRefundEventType(type: string): boolean {
  return type === "refund.created" || type === "refund.updated";
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

  return withHostedStripeFailureLog(
    "subscription.retrieve.member-billing",
    () => requireHostedStripeApi().subscriptions.retrieve(subscriptionId),
  );
}
