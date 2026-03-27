import type { HostedMember, PrismaClient } from "@prisma/client";
import {
  HostedBillingCheckoutStatus,
  HostedBillingMode,
  HostedBillingStatus,
  HostedMemberStatus,
} from "@prisma/client";
import type Stripe from "stripe";

import { getPrisma } from "../prisma";
import { hostedOnboardingError } from "./errors";
import { requireHostedInviteForAuthentication } from "./member-service";
import {
  getOptionalHostedPrivyIdentityFromCookies,
  requireHostedPrivyIdentityFromCookies,
} from "./privy";
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

  if (
    input.sessionRecord.member.status === HostedMemberStatus.suspended ||
    invite.member.status === HostedMemberStatus.suspended
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

  const shareCode = normalizeNullableString(input.shareCode);
  const resolvedWalletAddress = await resolveHostedMemberWalletAddress({
    existingWalletAddress: invite.member.walletAddress,
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
    inviteId: invite.id,
    memberId: invite.member.id,
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

async function resolveHostedMemberWalletAddress(input: {
  existingWalletAddress: string | null | undefined;
  requireWalletAddress: boolean;
}): Promise<string | null> {
  const normalizedExistingWalletAddress = normalizeNullableString(input.existingWalletAddress);
  const trustedWalletAddress = normalizedExistingWalletAddress
    ? normalizeHostedWalletAddress((await getOptionalHostedPrivyIdentityFromCookies())?.wallet.address)
    : normalizeHostedWalletAddress(
        (await resolveHostedBillingWalletIdentity(input.requireWalletAddress))?.wallet.address,
      );

  if (normalizedExistingWalletAddress) {
    const walletAddress = normalizeHostedWalletAddress(normalizedExistingWalletAddress);

    if (walletAddress) {
      if (trustedWalletAddress && trustedWalletAddress !== walletAddress) {
        throw hostedOnboardingError({
          code: "HOSTED_WALLET_ADDRESS_CONFLICT",
          message: "This hosted member is already bound to a different verified rewards wallet.",
          httpStatus: 409,
        });
      }

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

  if (trustedWalletAddress) {
    return trustedWalletAddress;
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

async function resolveHostedBillingWalletIdentity(requireWalletAddress: boolean) {
  if (requireWalletAddress) {
    return requireHostedPrivyIdentityFromCookies();
  }

  return getOptionalHostedPrivyIdentityFromCookies();
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
