import {
  HostedBillingStatus,
  Prisma,
  type PrismaClient,
} from "@prisma/client";
import type Stripe from "stripe";

import type {
  PreparedHostedCryptoDomainRootCandidates,
} from "../hosted-crypto/domain-root-store";
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
import { isHostedAccessBlockedBillingStatus } from "./entitlement";
import { hostedOnboardingError } from "./errors";
import {
  activateHostedMemberForPositiveSourceTx,
} from "./member-activation";
import {
  acceptHostedMemberStripeCheckoutCompletionTx,
  clearHostedMemberStripeCheckoutAttemptForSessionTx,
} from "./hosted-member-billing-store";
import {
  type HostedMemberBillingSnapshot,
  upsertHostedMemberStripeCheckoutEmailIfFreshTx,
} from "./hosted-member-store";
import {
  findMemberForStripeCheckoutSession,
  findMemberForStripeInvoice,
  findMemberForStripeSubscription,
  isHostedStripeStandardCheckoutAwaitingSessionAcceptance,
  listHostedStripeCheckoutSessionMemberIds,
  classifyHostedStripeRecurringFinancialHealth,
  readHostedStripeRecurringFinancialState,
} from "./stripe-billing-lookup";
import type { HostedStripeBillingOwner } from "./stripe-billing-owner";
import {
  classifyHostedStripeFailure,
  HOSTED_STRIPE_BILLING_SUBSCRIPTION_EXPANSIONS,
  isHostedStripeLegacyCheckoutCompletionAllowed,
  readHostedStripeExpandedLatestInvoice,
} from "./stripe-billing-state";
import {
  prepareHostedMemberStripeBillingWrite,
  writeHostedMemberStripeBillingTx,
} from "./stripe-billing-policy";
import {
  type HostedStripeDispatchContext,
} from "./stripe-dispatch";
import {
  buildHostedCheckoutSubscriptionCleanupCandidate,
  type HostedCheckoutSubscriptionCleanupCandidate,
} from "./stripe-checkout-subscription-cleanup";
import {
  describeHostedStripeErrorDetails,
  logHostedStripeFailure,
  withHostedStripeFailureLog,
} from "./stripe-error-log";
import { readActiveHostedFamilySponsorship } from "./member-access";
import {
  requireHostedStripeApi,
  requireHostedStripeBillingPlanConfig,
} from "./runtime";
import {
  classifyHostedPulseTrialCandidateDisposition,
  cancelHostedPulseTrialLoserSubscriptionsForMember,
  isHostedPulseTrialSubscriptionForKnownPolicy,
} from "./pulse-trial-subscription-cleanup";
import {
  applyHostedFamilyStripeCheckoutCompletedTx,
  applyHostedFamilyStripeSubscriptionUpdatedTx,
  clearHostedFamilyCheckoutAttemptForSession,
  findHostedAccountGroupForStripeCheckoutSession,
  lookupHostedAccountGroupStripeBillingRefByStripeSubscriptionId,
  readHostedMemberFamilyBillingClaim,
  setHostedFamilyStripeBillingReversalStateTx,
  type PreparedHostedFamilyCryptoDomainRoots,
  type HostedFamilyStripeSubscriptionResult,
} from "./family-plan";
import { normalizeNullableString } from "./shared";

export type HostedStripeActivatedMemberOutcome = {
  activatedMemberId: string | null;
  hostedExecutionEventId: string | null;
};

type HostedStripeActivationOutcome = HostedStripeActivatedMemberOutcome & {
  activatedMembers?: HostedStripeActivatedMemberOutcome[];
  cleanupCheckoutSubscription?: HostedCheckoutSubscriptionCleanupCandidate | null;
  cleanupPulseTrialStripeSubscriptionId?: string | null;
  welcomeEmailMemberId: string | null;
};

export type HostedStripeSubscriptionUpdateOutcome = HostedStripeActivationOutcome & {
  subscriptionCancellationEmail: HostedSubscriptionCancellationEmailCandidate | null;
};

export type HostedSubscriptionCancellationEmailCandidate = {
  memberId: string;
  stripeSubscriptionId: string;
};

export async function applyStripeCheckoutCompleted(
  session: Stripe.Checkout.Session,
  prisma: Prisma.TransactionClient,
  dispatchContext?: HostedStripeDispatchContext,
  observedAt = new Date(),
  preparedCryptoDomainRoots?: PreparedHostedCryptoDomainRootCandidates,
): Promise<HostedStripeActivationOutcome> {
  const familyCheckout = await applyHostedFamilyStripeCheckoutCompletedTx({
    dispatchContext: dispatchContext ?? buildHostedStripeCheckoutSessionDispatchContext(session),
    session,
    tx: prisma,
  });
  if (familyCheckout.groupId) {
    const stripeSubscriptionId = coerceStripeSubscriptionId(session.subscription);
    const stripeCustomerId = coerceStripeObjectId(session.customer);
    if (!stripeSubscriptionId || !stripeCustomerId) {
      throw new Error(
        "Accepted Family Checkout did not expose exact Stripe billing identifiers.",
      );
    }
    const familyOwner =
      await lookupHostedAccountGroupStripeBillingRefByStripeSubscriptionId({
        prisma,
        stripeSubscriptionId,
      });
    if (
      !familyOwner ||
      familyOwner.group.id !== familyCheckout.groupId ||
      familyOwner.billingRef.stripeSubscriptionId !== stripeSubscriptionId ||
      familyOwner.billingRef.stripeCustomerId !== stripeCustomerId
    ) {
      throw new Error(
        "Accepted Family Checkout did not resolve to its exact persisted billing owner.",
      );
    }
    const subscription = await withHostedStripeFailureLog(
      "subscription.retrieve.family-checkout-accepted-canonical",
      () => requireHostedStripeApi().subscriptions.retrieve(
        stripeSubscriptionId,
        {
          expand: [...HOSTED_STRIPE_BILLING_SUBSCRIPTION_EXPANSIONS],
        },
      ),
    );
    if (
      subscription.id !== stripeSubscriptionId ||
      coerceStripeObjectId(subscription.customer) !== stripeCustomerId
    ) {
      throw new Error(
        "Accepted Family Checkout canonical subscription did not match its Session.",
      );
    }
    const financialState = await withHostedStripeFailureLog(
      "subscription.financial-state.family-checkout-accepted",
      () => readHostedStripeRecurringFinancialState(subscription),
    );
    const financialHealth =
      classifyHostedStripeRecurringFinancialHealth(financialState);
    if (financialHealth.kind !== "healthy") {
      await setHostedFamilyStripeBillingReversalStateTx({
        billingStatus: HostedBillingStatus.unpaid,
        groupId: familyOwner.group.id,
        subscription,
        tx: prisma,
        verifiedOwnerMemberId: familyOwner.group.ownerMemberId,
      });
      return buildEmptyHostedStripeActivationOutcome();
    }
    const familySubscription =
      await applyHostedFamilyStripeSubscriptionUpdatedTx({
        dispatchContext:
          dispatchContext ??
          buildHostedStripeCheckoutSessionDispatchContext(session),
        subscription,
        tx: prisma,
      });
    if (familySubscription.groupId !== familyOwner.group.id) {
      throw new Error(
        "Accepted Family Checkout canonical subscription did not project to its persisted owner.",
      );
    }
    return buildHostedStripeActivationOutcomeFromFamilySubscription(
      familySubscription,
    );
  }

  const checkoutSubscriptionId = coerceStripeSubscriptionId(
    session.subscription,
  );
  const member = await findMemberForStripeCheckoutSession({
    prisma,
    session,
  });

  if (!member) {
    const legacyMemberId = normalizeNullableString(
      session.client_reference_id,
    );
    if (
      session.metadata?.checkoutOffer !== HOSTED_STANDARD_CHECKOUT_OFFER ||
      !legacyMemberId ||
      normalizeNullableString(session.metadata?.memberId) !== legacyMemberId
    ) {
      return {
        activatedMemberId: null,
        hostedExecutionEventId: null,
        welcomeEmailMemberId: null,
      };
    }
    if (!checkoutSubscriptionId) {
      throw new Error(
        "Orphaned standard Checkout completion did not include a subscription.",
      );
    }
    if (
      await lookupHostedAccountGroupStripeBillingRefByStripeSubscriptionId({
        prisma,
        stripeSubscriptionId: checkoutSubscriptionId,
      })
    ) {
      throw new Error(
        "Orphaned standard Checkout subscription already belongs to a Family billing owner.",
      );
    }
    return {
      ...buildEmptyHostedStripeActivationOutcome(),
      cleanupCheckoutSubscription:
        buildHostedCheckoutSubscriptionCleanupCandidate({
          memberId: legacyMemberId,
          reason: "superseded",
          session,
          stripeSubscriptionId: checkoutSubscriptionId,
        }),
    };
  }
  const candidateMemberIds = await listHostedStripeCheckoutSessionMemberIds({
    prisma,
    session,
  });
  if (
    candidateMemberIds.length !== 1 ||
    candidateMemberIds[0] !== member.core.id
  ) {
    throw new Error(
      "Completed standard Checkout Session resolved to conflicting member owners.",
    );
  }
  if (
    checkoutSubscriptionId &&
    await lookupHostedAccountGroupStripeBillingRefByStripeSubscriptionId({
      prisma,
      stripeSubscriptionId: checkoutSubscriptionId,
    })
  ) {
    throw new Error(
      "Completed standard Checkout subscription already belongs to a Family billing owner.",
    );
  }
  if (member.core.suspendedAt) {
    const stripeSubscriptionId = checkoutSubscriptionId;
    if (!stripeSubscriptionId) {
      throw new Error(
        "Suspended member Checkout completion did not include a subscription.",
      );
    }
    return {
      ...buildEmptyHostedStripeActivationOutcome(),
      cleanupCheckoutSubscription:
        buildHostedCheckoutSubscriptionCleanupCandidate({
          memberId: member.core.id,
          reason: "superseded",
          session,
          stripeSubscriptionId,
        }),
    };
  }

  const familyBillingClaim = await readHostedMemberFamilyBillingClaim({
    memberId: member.core.id,
    prisma,
  });
  if (familyBillingClaim) {
    const stripeSubscriptionId = coerceStripeSubscriptionId(session.subscription);
    if (!stripeSubscriptionId) {
      throw new Error(
        "Family-sponsored subscription Checkout completion did not include a subscription.",
      );
    }
    return {
      ...buildEmptyHostedStripeActivationOutcome(),
      cleanupCheckoutSubscription:
        buildHostedCheckoutSubscriptionCleanupCandidate({
          familyBillingClaim,
          memberId: member.core.id,
          reason: "family_sponsored",
          session,
          stripeSubscriptionId,
        }),
    };
  }

  if (session.metadata?.checkoutOffer === HOSTED_PULSE_TRIAL_OFFER) {
    return applyPulseTrialCheckoutCompletedTx({
      dispatchContext: dispatchContext ?? buildHostedStripeCheckoutSessionDispatchContext(session),
      member,
      ...(preparedCryptoDomainRoots
        ? { preparedCryptoDomainRoots }
        : {}),
      session,
      tx: prisma,
    });
  }

  const binding = await bindHostedStripeBillingRefsFromCheckoutSessionTx({
    dispatchContext: dispatchContext ?? buildHostedStripeCheckoutSessionDispatchContext(session),
    memberId: member.core.id,
    observedAt,
    session,
    tx: prisma,
  });
  if (binding.cleanupCandidate) {
    return {
      ...buildEmptyHostedStripeActivationOutcome(),
      cleanupCheckoutSubscription: binding.cleanupCandidate,
    };
  }

  return projectAcceptedHostedStandardCheckoutTx({
    dispatchContext:
      dispatchContext ?? buildHostedStripeCheckoutSessionDispatchContext(session),
    memberId: member.core.id,
    preparedCryptoDomainRoots,
    session,
    tx: prisma,
  });
}

async function projectAcceptedHostedStandardCheckoutTx(input: {
  dispatchContext: HostedStripeDispatchContext;
  memberId: string;
  preparedCryptoDomainRoots?: PreparedHostedCryptoDomainRootCandidates;
  session: Stripe.Checkout.Session;
  tx: Prisma.TransactionClient;
}): Promise<HostedStripeActivationOutcome> {
  const stripeSubscriptionId = coerceStripeSubscriptionId(
    input.session.subscription,
  );
  const stripeCustomerId = coerceStripeObjectId(input.session.customer);
  if (!stripeSubscriptionId || !stripeCustomerId) {
    throw new Error(
      "Accepted standard Checkout did not expose exact Stripe billing identifiers.",
    );
  }
  const subscription = await withHostedStripeFailureLog(
    "subscription.retrieve.checkout-accepted-canonical",
    () => requireHostedStripeApi().subscriptions.retrieve(
      stripeSubscriptionId,
      {
        expand: [...HOSTED_STRIPE_BILLING_SUBSCRIPTION_EXPANSIONS],
      },
    ),
  );
  if (
    subscription.id !== stripeSubscriptionId ||
    coerceStripeObjectId(subscription.customer) !== stripeCustomerId
  ) {
    throw new Error(
      "Accepted standard Checkout canonical subscription did not match its Session.",
    );
  }
  const financialProjection = await applyStripeRecurringFinancialState({
    dispatchContext: input.dispatchContext,
    owner: {
      kind: "member",
      lockMemberId: input.memberId,
      memberId: input.memberId,
      stripeCustomerId,
      stripeSubscriptionId,
    },
    restoreWhenHealthy: false,
    subscription,
    tx: input.tx,
  });
  if (financialProjection.blockActiveProjection) {
    return buildEmptyHostedStripeActivationOutcome();
  }

  const latestInvoice = readHostedStripeExpandedLatestInvoice(subscription);
  if (latestInvoice?.status === "paid") {
    return applyStripeInvoicePaid(
      latestInvoice,
      {
        ...input.dispatchContext,
        sourceType: "stripe.invoice.paid",
      },
      input.tx,
      mapStripeSubscriptionStatusToHostedBillingStatus(subscription.status),
      subscription,
      input.preparedCryptoDomainRoots,
    );
  }

  const subscriptionOutcome = await applyStripeSubscriptionUpdated(
    subscription,
    {
      ...input.dispatchContext,
      sourceType: "stripe.customer.subscription.updated",
    },
    input.tx,
  );
  return {
    activatedMemberId: subscriptionOutcome.activatedMemberId,
    activatedMembers: subscriptionOutcome.activatedMembers,
    hostedExecutionEventId: subscriptionOutcome.hostedExecutionEventId,
    welcomeEmailMemberId: subscriptionOutcome.welcomeEmailMemberId,
  };
}

export async function bindHostedStripeBillingRefsFromCheckoutSessionTx(input: {
  dispatchContext?: Pick<HostedStripeDispatchContext, "eventCreatedAt" | "sourceEventId">;
  memberId: string;
  observedAt: Date;
  session: Stripe.Checkout.Session;
  tx: Prisma.TransactionClient;
}) {
  const dispatchContext = input.dispatchContext ?? buildHostedStripeCheckoutSessionDispatchContext(input.session);
  const stripeSubscriptionId = coerceStripeSubscriptionId(input.session.subscription);
  const stripeCustomerId = coerceStripeObjectId(input.session.customer);
  if (!stripeSubscriptionId) {
    throw new Error(
      "Completed subscription Checkout Session did not include a subscription.",
    );
  }
  if (!stripeCustomerId) {
    throw new Error(
      "Completed subscription Checkout Session did not include a customer.",
    );
  }
  const checkoutAttemptId = normalizeNullableString(
    input.session.metadata?.checkoutAttemptId,
  );
  const checkoutIntentHash = normalizeNullableString(
    input.session.metadata?.checkoutIntentHash,
  );
  const acceptance = await acceptHostedMemberStripeCheckoutCompletionTx({
    allowLegacyCompletion:
      isHostedStripeLegacyCheckoutCompletionAllowed({
        observedAt: input.observedAt,
        sessionCreated: input.session.created,
        sessionExpiresAt: input.session.expires_at,
      }),
    checkoutAttemptId,
    checkoutIntentHash,
    checkoutSessionId: input.session.id,
    currentCheckoutOffer: HOSTED_STANDARD_CHECKOUT_OFFER,
    eventCreatedAt: dispatchContext.eventCreatedAt,
    memberId: input.memberId,
    stripeCustomerId,
    stripeSubscriptionId,
    tx: input.tx,
  });
  if (acceptance.kind === "cleanup_superseded") {
    return {
      billingSnapshot: null,
      cleanupCandidate: buildHostedCheckoutSubscriptionCleanupCandidate({
        memberId: input.memberId,
        reason: "superseded",
        session: input.session,
        stripeSubscriptionId,
      }),
    };
  }

  await writeHostedStripeCheckoutEmailIfPresentTx({
    collectedAt: dispatchContext.eventCreatedAt,
    memberId: input.memberId,
    stripeEmailAddress: readHostedStripeCheckoutSessionEmailAddress(input.session),
    tx: input.tx,
  });

  return {
    billingSnapshot: acceptance.billingRef,
    cleanupCandidate: null,
  };
}

export async function applyPulseTrialCheckoutCompletedTx(input: {
  dispatchContext: HostedStripeDispatchContext;
  member: HostedMemberBillingSnapshot;
  preparedCryptoDomainRoots?: PreparedHostedCryptoDomainRootCandidates;
  session: Stripe.Checkout.Session;
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

  const billingRefSubscriptionId = input.member.billingRef?.stripeSubscriptionId ?? null;
  const isCurrentPulseTrialSubscription = isHostedStripeSamePulseTrialCheckoutSubscription({
    billingRefSubscriptionId,
    session: input.session,
  });
  if (input.member.billingRef?.pulseTrialRedeemedAt && isCurrentPulseTrialSubscription) {
    return {
      activatedMemberId: null,
      hostedExecutionEventId: null,
      welcomeEmailMemberId: input.member.core.id,
    };
  }

  const subscription = await readHostedStripeCheckoutSessionSubscription(input.session);
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
      memberId: input.member.core.id,
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
  if (
    classifyHostedPulseTrialCandidateDisposition({
      billingStatus: input.member.core.billingStatus,
      currentBillingPhase: input.member.billingRef?.currentBillingPhase ?? null,
      currentStripeSubscriptionId:
        input.member.billingRef?.stripeSubscriptionId ?? null,
      pulseTrialRedeemedAt: input.member.billingRef?.pulseTrialRedeemedAt ?? null,
      subscriptionId: subscription.id,
    }) === "loser"
  ) {
    return {
      activatedMemberId: null,
      cleanupPulseTrialStripeSubscriptionId: subscription.id,
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
    pulseTrialPolicyVersion:
      parseHostedPulseTrialPolicyVersion(input.session.metadata?.trialPolicyVersion)
      ?? HOSTED_PULSE_TRIAL_POLICY_VERSION,
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
    preparedCryptoDomainRoots: input.preparedCryptoDomainRoots ?? new Map(),
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

export async function cancelHostedFamilySponsoredCheckoutSubscription(input: {
  stripe?: Pick<Stripe, "subscriptions">;
  subscriptionId: string;
}): Promise<void> {
  try {
    await (input.stripe ?? requireHostedStripeApi()).subscriptions.cancel(
      input.subscriptionId,
    );
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      Reflect.get(error, "code") === "resource_missing"
    ) {
      return;
    }
    logHostedStripeFailure({
      error,
      operationName: "subscription.cancel.family-sponsored-checkout",
    });
    const failure = classifyHostedStripeFailure(error);
    throw hostedOnboardingError({
      cause: error,
      code: "HOSTED_FAMILY_SPONSORED_CHECKOUT_CLEANUP_FAILED",
      details: describeHostedStripeErrorDetails({
        error,
        operationName: "subscription.cancel.family-sponsored-checkout",
      }),
      httpStatus: failure.httpStatus,
      message: failure.kind === "provider_ambiguous"
        ? "Murph could not cancel a superseded Stripe subscription. Try again."
        : "Stripe rejected the subscription cleanup. Contact support.",
      retryable: failure.retryable,
    });
  }
}

export async function applyStripeCheckoutExpired(
  session: Stripe.Checkout.Session,
  prisma: Prisma.TransactionClient,
): Promise<void> {
  const familyGroup = await findHostedAccountGroupForStripeCheckoutSession({
    prisma,
    session,
  });
  if (familyGroup) {
    await clearHostedFamilyCheckoutAttemptForSession({
      groupId: familyGroup.id,
      prisma,
      sessionId: session.id,
    });
    return;
  }

  const memberIds = await listHostedStripeCheckoutSessionMemberIds({
    prisma,
    session,
  });
  if (memberIds.length !== 1 || !memberIds[0]) {
    return;
  }
  await clearHostedMemberStripeCheckoutAttemptForSessionTx({
    memberId: memberIds[0],
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

  const metadataMemberId = normalizeNullableString(subscription.metadata?.memberId);
  if (
    metadataMemberId &&
    await readActiveHostedFamilySponsorship({
      memberId: metadataMemberId,
      prisma,
    })
  ) {
    return {
      ...buildEmptyHostedStripeActivationOutcome(),
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
  if (
    isHostedStripeStandardCheckoutAwaitingSessionAcceptance({
      member,
      subscription,
    })
  ) {
    return {
      ...buildEmptyHostedStripeActivationOutcome(),
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

  return {
    ...buildEmptyHostedStripeActivationOutcome(),
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
  if (
    canonicalSubscription &&
    isHostedStripeStandardCheckoutAwaitingSessionAcceptance({
      member,
      subscription: canonicalSubscription,
    })
  ) {
    return buildEmptyHostedStripeActivationOutcome();
  }

  if (await readActiveHostedFamilySponsorship({
    memberId: member.core.id,
    prisma,
  })) {
    return {
      ...buildEmptyHostedStripeActivationOutcome(),
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
    welcomeEmailMemberId: isHostedStripeActivationWelcomeCandidate(activation)
      ? updatedMember.core.id
      : null,
  };
}

export async function applyStripeInvoiceCollectionStateChanged(
  dispatchContext: HostedStripeDispatchContext,
  prisma: Prisma.TransactionClient,
  canonicalSubscription: Stripe.Subscription | null,
  billingOwner: HostedStripeBillingOwner | null,
): Promise<void> {
  if (!canonicalSubscription || !billingOwner) {
    return;
  }
  await applyStripeRecurringFinancialState({
    dispatchContext,
    owner: billingOwner,
    restoreWhenHealthy: false,
    subscription: canonicalSubscription,
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
  for (const memberId of familySubscription.billingModeChangedMemberIds ?? []) {
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
    welcomeEmailMemberId: null,
  };
}

type HostedStripeRecurringFinancialProjection = {
  blockActiveProjection: boolean;
  state: "blocked" | "healthy" | "unsettled";
};

export async function applyStripeRecurringFinancialState(input: {
  dispatchContext: Pick<
    HostedStripeDispatchContext,
    "eventCreatedAt" | "sourceEventId" | "sourceType"
  >;
  owner: HostedStripeBillingOwner;
  restoreWhenHealthy: boolean;
  subscription: Stripe.Subscription;
  tx: Prisma.TransactionClient;
}): Promise<HostedStripeRecurringFinancialProjection> {
  if (input.owner.stripeSubscriptionId !== input.subscription.id) {
    throw new Error(
      "Canonical recurring financial owner did not match the Stripe subscription.",
    );
  }
  const financialState = await readHostedStripeRecurringFinancialState(
    input.subscription,
  );
  const financialBlocker =
    financialState.fullyRefunded ||
    financialState.outstandingDispute;
  const canonicalBillingStatus =
    mapStripeSubscriptionStatusToHostedBillingStatus(input.subscription.status);
  const canonicalSubscriptionActive =
    canonicalBillingStatus === HostedBillingStatus.active;
  const collectionBlocksExistingEntitlement =
    financialState.collectionState.kind === "payment_required" ||
    financialState.collectionState.kind === "voided" ||
    financialState.collectionState.kind === "uncollectible" ||
    financialState.collectionState.kind === "failed";
  const canonicalStatusBlocksExistingEntitlement =
    financialState.collectionState.kind !== "processing" &&
    (
      canonicalBillingStatus === HostedBillingStatus.past_due ||
      canonicalBillingStatus === HostedBillingStatus.unpaid
    );
  const blocked =
    financialBlocker ||
    collectionBlocksExistingEntitlement ||
    canonicalStatusBlocksExistingEntitlement;
  const collectionAllowsActiveProjection =
    financialState.collectionState.kind === "paid" ||
    financialState.collectionState.kind === "none";
  const allowActiveProjection =
    !blocked &&
    canonicalSubscriptionActive &&
    collectionAllowsActiveProjection;
  const healthy =
    allowActiveProjection &&
    financialState.collectionState.kind === "paid" &&
    canonicalSubscriptionActive;

  if (!blocked && (!healthy || !input.restoreWhenHealthy)) {
    return {
      blockActiveProjection: !allowActiveProjection,
      state: healthy ? "healthy" : "unsettled",
    };
  }

  if (input.owner.kind === "family") {
    await writeHostedFamilyRecurringFinancialStateTx({
      billingStatus: blocked
        ? HostedBillingStatus.unpaid
        : HostedBillingStatus.active,
      owner: input.owner,
      subscription: input.subscription,
      tx: input.tx,
    });
    return {
      blockActiveProjection: blocked,
      state: blocked ? "blocked" : "healthy",
    };
  }

  const member = await findMemberForStripeSubscription({
    prisma: input.tx,
    subscription: input.subscription,
  });
  if (!member || member.core.id !== input.owner.memberId) {
    throw new Error(
      "Exact member billing owner disappeared during financial reconciliation.",
    );
  }
  const financialDispatchContext: HostedStripeDispatchContext = {
    eventCreatedAt: input.dispatchContext.eventCreatedAt,
    occurredAt: input.dispatchContext.eventCreatedAt.toISOString(),
    sourceEventId: input.dispatchContext.sourceEventId,
    sourceType: "stripe.billing.financial_state",
  };
  await writeHostedMemberStripeBillingTx({
    billingStatus: blocked
      ? HostedBillingStatus.unpaid
      : HostedBillingStatus.active,
    canonicalBillingStatus: null,
    ...buildHostedStripeSubscriptionBillingPeriodSnapshot(input.subscription),
    ...buildHostedStripeSubscriptionBillingPhaseSnapshot(input.subscription, member),
    dispatchContext: financialDispatchContext,
    freshnessPolicy: "canonical-financial-state",
    member,
    stripeCustomerId:
      coerceStripeObjectId(input.subscription.customer) ??
      member.billingRef?.stripeCustomerId ??
      null,
    stripeSubscriptionId: input.subscription.id,
    tx: input.tx,
  });

  return {
    blockActiveProjection: blocked,
    state: blocked ? "blocked" : "healthy",
  };
}

async function writeHostedFamilyRecurringFinancialStateTx(input: {
  billingStatus: Extract<HostedBillingStatus, "active" | "unpaid">;
  owner: Extract<HostedStripeBillingOwner, { kind: "family" }>;
  subscription: Stripe.Subscription;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  const written = await setHostedFamilyStripeBillingReversalStateTx({
    billingStatus: input.billingStatus,
    groupId: input.owner.groupId,
    subscription: input.subscription,
    tx: input.tx,
    verifiedOwnerMemberId: input.owner.lockMemberId,
  });
  if (!written) {
    throw new Error(
      "Exact Family billing owner disappeared during financial reconciliation.",
    );
  }
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
