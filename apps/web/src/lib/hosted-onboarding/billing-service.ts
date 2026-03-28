import { Prisma, type HostedMember, type PrismaClient } from "@prisma/client";
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
  type HostedPrivyCookieStore,
  requireHostedPrivyUserForSession,
} from "./privy";
import {
  extractHostedPrivyWalletAccount,
  HOSTED_PRIVY_EMBEDDED_WALLET_CHAIN_TYPE,
  type PrivyLinkedAccountLike,
} from "./privy-shared";
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
  cookieStore: HostedPrivyCookieStore;
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
  const { linkedAccounts } = await requireHostedPrivyUserForSession(input.cookieStore, input.sessionRecord);
  const resolvedWalletAddress = await resolveHostedMemberWalletAddress({
    existingWalletAddress: invite.member.walletAddress,
    linkedAccounts,
    requireWalletAddress: isHostedOnboardingRevnetEnabled(),
  });
  const { billingMode, priceId, stripe } = requireHostedOnboardingStripeConfig();
  const publicBaseUrl = requireHostedOnboardingPublicBaseUrl();
  const customerId = await ensureHostedStripeCustomer({
    memberId: invite.member.id,
    memberSnapshot: invite.member,
    normalizedPhoneNumber: invite.member.normalizedPhoneNumber,
    preferredWalletAddress: resolvedWalletAddress,
    prisma,
    stripe,
  });
  const mode = billingMode === "payment" ? HostedBillingMode.payment : HostedBillingMode.subscription;
  const reusableCheckout = typeof prisma.hostedBillingCheckout.findFirst === "function"
    ? await prisma.hostedBillingCheckout.findFirst({
      where: {
        memberId: invite.member.id,
        mode,
        priceId,
        status: HostedBillingCheckoutStatus.open,
      },
      orderBy: {
        createdAt: "desc",
      },
    })
    : null;

  if (reusableCheckout?.checkoutUrl) {
    await prisma.hostedMember.update({
      where: {
        id: invite.member.id,
      },
      data: {
        billingMode: mode,
        billingStatus: HostedBillingStatus.checkout_open,
        stripeCustomerId: customerId,
        stripeLatestCheckoutSessionId: reusableCheckout.stripeCheckoutSessionId,
        ...(resolvedWalletAddress ? { walletAddress: resolvedWalletAddress } : {}),
      },
    });

    return {
      alreadyActive: false,
      url: reusableCheckout.checkoutUrl,
    };
  }

  const checkoutAttemptCount = typeof prisma.hostedBillingCheckout.count === "function"
    ? await prisma.hostedBillingCheckout.count({
      where: {
        memberId: invite.member.id,
        mode,
        priceId,
      },
    })
    : 0;
  const checkoutAttemptNumber = checkoutAttemptCount + 1;
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
    payment_method_types: ["card"],
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

  const checkoutSession = await stripe.checkout.sessions.create(
    checkoutSessionParams,
    {
      idempotencyKey: buildHostedStripeCheckoutIdempotencyKey({
        attemptNumber: checkoutAttemptNumber,
        billingMode,
        inviteId: invite.id,
        memberId: invite.member.id,
        priceId,
      }),
    },
  );

  if (!checkoutSession.url) {
    throw hostedOnboardingError({
      code: "CHECKOUT_URL_MISSING",
      message: "Stripe Checkout did not return a redirect URL.",
      httpStatus: 502,
    });
  }

  try {
    await runHostedBillingCheckoutTransaction(prisma, async (transaction) => {
      await transaction.hostedBillingCheckout.create({
        data: {
          id: generateHostedCheckoutId(),
          memberId: invite.member.id,
          inviteId: invite.id,
          stripeCheckoutSessionId: checkoutSession.id,
          stripeCustomerId: customerId,
          stripeSubscriptionId: coerceStripeSubscriptionId(checkoutSession.subscription),
          priceId,
          mode,
          status: HostedBillingCheckoutStatus.open,
          checkoutUrl: checkoutSession.url,
        },
      });
      await transaction.hostedMember.update({
        where: {
          id: invite.member.id,
        },
        data: {
          billingMode: mode,
          billingStatus: HostedBillingStatus.checkout_open,
          stripeCustomerId: customerId,
          stripeLatestCheckoutSessionId: checkoutSession.id,
          ...(resolvedWalletAddress ? { walletAddress: resolvedWalletAddress } : {}),
        },
      });
    });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) {
      throw error;
    }

    const concurrentOpenCheckout = typeof prisma.hostedBillingCheckout.findFirst === "function"
      ? await prisma.hostedBillingCheckout.findFirst({
        where: {
          memberId: invite.member.id,
          mode,
          priceId,
          status: HostedBillingCheckoutStatus.open,
        },
        orderBy: {
          createdAt: "desc",
        },
      })
      : null;

    if (concurrentOpenCheckout?.checkoutUrl) {
      await prisma.hostedMember.update({
        where: {
          id: invite.member.id,
        },
        data: {
          billingMode: mode,
          billingStatus: HostedBillingStatus.checkout_open,
          stripeCustomerId: customerId,
          stripeLatestCheckoutSessionId: concurrentOpenCheckout.stripeCheckoutSessionId,
          ...(resolvedWalletAddress ? { walletAddress: resolvedWalletAddress } : {}),
        },
      });

      return {
        alreadyActive: false,
        url: concurrentOpenCheckout.checkoutUrl,
      };
    }

    throw error;
  }

  return {
    alreadyActive: false,
    url: checkoutSession.url,
  };
}

async function ensureHostedStripeCustomer(input: {
  memberId: string;
  memberSnapshot: Pick<HostedMember, "id" | "stripeCustomerId">;
  normalizedPhoneNumber: string;
  preferredWalletAddress: string | null;
  prisma: PrismaClient;
  stripe: Stripe;
}): Promise<string> {
  const customerMetadata = {
    memberId: input.memberId,
  };
  const currentMember = typeof input.prisma.hostedMember.findUnique === "function"
    ? await input.prisma.hostedMember.findUnique({
      where: {
        id: input.memberId,
      },
      select: {
        id: true,
        stripeCustomerId: true,
      },
    })
    : input.memberSnapshot;

  if (currentMember?.stripeCustomerId) {
    await input.stripe.customers.update(currentMember.stripeCustomerId, {
      metadata: customerMetadata,
      phone: input.normalizedPhoneNumber,
    });

    return currentMember.stripeCustomerId;
  }

  const customer = await input.stripe.customers.create(
    {
      metadata: customerMetadata,
      phone: input.normalizedPhoneNumber,
    },
    {
      idempotencyKey: buildHostedStripeCustomerIdempotencyKey(input.memberId),
    },
  );

  const bindResult = await input.prisma.hostedMember.updateMany({
    where: {
      id: input.memberId,
      stripeCustomerId: null,
    },
    data: {
      stripeCustomerId: customer.id,
      ...(input.preferredWalletAddress ? { walletAddress: input.preferredWalletAddress } : {}),
    },
  });

  if (bindResult.count === 1) {
    return customer.id;
  }

  const reboundMember = typeof input.prisma.hostedMember.findUnique === "function"
    ? await input.prisma.hostedMember.findUnique({
      where: {
        id: input.memberId,
      },
      select: {
        stripeCustomerId: true,
      },
    })
    : null;

  if (reboundMember?.stripeCustomerId) {
    await input.stripe.customers.update(reboundMember.stripeCustomerId, {
      metadata: customerMetadata,
      phone: input.normalizedPhoneNumber,
    });

    return reboundMember.stripeCustomerId;
  }

  throw hostedOnboardingError({
    code: "STRIPE_CUSTOMER_BIND_FAILED",
    message: "Stripe customer creation succeeded, but the hosted member could not be bound safely.",
    httpStatus: 503,
    retryable: true,
  });
}

async function runHostedBillingCheckoutTransaction<TResult>(
  prisma: PrismaClient,
  callback: (transaction: PrismaClient) => Promise<TResult>,
): Promise<TResult> {
  return typeof prisma.$transaction === "function"
    ? prisma.$transaction((transaction) => callback(transaction as PrismaClient))
    : callback(prisma);
}

function buildHostedStripeCustomerIdempotencyKey(memberId: string): string {
  return `hosted-onboarding:stripe-customer:${memberId}`;
}

function buildHostedStripeCheckoutIdempotencyKey(input: {
  attemptNumber: number;
  billingMode: "payment" | "subscription";
  inviteId: string;
  memberId: string;
  priceId: string;
}): string {
  return [
    "hosted-onboarding:stripe-checkout",
    input.memberId,
    input.inviteId,
    input.billingMode,
    input.priceId,
    String(input.attemptNumber),
  ].join(":");
}

async function resolveHostedMemberWalletAddress(input: {
  existingWalletAddress: string | null | undefined;
  linkedAccounts: readonly PrivyLinkedAccountLike[];
  requireWalletAddress: boolean;
}): Promise<string | null> {
  const normalizedExistingWalletAddress = normalizeNullableString(input.existingWalletAddress);
  const privyWalletAddress = normalizeHostedWalletAddress(
    extractHostedPrivyWalletAccount(input.linkedAccounts, HOSTED_PRIVY_EMBEDDED_WALLET_CHAIN_TYPE)?.address,
  );

  if (normalizedExistingWalletAddress) {
    const walletAddress = normalizeHostedWalletAddress(normalizedExistingWalletAddress);

    if (walletAddress) {
      if (privyWalletAddress && privyWalletAddress !== walletAddress) {
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

  if (privyWalletAddress) {
    return privyWalletAddress;
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
