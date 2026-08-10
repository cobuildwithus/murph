import { randomUUID } from "node:crypto";

import {
  HostedBillingStatus,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";
import type Stripe from "stripe";

import { runWithHostedDomainRootUnwrapCache } from "../hosted-crypto/domain-root-unwrap-cache";
import { getPrisma } from "../prisma";
import { buildStripeCancelUrl, buildStripeSuccessUrl } from "./billing";
import {
  HOSTED_PULSE_TRIAL_DAYS,
  HOSTED_PULSE_TRIAL_OFFER,
  HOSTED_PULSE_TRIAL_POLICY_VERSION,
  HOSTED_PULSE_TRIAL_USAGE_LIMIT_USD_MICROS,
  HOSTED_STANDARD_CHECKOUT_OFFER,
  getHostedDefaultBillingPlanCode,
  isHostedPulseTrialCheckoutEnabled,
  type HostedBillingCheckoutOffer,
  type HostedBillingPlanCode,
  type HostedPublicBillingCheckoutOffer,
} from "./billing-plans";
import { buildHostedBillingOfferMetadata } from "./billing-offer-metadata";
import { isHostedMemberSuspended } from "./entitlement";
import {
  hostedOnboardingError,
  isHostedOnboardingError,
  type HostedOnboardingError,
} from "./errors";
import {
  bindHostedMemberStripeCheckoutSessionTx,
  clearHostedMemberStripeCheckoutAttemptTx,
  prepareHostedMemberStripeCheckoutSession,
  readHostedMemberStripeBillingRef,
  revalidateHostedMemberStripeCheckoutAttemptUnderLockTx,
  reserveHostedMemberStripeCheckoutAttemptUnderLockTx,
  type HostedMemberStripeCheckoutAttempt,
  type HostedMemberStripeBillingRefSnapshot,
} from "./hosted-member-billing-store";
import { assertHostedMemberBillingStartMessagingReady } from "./billing-start-preconditions";
import { requireHostedInviteForBillingCheckout } from "./invite-service";
import { requiresHostedBillingCheckout } from "./lifecycle";
import { readActiveHostedFamilySponsorship } from "./member-access";
import {
  deriveHostedOnboardingTimingErrorName,
  finishHostedOnboardingTiming,
  startHostedOnboardingTiming,
} from "./logging";
import { sha256Hex } from "../primitives";
import {
  extractHostedPrivyVerifiedEmailAccount,
  type PrivyLinkedAccountLike,
} from "./privy-shared";
import {
  requireHostedOnboardingPublicBaseUrl,
  requireHostedStripeCheckoutConfig,
} from "./runtime";
import { withHostedStripeActionFailureAlert } from "./stripe-error-log";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  lockHostedMemberRow,
  normalizeNullableString,
} from "./shared";
import { closeUnboundHostedSubscriptionCheckout } from "./subscription-checkout-lifecycle";
import {
  bindHostedMemberSubscriptionCheckoutUnderLockTx,
  prepareHostedMemberSubscriptionCheckout,
} from "./subscription-checkout-store";
import {
  buildHostedFamilyBillingClaimError,
  readHostedMemberFamilyBillingClaim,
  type HostedMemberFamilyBillingClaim,
} from "./family-plan";

const HOSTED_BILLING_CHECKOUT_SAFE_REPLAY_MS = 23 * 60 * 60_000;
const HOSTED_BILLING_CHECKOUT_REQUEST_OPTIONS = {
  maxNetworkRetries: 0,
  timeout: 5_000,
} as const;

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
      throw hostedOnboardingError({
        code: "HOSTED_FAMILY_MEMBER_ALREADY_SPONSORED",
        httpStatus: 409,
        message: "Your Murph access is already covered by a Family plan.",
      });
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

    const { priceId, stripe, stripeLiveMode } = requireHostedStripeCheckoutConfig({
      billingPlanCode,
    });
    const publicBaseUrl = requireHostedOnboardingPublicBaseUrl();
    const verifiedEmailAddress =
      extractHostedPrivyVerifiedEmailAccount(input.linkedAccounts ?? [])?.address ?? null;
    const checkout = await createOrReuseHostedBillingCheckoutAttempt({
      billingPlanCode,
      checkoutOffer,
      inviteCode: invite.inviteCode,
      memberId: invite.member.id,
      now,
      priceId,
      prisma,
      publicBaseUrl,
      stripe,
      stripeLiveMode,
      verifiedEmailAddress,
    });

    finishHostedOnboardingTiming(timing, "completed", {
      alreadyActive: checkout.alreadyActive,
    });

    return checkout;
  } catch (error) {
    finishHostedOnboardingTiming(timing, "failed", {
      errorName: deriveHostedOnboardingTimingErrorName(error),
    });
    throw error;
  }
}

interface HostedBillingCheckoutPreparedAttempt {
  attempt: HostedMemberStripeCheckoutAttempt;
  resolvedOffer: HostedBillingCheckoutOffer;
  stripeCustomerId: string | null;
  verifiedEmailAddress: string | null;
}

type HostedBillingCheckoutAttemptOutcome =
  | {
      alreadyActive: false;
      kind: "ready";
      url: string;
    }
  | {
      alreadyActive: true;
      kind: "already_active";
      url: null;
    }
  | {
      kind: "restart";
    };

async function createOrReuseHostedBillingCheckoutAttempt(input: {
  billingPlanCode: HostedBillingPlanCode;
  checkoutOffer: HostedBillingCheckoutOffer;
  inviteCode: string;
  memberId: string;
  now: Date;
  priceId: string;
  prisma: PrismaClient;
  publicBaseUrl: string;
  stripe: Stripe;
  stripeLiveMode: boolean;
  verifiedEmailAddress: string | null;
}): Promise<{ alreadyActive: boolean; url: string | null }> {
  for (let attemptIndex = 0; attemptIndex < 3; attemptIndex += 1) {
    const expectedBillingRef = await readHostedMemberStripeBillingRef({
      memberId: input.memberId,
      prisma: input.prisma,
    });
    let prepared: HostedBillingCheckoutPreparedAttempt | "already_active";
    try {
      prepared = await input.prisma.$transaction(
        (tx) => prepareHostedBillingCheckoutAttempt({
          ...input,
          expectedBillingRef,
          tx,
        }),
        HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
      );
    } catch (error) {
      if (
        attemptIndex === 0
        && isHostedOnboardingError(error)
        && error.code === "HOSTED_BILLING_CHECKOUT_ATTEMPT_STALE"
      ) {
        continue;
      }
      throw error;
    }
    if (prepared === "already_active") {
      return { alreadyActive: true, url: null };
    }

    const outcome = await withHostedStripeActionFailureAlert(
      {
        operationIdentity: prepared.attempt.attemptId,
        operationName: "billing.checkout",
        stripeLiveMode: input.stripeLiveMode,
      },
      () => runHostedBillingCheckoutAttempt({
        ...input,
        prepared,
      }),
    );
    if (outcome.kind === "restart") {
      continue;
    }
    return {
      alreadyActive: outcome.alreadyActive,
      url: outcome.url,
    };
  }

  throw buildHostedBillingCheckoutStateChangedError();
}

async function prepareHostedBillingCheckoutAttempt(input: {
  billingPlanCode: HostedBillingPlanCode;
  checkoutOffer: HostedBillingCheckoutOffer;
  expectedBillingRef: HostedMemberStripeBillingRefSnapshot | null;
  inviteCode: string;
  memberId: string;
  now: Date;
  priceId: string;
  publicBaseUrl: string;
  tx: Prisma.TransactionClient;
  verifiedEmailAddress: string | null;
}): Promise<HostedBillingCheckoutPreparedAttempt | "already_active"> {
  await lockHostedMemberRow(input.tx, input.memberId);
  const member = await input.tx.hostedMember.findUnique({
    select: {
      billingStatus: true,
      suspendedAt: true,
    },
    where: { id: input.memberId },
  });
  if (!member) {
    throw hostedOnboardingError({
      code: "HOSTED_MEMBER_NOT_FOUND",
      httpStatus: 404,
      message: "Your hosted member record was not found.",
    });
  }
  if (isHostedMemberSuspended(member.suspendedAt)) {
    throw hostedOnboardingError({
      code: "HOSTED_MEMBER_SUSPENDED",
      httpStatus: 403,
      message: "This hosted account is suspended. Contact support to restore access.",
    });
  }
  if (member.billingStatus === HostedBillingStatus.active) {
    return "already_active";
  }
  if (!requiresHostedBillingCheckout(member.billingStatus)) {
    throw hostedOnboardingError({
      code: "HOSTED_BILLING_CHECKOUT_BLOCKED",
      httpStatus: 403,
      message:
        "This hosted account cannot start a new checkout right now. Contact support to restore access.",
    });
  }
  const familyClaim = await readHostedMemberFamilyBillingClaim({
    memberId: input.memberId,
    prisma: input.tx,
  });
  if (familyClaim) {
    throw buildHostedFamilyBillingClaimError(familyClaim);
  }

  const resolvedOffer = resolveHostedBillingCheckoutOffer({
    billingPlanCode: input.billingPlanCode,
    checkoutOffer: input.checkoutOffer,
    currentBillingRef: input.expectedBillingRef,
  });
  const stripeCustomerId = input.expectedBillingRef?.stripeCustomerId ?? null;
  const verifiedEmailAddress = stripeCustomerId
    ? null
    : input.verifiedEmailAddress;
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
  const attempt = await reserveHostedMemberStripeCheckoutAttemptUnderLockTx({
    attemptId: randomUUID(),
    createdAt: input.now,
    expectedBillingRef: input.expectedBillingRef,
    intentHash,
    memberId: input.memberId,
    tx: input.tx,
  });
  if (attempt.intentHash !== intentHash) {
    throw hostedOnboardingError({
      code: "HOSTED_BILLING_CHECKOUT_ALREADY_OPEN",
      httpStatus: 409,
      message:
        "A different billing checkout is already open. Finish or expire it before changing plans.",
    });
  }

  return {
    attempt,
    resolvedOffer,
    stripeCustomerId,
    verifiedEmailAddress,
  };
}

async function runHostedBillingCheckoutAttempt(input: {
  billingPlanCode: HostedBillingPlanCode;
  inviteCode: string;
  memberId: string;
  now: Date;
  prepared: HostedBillingCheckoutPreparedAttempt;
  priceId: string;
  prisma: PrismaClient;
  publicBaseUrl: string;
  stripe: Stripe;
  stripeLiveMode: boolean;
}): Promise<HostedBillingCheckoutAttemptOutcome> {
  const currentAttempt = input.prepared.attempt;
  if (currentAttempt.stripeCheckoutSessionId) {
    const session = await input.stripe.checkout.sessions.retrieve(
      currentAttempt.stripeCheckoutSessionId,
    );
    assertHostedBillingCheckoutSessionMatchesAttempt({
      attempt: currentAttempt,
      memberId: input.memberId,
      session,
    });
    const revalidation = await input.prisma.$transaction(
      async (tx) => {
        const state = await revalidateHostedBillingCheckoutAttemptTx({
          attempt: currentAttempt,
          memberId: input.memberId,
          tx,
        });
        if (state.kind === "ready" && session.status === "expired") {
          const cleared = await clearHostedMemberStripeCheckoutAttemptTx({
            attemptId: currentAttempt.attemptId,
            expectedSessionId: session.id,
            intentHash: currentAttempt.intentHash,
            memberId: input.memberId,
            tx,
          });
          if (!cleared) {
            throw buildHostedBillingCheckoutStateChangedError();
          }
        }
        return state;
      },
      HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
    );
    if (revalidation.kind === "restart") {
      return { kind: "restart" };
    }
    if (revalidation.kind === "already_active") {
      return { alreadyActive: true, kind: "already_active", url: null };
    }
    if (revalidation.kind !== "ready") {
      await closeUnboundHostedSubscriptionCheckout({
        deleteSessionCustomer: input.prepared.stripeCustomerId === null,
        sessionId: session.id,
        stripe: input.stripe,
      });
      if (revalidation.kind === "family_claim") {
        throw buildHostedFamilyBillingClaimError(
          revalidation.familyClaim,
        );
      }
      if (revalidation.kind === "blocked") {
        throw revalidation.error;
      }
    }
    if (session.status === "open" && session.url) {
      return { alreadyActive: false, kind: "ready", url: session.url };
    }
    if (session.status === "expired") {
      return { kind: "restart" };
    }
    throw hostedOnboardingError({
      code: "HOSTED_BILLING_CHECKOUT_SYNCING",
      httpStatus: 409,
      message:
        "This billing checkout is complete or unavailable and still syncing. Open Billing settings or contact support.",
      retryable: session.status === "complete",
    });
  }

  const attemptAgeMs =
    input.now.getTime() - currentAttempt.createdAt.getTime();
  if (
    attemptAgeMs < 0
    || attemptAgeMs >= HOSTED_BILLING_CHECKOUT_SAFE_REPLAY_MS
  ) {
    throw hostedOnboardingError({
      code: "HOSTED_BILLING_CHECKOUT_RECOVERY_REQUIRED",
      httpStatus: 409,
      message:
        "This billing checkout is too old to retry safely. Contact support before starting another checkout.",
    });
  }

  const preCreateState = await input.prisma.$transaction(
    (tx) => revalidateHostedBillingCheckoutAttemptTx({
      attempt: currentAttempt,
      memberId: input.memberId,
      tx,
    }),
    HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  );
  if (preCreateState.kind === "family_claim") {
    throw buildHostedFamilyBillingClaimError(
      preCreateState.familyClaim,
    );
  }
  if (preCreateState.kind === "blocked") {
    throw preCreateState.error;
  }
  if (preCreateState.kind === "already_active") {
    return { alreadyActive: true, kind: "already_active", url: null };
  }
  if (preCreateState.kind === "restart") {
    return { kind: "restart" };
  }

  const offerMetadata = input.prepared.resolvedOffer === HOSTED_PULSE_TRIAL_OFFER
    ? buildHostedBillingOfferMetadata({
        billingPlanCode: input.billingPlanCode,
        checkoutOffer: HOSTED_PULSE_TRIAL_OFFER,
        memberId: input.memberId,
        pulseTrialStartSource: "web_onboarding",
      })
    : buildHostedBillingOfferMetadata({
        billingPlanCode: input.billingPlanCode,
        checkoutOffer: HOSTED_STANDARD_CHECKOUT_OFFER,
        memberId: input.memberId,
      });
  const checkoutMetadata = offerMetadata;
  checkoutMetadata.checkoutAttemptId = currentAttempt.attemptId;
  checkoutMetadata.checkoutIntentHash = currentAttempt.intentHash;
  const subscriptionData: NonNullable<
    Stripe.Checkout.SessionCreateParams["subscription_data"]
  > = {
    metadata: checkoutMetadata,
  };
  if (input.prepared.resolvedOffer === HOSTED_PULSE_TRIAL_OFFER) {
    subscriptionData.trial_period_days = HOSTED_PULSE_TRIAL_DAYS;
  }
  const checkoutParams: Stripe.Checkout.SessionCreateParams = {
    cancel_url: buildStripeCancelUrl(input.publicBaseUrl, input.inviteCode),
    client_reference_id: input.memberId,
    line_items: buildHostedBillingCheckoutLineItems(input.priceId),
    metadata: checkoutMetadata,
    mode: "subscription",
    payment_method_types: ["card"],
    subscription_data: subscriptionData,
    success_url: buildStripeSuccessUrl(
      input.publicBaseUrl,
      input.inviteCode,
    ),
  };
  if (input.prepared.stripeCustomerId) {
    checkoutParams.customer = input.prepared.stripeCustomerId;
  }
  if (input.prepared.verifiedEmailAddress) {
    checkoutParams.customer_email = input.prepared.verifiedEmailAddress;
  }
  const requestOptions: Stripe.RequestOptions = {
    idempotencyKey: [
      "hosted-billing-checkout",
      currentAttempt.attemptId,
      currentAttempt.intentHash,
    ].join(":"),
    maxNetworkRetries: HOSTED_BILLING_CHECKOUT_REQUEST_OPTIONS.maxNetworkRetries,
    timeout: HOSTED_BILLING_CHECKOUT_REQUEST_OPTIONS.timeout,
  };
  const session = await input.stripe.checkout.sessions.create(
    checkoutParams,
    requestOptions,
  );
  assertHostedBillingCheckoutSessionMatchesAttempt({
    attempt: currentAttempt,
    memberId: input.memberId,
    session,
  });
  const preparedSessionBindings =
    await runWithHostedDomainRootUnwrapCache(async () => {
      const [subscriptionCheckout, billingCheckoutSession] =
        await Promise.all([
          prepareHostedMemberSubscriptionCheckout({
            memberId: input.memberId,
            prisma: input.prisma,
            stripeCheckoutSessionId: session.id,
          }),
          prepareHostedMemberStripeCheckoutSession({
            memberId: input.memberId,
            prisma: input.prisma,
            sessionId: session.id,
          }),
        ]);
      return {
        billingCheckoutSession,
        subscriptionCheckout,
      };
    });
  const bindResult = await input.prisma.$transaction(
    async (tx) => {
      const state = await revalidateHostedBillingCheckoutAttemptTx({
        attempt: currentAttempt,
        memberId: input.memberId,
        tx,
      });
      if (state.kind !== "ready") {
        return state;
      }
      await bindHostedMemberSubscriptionCheckoutUnderLockTx({
        memberId: input.memberId,
        preparedCheckout: preparedSessionBindings.subscriptionCheckout,
        tx,
      });
      const bound = await bindHostedMemberStripeCheckoutSessionTx({
        attemptId: currentAttempt.attemptId,
        intentHash: currentAttempt.intentHash,
        memberId: input.memberId,
        preparedSession: preparedSessionBindings.billingCheckoutSession,
        tx,
      });
      if (!bound) {
        throw buildHostedBillingCheckoutStateChangedError();
      }
      return { kind: "bound" } as const;
    },
    HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  );
  if (bindResult.kind !== "bound") {
    if (bindResult.kind === "restart") {
      return { kind: "restart" };
    }
    if (bindResult.kind === "already_active") {
      return { alreadyActive: true, kind: "already_active", url: null };
    }
    await closeUnboundHostedSubscriptionCheckout({
      deleteSessionCustomer: input.prepared.stripeCustomerId === null,
      sessionId: session.id,
      stripe: input.stripe,
    });
    if (bindResult.kind === "family_claim") {
      throw buildHostedFamilyBillingClaimError(
        bindResult.familyClaim,
      );
    }
    if (bindResult.kind === "blocked") {
      throw bindResult.error;
    }
    throw buildHostedBillingCheckoutStateChangedError();
  }
  if (!session.url) {
    throw hostedOnboardingError({
      code: "CHECKOUT_URL_MISSING",
      httpStatus: 502,
      message:
        "Stripe created billing checkout without a redirect URL. Retry or contact support.",
      retryable: true,
    });
  }
  return { alreadyActive: false, kind: "ready", url: session.url };
}

type HostedBillingCheckoutAttemptRevalidation =
  | {
      familyClaim: HostedMemberFamilyBillingClaim;
      kind: "family_claim";
    }
  | {
      kind: "already_active";
    }
  | {
      error: HostedOnboardingError;
      kind: "blocked";
    }
  | {
      kind: "ready";
    }
  | {
      kind: "restart";
    };

async function revalidateHostedBillingCheckoutAttemptTx(input: {
  attempt: HostedMemberStripeCheckoutAttempt;
  memberId: string;
  tx: Prisma.TransactionClient;
}): Promise<HostedBillingCheckoutAttemptRevalidation> {
  await lockHostedMemberRow(input.tx, input.memberId);
  const member = await input.tx.hostedMember.findUnique({
    select: {
      billingStatus: true,
      suspendedAt: true,
    },
    where: { id: input.memberId },
  });
  if (!member || isHostedMemberSuspended(member.suspendedAt)) {
    return {
      error: hostedOnboardingError({
        code: "HOSTED_MEMBER_SUSPENDED",
        httpStatus: 403,
        message:
          "This hosted account is suspended. Contact support to restore access.",
      }),
      kind: "blocked",
    };
  }
  if (member.billingStatus === HostedBillingStatus.active) {
    await clearHostedMemberStripeCheckoutAttemptTx({
      attemptId: input.attempt.attemptId,
      expectedSessionId: input.attempt.stripeCheckoutSessionId,
      intentHash: input.attempt.intentHash,
      memberId: input.memberId,
      tx: input.tx,
    });
    return { kind: "already_active" };
  }
  const attemptRevalidation =
    await revalidateHostedMemberStripeCheckoutAttemptUnderLockTx(input);
  if (attemptRevalidation === "session_advanced") {
    return { kind: "restart" };
  }
  if (attemptRevalidation === "stale") {
    throw buildHostedBillingCheckoutStateChangedError();
  }
  if (!requiresHostedBillingCheckout(member.billingStatus)) {
    return {
      error: hostedOnboardingError({
        code: "HOSTED_BILLING_CHECKOUT_BLOCKED",
        httpStatus: 403,
        message:
          "This hosted account cannot start a new checkout right now. Contact support to restore access.",
      }),
      kind: "blocked",
    };
  }
  const familyClaim = await readHostedMemberFamilyBillingClaim({
    memberId: input.memberId,
    prisma: input.tx,
  });
  if (!familyClaim) {
    return { kind: "ready" };
  }
  await clearHostedMemberStripeCheckoutAttemptTx({
    attemptId: input.attempt.attemptId,
    expectedSessionId: input.attempt.stripeCheckoutSessionId,
    intentHash: input.attempt.intentHash,
    memberId: input.memberId,
    tx: input.tx,
  });
  return {
    familyClaim,
    kind: "family_claim",
  };
}

function assertHostedBillingCheckoutSessionMatchesAttempt(input: {
  attempt: HostedMemberStripeCheckoutAttempt;
  memberId: string;
  session: Stripe.Checkout.Session;
}): void {
  if (
    input.session.client_reference_id !== input.memberId
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

function buildHostedBillingCheckoutIntentHash(input: {
  billingPlanCode: HostedBillingPlanCode;
  checkoutOffer: HostedBillingCheckoutOffer;
  inviteCode: string;
  memberId: string;
  priceId: string;
  publicBaseUrl: string;
  stripeCustomerId: string | null;
  verifiedEmailAddress: string | null;
}): string {
  return sha256Hex(JSON.stringify({
    billingPlanCode: input.billingPlanCode,
    cancelUrl: buildStripeCancelUrl(input.publicBaseUrl, input.inviteCode),
    checkoutOffer: input.checkoutOffer,
    customer: input.stripeCustomerId,
    email: normalizeNullableString(input.verifiedEmailAddress)?.toLowerCase()
      ?? null,
    lineItems: buildHostedBillingCheckoutLineItems(input.priceId),
    memberId: input.memberId,
    offerBindingKey: deriveHostedBillingCheckoutOfferBindingKey({
      checkoutOffer: input.checkoutOffer,
    }),
    successUrl: buildStripeSuccessUrl(
      input.publicBaseUrl,
      input.inviteCode,
    ),
  })).slice(0, 32);
}

export function deriveHostedBillingCheckoutOfferBindingKey(input: {
  checkoutOffer: HostedBillingCheckoutOffer;
  trialDurationDays?: number | null;
  trialPolicyVersion?: string | null;
  trialUsageLimitUsdMicros?: bigint | null;
}): string {
  const binding = {
    checkoutOffer: input.checkoutOffer,
    trialDurationDays: input.trialDurationDays ?? (
      input.checkoutOffer === HOSTED_PULSE_TRIAL_OFFER
        ? HOSTED_PULSE_TRIAL_DAYS
        : null
    ),
    trialPolicyVersion: input.trialPolicyVersion ?? (
      input.checkoutOffer === HOSTED_PULSE_TRIAL_OFFER
        ? HOSTED_PULSE_TRIAL_POLICY_VERSION
        : null
    ),
    trialUsageLimitUsdMicros: (
      input.trialUsageLimitUsdMicros ?? (
        input.checkoutOffer === HOSTED_PULSE_TRIAL_OFFER
          ? HOSTED_PULSE_TRIAL_USAGE_LIMIT_USD_MICROS
          : null
      )
    )?.toString() ?? null,
  };

  return `offer:${sha256Hex(JSON.stringify(binding)).slice(0, 12)}`;
}

function buildHostedBillingCheckoutStateChangedError() {
  return hostedOnboardingError({
    code: "HOSTED_BILLING_CHECKOUT_ATTEMPT_STALE",
    httpStatus: 409,
    message: "Billing checkout changed while Stripe was responding. Try again.",
    retryable: true,
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
