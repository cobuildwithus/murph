import {
  HostedBillingStatus,
  type PrismaClient,
} from "@prisma/client";

import { getPrisma } from "../prisma";
import { buildStripeCancelUrl, buildStripeSuccessUrl } from "./billing";
import {
  getHostedDefaultBillingPlanCode,
  type HostedBillingPlanCode,
} from "./billing-plans";
import { isHostedMemberSuspended } from "./entitlement";
import { hostedOnboardingError } from "./errors";
import {
  readHostedMemberStripeBillingRef,
} from "./hosted-member-billing-store";
import { requireHostedInviteForBillingCheckout } from "./invite-service";
import { requiresHostedBillingCheckout } from "./lifecycle";
import { projectHostedMemberRoutingState } from "./hosted-member-routing-store";
import { isHostedMemberMessagingSetupRequired } from "./messaging-state";
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

export function buildHostedBillingCheckoutLineItems(input: {
  priceId: string;
  usagePriceId?: string | null;
}): HostedBillingCheckoutLineItem[] {
  const lineItems: HostedBillingCheckoutLineItem[] = [
    {
      price: input.priceId,
      quantity: 1,
    },
  ];

  if (input.usagePriceId) {
    lineItems.push({
      price: input.usagePriceId,
    });
  }

  return lineItems;
}

export async function createHostedBillingCheckout(
  input: HostedBillingCheckoutInput,
): Promise<{ alreadyActive: boolean; url: string | null }> {
  const prisma = input.prisma ?? getPrisma();
  const billingPlanCode = input.billingPlanCode ?? getHostedDefaultBillingPlanCode();
  const now = input.now ?? new Date();
  const timing = startHostedOnboardingTiming("hosted-onboarding.billing.create-checkout", {
    billingPlanCode,
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

    if (isHostedMemberMessagingSetupRequired({
      identity: invite.member.identity,
      routing: invite.member.routing
        ? await projectHostedMemberRoutingState(invite.member.routing)
        : null,
    })) {
      throw hostedOnboardingError({
        code: "HOSTED_MESSAGING_CHANNEL_REQUIRED",
        message: "Verify your phone number or connect Telegram before checkout so Murph can message you.",
        httpStatus: 409,
      });
    }

    const { priceId, stripe, usagePriceId } = requireHostedStripeCheckoutConfig({
      billingPlanCode,
    });
    const publicBaseUrl = requireHostedOnboardingPublicBaseUrl();
    const customerId = await resolveHostedStripeCustomerId({
      memberId: invite.member.id,
      prisma,
    });
    const verifiedEmail = customerId
      ? null
      : extractHostedPrivyVerifiedEmailAccount(input.linkedAccounts ?? [])?.address ?? null;
    const checkoutMetadata: Record<string, string> = {
      billingPlanCode,
      memberId: invite.member.id,
    };
    const checkoutIdempotencyKey = buildHostedBillingCheckoutIdempotencyKey({
      billingPlanCode,
      inviteCode: invite.inviteCode,
      memberId: invite.member.id,
      priceId,
      stripeCustomerId: customerId,
      usagePriceId,
      verifiedEmail,
    });
    const checkoutSession = await stripe.checkout.sessions.create({
      cancel_url: buildStripeCancelUrl(publicBaseUrl, invite.inviteCode),
      client_reference_id: invite.member.id,
      ...(customerId ? { customer: customerId } : {}),
      ...(verifiedEmail ? { customer_email: verifiedEmail } : {}),
      line_items: buildHostedBillingCheckoutLineItems({
        priceId,
        usagePriceId,
      }),
      metadata: checkoutMetadata,
      mode: "subscription",
      payment_method_types: ["card"],
      subscription_data: {
        metadata: checkoutMetadata,
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

async function resolveHostedStripeCustomerId(input: {
  memberId: string;
  prisma: PrismaClient;
}): Promise<string | null> {
  const timing = startHostedOnboardingTiming("hosted-onboarding.billing.resolve-stripe-customer");
  const currentBillingRef = await readHostedMemberStripeBillingRef({
    memberId: input.memberId,
    prisma: input.prisma,
  });
  const currentStripeCustomerId = currentBillingRef?.stripeCustomerId ?? null;
  const customerPath = currentStripeCustomerId ? "existing" : "checkout-create";

  try {
    finishHostedOnboardingTiming(timing, "completed", {
      customerPath,
    });
    return currentStripeCustomerId;
  } catch (error) {
    finishHostedOnboardingTiming(timing, "failed", {
      customerPath,
      errorName: deriveHostedOnboardingTimingErrorName(error),
    });
    throw error;
  }
}

export function buildHostedBillingCheckoutIdempotencyKey(input: {
  billingPlanCode: HostedBillingPlanCode;
  inviteCode: string;
  memberId: string;
  priceId: string;
  stripeCustomerId?: string | null;
  usagePriceId?: string | null;
  verifiedEmail?: string | null;
}): string {
  const customerBindingKey = deriveHostedBillingCheckoutCustomerBindingKey({
    stripeCustomerId: input.stripeCustomerId,
    verifiedEmail: input.verifiedEmail,
  });
  const lineItemBindingKey = deriveHostedBillingCheckoutLineItemBindingKey({
    priceId: input.priceId,
    usagePriceId: input.usagePriceId,
  });
  return [
    "hosted-billing-checkout",
    input.memberId,
    input.inviteCode,
    input.billingPlanCode,
    lineItemBindingKey,
    customerBindingKey,
  ].join(":");
}

function deriveHostedBillingCheckoutLineItemBindingKey(input: {
  priceId: string;
  usagePriceId?: string | null;
}): string {
  const usagePriceId = normalizeNullableString(input.usagePriceId) ?? "none";
  return `items:${sha256Hex(`${input.priceId}:${usagePriceId}`).slice(0, 12)}`;
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
