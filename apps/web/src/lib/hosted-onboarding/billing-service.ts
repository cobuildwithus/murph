import type { HostedMember, PrismaClient } from "@prisma/client";
import {
  HostedBillingCheckoutStatus,
  HostedBillingMode,
  HostedBillingStatus,
} from "@prisma/client";
import type Stripe from "stripe";

import { getPrisma } from "../prisma";
import { hostedOnboardingError } from "./errors";
import { requireHostedInviteForAuthentication } from "./member-service";
import {
  requireHostedOnboardingPublicBaseUrl,
  requireHostedOnboardingStripeConfig,
} from "./runtime";
import { generateHostedCheckoutId, normalizeNullableString } from "./shared";
import {
  buildStripeCancelUrl,
  buildStripeSuccessUrl,
  coerceStripeSubscriptionId,
} from "./billing";
import {
  coerceHostedWalletAddress,
  isHostedOnboardingRevnetEnabled,
  normalizeHostedWalletAddress,
} from "./revnet";

import type { HostedSessionRecord } from "./session";

export async function createHostedBillingCheckout(input: {
  inviteCode: string;
  now?: Date;
  prisma?: PrismaClient;
  sessionRecord: HostedSessionRecord;
  shareCode?: string | null;
  walletAddress?: string | null;
}): Promise<{ alreadyActive: boolean; url: string | null }> {
  const prisma = input.prisma ?? getPrisma();
  const now = input.now ?? new Date();
  const invite = await requireHostedInviteForAuthentication(input.inviteCode, prisma, now);

  if (input.sessionRecord.member.id !== invite.memberId) {
    throw hostedOnboardingError({
      code: "AUTH_INVITE_MISMATCH",
      message: "That invite belongs to a different hosted member.",
      httpStatus: 403,
    });
  }

  if (invite.member.billingStatus === HostedBillingStatus.active) {
    return {
      alreadyActive: true,
      url: null,
    };
  }

  const shareCode = normalizeNullableString(input.shareCode);
  const resolvedWalletAddress = resolveHostedMemberWalletAddress({
    existingWalletAddress: invite.member.walletAddress,
    nextWalletAddress: normalizeNullableString(input.walletAddress),
    requireWalletAddress: isHostedOnboardingRevnetEnabled(),
  });
  const { billingMode, priceId, stripe } = requireHostedOnboardingStripeConfig();
  const publicBaseUrl = requireHostedOnboardingPublicBaseUrl();
  const memberForCustomer = resolvedWalletAddress
    ? {
        ...invite.member,
        walletAddress: resolvedWalletAddress,
      }
    : invite.member;
  const customerId = await ensureHostedStripeCustomer({
    member: memberForCustomer,
    prisma,
    stripe,
  });
  const checkoutMetadata: Record<string, string> = {
    inviteCode: invite.inviteCode,
    inviteId: invite.id,
    memberId: invite.member.id,
    normalizedPhoneNumber: invite.member.normalizedPhoneNumber,
    ...(resolvedWalletAddress ? { walletAddress: resolvedWalletAddress } : {}),
  };
  const checkoutSessionParams: Stripe.Checkout.SessionCreateParams = {
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
    mode: billingMode,
    success_url: buildStripeSuccessUrl(publicBaseUrl, invite.inviteCode, shareCode),
  };

  if (billingMode === "subscription") {
    checkoutSessionParams.subscription_data = {
      metadata: checkoutMetadata,
    };
  } else {
    checkoutSessionParams.payment_intent_data = {
      metadata: checkoutMetadata,
    };
  }

  const checkoutSession = await stripe.checkout.sessions.create(checkoutSessionParams);

  if (!checkoutSession.url) {
    throw hostedOnboardingError({
      code: "CHECKOUT_URL_MISSING",
      message: "Stripe Checkout did not return a redirect URL.",
      httpStatus: 502,
    });
  }

  await prisma.hostedBillingCheckout.create({
    data: {
      id: generateHostedCheckoutId(),
      memberId: invite.member.id,
      inviteId: invite.id,
      stripeCheckoutSessionId: checkoutSession.id,
      stripeCustomerId: customerId,
      stripeSubscriptionId: coerceStripeSubscriptionId(checkoutSession.subscription),
      priceId,
      mode: billingMode === "payment" ? HostedBillingMode.payment : HostedBillingMode.subscription,
      status: HostedBillingCheckoutStatus.open,
      checkoutUrl: checkoutSession.url,
    },
  });
  await prisma.hostedMember.update({
    where: {
      id: invite.member.id,
    },
    data: {
      billingMode: billingMode === "payment" ? HostedBillingMode.payment : HostedBillingMode.subscription,
      billingStatus: HostedBillingStatus.checkout_open,
      stripeCustomerId: customerId,
      stripeLatestCheckoutSessionId: checkoutSession.id,
      ...(resolvedWalletAddress ? { walletAddress: resolvedWalletAddress } : {}),
    },
  });

  return {
    alreadyActive: false,
    url: checkoutSession.url,
  };
}

async function ensureHostedStripeCustomer(input: {
  member: HostedMember;
  prisma: PrismaClient;
  stripe: Stripe;
}): Promise<string> {
  const customerMetadata = {
    memberId: input.member.id,
    normalizedPhoneNumber: input.member.normalizedPhoneNumber,
    ...(input.member.walletAddress ? { walletAddress: input.member.walletAddress } : {}),
  };

  if (input.member.stripeCustomerId) {
    await input.stripe.customers.update(input.member.stripeCustomerId, {
      metadata: customerMetadata,
      phone: input.member.normalizedPhoneNumber,
    });

    return input.member.stripeCustomerId;
  }

  const customer = await input.stripe.customers.create({
    metadata: customerMetadata,
    phone: input.member.normalizedPhoneNumber,
  });

  await input.prisma.hostedMember.update({
    where: {
      id: input.member.id,
    },
    data: {
      stripeCustomerId: customer.id,
      ...(input.member.walletAddress ? { walletAddress: input.member.walletAddress } : {}),
    },
  });

  return customer.id;
}

function resolveHostedMemberWalletAddress(input: {
  existingWalletAddress: string | null | undefined;
  nextWalletAddress: string | null | undefined;
  requireWalletAddress: boolean;
}): string | null {
  const normalizedNextWalletAddress = normalizeNullableString(input.nextWalletAddress);

  if (normalizedNextWalletAddress) {
    const walletAddress = normalizeHostedWalletAddress(normalizedNextWalletAddress);

    if (!walletAddress) {
      throw hostedOnboardingError({
        code: "HOSTED_WALLET_ADDRESS_INVALID",
        message: "The hosted wallet address must be a valid EVM address.",
        httpStatus: 400,
      });
    }

    return walletAddress;
  }

  const normalizedExistingWalletAddress = normalizeNullableString(input.existingWalletAddress);

  if (normalizedExistingWalletAddress) {
    const walletAddress = normalizeHostedWalletAddress(normalizedExistingWalletAddress);

    if (walletAddress) {
      return walletAddress;
    }

    if (!input.requireWalletAddress) {
      return null;
    }

    throw hostedOnboardingError({
      code: "HOSTED_WALLET_ADDRESS_INVALID",
      message: "The hosted wallet address must be a valid EVM address.",
      httpStatus: 400,
    });
  }

  if (input.requireWalletAddress) {
    throw hostedOnboardingError({
      code: "HOSTED_WALLET_ADDRESS_REQUIRED",
      message: "A hosted wallet address is required before Stripe checkout can begin.",
      httpStatus: 400,
    });
  }

  return null;
}

export function requireHostedMemberWalletAddressForRevnet(member: HostedMember) {
  const walletAddress = coerceHostedWalletAddress(member.walletAddress);

  if (!walletAddress) {
    throw hostedOnboardingError({
      code: "REVNET_BENEFICIARY_REQUIRED",
      message: "Hosted RevNet issuance requires a valid wallet address on the hosted member.",
      httpStatus: 503,
      retryable: true,
      details: {
        memberId: member.id,
      },
    });
  }

  return walletAddress;
}
