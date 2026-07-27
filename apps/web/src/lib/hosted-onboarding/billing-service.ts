import {
  HostedBillingStatus,
  type PrismaClient,
} from "@prisma/client";

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
import { hostedOnboardingError } from "./errors";
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
import { withHostedStripeFailureLog } from "./stripe-error-log";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  lockHostedMemberRow,
  normalizeNullableString,
} from "./shared";
import { createHostedPulseTrialStripeCustomer } from "./pulse-trial-customer";
import { expireHostedStripeCheckoutSessionBestEffort } from "./stripe-checkout-session-lifecycle";

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
    const checkoutIdempotencyKey = buildHostedBillingCheckoutIdempotencyKey({
      billingPlanCode,
      checkoutOffer: resolvedOffer,
      inviteCode: invite.inviteCode,
      memberId: invite.member.id,
      priceId,
      stripeCustomerId: customerId,
      verifiedEmail,
    });
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

    if (!checkoutSession.url) {
      await expireHostedStripeCheckoutSessionBestEffort({
        operationName: "checkout.sessions.expire.billing-start-missing-url",
        sessionId: checkoutSession.id,
        stripe,
      });
      throw hostedOnboardingError({
        code: "CHECKOUT_URL_MISSING",
        message: "Stripe Checkout did not return a redirect URL.",
        httpStatus: 502,
      });
    }
    try {
      await prisma.$transaction(
        (tx) => bindHostedMemberStripeCheckoutSessionTx({
          memberId: invite.member.id,
          stripeCheckoutSessionId: checkoutSession.id,
          tx,
        }),
        HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
      );
    } catch (error) {
      await expireHostedStripeCheckoutSessionBestEffort({
        operationName: "checkout.sessions.expire.billing-start-bind-failed",
        sessionId: checkoutSession.id,
        stripe,
      });
      throw error;
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
