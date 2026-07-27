import {
  HostedBillingStatus,
  type PrismaClient,
} from "@prisma/client";
import type Stripe from "stripe";

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
import { hostedOnboardingError, isHostedOnboardingError } from "./errors";
import {
  bindHostedMemberStripeCheckoutSessionTx,
  bindHostedMemberStripeCustomerIdIfMissingTx,
  readHostedMemberStripeBillingRef,
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
import { logHostedStripeFailure, withHostedStripeFailureLog } from "./stripe-error-log";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  lockHostedMemberRow,
  normalizeNullableString,
} from "./shared";
import { createHostedPulseTrialStripeCustomer } from "./pulse-trial-customer";
import {
  expireHostedStripeCheckoutSessionBestEffort,
  isHostedStripeResourceMissingError,
} from "./stripe-checkout-session-lifecycle";

const HOSTED_BILLING_CHECKOUT_RECONCILIATION_TIMEOUT_MS = 5_000;

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

    const currentBillingRef = await readHostedMemberStripeBillingRef({
      memberId: invite.member.id,
      prisma,
    });
    const resolvedOffer = resolveHostedBillingCheckoutOffer({
      billingPlanCode,
      checkoutOffer,
      currentBillingRef,
    });
    const { priceId, stripe } = requireHostedStripeCheckoutConfig({
      billingPlanCode,
    });
    const replacedStripeCheckoutSessionId =
      await settleHostedMemberCheckoutSessionForReplacement({
        stripe,
        stripeCheckoutSessionId: currentBillingRef?.stripeCheckoutSessionId ?? null,
      });
    const publicBaseUrl = requireHostedOnboardingPublicBaseUrl();
    const verifiedEmailAddress =
      extractHostedPrivyVerifiedEmailAccount(input.linkedAccounts ?? [])?.address ?? null;
    const customerId = currentBillingRef?.stripeCustomerId ??
      (resolvedOffer === HOSTED_PULSE_TRIAL_OFFER
        ? await reserveHostedPulseTrialCheckoutCustomer({
            memberId: invite.member.id,
            prisma,
            stripe,
          })
        : null);
    const verifiedEmail = customerId ? null : verifiedEmailAddress;
    const checkoutMetadata = buildHostedBillingOfferMetadata({
      billingPlanCode,
      checkoutOffer: resolvedOffer,
      memberId: invite.member.id,
    });
    const baseCheckoutIdempotencyKey = buildHostedBillingCheckoutIdempotencyKey({
      billingPlanCode,
      checkoutOffer: resolvedOffer,
      inviteCode: invite.inviteCode,
      memberId: invite.member.id,
      priceId,
      stripeCustomerId: customerId,
      verifiedEmail,
    });
    const checkoutIdempotencyKey = replacedStripeCheckoutSessionId
      ? `${baseCheckoutIdempotencyKey}:retry:${
          sha256Hex(replacedStripeCheckoutSessionId).slice(0, 12)
        }`
      : baseCheckoutIdempotencyKey;
    const checkoutSession = await withHostedStripeFailureLog(
      "checkout.sessions.create.billing-start",
      () => stripe.checkout.sessions.create({
        cancel_url: buildStripeCancelUrl(publicBaseUrl, invite.inviteCode),
        client_reference_id: invite.member.id,
        ...(customerId ? { customer: customerId } : {}),
        ...(verifiedEmail ? { customer_email: verifiedEmail } : {}),
        line_items: buildHostedBillingCheckoutLineItems(priceId),
        metadata: checkoutMetadata,
        mode: "subscription",
        payment_method_types: ["card"],
        subscription_data: {
          metadata: checkoutMetadata,
          ...(resolvedOffer === HOSTED_PULSE_TRIAL_OFFER
            ? { trial_period_days: HOSTED_PULSE_TRIAL_DAYS }
            : {}),
        },
        success_url: buildStripeSuccessUrl(publicBaseUrl, invite.inviteCode),
      }, {
        idempotencyKey: checkoutIdempotencyKey,
      }),
    );

    try {
      await prisma.$transaction(
        (tx) => bindHostedMemberStripeCheckoutSessionTx({
          memberId: invite.member.id,
          replaceStripeCheckoutSessionId: replacedStripeCheckoutSessionId,
          stripeCheckoutSessionId: checkoutSession.id,
          tx,
        }),
        HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
      );
    } catch (error) {
      if (shouldExpireHostedBillingCheckoutAfterBindFailure(error)) {
        await expireHostedStripeCheckoutSessionBestEffort({
          operationName: "checkout.sessions.expire.billing-start-bind-rejected",
          sessionId: checkoutSession.id,
          stripe,
        });
      }
      throw error;
    }
    if (!checkoutSession.url) {
      throw hostedOnboardingError({
        code: "CHECKOUT_URL_MISSING",
        message: "Stripe Checkout did not return a redirect URL.",
        httpStatus: 502,
      });
    }

    finishHostedOnboardingTiming(timing, "completed", {
      alreadyActive: false,
    });

    return {
      alreadyActive: false,
      url: checkoutSession.url,
    };
  } catch (error) {
    finishHostedOnboardingTiming(timing, "failed", {
      errorName: deriveHostedOnboardingTimingErrorName(error),
    });
    throw error;
  }
}

function shouldExpireHostedBillingCheckoutAfterBindFailure(error: unknown): boolean {
  if (!isHostedOnboardingError(error)) {
    return false;
  }

  return error.code === "HOSTED_MEMBER_NOT_FOUND"
    || error.code === "HOSTED_MEMBER_SUSPENDED"
    || error.code === "HOSTED_BILLING_CHECKOUT_IN_PROGRESS"
    || error.code === "STRIPE_CHECKOUT_SESSION_IDENTITY_CONFLICT";
}

async function settleHostedMemberCheckoutSessionForReplacement(input: {
  stripe: Stripe;
  stripeCheckoutSessionId: string | null;
}): Promise<string | null> {
  const stripeCheckoutSessionId = input.stripeCheckoutSessionId;
  if (!stripeCheckoutSessionId) {
    return null;
  }

  const requestOptions: Stripe.RequestOptions = {
    maxNetworkRetries: 0,
    timeout: HOSTED_BILLING_CHECKOUT_RECONCILIATION_TIMEOUT_MS,
  };
  let session: Stripe.Checkout.Session | null;
  try {
    session = await input.stripe.checkout.sessions.retrieve(
      stripeCheckoutSessionId,
      {},
      requestOptions,
    );
  } catch (error) {
    if (isHostedStripeResourceMissingError(error)) {
      session = null;
    } else {
      logHostedStripeFailure({
        error,
        operationName: "checkout.sessions.retrieve.billing-retry",
      });
      throw hostedOnboardingError({
        cause: error,
        code: "HOSTED_BILLING_CHECKOUT_RECONCILIATION_FAILED",
        httpStatus: 502,
        message: "Murph could not close the previous billing checkout. Try again.",
        retryable: true,
      });
    }
  }

  if (session?.status === "complete") {
    throw hostedOnboardingError({
      code: "HOSTED_BILLING_CHECKOUT_SYNCING",
      httpStatus: 409,
      message: "Your previous billing checkout is still syncing. Try again shortly.",
      retryable: true,
    });
  }
  if (session?.status === "open") {
    try {
      session = await input.stripe.checkout.sessions.expire(
        stripeCheckoutSessionId,
        {},
        requestOptions,
      );
    } catch (expireError) {
      if (isHostedStripeResourceMissingError(expireError)) {
        session = null;
      } else {
        try {
          session = await input.stripe.checkout.sessions.retrieve(
            stripeCheckoutSessionId,
            {},
            requestOptions,
          );
        } catch (retrieveError) {
          if (isHostedStripeResourceMissingError(retrieveError)) {
            session = null;
          } else {
            logHostedStripeFailure({
              error: retrieveError,
              operationName: "checkout.sessions.retrieve.billing-retry-expiry-race",
            });
            throw hostedOnboardingError({
              cause: expireError,
              code: "HOSTED_BILLING_CHECKOUT_RECONCILIATION_FAILED",
              httpStatus: 502,
              message: "Murph could not close the previous billing checkout. Try again.",
              retryable: true,
            });
          }
        }
      }
    }
  }

  if (session && session.status !== "expired") {
    throw hostedOnboardingError({
      code: "HOSTED_BILLING_CHECKOUT_SYNCING",
      httpStatus: 409,
      message: "Your previous billing checkout is still changing. Try again shortly.",
      retryable: true,
    });
  }

  return stripeCheckoutSessionId;
}

async function reserveHostedPulseTrialCheckoutCustomer(input: {
  memberId: string;
  prisma: PrismaClient;
  stripe: ReturnType<typeof requireHostedStripeCheckoutConfig>["stripe"];
}): Promise<string> {
  return input.prisma.$transaction(async (tx) => {
    await lockHostedMemberRow(tx, input.memberId);
    const currentBillingRef = await readHostedMemberStripeBillingRef({
      memberId: input.memberId,
      prisma: tx,
    });
    const candidateStripeCustomerId = currentBillingRef?.stripeCustomerId
      ?? await createHostedPulseTrialStripeCustomer({
        memberId: input.memberId,
        requestOptions: {
          maxNetworkRetries: 0,
          timeout: 5_000,
        },
        stripe: input.stripe,
      });
    const billingRef = currentBillingRef?.stripeCustomerId
      ? currentBillingRef
      : await bindHostedMemberStripeCustomerIdIfMissingTx({
          memberId: input.memberId,
          stripeCustomerId: candidateStripeCustomerId,
          tx,
        });
    if (!billingRef?.stripeCustomerId) {
      throw hostedOnboardingError({
        code: "HOSTED_AUTO_PULSE_TRIAL_CUSTOMER_BIND_FAILED",
        httpStatus: 409,
        message: "Murph could not reserve Stripe billing for trial activation. Try again.",
        retryable: true,
      });
    }
    return billingRef.stripeCustomerId;
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

async function resolveHostedBillingCheckoutAuth(
  input: HostedBillingCheckoutInput,
): Promise<{ member: HostedBillingCheckoutAuthenticatedMember }> {
  if (input.member) {
    return { member: input.member };
  }

  throw new TypeError("Hosted billing checkout requires the authenticated hosted member.");
}

export function buildHostedBillingCheckoutIdempotencyKey(input: {
  billingPlanCode: HostedBillingPlanCode;
  checkoutOffer?: HostedBillingCheckoutOffer;
  inviteCode: string;
  memberId: string;
  priceId: string;
  stripeCustomerId?: string | null;
  verifiedEmail?: string | null;
}): string {
  const customerBindingKey = deriveHostedBillingCheckoutCustomerBindingKey({
    stripeCustomerId: input.stripeCustomerId,
    verifiedEmail: input.verifiedEmail,
  });
  const lineItemBindingKey = deriveHostedBillingCheckoutLineItemBindingKey(input.priceId);
  const offerBindingKey = deriveHostedBillingCheckoutOfferBindingKey({
    checkoutOffer: input.checkoutOffer ?? HOSTED_STANDARD_CHECKOUT_OFFER,
  });
  return [
    "hosted-billing-checkout",
    input.memberId,
    input.inviteCode,
    input.billingPlanCode,
    offerBindingKey,
    lineItemBindingKey,
    customerBindingKey,
  ].join(":");
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
      input.checkoutOffer === HOSTED_PULSE_TRIAL_OFFER ? HOSTED_PULSE_TRIAL_DAYS : null
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

function deriveHostedBillingCheckoutLineItemBindingKey(priceId: string): string {
  return `items:${sha256Hex(priceId).slice(0, 12)}`;
}

function deriveHostedBillingCheckoutCustomerBindingKey(input: {
  stripeCustomerId?: string | null;
  verifiedEmail?: string | null;
}): string {
  const stripeCustomerId = normalizeNullableString(input.stripeCustomerId);

  if (stripeCustomerId) {
    return `customer:${stripeCustomerId}`;
  }

  const verifiedEmail = normalizeNullableString(input.verifiedEmail)?.toLowerCase() ?? null;

  if (verifiedEmail) {
    return `email:${sha256Hex(verifiedEmail).slice(0, 12)}`;
  }

  return "customer:none";
}
