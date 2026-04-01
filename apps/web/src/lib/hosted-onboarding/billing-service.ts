import {
  HostedBillingCheckoutStatus,
  Prisma,
  type HostedBillingCheckout,
  type HostedMember,
  type PrismaClient,
} from "@prisma/client";
import {
  HostedBillingMode,
  HostedBillingStatus,
  HostedMemberStatus,
} from "@prisma/client";
import type Stripe from "stripe";

import { getPrisma } from "../prisma";
import { hostedOnboardingError, isHostedOnboardingError } from "./errors";
import { requireHostedInviteForAuthentication } from "./invite-service";
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
  createPendingHostedBillingAttempt,
  expireHostedBillingAttemptBySessionId,
  failHostedBillingAttemptById,
  finalizeHostedBillingAttemptById,
  findActiveHostedBillingAttemptForMember,
} from "./billing-attempts";
import {
  requireHostedOnboardingPublicBaseUrl,
  requireHostedStripeCheckoutConfig,
} from "./runtime";
import { normalizeNullableString } from "./shared";
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
import { lockHostedMemberRow } from "./shared";

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
  resolveHostedMemberWalletAddress({
    existingWalletAddress: invite.member.walletAddress,
    linkedAccounts,
    requireWalletAddress: isHostedOnboardingRevnetEnabled(),
  });
  const { billingMode, priceId, stripe } = requireHostedStripeCheckoutConfig();
  const publicBaseUrl = requireHostedOnboardingPublicBaseUrl();
  const customerId = await ensureHostedStripeCustomer({
    memberId: invite.member.id,
    memberSnapshot: invite.member,
    prisma,
    stripe,
  });
  const mode = billingMode === "payment" ? HostedBillingMode.payment : HostedBillingMode.subscription;
  const requestContext = {
    hasShareContext: shareCode !== null,
    inviteId: invite.id,
    memberId: invite.member.id,
    mode,
    priceId,
  };

  for (let retryCount = 0; retryCount < 2; retryCount += 1) {
    const reservation = await reserveHostedBillingCheckout({
      customerId,
      now,
      prisma,
      requestContext,
    });

    if (reservation.kind === "alreadyActive") {
      return {
        alreadyActive: true,
        url: null,
      };
    }

    if (reservation.kind === "pending") {
      return finalizeHostedBillingCheckoutReservation({
        billingMode,
        customerId,
        inviteCode: invite.inviteCode,
        memberId: invite.member.id,
        priceId,
        prisma,
        reservation: reservation.attempt,
        shareCode,
        stripe,
        publicBaseUrl,
      });
    }

    if (reservation.kind === "conflict_pending") {
      throw hostedOnboardingError({
        code: "HOSTED_BILLING_CHECKOUT_IN_PROGRESS",
        message: "Another hosted billing checkout is already being prepared for this account. Retry in a moment.",
        httpStatus: 503,
        retryable: true,
      });
    }

    const reusableCheckout = await resolveReusableHostedBillingCheckout({
      attempt: reservation.attempt,
      now,
      prisma,
      stripe,
    });

    if (!reusableCheckout?.checkoutUrl) {
      continue;
    }

    await prisma.hostedMember.update({
      where: {
        id: invite.member.id,
      },
      data: {
        billingMode: mode,
        billingStatus: HostedBillingStatus.checkout_open,
        stripeCustomerId: customerId,
        stripeLatestCheckoutSessionId: reusableCheckout.stripeCheckoutSessionId,
      },
    });

    if (reservation.kind === "open") {
      return {
        alreadyActive: false,
        url: reusableCheckout.checkoutUrl,
      };
    }

    throw hostedOnboardingError({
      code: "HOSTED_BILLING_CHECKOUT_ALREADY_OPEN",
      message: "A hosted billing checkout is already open for this account. Finish that checkout before starting another one.",
      httpStatus: 409,
    });
  }

  throw hostedOnboardingError({
    code: "HOSTED_BILLING_CHECKOUT_RETRY_EXHAUSTED",
    message: "The hosted billing checkout could not be prepared safely. Retry in a moment.",
    httpStatus: 503,
    retryable: true,
  });
}

async function resolveReusableHostedBillingCheckout(input: {
  attempt: HostedBillingCheckout;
  now: Date;
  prisma: PrismaClient;
  stripe: Stripe;
}) {
  if (input.attempt.status !== HostedBillingCheckoutStatus.open) {
    return null;
  }

  if (!input.attempt.stripeCheckoutSessionId || !input.attempt.checkoutUrl) {
    await failHostedBillingAttemptById({
      checkoutId: input.attempt.id,
      prisma: input.prisma,
      statuses: [HostedBillingCheckoutStatus.open],
      stripeCheckoutSessionId: input.attempt.stripeCheckoutSessionId,
    });
    return null;
  }

  const stripeSession = await input.stripe.checkout.sessions.retrieve(
    input.attempt.stripeCheckoutSessionId,
  );
  const expiresAtMs = typeof stripeSession.expires_at === "number"
    ? stripeSession.expires_at * 1000
    : null;
  const isOpen =
    stripeSession.status === "open" &&
    (expiresAtMs === null || expiresAtMs > input.now.getTime());

  if (!isOpen) {
    await expireHostedBillingAttemptBySessionId({
      prisma: input.prisma,
      stripeCheckoutSessionId: input.attempt.stripeCheckoutSessionId,
    });
    return null;
  }

  return {
    ...input.attempt,
    checkoutUrl: stripeSession.url ?? input.attempt.checkoutUrl,
  };
}

async function ensureHostedStripeCustomer(input: {
  memberId: string;
  memberSnapshot: Pick<HostedMember, "id" | "stripeCustomerId">;
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
    });

    return currentMember.stripeCustomerId;
  }

  const customer = await input.stripe.customers.create(
    {
      metadata: customerMetadata,
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
  callback: (transaction: Prisma.TransactionClient) => Promise<TResult>,
): Promise<TResult> {
  return typeof prisma.$transaction === "function"
    ? prisma.$transaction((transaction) => callback(transaction))
    : callback(prisma as Prisma.TransactionClient);
}

function buildHostedStripeCustomerIdempotencyKey(memberId: string): string {
  return `hosted-onboarding:stripe-customer:${memberId}`;
}

function buildHostedStripeCheckoutIdempotencyKey(checkoutId: string): string {
  return `hosted-onboarding:stripe-checkout:${checkoutId}`;
}

function isMatchingHostedBillingCheckout(
  attempt: Pick<HostedBillingCheckout, "hasShareContext" | "inviteId" | "memberId" | "mode" | "priceId">,
  requestContext: HostedBillingCheckoutRequestContext,
): boolean {
  return attempt.hasShareContext === requestContext.hasShareContext
    && attempt.inviteId === requestContext.inviteId
    && attempt.memberId === requestContext.memberId
    && attempt.mode === requestContext.mode
    && attempt.priceId === requestContext.priceId;
}

type HostedBillingCheckoutRequestContext = {
  hasShareContext: boolean;
  inviteId: string;
  memberId: string;
  mode: HostedBillingMode;
  priceId: string;
};

type HostedBillingCheckoutReservation =
  | { kind: "alreadyActive" }
  | { kind: "pending"; attempt: HostedBillingCheckout }
  | { kind: "open"; attempt: HostedBillingCheckout }
  | { kind: "conflict_pending"; attempt: HostedBillingCheckout }
  | { kind: "conflict_open"; attempt: HostedBillingCheckout };

async function reserveHostedBillingCheckout(input: {
  customerId: string;
  now: Date;
  prisma: PrismaClient;
  requestContext: HostedBillingCheckoutRequestContext;
}): Promise<HostedBillingCheckoutReservation> {
  return runHostedBillingCheckoutTransaction(input.prisma, async (transaction) => {
    await lockHostedMemberRow(transaction, input.requestContext.memberId);

    const member = typeof transaction.hostedMember.findUnique === "function"
      ? await transaction.hostedMember.findUnique({
          where: {
            id: input.requestContext.memberId,
          },
          select: {
            billingStatus: true,
          },
        })
      : null;

    if (member?.billingStatus === HostedBillingStatus.active) {
      return {
        kind: "alreadyActive",
      };
    }

    const activeAttempt = await findActiveHostedBillingAttemptForMember({
      memberId: input.requestContext.memberId,
      prisma: transaction,
    });

    if (!activeAttempt) {
      return {
        kind: "pending",
        attempt: await createPendingHostedBillingAttempt({
          hasShareContext: input.requestContext.hasShareContext,
          inviteId: input.requestContext.inviteId,
          memberId: input.requestContext.memberId,
          mode: input.requestContext.mode,
          priceId: input.requestContext.priceId,
          prisma: transaction,
          stripeCustomerId: input.customerId,
        }),
      };
    }

    if (isMatchingHostedBillingCheckout(activeAttempt, input.requestContext)) {
      return {
        kind:
          activeAttempt.status === HostedBillingCheckoutStatus.pending
            ? "pending"
            : "open",
        attempt: activeAttempt,
      };
    }

    return {
      kind:
        activeAttempt.status === HostedBillingCheckoutStatus.pending
          ? "conflict_pending"
          : "conflict_open",
      attempt: activeAttempt,
    };
  });
}

async function finalizeHostedBillingCheckoutReservation(input: {
  billingMode: "payment" | "subscription";
  customerId: string;
  inviteCode: string;
  memberId: string;
  priceId: string;
  prisma: PrismaClient;
  publicBaseUrl: string;
  reservation: HostedBillingCheckout;
  shareCode: string | null;
  stripe: Stripe;
}): Promise<{ alreadyActive: boolean; url: string | null }> {
  const checkoutMetadata: Record<string, string> = {
    checkoutId: input.reservation.id,
    inviteId: input.reservation.inviteId ?? "",
    memberId: input.memberId,
  };
  const checkoutSessionParams: Stripe.Checkout.SessionCreateParams = {
    cancel_url: buildStripeCancelUrl(input.publicBaseUrl, input.inviteCode, input.shareCode),
    client_reference_id: input.memberId,
    customer: input.customerId,
    line_items: [
      {
        price: input.priceId,
        quantity: 1,
      },
    ],
    metadata: checkoutMetadata,
    mode: input.billingMode,
    payment_method_types: ["card"],
    success_url: buildStripeSuccessUrl(input.publicBaseUrl, input.inviteCode, input.shareCode),
  };

  if (input.billingMode === "subscription") {
    checkoutSessionParams.subscription_data = {
      metadata: checkoutMetadata,
    };
  } else {
    checkoutSessionParams.payment_intent_data = {
      metadata: checkoutMetadata,
    };
  }

  const checkoutSession = await input.stripe.checkout.sessions.create(
    checkoutSessionParams,
    {
      idempotencyKey: buildHostedStripeCheckoutIdempotencyKey(input.reservation.id),
    },
  );

  if (!checkoutSession.url) {
    await failHostedBillingAttemptById({
      checkoutId: input.reservation.id,
      prisma: input.prisma,
      stripeCheckoutSessionId: checkoutSession.id,
    });
    throw hostedOnboardingError({
      code: "CHECKOUT_URL_MISSING",
      message: "Stripe Checkout did not return a redirect URL.",
      httpStatus: 502,
    });
  }

  try {
    await runHostedBillingCheckoutTransaction(input.prisma, async (transaction) => {
      await lockHostedMemberRow(transaction, input.memberId);

      const latestAttempt = await transaction.hostedBillingCheckout.findUnique({
        where: {
          id: input.reservation.id,
        },
      });

      if (!latestAttempt) {
        throw hostedOnboardingError({
          code: "HOSTED_BILLING_CHECKOUT_MISSING",
          message: "The hosted billing checkout reservation no longer exists.",
          httpStatus: 503,
          retryable: true,
        });
      }

      if (
        latestAttempt.status === HostedBillingCheckoutStatus.open
        && latestAttempt.stripeCheckoutSessionId === checkoutSession.id
      ) {
        await transaction.hostedMember.update({
          where: {
            id: input.memberId,
          },
          data: {
            billingMode: latestAttempt.mode,
            billingStatus: HostedBillingStatus.checkout_open,
            stripeCustomerId: input.customerId,
            stripeLatestCheckoutSessionId: checkoutSession.id,
          },
        });
        return;
      }

      if (latestAttempt.status !== HostedBillingCheckoutStatus.pending) {
        throw hostedOnboardingError({
          code: "HOSTED_BILLING_CHECKOUT_RESERVATION_CONFLICT",
          message: "The hosted billing checkout reservation changed before it could be finalized. Retry in a moment.",
          httpStatus: 503,
          retryable: true,
        });
      }

      await finalizeHostedBillingAttemptById({
        checkoutId: latestAttempt.id,
        checkoutUrl: checkoutSession.url!,
        prisma: transaction,
        stripeCheckoutSessionId: checkoutSession.id,
        stripeCustomerId: input.customerId,
        stripeSubscriptionId: coerceStripeSubscriptionId(checkoutSession.subscription),
      });
      await transaction.hostedMember.update({
        where: {
          id: input.memberId,
        },
        data: {
          billingMode: latestAttempt.mode,
          billingStatus: HostedBillingStatus.checkout_open,
          stripeCustomerId: input.customerId,
          stripeLatestCheckoutSessionId: checkoutSession.id,
        },
      });
    });
  } catch (error) {
    if (isHostedOnboardingError(error)) {
      throw error;
    }

    throw hostedOnboardingError({
      code: "HOSTED_BILLING_CHECKOUT_FINALIZE_FAILED",
      message: "Stripe Checkout was created, but the hosted billing record could not be finalized safely. Retry in a moment.",
      httpStatus: 503,
      retryable: true,
    });
  }

  return {
    alreadyActive: false,
    url: checkoutSession.url,
  };
}

function resolveHostedMemberWalletAddress(input: {
  existingWalletAddress: string | null | undefined;
  linkedAccounts: readonly PrivyLinkedAccountLike[];
  requireWalletAddress: boolean;
}): string | null {
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
          message: "This hosted member is already bound to different verified account details.",
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
      message: "The hosted account details are invalid.",
      httpStatus: 400,
    });
  }

  if (input.requireWalletAddress) {
    throw hostedOnboardingError({
      code: "HOSTED_WALLET_ADDRESS_REQUIRED",
      message: "Your account setup must finish before Stripe checkout can begin.",
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
