import {
  HostedBillingStatus,
  type HostedMember,
  type PrismaClient,
} from "@prisma/client";
import type Stripe from "stripe";

import { getPrisma } from "../prisma";
import { buildStripeCancelUrl, buildStripeSuccessUrl } from "./billing";
import { isHostedMemberSuspended } from "./entitlement";
import { hostedOnboardingError } from "./errors";
import {
  bindHostedMemberStripeCustomerIdIfMissing,
  readHostedMemberStripeBillingRef,
} from "./hosted-member-store";
import { requireHostedInviteForAuthentication } from "./invite-service";
import { requiresHostedBillingCheckout } from "./lifecycle";
import { coerceHostedWalletAddress } from "./revnet";
import {
  requireHostedOnboardingPublicBaseUrl,
  requireHostedStripeCheckoutConfig,
} from "./runtime";
import { normalizeNullableString } from "./shared";

export interface HostedBillingCheckoutInput {
  inviteCode: string;
  member?: HostedMember;
  now?: Date;
  prisma?: PrismaClient;
  shareCode?: string | null;
}

export async function createHostedBillingCheckout(
  input: HostedBillingCheckoutInput,
): Promise<{ alreadyActive: boolean; url: string | null }> {
  const prisma = input.prisma ?? getPrisma();
  const now = input.now ?? new Date();
  const auth = await resolveHostedBillingCheckoutAuth(input);
  const invite = await requireHostedInviteForAuthentication(input.inviteCode, prisma, now);

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

  const shareCode = normalizeNullableString(input.shareCode);
  const { priceId, stripe } = requireHostedStripeCheckoutConfig();
  const publicBaseUrl = requireHostedOnboardingPublicBaseUrl();
  const customerId = await ensureHostedStripeCustomer({
    memberId: invite.member.id,
    prisma,
    stripe,
  });
  const checkoutMetadata: Record<string, string> = {
    memberId: invite.member.id,
  };
  const checkoutSession = await stripe.checkout.sessions.create({
    cancel_url: buildStripeCancelUrl(publicBaseUrl, invite.inviteCode, shareCode),
    client_reference_id: invite.member.id,
    customer: customerId,
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    metadata: checkoutMetadata,
    mode: "subscription",
    payment_method_types: ["card"],
    subscription_data: {
      metadata: checkoutMetadata,
    },
    success_url: buildStripeSuccessUrl(publicBaseUrl, invite.inviteCode, shareCode),
  });

  if (!checkoutSession.url) {
    throw hostedOnboardingError({
      code: "CHECKOUT_URL_MISSING",
      message: "Stripe Checkout did not return a redirect URL.",
      httpStatus: 502,
    });
  }

  return {
    alreadyActive: false,
    url: checkoutSession.url,
  };
}

async function resolveHostedBillingCheckoutAuth(
  input: HostedBillingCheckoutInput,
): Promise<{ member: HostedMember }> {
  if (input.member) {
    return { member: input.member };
  }

  throw new TypeError("Hosted billing checkout requires the authenticated hosted member.");
}

async function ensureHostedStripeCustomer(input: {
  memberId: string;
  prisma: PrismaClient;
  stripe: Stripe;
}): Promise<string> {
  const customerMetadata = {
    memberId: input.memberId,
  };
  const currentBillingRef = await readHostedMemberStripeBillingRef({
    memberId: input.memberId,
    prisma: input.prisma,
  });
  const currentStripeCustomerId = currentBillingRef?.stripeCustomerId ?? null;

  if (currentStripeCustomerId) {
    await input.stripe.customers.update(currentStripeCustomerId, {
      metadata: customerMetadata,
    });

    return currentStripeCustomerId;
  }

  const customer = await input.stripe.customers.create(
    {
      metadata: customerMetadata,
    },
    {
      idempotencyKey: buildHostedStripeCustomerIdempotencyKey(input.memberId),
    },
  );

  const bound = await bindHostedMemberStripeCustomerIdIfMissing({
    memberId: input.memberId,
    prisma: input.prisma,
    stripeCustomerId: customer.id,
  });

  if (bound) {
    await input.stripe.customers.update(customer.id, {
      metadata: customerMetadata,
    });

    return customer.id;
  }

  const reboundBillingRef = await readHostedMemberStripeBillingRef({
    memberId: input.memberId,
    prisma: input.prisma,
  });

  if (reboundBillingRef?.stripeCustomerId) {
    await input.stripe.customers.update(reboundBillingRef.stripeCustomerId, {
      metadata: customerMetadata,
    });

    return reboundBillingRef.stripeCustomerId;
  }

  throw hostedOnboardingError({
    code: "STRIPE_CUSTOMER_BIND_FAILED",
    message: "Stripe customer creation succeeded, but the hosted member could not be bound safely.",
    httpStatus: 503,
    retryable: true,
  });
}

function buildHostedStripeCustomerIdempotencyKey(memberId: string): string {
  return `hosted-onboarding:stripe-customer:${memberId}`;
}

export function requireHostedMemberWalletAddressForRevnet(member: {
  id: string;
  walletAddress: string | null | undefined;
}) {
  const walletAddress = coerceHostedWalletAddress(member.walletAddress);

  if (!walletAddress) {
    throw hostedOnboardingError({
      code: "REVNET_BENEFICIARY_REQUIRED",
      message: "Hosted RevNet issuance requires valid account setup details on the hosted member.",
      httpStatus: 503,
      retryable: true,
      details: {
        memberId: member.id,
      },
    });
  }

  return walletAddress;
}
