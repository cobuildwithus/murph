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
  readHostedMemberStripeBillingRef,
} from "./hosted-member-billing-store";
import { assertHostedMemberBillingStartMessagingReady } from "./billing-start-preconditions";
import { requireHostedInviteForBillingCheckout } from "./invite-service";
import { requiresHostedBillingCheckout } from "./lifecycle";
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
import { normalizeNullableString } from "./shared";

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

    if (!requiresHostedBillingCheckout(invite.member.billingStatus)) {
      throw hostedOnboardingError({
        code: "HOSTED_BILLING_CHECKOUT_BLOCKED",
        message: "This hosted account cannot start a new checkout right now. Contact support to restore access.",
        httpStatus: 403,
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
    const customerId = currentBillingRef?.stripeCustomerId ?? null;
    const verifiedEmail = customerId
      ? null
      : extractHostedPrivyVerifiedEmailAccount(input.linkedAccounts ?? [])?.address ?? null;
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
    const checkoutSession = await stripe.checkout.sessions.create({
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
    });

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
